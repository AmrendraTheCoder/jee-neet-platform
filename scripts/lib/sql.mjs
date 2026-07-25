/**
 * Zero-dependency SQL reader shared by `lint-sql.mjs` and `check-rls.mjs`.
 *
 * Requirements: NFR-SEC-01, NFR-SEC-02, NFR-SEC-03, NFR-SEC-06, NFR-AVL-03.
 *
 * This is deliberately not a full PostgreSQL grammar. It is a masking
 * tokeniser plus a set of statement recognisers, which is enough to answer
 * the six questions CI actually needs answered about a migration and is
 * something that can be read and audited in one sitting.
 *
 * The masking step is the part that matters. Migrations are full of
 * dollar-quoted function bodies and string literals containing SQL-looking
 * text; a naive regex over raw source reports the `CREATE POLICY` inside a
 * comment and misses the real one. Masking replaces comments, string bodies
 * and dollar-quoted bodies with spaces while preserving every byte offset and
 * newline, so a match index in the masked text maps to the same file:line:col
 * in the original.
 */

/**
 * Schemas that are not reachable by the `authenticated` role.
 *
 * NFR-SEC-02: answer keys, solutions, role assignments and licence evidence
 * live here with zero grants. The list is a closed set on purpose. Anything
 * not named here is treated as client-exposed, because the failure mode of
 * guessing wrong in the other direction is a readable answer key.
 */
export const PRIVATE_SCHEMAS = new Set([
  'private',
  'app_private',
  'internal',
  'restricted',
  'secure',
  'audit_private',
]);

/**
 * Schemas owned by PostgreSQL or by the platform provider. Objects here are
 * not ours to police; flagging them produces noise that trains reviewers to
 * ignore the gate.
 */
export const SYSTEM_SCHEMAS = new Set([
  'information_schema',
  'auth',
  'storage',
  'realtime',
  'vault',
  'extensions',
  'graphql',
  'graphql_public',
  'cron',
  'net',
  'supabase_migrations',
  'supabase_functions',
]);

/** Tables whose index builds must never take a blocking lock (NFR-AVL-03). */
export const HOT_TABLE_PATTERN = /\b\w*(attempt|response)\w*\b/i;

/** 'system' | 'private' | 'exposed'. */
export function schemaKind(schema) {
  const s = (schema ?? 'public').toLowerCase();
  if (s.startsWith('pg_') || SYSTEM_SCHEMAS.has(s)) return 'system';
  if (PRIVATE_SCHEMAS.has(s)) return 'private';
  return 'exposed';
}

/**
 * Replace comments, string bodies and dollar-quoted bodies with spaces,
 * preserving length and newlines so offsets survive.
 */
export function mask(sql) {
  const out = sql.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < sql.length; k += 1) {
      if (sql[k] !== '\n') out[k] = ' ';
    }
  };

  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      let j = sql.indexOf('\n', i);
      if (j === -1) j = sql.length;
      blank(i, j);
      i = j;
      continue;
    }

    if (two === '/*') {
      // PostgreSQL block comments nest, unlike C.
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.slice(j, j + 2) === '/*') {
          depth += 1;
          j += 2;
        } else if (sql.slice(j, j + 2) === '*/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      blank(i, j);
      i = j;
      continue;
    }

    if (ch === '$') {
      // A dollar quote, not a positional parameter: `$1` cannot match because
      // the optional tag must start with a letter or underscore.
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const end = sql.indexOf(tag, bodyStart);
        const bodyEnd = end === -1 ? sql.length : end;
        blank(bodyStart, bodyEnd);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }

    if (ch === "'") {
      // Backslash is only an escape inside an E'' string; treating it as one
      // everywhere over-consumes and swallows the rest of the migration.
      const escaped = i > 0 && /[Ee]/.test(sql[i - 1]) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? ' ');
      let j = i + 1;
      let close = -1;
      while (j < sql.length) {
        if (escaped && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          close = j;
          break;
        }
        j += 1;
      }
      const bodyEnd = close === -1 ? sql.length : close;
      blank(i + 1, bodyEnd);
      i = close === -1 ? sql.length : close + 1;
      continue;
    }

    if (ch === '"') {
      // Quoted identifiers are meaningful. Skip past without masking.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/** Split masked SQL into statements, each carrying its absolute start offset. */
export function splitStatements(masked) {
  const statements = [];
  let start = 0;
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === ';') {
      const text = masked.slice(start, i);
      if (text.trim()) statements.push({ text, start });
      start = i + 1;
    }
  }
  const tail = masked.slice(start);
  if (tail.trim()) statements.push({ text: tail, start });
  return statements;
}

/** Build an offset -> {line, col} lookup, both 1-indexed. */
export function makeLocator(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  return (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - lineStarts[lo] + 1 };
  };
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)';
/** schema-qualified name, e.g. `private."answer_key"` */
export const QNAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;

