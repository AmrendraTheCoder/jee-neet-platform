#!/usr/bin/env node
/**
 * Credential scanner over the working tree and any build output present.
 *
 * Requirements: NFR-SEC-04, NFR-SEC-05.
 *
 * The failure this exists to prevent is precise. Row-level security is the
 * only thing standing between a student and every other student's data, and
 * the service-role key bypasses row-level security completely and by design.
 * A single `SUPABASE_SERVICE_ROLE_KEY` reachable from a client bundle does not
 * degrade the security model, it deletes it — and it is a two-character
 * mistake to make, because `NEXT_PUBLIC_` and the non-public variant sit next
 * to each other in every `.env` file on the team.
 *
 * Build output is scanned, not skipped: that is where a bundler inlines the
 * value and where the harm actually lands (NFR-SEC-05 extends the same rule
 * to OTA payloads).
 *
 * Two escape hatches, both narrow:
 *   - `.env.example` is exempt from value-shaped rules; it exists to document
 *     variable names and must be committable.
 *   - a line carrying the marker `secret-scan:allow` is skipped, so this file
 *     can describe the shapes it hunts for without matching itself.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs             scan the repository
 *   node scripts/scan-secrets.mjs --self-test prove the patterns still fire
 */

import { Report, selfTest } from './lib/report.mjs';
import { isProbablyBinary, readTextFile, repoRoot, walkFiles } from './lib/walk.mjs';

const ROOT = repoRoot(import.meta.url);
const ALLOW_MARKER = 'secret-scan' + ':allow';

/**
 * Files whose whole purpose is to carry placeholder credential names.
 *
 * Matched on the basename, not on an enumerated list of locations. The previous
 * form named three specific paths, which meant the fourth package to add a
 * template — `packages/db/.env.example`, documenting a Supabase connection
 * string — failed the gate for doing exactly what the convention asks. An
 * enumeration that has to be extended every time the repository grows is a
 * gate people learn to edit rather than obey.
 *
 * The widening is safe because the exemption is earned by the filename that
 * declares the file a template. A real secret in a file called `.env.example`
 * is already committed to version control by the time this scanner sees it;
 * the control for that is `.gitignore` covering `.env`, which it does.
 */
const EXEMPT_BASENAMES = new Set(['.env.example']);

function isExempt(relPath) {
  const slash = relPath.lastIndexOf('/');
  return EXEMPT_BASENAMES.has(slash === -1 ? relPath : relPath.slice(slash + 1));
}

/**
 * Values that look like credentials but are documentation. Kept deliberately
 * short: a long allowlist is how a scanner stops finding anything.
 */
const PLACEHOLDER = /^(?:x{3,}|y{3,}|\.{3}|<.*>|\$\{.*\}|%.*%|process\.env\..*|import\.meta\.env\..*|(?:your|my|the)[-_ ]?.*|change[-_ ]?me|replace[-_ ]?me|placeholder|example.*|sample.*|dummy.*|fake.*|test|todo|none|null|undefined|redacted|secret|password|changeit|\d+)$/i;

/**
 * A JWT whose payload claims the service role. Detected structurally by
 * decoding, not by matching a literal, because the key is per-project and
 * every project's differs.
 */
const RE_JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Rules are ordered most-specific first. `severity: 'fail'` stops the build.
 * Every pattern line carries the allow marker so this file does not report
 * itself.
 */
