#!/usr/bin/env node
/**
 * Row-level-security coverage gate over `packages/db/migrations/*.sql`.
 *
 * Requirements: NFR-SEC-01, NFR-SEC-02, NFR-SEC-07. Invariants 3 and 4.
 *
 * `lint-sql.mjs` answers "is this statement written correctly". This answers a
 * different and more important question: "for every table that exists, is
 * anything actually protecting it". The two overlap on purpose. A migration
 * can pass every statement-level rule and still leave a table with RLS enabled
 * and no policy, or with policies that quietly ignore `org_id` — which is not
 * a syntax defect, it is a cross-tenant read.
 *
 * The output is a coverage table rather than a list of errors because coverage
 * is the thing a reviewer needs to see at a glance before a launch: every
 * table, its schema class, whether RLS is on, how many policies it has, and
 * whether tenancy is constrained.
 *
 * Exit code is non-zero when any exposed-schema table has zero policies.
 *
 * Usage:
 *   node scripts/check-rls.mjs             coverage table, human readable
 *   node scripts/check-rls.mjs --json      machine-readable coverage
 *   node scripts/check-rls.mjs --self-test prove the analysis still works
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Report, selfTest } from './lib/report.mjs';
import { buildModel, parseFile, qkey } from './lib/sql.mjs';
import { repoRoot } from './lib/walk.mjs';

const ROOT = repoRoot(import.meta.url);
const MIGRATIONS_DIR = join(ROOT, 'packages', 'db', 'migrations');

/**
 * Names that indicate a table holds material a student must never read, no
 * matter what its policies say. NFR-SEC-02 puts these in a non-exposed schema
 * because RLS filters rows and never columns: one `?select=answer` against a
 * permissively-policied table dumps the key for every question in the bank.
 */
const SENSITIVE_NAME = /(answer_key|answerkey|solution|rationale|user_role|role_grant|role_assignment|licence_evidence|license_evidence|provenance_evidence)/i;

export function coverage(files) {
  const parsedFiles = files.map(({ file, source }) => ({
    file,
    source,
    records: parseFile(file, source),
  }));
  const model = buildModel(parsedFiles);

  const rows = [];
  for (const table of model.tables.values()) {
    // Tables only referenced (foreign keys, ALTERs against auth.users) are not
    // ours to police; only tables this migration set creates.
    if (!table.declaredIn) continue;
    if (table.kind === 'system') continue;

    const policies = table.policies;
    const orgConstrained =
      policies.length > 0 &&
      policies.every((p) => /\borg_id\b/i.test(`${p.using ?? ''} ${p.withCheck ?? ''}`));
    const roles = [...new Set(policies.flatMap((p) => p.roles ?? ['public']))].sort();

    rows.push({
      table: table.key,
      schemaClass: table.kind,
      isPartition: table.isPartition,
      declaredIn: table.declaredIn,
      loc: table.loc,
      rlsEnabled: table.rlsEnabled,
      rlsForced: table.rlsForced,
      policyCount: policies.length,
      roles,
      hasOrgId: table.hasOrgId,
      orgConstrained,
      commented: table.commented,
      sensitive: SENSITIVE_NAME.test(table.name),
    });
  }

  rows.sort((a, b) => a.table.localeCompare(b.table));
  return rows;
}