function unquote(part) {
  const t = part.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t.toLowerCase();
}

/** `private.answer_key` -> { schema: 'private', name: 'answer_key' } */
export function parseQName(raw) {
  const parts = raw.split('.');
  if (parts.length === 2) return { schema: unquote(parts[0]), name: unquote(parts[1]) };
  return { schema: 'public', name: unquote(parts[0]) };
}

export function qkey(q) {
  return `${q.schema}.${q.name}`;
}

/** Every match of `re` in `text`, as `{ match, index }`. `re` must be global. */
export function matches(re, text) {
  const found = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  while ((m = rx.exec(text)) !== null) {
    found.push({ match: m, index: m.index });
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  return found;
}

/**
 * Read a balanced parenthesised group starting at the first `(` at or after
 * `from`. Returns `{ body, start, end }` with `body` excluding the outer
 * parentheses, or null.
 */
export function balanced(text, from) {
  const open = text.indexOf('(', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(open + 1, i), start: open, end: i };
    }
  }
  return null;
}

const RE_CREATE_TABLE = new RegExp(
  `\\bCREATE\\s+(?:(UNLOGGED|TEMP|TEMPORARY)\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QNAME})`,
  'i',
);
const RE_PARTITION_OF = new RegExp(`\\bPARTITION\\s+OF\\s+(${QNAME})`, 'i');
const RE_ENABLE_RLS = new RegExp(
  `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QNAME})\\s+(ENABLE|FORCE)\\s+ROW\\s+LEVEL\\s+SECURITY`,
  'i',
);
const RE_CREATE_POLICY = new RegExp(
  `\\bCREATE\\s+POLICY\\s+(${IDENT})\\s+ON\\s+(${QNAME})`,
  'i',
);
const RE_CREATE_VIEW = new RegExp(
  `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QNAME})`,
  'i',
);
const RE_CREATE_FUNCTION = new RegExp(
  `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:FUNCTION|PROCEDURE)\\s+(${QNAME})`,
  'i',
);
const RE_CREATE_INDEX = new RegExp(
  `\\bCREATE\\s+(UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${IDENT}\\s+)?ON\\s+(?:ONLY\\s+)?(${QNAME})`,
  'i',
);
const RE_ALTER_ADD_COLUMN = new RegExp(
  `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QNAME})\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`,
  'i',
);
const RE_COMMENT_ON_TABLE = new RegExp(`\\bCOMMENT\\s+ON\\s+TABLE\\s+(${QNAME})`, 'i');
const RE_DROP_TABLE = new RegExp(`\\bDROP\\s+TABLE\\b`, 'i');
const RE_TRUNCATE = new RegExp(`\\bTRUNCATE\\b`, 'i');
const RE_GRANT = new RegExp(`\\bGRANT\\s+([\\s\\S]*?)\\s+ON\\s+([\\s\\S]*?)\\s+TO\\s+([\\s\\S]*)`, 'i');

function extractClause(statementText, keyword) {
  const re = new RegExp(`\\b${keyword}\\s*\\(`, 'i');
  const m = re.exec(statementText);
  if (!m) return null;
  const group = balanced(statementText, m.index);
  return group ? group.body : null;
}

/**
 * Parse one migration file into a list of typed statement records. Offsets are
 * absolute within the file so callers can report file:line:col directly.
 */