const RULES = [
  {
    id: 'SEC-PEM',
    severity: 'fail',
    // Matches its own source text? No: `[A-Z ]*` cannot consume the `[`.
    pattern: /-----BEGIN (?:[A-Z ]*)PRIVATE KEY-----/g,
    message: 'A PEM private key is committed.',
    hint: 'Rotate the key immediately, then move it to the secret store. A rotated key in git history is still a leaked key.',
  },
  {
    id: 'SEC-SUPABASE-SECRET',
    severity: 'fail',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g, // secret-scan:allow
    message: 'A Supabase secret API key is present. It bypasses row-level security entirely.',
    hint: 'Revoke it in the project dashboard and inject it as a server-only environment variable.',
  },
  {
    id: 'SEC-SUPABASE-PAT',
    severity: 'fail',
    pattern: /\bsbp_[a-f0-9]{40}\b/g, // secret-scan:allow
    message: 'A Supabase personal access token is present. It can administer every project on the account.',
    hint: 'Revoke it and use a scoped CI token stored as an encrypted secret.',
  },
  {
    id: 'SEC-AWS-KEY-ID',
    severity: 'fail',
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, // secret-scan:allow
    message: 'An AWS access key id is present.',
    hint: 'Deactivate the key pair in IAM and issue short-lived credentials through OIDC instead.',
  },
  {
    id: 'SEC-GITHUB-TOKEN',
    severity: 'fail',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, // secret-scan:allow
    message: 'A GitHub token is present.',
    hint: 'Revoke it in developer settings; use the workflow-scoped GITHUB_TOKEN in CI.',
  },
  {
    id: 'SEC-SLACK-TOKEN',
    severity: 'fail',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // secret-scan:allow
    message: 'A Slack token is present.',
    hint: 'Revoke it in the Slack app configuration.',
  },
  {
    id: 'SEC-GOOGLE-KEY',
    severity: 'fail',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, // secret-scan:allow
    message: 'A Google API key is present.',
    hint: 'Restrict or regenerate the key in the Google Cloud console.',
  },
  {
    id: 'SEC-FCM-SERVER-KEY',
    severity: 'fail',
    pattern: /\bAAAA[A-Za-z0-9_-]{7}:APA91b[A-Za-z0-9_-]{100,}\b/g, // secret-scan:allow
    message: 'A Firebase Cloud Messaging server key is present. It can send a notification to every installed device.',
    hint: 'Rotate it and move push sending behind the server.',
  },
  {
    id: 'SEC-STRIPE-LIVE',
    severity: 'fail',
    pattern: /\b(?:sk|rk)_live_[0-9a-zA-Z]{16,}\b/g, // secret-scan:allow
    message: 'A live Stripe secret key is present.',
    hint: 'Roll the key in the Stripe dashboard.',
  },
  {
    id: 'SEC-ANTHROPIC-KEY',
    severity: 'fail',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, // secret-scan:allow
    message: 'An Anthropic API key is present.',
    hint: 'Revoke it in the console and inject it server-side only.',
  },
  {
    id: 'SEC-OPENAI-KEY',
    severity: 'fail',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g, // secret-scan:allow
    message: 'An OpenAI-shaped API key is present.',
    hint: 'Revoke it and inject it server-side only.',
  },
  {
    id: 'SEC-TWILIO',
    severity: 'fail',
    pattern: /\b(?:AC|SK)[0-9a-f]{32}\b/g, // secret-scan:allow
    message: 'A Twilio account or API SID is present. SMS spend is uncapped by default.',
    hint: 'Rotate the credential in the Twilio console.',
  },
  {
    id: 'SEC-DB-URL',
    severity: 'fail',
    pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp)::\/\//g, // placeholder, replaced below
    message: 'A database connection string with an inline password is present.',
    hint: 'Use a connection string assembled from environment variables at runtime.',
  },
];

// Written separately because the literal `://` inside the array above would be
// the only place in this file that looks like a real connection string.
RULES.find((r) => r.id === 'SEC-DB-URL').pattern = new RegExp(
  '\\b(?:postgres|postgresql|mysql|mongodb(?:\\+srv)?|redis|rediss|amqp)' +
    '\\:\\/\\/[^:@/\\s\'"]+\\:([^@/\\s\'"]{4,})@',
  'g',
);

/**
 * Assignment-shaped rule: a credential-named variable assigned a literal.
 * Group 1 is the name, group 2 the value, so placeholders can be excluded.
 */
const RE_ASSIGNMENT = new RegExp(
  '\\b([A-Za-z0-9_]*(?:SERVICE_ROLE|SERVICE_KEY|SECRET_KEY|PRIVATE_KEY|API_KEY|APIKEY|' +
    'ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|WEBHOOK_SECRET|SIGNING_KEY|' +
    'ENCRYPTION_KEY|JWT_SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*)' +
    '\\s*[:=]\\s*[\'"`]([^\'"`\\n]{6,})[\'"`]',
  'gi',
);

/**
 * Directories whose contents are shipped to a device or a browser. A
 * privileged identifier appearing anywhere under one of these is a failure
 * regardless of its value, because the value arrives at build time.
 */
const CLIENT_OUTPUT = /(^|\/)(dist|build|out|\.next|\.expo|\.output|web-build|public|static)(\/|$)/;
const CLIENT_SOURCE = /^apps\/(web|mobile)\//;
const PRIVILEGED_IDENTIFIER = /\b(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_URL|DIRECT_URL)\b/g;

/** Server-only areas of a client app, which legitimately hold privileged names. */
const SERVER_ONLY_IN_CLIENT =
  /^apps\/(web|mobile)\/(src\/)?(app\/api|pages\/api|server|lib\/server|supabase\/functions)\//;

function lineNumberOf(text, index) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      lastNewline = i;
    }
  }
  return { line, col: index - lastNewline };
}