export function evaluate(rows) {
  const report = new Report(
    'rls-gate',
    'Proves every client-exposed table is actually protected, and that tenancy is constrained in the policy rather than in application code.',
  );

  for (const row of rows) {
    if (row.schemaClass === 'exposed') {
      if (row.policyCount === 0) {
        report.fail(
          'COV-001',
          `${row.table} is in the client-exposed schema with zero policies. Every authenticated user — that is, every student on the platform — can read it.`,
          row.loc,
          'A table ships with RLS enabled and at least one policy, or it does not ship (invariant 3).',
        );
      }
      if (!row.rlsEnabled) {
        report.fail(
          'COV-002',
          `${row.table} never has ENABLE ROW LEVEL SECURITY applied. Policies on a table without RLS enabled are inert.`,
          row.loc,
          `ALTER TABLE ${row.table} ENABLE ROW LEVEL SECURITY;`,
        );
      }
      if (row.hasOrgId && row.policyCount > 0 && !row.orgConstrained) {
        report.fail(
          'COV-003',
          `${row.table} carries org_id but at least one policy does not constrain it. A policy that filters on user and not org is a cross-tenant leak (invariant 4).`,
          row.loc,
          'Add the org predicate to every policy on this table, not only the SELECT one.',
        );
      }
      if (row.sensitive) {
        report.fail(
          'COV-004',
          `${row.table} looks like answer-key, solution, role or licence-evidence material but sits in the client-exposed schema. RLS controls rows, never columns.`,
          row.loc,
          'Move it to a non-exposed schema with zero grants to authenticated, reached through a state-checking RPC (NFR-SEC-02).',
        );
      }
      if (row.roles.includes('public')) {
        report.fail(
          'COV-005',
          `${row.table} has a policy granted to the public role, which includes unauthenticated anon requests.`,
          row.loc,
          'Scope every policy TO authenticated.',
        );
      }
      if (row.policyCount > 0 && !row.hasOrgId) {
        report.warn(
          'COV-006',
          `${row.table} has policies but no org_id column. Confirm this table is genuinely not org-scoped.`,
          row.loc,
          'If it is org-scoped, add org_id NOT NULL and constrain it (FR-TEN-01).',
        );
      }
    }

    if (row.schemaClass === 'private' && row.policyCount > 0) {
      report.info(
        'COV-007',
        `${row.table} is in a non-exposed schema and still defines ${row.policyCount} policy/policies. Harmless, but the isolation guarantee here is the absent grant, not the policy.`,
        row.loc,
      );
    }
  }

  return report;
}

function renderTable(rows) {
  const headers = ['Table', 'Schema', 'RLS', 'Policies', 'Roles', 'org_id', 'Constrained'];
  const body = rows.map((r) => [
    r.table + (r.isPartition ? ' (partition)' : ''),
    r.schemaClass,
    r.rlsEnabled ? (r.rlsForced ? 'on+forced' : 'on') : 'OFF',
    String(r.policyCount),
    r.roles.length > 0 ? r.roles.join('+') : '-',
    r.hasOrgId ? 'yes' : 'no',
    r.policyCount === 0 ? '-' : r.orgConstrained ? 'yes' : r.hasOrgId ? 'NO' : 'n/a',
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length), 3),
  );
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');

  const out = [line(headers), line(widths.map((w) => '-'.repeat(w)))];
  for (const row of body) out.push(line(row));
  return { text: out.join('\n'), headers, rows: body };
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

const FIXTURE_GOOD = `
  create table public.attempt (
    id uuid primary key,
    org_id uuid not null,
    user_id uuid not null
  );
  alter table public.attempt enable row level security;
  comment on table public.attempt is 'Attempts.';
  create policy attempt_select on public.attempt for select to authenticated
    using (org_id = (select private.current_org_id()) and user_id = (select auth.uid()));
  create policy attempt_insert on public.attempt for insert to authenticated
    with check (org_id = (select private.current_org_id()) and user_id = (select auth.uid()));
`;

const FIXTURE_NO_POLICY = `
  create table public.attempt (id uuid primary key, org_id uuid not null);
  alter table public.attempt enable row level security;
`;

const FIXTURE_PARTIAL_TENANCY = `
  create table public.response (id uuid primary key, org_id uuid not null, user_id uuid not null);
  alter table public.response enable row level security;
  create policy r_select on public.response for select to authenticated
    using (org_id = (select private.current_org_id()));
  create policy r_update on public.response for update to authenticated
    using (user_id = (select auth.uid()));
`;

const FIXTURE_EXPOSED_KEY = `
  create table public.answer_key (id uuid primary key, org_id uuid not null, correct_option_id uuid);
  alter table public.answer_key enable row level security;
  create policy k on public.answer_key for select to authenticated
    using (org_id = (select private.current_org_id()));
`;