export function parseFile(file, source) {
  const masked = mask(source);
  const locate = makeLocator(source);
  const records = [];

  for (const stmt of splitStatements(masked)) {
    const at = (relIndex) => {
      const abs = stmt.start + relIndex;
      return { file, offset: abs, ...locate(abs) };
    };
    const raw = source.slice(stmt.start, stmt.start + stmt.text.length);
    const base = { file, source: stmt.text, raw, start: stmt.start, loc: at(0) };

    let m;

    if ((m = RE_CREATE_TABLE.exec(stmt.text))) {
      const partitionOf = RE_PARTITION_OF.exec(stmt.text);
      const cols = balanced(stmt.text, m.index + m[0].length);
      records.push({
        ...base,
        kind: 'table',
        name: parseQName(m[2]),
        temporary: Boolean(m[1]),
        partitionOf: partitionOf ? parseQName(partitionOf[1]) : null,
        columnsBody: cols ? cols.body : '',
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_ENABLE_RLS.exec(stmt.text))) {
      records.push({
        ...base,
        kind: 'rls',
        name: parseQName(m[1]),
        mode: m[2].toUpperCase(),
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_CREATE_POLICY.exec(stmt.text))) {
      const rest = stmt.text.slice(m.index + m[0].length);
      const forClause = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(rest);
      const toClause = /\bTO\s+([\s\S]*?)(?=\bUSING\b|\bWITH\s+CHECK\b|$)/i.exec(rest);
      const roles = toClause
        ? toClause[1]
            .split(',')
            .map((r) => unquote(r))
            .filter(Boolean)
        : null;
      records.push({
        ...base,
        kind: 'policy',
        policyName: unquote(m[1]),
        name: parseQName(m[2]),
        command: forClause ? forClause[1].toUpperCase() : 'ALL',
        roles,
        toClauseIndex: toClause ? m.index + m[0].length + toClause.index : null,
        using: extractClause(rest, 'USING'),
        withCheck: extractClause(rest, 'WITH\\s+CHECK'),
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_CREATE_VIEW.exec(stmt.text))) {
      const asIndex = /\bAS\b/i.exec(stmt.text.slice(m.index + m[0].length));
      const head = stmt.text.slice(
        m.index,
        asIndex ? m.index + m[0].length + asIndex.index : stmt.text.length,
      );
      const withOpts = /\bWITH\s*\(([^)]*)\)/i.exec(head);
      records.push({
        ...base,
        kind: 'view',
        materialized: Boolean(m[1]),
        name: parseQName(m[2]),
        options: withOpts ? withOpts[1] : '',
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_CREATE_FUNCTION.exec(stmt.text))) {
      records.push({
        ...base,
        kind: 'function',
        name: parseQName(m[1]),
        securityDefiner: /\bSECURITY\s+DEFINER\b/i.test(stmt.text),
        setsSearchPath: /\bSET\s+search_path\b/i.test(stmt.text),
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_CREATE_INDEX.exec(stmt.text))) {
      records.push({
        ...base,
        kind: 'index',
        concurrent: Boolean(m[2]),
        name: parseQName(m[3]),
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_ALTER_ADD_COLUMN.exec(stmt.text))) {
      records.push({
        ...base,
        kind: 'add_column',
        name: parseQName(m[1]),
        column: unquote(m[2]),
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_COMMENT_ON_TABLE.exec(stmt.text))) {
      records.push({ ...base, kind: 'comment_table', name: parseQName(m[1]), loc: at(m.index) });
      continue;
    }

    if ((m = RE_GRANT.exec(stmt.text))) {
      records.push({
        ...base,
        kind: 'grant',
        privileges: m[1].trim().toLowerCase(),
        target: m[2].trim().toLowerCase(),
        grantees: m[3]
          .split(',')
          .map((r) => unquote(r))
          .filter(Boolean),
        loc: at(m.index),
      });
      continue;
    }

    if ((m = RE_DROP_TABLE.exec(stmt.text))) {
      records.push({ ...base, kind: 'drop_table', loc: at(m.index) });
      continue;
    }

    if ((m = RE_TRUNCATE.exec(stmt.text))) {
      records.push({ ...base, kind: 'truncate', loc: at(m.index) });
      continue;
    }
  }

  return records;
}

/** Does a CREATE TABLE column list declare `org_id`? (Invariant 4, FR-TEN-01) */
export function declaresOrgId(columnsBody) {
  return /(^|[,(])\s*"?org_id"?\s+/i.test(columnsBody);
}

/**
 * Aggregate parsed statements from every migration into one model keyed by
 * qualified table name. RLS may be enabled in a later migration than the
 * CREATE TABLE, so resolution is across the whole set, never per file.
 */
export function buildModel(parsedFiles) {
  const tables = new Map();
  const all = [];

  for (const { file, records } of parsedFiles) {
    for (const r of records) all.push({ ...r, file });
  }

  const ensure = (q) => {
    const key = qkey(q);
    let t = tables.get(key);
    if (!t) {
      t = {
        key,
        schema: q.schema,
        name: q.name,
        kind: schemaKind(q.schema),
        declaredIn: null,
        loc: null,
        isPartition: false,
        hasOrgId: false,
        rlsEnabled: false,
        rlsForced: false,
        commented: false,
        policies: [],
      };
      tables.set(key, t);
    }
    return t;
  };

  for (const r of all) {
    if (r.kind === 'table') {
      const t = ensure(r.name);
      t.declaredIn = r.file;
      t.loc = r.loc;
      t.isPartition = Boolean(r.partitionOf);
      if (declaresOrgId(r.columnsBody)) t.hasOrgId = true;
      if (r.partitionOf) {
        const parent = tables.get(qkey(r.partitionOf));
        if (parent?.hasOrgId) t.hasOrgId = true;
      }
    } else if (r.kind === 'add_column' && r.column === 'org_id') {
      ensure(r.name).hasOrgId = true;
    } else if (r.kind === 'rls') {
      const t = ensure(r.name);
      if (r.mode === 'ENABLE') t.rlsEnabled = true;
      else t.rlsForced = true;
    } else if (r.kind === 'policy') {
      ensure(r.name).policies.push(r);
    } else if (r.kind === 'comment_table') {
      ensure(r.name).commented = true;
    }
  }

  return { tables, statements: all };
}