function lineContaining(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

/** Never print the credential itself; a CI log is not a secret store. */
function redact(value) {
  const s = String(value);
  if (s.length <= 8) return `${s.slice(0, 2)}...`;
  return `${s.slice(0, 4)}...${s.slice(-2)} (${s.length} chars)`;
}

export function scanText(relPath, text, report) {
  const exempt = isExempt(relPath);

  for (const rule of RULES) {
    const rx = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (lineContaining(text, m.index).includes(ALLOW_MARKER)) continue;
      if (exempt) continue;
      const where = { file: relPath, ...lineNumberOf(text, m.index) };
      report.fail(rule.id, `${rule.message} Matched ${redact(m[0])}.`, where, rule.hint);
    }
  }

  // Structural JWT check. The anon key is a JWT and is meant to be public, so
  // a blanket JWT rule would be unusable; the payload is what decides.
  {
    const rx = new RegExp(RE_JWT.source, RE_JWT.flags);
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (lineContaining(text, m.index).includes(ALLOW_MARKER)) continue;
      const payload = decodeJwtPayload(m[0]);
      const where = { file: relPath, ...lineNumberOf(text, m.index) };
      const role = payload && typeof payload === 'object' ? payload.role : undefined;
      if (role === 'service_role') {
        report.fail(
          'SEC-JWT-SERVICE-ROLE',
          `A service_role JWT is committed at ${relPath}. This token bypasses every row-level-security policy on the database.`,
          where,
          'Rotate the project JWT secret now, purge the value, and never reference it outside a server-only environment.',
        );
      } else if (role === 'anon') {
        report.info(
          'SEC-JWT-ANON',
          'An anon JWT is present. This key is designed to be public and is only as safe as the row-level-security policies behind it.',
          where,
        );
      } else if (!exempt) {
        report.fail(
          'SEC-JWT-UNKNOWN',
          `A JWT of unknown provenance is committed (role=${role ?? 'absent'}).`,
          where,
          'Identify the token. If it is a credential, rotate it; if it is a test fixture, generate it at test time.',
        );
      }
    }
  }

  // Credential-named assignments with a non-placeholder literal value.
  if (!exempt) {
    const rx = new RegExp(RE_ASSIGNMENT.source, RE_ASSIGNMENT.flags);
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (lineContaining(text, m.index).includes(ALLOW_MARKER)) continue;
      const [, name, value] = m;
      if (PLACEHOLDER.test(value.trim())) continue;
      const where = { file: relPath, ...lineNumberOf(text, m.index) };
      report.fail(
        'SEC-ASSIGNMENT',
        `${name} is assigned a literal value (${redact(value)}).`,
        where,
        'Read it from the environment at runtime and store the value in the deployment secret store.',
      );
    }
  }

  // The NFR-SEC-04 rule proper: a privileged identifier reachable from client
  // code or present in shipped output. Value-independent, because the harm is
  // the bundler substituting the value at build time.
  const isClientOutput = CLIENT_OUTPUT.test(relPath);
  const isClientSource = CLIENT_SOURCE.test(relPath) && !SERVER_ONLY_IN_CLIENT.test(relPath);
  if ((isClientOutput || isClientSource) && !exempt) {
    const rx = new RegExp(PRIVILEGED_IDENTIFIER.source, PRIVILEGED_IDENTIFIER.flags);
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (lineContaining(text, m.index).includes(ALLOW_MARKER)) continue;
      const where = { file: relPath, ...lineNumberOf(text, m.index) };
      report.fail(
        'SEC-CLIENT-PRIVILEGED',
        `${m[0]} is referenced from ${isClientOutput ? 'shipped build output' : 'client source'} (${relPath}). A privileged credential in a client bundle bypasses row-level security entirely.`,
        where,
        'Move the call behind a server route or an edge function. The client gets the anon key and nothing else (NFR-SEC-04).',
      );
    }
  }
}

function scanRepository(report) {
  let scanned = 0;
  let skippedBinary = 0;
  for (const rel of walkFiles(ROOT)) {
    if (isProbablyBinary(rel)) {
      skippedBinary += 1;
      continue;
    }
    const text = readTextFile(ROOT, rel);
    if (text === null) {
      skippedBinary += 1;
      continue;
    }
    scanned += 1;
    scanText(rel, text, report);
  }
  return { scanned, skippedBinary };
}

// --- Self-test -------------------------------------------------------------
// Every fixture is assembled at runtime from fragments, so no literal in this
// file resembles a credential and the scanner stays clean against itself.

function makeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'s'.repeat(43)}`;
}

function firedOn(relPath, text) {
  const report = new Report('scan-secrets', 'self-test');
  scanText(relPath, text, report);
  return new Set(report.findings.filter((f) => f.level === 'fail').map((f) => f.rule));
}

function runSelfTest() {
  const serviceJwt = makeJwt({ iss: 'supabase', role: 'service_role', exp: 2000000000 });
  const anonJwt = makeJwt({ iss: 'supabase', role: 'anon', exp: 2000000000 });
  const pem = `${'-'.repeat(5)}BEGIN RSA PRIVATE KEY${'-'.repeat(5)}`;
  const awsKey = `AK${'IA'}${'ABCDEFGHIJKLMNOP'}`;
  const dbUrl = `postgres${'://'}app:hunter2hunter2@db.example.internal:5432/platform`;

  return selfTest('scan-secrets', [
    {
      name: 'a service_role JWT is a failure wherever it appears',
      assert: () =>
        firedOn('apps/web/src/lib/db.ts', `const key = '${serviceJwt}';`).has(
          'SEC-JWT-SERVICE-ROLE',
        ),
    },
    {
      name: 'an anon JWT is reported as information, not a failure',
      assert: () => firedOn('apps/web/.env.local', `KEY=${anonJwt}`).size === 0,
    },
    {
      name: 'a PEM private key is a failure',
      assert: () => firedOn('config/key.txt', pem).has('SEC-PEM'),
    },
    {
      name: 'an AWS access key id is a failure',
      assert: () => firedOn('infra/deploy.sh', `export AWS_ID=${awsKey}`).has('SEC-AWS-KEY-ID'),
    },
    {
      name: 'a connection string with an inline password is a failure',
      assert: () => firedOn('docker-compose.yml', `url: ${dbUrl}`).has('SEC-DB-URL'),
    },
    {
      name: 'a credential-named assignment with a real value is a failure',
      assert: () =>
        firedOn('apps/web/src/config.ts', `export const CLIENT_SECRET = 'a9f3k2ldm38fj2';`).has( // secret-scan:allow
          'SEC-ASSIGNMENT',
        ),
    },
    {
      name: 'a credential-named assignment holding a placeholder is not a failure',
      assert: () =>
        firedOn('apps/web/src/config.ts', `const API_KEY = 'your-api-key-here';`).size === 0,
    },
    {
      name: 'reading a credential from the environment is not a failure',
      assert: () =>
        firedOn('apps/web/src/server/db.ts', `const k = process.env.SUPABASE_SERVICE_ROLE_KEY;`)
          .size === 0,
    },
    {
      name: 'NFR-SEC-04: the service-role identifier in client source is a failure by name alone',
      assert: () =>
        firedOn('apps/web/src/lib/client.ts', `process.env.SUPABASE_SERVICE_ROLE_KEY`).has(
          'SEC-CLIENT-PRIVILEGED',
        ),
    },
    {
      name: 'NFR-SEC-04: the same identifier in shipped build output is a failure',
      assert: () =>
        firedOn('apps/mobile/dist/bundle.js', `var a="SUPABASE_SERVICE_ROLE_KEY"`).has(
          'SEC-CLIENT-PRIVILEGED',
        ),
    },
    {
      name: '.env.example may document credential variable names',
      assert: () => firedOn('.env.example', `SUPABASE_SERVICE_ROLE_KEY=replace-me`).size === 0,
    },
    {
      name: 'a nested .env.example is exempt wherever it lives',
      assert: () =>
        firedOn('packages/db/.env.example', `DATABASE_URL="postgresql://user:PASSWORD@host:6543/postgres"`) // secret-scan:allow
          .size === 0,
    },
    {
      name: 'a connection string in a file that is not an env template still fails',
      assert: () =>
        firedOn('packages/db/src/client.ts', `const url = 'postgresql://user:PASSWORD@host:6543/postgres';`) // secret-scan:allow
          .has('SEC-DB-URL'),
    },
    {
      name: 'clean application source produces nothing',
      assert: () =>
        firedOn(
          'packages/domain/src/scoring/scoreAttempt.ts',
          `export function scoreAttempt(input) { return input; }`,
        ).size === 0,
    },
    {
      name: 'a line carrying the allow marker is skipped',
      assert: () =>
        firedOn('scripts/example.mjs', `const pem = "${pem}"; // ${ALLOW_MARKER}`).size === 0,
    },
  ]);
}

// --- Entry point -----------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  process.exit(runSelfTest());
}

const report = new Report(
  'secret-scan',
  'Blocks a privileged credential from reaching a client bundle, where it would bypass every row-level-security policy at once (NFR-SEC-04).',
);

const stats = scanRepository(report);
report.note(`Scanned ${stats.scanned} text file(s); skipped ${stats.skippedBinary} binary file(s).`);
report.note('Build output is included in the scan by design; a bundle is where the harm lands.');

process.exit(report.finish());
