#!/usr/bin/env node
/**
 * Static analysis gate over `packages/db/migrations/*.sql`.
 *
 * Requirements: NFR-SEC-01, NFR-SEC-02, NFR-SEC-03, NFR-SEC-06, NFR-AVL-03.
 * Invariants 3 and 4 in `docs/agent.md` Part A.
 *
 * Every rule below corresponds to a specific, catalogued way this product
 * dies. None of them are style:
 *
 *   RLS-001  A table without RLS in the client-exposed schema is readable by
 *            every authenticated user, which is every student on the platform.
 *   POL-001  A policy with no TO clause defaults to PUBLIC, which includes the
 *            anon role. The policy looks written and enforces nothing useful.
 *   POL-002  `TO public` is the same defect stated explicitly.
 *   POL-003  A bare `auth.uid()` is re-evaluated once per row instead of once
 *            per query. The difference is invisible against a thousand
 *            development rows and is orders of magnitude at exam scale.
 *   VIEW-001 A view defaults to DEFINER semantics and therefore bypasses RLS
 *            entirely. `docs/agent.md` names this the single most-missed
 *            finding in this codebase, so it is the rule to keep sharpest.
 *   FN-001   A SECURITY DEFINER function without a pinned search_path can be
 *            hijacked by a schema the caller controls.
 *   IDX-001  A non-concurrent index build takes ACCESS EXCLUSIVE on the
 *            hottest table in the system and loses every in-flight attempt.
 *
 * Usage:
 *   node scripts/lint-sql.mjs            lint the migration directory
 *   node scripts/lint-sql.mjs --self-test  prove the rules still fire
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Report, selfTest } from './lib/report.mjs';
import {
  HOT_TABLE_PATTERN,
  buildModel,
  mask,
  matches,
  parseFile,
  qkey,
  schemaKind,
} from './lib/sql.mjs';
import { repoRoot } from './lib/walk.mjs';

const ROOT = repoRoot(import.meta.url);
const MIGRATIONS_DIR = join(ROOT, 'packages', 'db', 'migrations');

/**
 * Wrapped means literally `(select auth.uid())`. Anything else — a bare call,
 * or a call inside an expression that is not its own subselect — is re-planned
 * per row. Matching on the preceding text rather than trying to parse the
 * expression keeps this rule impossible to accidentally weaken.
 */