const FIXTURE_PRIVATE_KEY = `
  create table private.answer_key (id uuid primary key, org_id uuid not null);
`;

const FIXTURE_LATE_RLS = [
  { file: 'a.sql', source: `create table public.note (id uuid primary key, org_id uuid not null);` },
  {
    file: 'b.sql',
    source: `alter table public.note enable row level security;
      create policy n on public.note for select to authenticated
        using (org_id = (select private.current_org_id()));`,
  },
];

function failuresFor(files) {
  const list = Array.isArray(files) ? files : [{ file: 'fixture.sql', source: files }];
  return new Set(
    evaluate(coverage(list))
      .findings.filter((f) => f.level === 'fail')
      .map((f) => f.rule),
  );
}

function runSelfTest() {
  return selfTest('check-rls', [
    {
      name: 'a fully protected org-scoped table produces no failures',
      assert: () => failuresFor(FIXTURE_GOOD).size === 0,
    },
    {
      name: 'COV-001 fires on an exposed table with RLS on and zero policies',
      assert: () => failuresFor(FIXTURE_NO_POLICY).has('COV-001'),
    },
    {
      name: 'COV-003 fires when only some policies constrain org_id',
      assert: () => failuresFor(FIXTURE_PARTIAL_TENANCY).has('COV-003'),
    },
    {
      name: 'COV-004 fires on an answer-key table in the exposed schema',
      assert: () => failuresFor(FIXTURE_EXPOSED_KEY).has('COV-004'),
    },
    {
      name: 'the same answer-key table in a private schema is accepted',
      assert: () => failuresFor(FIXTURE_PRIVATE_KEY).size === 0,
    },
    {
      name: 'RLS enabled by a later migration than the CREATE TABLE still counts',
      assert: () => failuresFor(FIXTURE_LATE_RLS).size === 0,
    },
    {
      name: 'coverage records policy count and role scoping',
      assert: () => {
        const rows = coverage([{ file: 'f.sql', source: FIXTURE_GOOD }]);
        const row = rows.find((r) => r.table === 'public.attempt');
        return (
          rows.length === 1 &&
          row.policyCount === 2 &&
          row.rlsEnabled === true &&
          row.hasOrgId === true &&
          row.orgConstrained === true &&
          row.roles.join(',') === 'authenticated'
        );
      },
    },
    {
      name: 'a table this migration set only references is not counted as owned',
      assert: () => {
        const rows = coverage([
          {
            file: 'f.sql',
            source: `create table public.profile (
                user_id uuid primary key references auth.users (id),
                org_id uuid not null references public.org (id));
              alter table public.profile enable row level security;
              create policy p on public.profile for select to authenticated
                using (org_id = (select private.current_org_id()));`,
          },
        ]);
        return rows.length === 1 && rows[0].table === 'public.profile';
      },
    },
  ]);
}

// --- Entry point -----------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  process.exit(runSelfTest());
}

const migrations = loadMigrations();
const rows = coverage(migrations);

if (argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ tables: rows }, null, 2)}\n`);
  const exitCode = evaluate(rows).count('fail') > 0 ? 1 : 0;
  process.exit(exitCode);
}

const rendered = renderTable(rows);
const report = evaluate(rows);

if (migrations.length === 0) {
  report.note('No .sql files under packages/db/migrations; nothing to cover yet.');
} else {
  const exposed = rows.filter((r) => r.schemaClass === 'exposed');
  const covered = exposed.filter((r) => r.rlsEnabled && r.policyCount > 0);
  report.note(
    `${rows.length} table(s) across ${migrations.length} migration(s): ` +
      `${exposed.length} exposed, ${covered.length} with RLS enabled and at least one policy, ` +
      `${rows.length - exposed.length} in non-exposed schemas.`,
  );
  process.stdout.write(`\n${rendered.text}\n`);
}

process.exit(
  report.finish({ summaryTable: { headers: rendered.headers, rows: rendered.rows } }),
);