const RE_AUTH_UID = /auth\s*\.\s*uid\s*\(\s*\)/gi;
const RE_WRAPPED_PREFIX = /\(\s*select\s+$/i;

function findUnwrappedAuthUid(text) {
  return matches(RE_AUTH_UID, text).filter(
    ({ index }) => !RE_WRAPPED_PREFIX.test(text.slice(Math.max(0, index - 40), index)),
  );
}

/** `security_invoker = on` (or `true`) inside the view's WITH options. */
function hasSecurityInvoker(options) {
  return /\bsecurity_invoker\s*=\s*(on|true)\b/i.test(options);
}

export function lint(files) {
  const report = new Report(
    'sql-lint',
    'Blocks migrations that would leave a table, view or policy silently open to every student.',
  );

  const parsedFiles = files.map(({ file, source }) => ({
    file,
    source,
    records: parseFile(file, source),
  }));
  const model = buildModel(parsedFiles);
  const maskedByFile = new Map(files.map(({ file, source }) => [file, mask(source)]));

  // --- Table-level rules, resolved across the whole migration set. A later
  // --- migration is allowed to enable RLS on an earlier table.
  for (const table of model.tables.values()) {
    if (!table.declaredIn) continue; // referenced only, never created here
    if (table.kind === 'system') continue;

    if (table.kind === 'exposed' && !table.rlsEnabled) {
      report.fail(
        'RLS-001',
        `Table ${table.key} is created in the client-exposed schema with no ENABLE ROW LEVEL SECURITY anywhere in the migration set.`,
        table.loc,
        table.isPartition
          ? `Partitions carry their own RLS when selected directly. Add: ALTER TABLE ${table.key} ENABLE ROW LEVEL SECURITY;`
          : `Add: ALTER TABLE ${table.key} ENABLE ROW LEVEL SECURITY; and at least one policy TO authenticated.`,
      );
    }

    if (table.kind === 'exposed' && table.rlsEnabled && table.policies.length === 0) {
      report.fail(
        'RLS-002',
        `Table ${table.key} has RLS enabled but zero policies. RLS with no policy denies everyone, including the application.`,
        table.loc,
        'Add at least one policy scoped TO authenticated and constrained on org_id.',
      );
    }

    if (!table.commented) {
      report.warn(
        'DOC-001',
        `Table ${table.key} has no COMMENT ON TABLE. Schema intent is the only durable documentation of a tenancy boundary.`,
        table.loc,
        `Add: COMMENT ON TABLE ${table.key} IS '...';`,
      );
    }
  }

  // --- Statement-level rules.
  for (const stmt of model.statements) {
    if (stmt.kind === 'policy') {
      const table = model.tables.get(qkey(stmt.name));
      const kind = table?.kind ?? schemaKind(stmt.name.schema);

      if (stmt.roles === null) {
        report.fail(
          'POL-001',
          `Policy "${stmt.policyName}" on ${qkey(stmt.name)} has no TO clause, so it applies TO PUBLIC — including the anon role.`,
          stmt.loc,
          'Add an explicit `TO authenticated` (or the narrowest role that needs it).',
        );
      } else if (stmt.roles.includes('public')) {
        report.fail(
          'POL-002',
          `Policy "${stmt.policyName}" on ${qkey(stmt.name)} is scoped TO public, which grants the unauthenticated anon role.`,
          stmt.loc,
          'Scope the policy TO authenticated.',
        );
      }

      for (const hit of findUnwrappedAuthUid(stmt.source)) {
        report.fail(
          'POL-003',
          `Policy "${stmt.policyName}" on ${qkey(stmt.name)} calls auth.uid() unwrapped; it is re-evaluated once per candidate row.`,
          offsetLoc(stmt, hit.index, files),
          'Write (select auth.uid()) so the planner evaluates it once as an InitPlan.',
        );
      }

      if (kind === 'exposed' && table?.hasOrgId) {
        const predicate = `${stmt.using ?? ''} ${stmt.withCheck ?? ''}`;
        if (!/\borg_id\b/i.test(predicate)) {
          report.fail(
            'TEN-001',
            `Policy "${stmt.policyName}" on ${qkey(stmt.name)} does not constrain org_id, so it permits cross-tenant rows that satisfy the user predicate.`,
            stmt.loc,
            'Add the tenancy predicate, e.g. org_id = (select private.current_org_id()).',
          );
        }
      }
    }

    if (stmt.kind === 'view') {
      const kind = schemaKind(stmt.name.schema);
      if (kind === 'exposed' && stmt.materialized) {
        report.fail(
          'VIEW-002',
          `Materialized view ${qkey(stmt.name)} is in the client-exposed schema. Materialized views cannot run with invoker security and always bypass RLS.`,
          stmt.loc,
          'Move it to a private schema and expose it through a state-checking RPC.',
        );
      } else if (kind === 'exposed' && !hasSecurityInvoker(stmt.options)) {
        report.fail(
          'VIEW-001',
          `View ${qkey(stmt.name)} is in the client-exposed schema without WITH (security_invoker = on). Views default to definer semantics and bypass RLS entirely.`,
          stmt.loc,
          `Add: CREATE VIEW ${qkey(stmt.name)} WITH (security_invoker = on) AS ...`,
        );
      }
    }

    if (stmt.kind === 'function' && stmt.securityDefiner && !stmt.setsSearchPath) {
      report.fail(
        'FN-001',
        `SECURITY DEFINER function ${qkey(stmt.name)} does not SET search_path. A caller-controlled schema can shadow any unqualified name in the body.`,
        stmt.loc,
        "Add: SET search_path = '' and schema-qualify every reference in the body.",
      );
    }

    if (stmt.kind === 'function' && stmt.securityDefiner && stmt.setsSearchPath) {
      const setting = /\bSET\s+search_path\s*(?:=|TO)\s*([^\s;]+)/i.exec(stmt.raw);
      const value = setting ? setting[1].replace(/['"]/g, '').trim() : '';
      if (value !== '' && value.toLowerCase() !== 'pg_catalog') {
        report.warn(
          'FN-002',
          `SECURITY DEFINER function ${qkey(stmt.name)} pins search_path to "${value}" rather than the empty path.`,
          stmt.loc,
          "Prefer SET search_path = '' with fully qualified references.",
        );
      }
    }

    if (stmt.kind === 'index' && !stmt.concurrent) {
      const target = qkey(stmt.name);
      const fileTouchesHot = touchesHotTable(maskedByFile, stmt.file);
      if (HOT_TABLE_PATTERN.test(target)) {
        report.fail(
          'IDX-001',
          `CREATE INDEX on ${target} is not CONCURRENTLY. A blocking build on an attempt or response table takes ACCESS EXCLUSIVE and fails every in-flight exam.`,
          stmt.loc,
          'Use CREATE INDEX CONCURRENTLY, in its own migration outside any transaction block.',
        );
      } else if (fileTouchesHot) {
        report.fail(
          'IDX-002',
          `CREATE INDEX on ${target} is not CONCURRENTLY, in a migration that also touches attempt or response tables. The migration transaction holds the lock for the whole file.`,
          stmt.loc,
          'Use CONCURRENTLY, or split the index build into a migration that touches no hot table.',
        );
      }
    }

    if (stmt.kind === 'drop_table') {
      report.warn(
        'DES-001',
        'DROP TABLE in a migration. Invariant 2: retirement is a status, never a delete, and a dropped table takes every attempt that pinned it.',
        stmt.loc,
        'Confirm no student-visible data referenced this table, and record the decision in the pull request.',
      );
    }

    if (stmt.kind === 'truncate') {
      report.warn(
        'DES-002',
        'TRUNCATE in a migration. This is unrecoverable and does not fire row triggers, including audit triggers.',
        stmt.loc,
        'Confirm this runs only against seed or fixture data.',
      );
    }

    if (stmt.kind === 'grant') {
      const toAuthenticated = stmt.grantees.some((g) => g === 'authenticated' || g === 'public');
      if (toAuthenticated && schemaKind(schemaOfGrantTarget(stmt.target)) === 'private') {
        report.fail(
          'SEC-002',
          `GRANT on ${stmt.target} to ${stmt.grantees.join(', ')} exposes a private-schema object. NFR-SEC-02 requires zero grants to the authenticated role there.`,
          stmt.loc,
          'Revoke the grant and reach the object through a SECURITY DEFINER RPC that checks attempt state.',
        );
      }
    }
  }

  return report;
}

function schemaOfGrantTarget(target) {
  const cleaned = target.replace(/^\s*(all\s+tables\s+in\s+schema|table|schema|function)\s+/i, '');
  const dot = cleaned.indexOf('.');
  return dot === -1 ? cleaned.trim() : cleaned.slice(0, dot).trim();
}

/**
 * Whether a migration file structurally references an attempt or response
 * table.
 *
 * Deliberately tested against the *masked* source rather than the raw text.
 * Prose about attempts is everywhere in this schema's comments, and every
 * permission row is a string literal like 'attempts.extend'. Matching those
 * would flag every index in the repository and the gate would be switched off
 * within a week.
 */
function touchesHotTable(maskedByFile, file) {
  const masked = maskedByFile.get(file);
  return masked ? HOT_TABLE_PATTERN.test(masked) : false;
}

/** Convert a match index inside a statement back into a file location. */
function offsetLoc(stmt, relIndex, files) {
  const entry = files.find((f) => f.file === stmt.file);
  if (!entry) return stmt.loc;
  const abs = stmt.start + relIndex;
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < abs && i < entry.source.length; i += 1) {
    if (entry.source[i] === '\n') {
      line += 1;
      lastNewline = i;
    }
  }
  return { file: stmt.file, line, col: abs - lastNewline };
}

function loadMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort()
    .map((f) => ({
      file: `packages/db/migrations/${f}`,
      source: readFileSync(join(MIGRATIONS_DIR, f), 'utf8'),
    }));
}

// --- Self-test -------------------------------------------------------------
// The migration directory is empty until the schema lands, and an empty
// directory makes every rule vacuously pass. A gate nobody can tell is broken
// is worse than no gate, so CI runs this first and it fails if a rule stops
// firing.

const FIXTURES = {
  missingRls: `CREATE TABLE public.note (id uuid PRIMARY KEY, org_id uuid NOT NULL);`,
  goodTable: `
    CREATE TABLE public.note (id uuid PRIMARY KEY, org_id uuid NOT NULL);
    ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE public.note IS 'Student notes.';
    CREATE POLICY note_select ON public.note FOR SELECT TO authenticated
      USING (org_id = (select private.current_org_id()) AND user_id = (select auth.uid()));`,
  policyNoTo: `
    CREATE TABLE public.note (id uuid PRIMARY KEY);
    ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE public.note IS 'x';
    CREATE POLICY note_all ON public.note USING (true);`,
  policyToPublic: `
    CREATE TABLE public.note (id uuid PRIMARY KEY);
    ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE public.note IS 'x';
    CREATE POLICY note_all ON public.note FOR SELECT TO public USING (true);`,
  bareAuthUid: `
    CREATE TABLE public.note (id uuid PRIMARY KEY);
    ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE public.note IS 'x';
    CREATE POLICY note_all ON public.note FOR SELECT TO authenticated USING (user_id = auth.uid());`,
  definerView: `CREATE VIEW public.attempt_summary AS SELECT 1;`,
  invokerView: `CREATE VIEW public.attempt_summary WITH (security_invoker = on) AS SELECT 1;`,
  matView: `CREATE MATERIALIZED VIEW public.cohort_stats AS SELECT 1;`,
  definerNoPath: `
    CREATE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    AS $$ SELECT org_id FROM private.membership WHERE user_id = (select auth.uid()) $$;`,
  definerWithPath: `
    CREATE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER SET search_path = ''
    AS $$ SELECT org_id FROM private.membership WHERE user_id = (select auth.uid()) $$;`,
  blockingIndex: `CREATE INDEX idx_response_attempt ON public.response (attempt_id);`,
  concurrentIndex: `CREATE INDEX CONCURRENTLY idx_response_attempt ON public.response (attempt_id);`,
  indexBesideHotTable: `
    ALTER TABLE public.attempt ADD COLUMN sealed_at timestamptz;
    CREATE INDEX idx_profile_org ON public.profile (org_id);`,
  attemptOnlyInProse: `
    -- Every content policy gates on consent before a student may start an attempt.
    INSERT INTO private.permission (code, label) VALUES ('attempts.extend', 'Extend a deadline');
    CREATE INDEX idx_profile_org ON public.profile (org_id);`,
  privateTableNoRls: `CREATE TABLE private.answer_key (id uuid PRIMARY KEY);
    COMMENT ON TABLE private.answer_key IS 'Keys. No grants to authenticated.';`,
  grantPrivate: `GRANT SELECT ON private.answer_key TO authenticated;`,
  crossTenantPolicy: `
    CREATE TABLE public.attempt (id uuid PRIMARY KEY, org_id uuid NOT NULL);
    ALTER TABLE public.attempt ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE public.attempt IS 'x';
    CREATE POLICY a ON public.attempt FOR SELECT TO authenticated
      USING (user_id = (select auth.uid()));`,
  commentedOutPolicy: `
    CREATE TABLE public.note (id uuid PRIMARY KEY);
    ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE public.note IS 'x';
    -- CREATE POLICY ghost ON public.note USING (true);
    /* CREATE POLICY ghost2 ON public.note USING (true); */
    CREATE POLICY real ON public.note FOR SELECT TO authenticated USING (true);`,
  authUidInsideDollarBody: `
    CREATE TABLE public.note (id uuid PRIMARY KEY);
    ALTER TABLE public.note ENABLE ROW LEVEL SECURITY;
    COMMENT ON TABLE public.note IS 'x';
    CREATE POLICY real ON public.note FOR SELECT TO authenticated USING (true);
    CREATE FUNCTION public.f() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = ''
      AS $fn$ SELECT auth.uid(); $fn$;`,
};

function rulesFired(sql) {
  const report = lint([{ file: 'fixture.sql', source: sql }]);
  return new Set(report.findings.filter((f) => f.level === 'fail').map((f) => f.rule));
}

function noFailures(sql) {
  return rulesFired(sql).size === 0;
}

function runSelfTest() {
  return selfTest('lint-sql', [
    {
      name: 'RLS-001 fires on an exposed table with no ENABLE ROW LEVEL SECURITY',
      assert: () => rulesFired(FIXTURES.missingRls).has('RLS-001'),
    },
    {
      name: 'a correctly written table produces no failures',
      assert: () => noFailures(FIXTURES.goodTable),
    },
    {
      name: 'POL-001 fires on a policy with no TO clause',
      assert: () => rulesFired(FIXTURES.policyNoTo).has('POL-001'),
    },
    {
      name: 'POL-002 fires on a policy scoped TO public',
      assert: () => rulesFired(FIXTURES.policyToPublic).has('POL-002'),
    },
    {
      name: 'POL-003 fires on a bare auth.uid() in a policy body',
      assert: () => rulesFired(FIXTURES.bareAuthUid).has('POL-003'),
    },
    {
      name: 'POL-003 does not fire on (select auth.uid())',
      assert: () => !rulesFired(FIXTURES.goodTable).has('POL-003'),
    },
    {
      name: 'VIEW-001 fires on an exposed view without security_invoker',
      assert: () => rulesFired(FIXTURES.definerView).has('VIEW-001'),
    },
    {
      name: 'VIEW-001 does not fire when security_invoker is on',
      assert: () => !rulesFired(FIXTURES.invokerView).has('VIEW-001'),
    },
    {
      name: 'VIEW-002 fires on a materialized view in the exposed schema',
      assert: () => rulesFired(FIXTURES.matView).has('VIEW-002'),
    },
    {
      name: 'FN-001 fires on SECURITY DEFINER without SET search_path',
      assert: () => rulesFired(FIXTURES.definerNoPath).has('FN-001'),
    },
    {
      name: 'FN-001 does not fire when search_path is pinned empty',
      assert: () => !rulesFired(FIXTURES.definerWithPath).has('FN-001'),
    },
    {
      name: 'IDX-001 fires on a non-concurrent index on a response table',
      assert: () => rulesFired(FIXTURES.blockingIndex).has('IDX-001'),
    },
    {
      name: 'IDX-001 does not fire on CREATE INDEX CONCURRENTLY',
      assert: () => !rulesFired(FIXTURES.concurrentIndex).has('IDX-001'),
    },
    {
      name: 'IDX-002 fires on a blocking index built alongside an attempt-table change',
      assert: () => rulesFired(FIXTURES.indexBesideHotTable).has('IDX-002'),
    },
    {
      name: 'IDX-002 does not fire when "attempt" appears only in prose and string literals',
      assert: () => !rulesFired(FIXTURES.attemptOnlyInProse).has('IDX-002'),
    },
    {
      name: 'a private-schema table is not required to carry RLS policies',
      assert: () => noFailures(FIXTURES.privateTableNoRls),
    },
    {
      name: 'SEC-002 fires on a GRANT of a private object to authenticated',
      assert: () => rulesFired(FIXTURES.grantPrivate).has('SEC-002'),
    },
    {
      name: 'TEN-001 fires when an org-scoped policy omits org_id',
      assert: () => rulesFired(FIXTURES.crossTenantPolicy).has('TEN-001'),
    },
    {
      name: 'a policy that exists only inside a comment does not satisfy the gate',
      assert: () => {
        const report = lint([{ file: 'f.sql', source: FIXTURES.commentedOutPolicy }]);
        const policies = report.findings.filter((f) => f.rule.startsWith('POL-'));
        // The two commented policies have no TO clause. If the masker were
        // broken they would be parsed and would raise POL-001 twice.
        return policies.length === 0;
      },
    },
    {
      name: 'auth.uid() inside a dollar-quoted function body is not a policy finding',
      assert: () => !rulesFired(FIXTURES.authUidInsideDollarBody).has('POL-003'),
    },
  ]);
}

// --- Entry point -----------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  process.exit(runSelfTest());
}

const migrations = loadMigrations();
const report = lint(migrations);

if (migrations.length === 0) {
  report.note(
    `No .sql files under packages/db/migrations. The gate is live but has nothing to check yet; run --self-test to confirm the rules still fire.`,
  );
} else {
  report.note(`Analysed ${migrations.length} migration file(s).`);
}

process.exit(report.finish());
