/**
 * Deterministic fingerprint of a scoring configuration (FR-PAT-07).
 *
 * Purpose: pin the exact `test_questions` marking configuration into the attempt
 * result, so a later configuration edit cannot silently alter a historical
 * score. It answers "was this attempt scored under the same rules as that one",
 * not "has an attacker tampered with this".
 *
 * This is FNV-1a over a canonical serialisation — dependency-free and
 * deterministic across runtimes. The database computes its own SHA-256 over the
 * same canonical form via pgcrypto and that value is authoritative; this one
 * exists so tests and the tutor-mode preview can agree without a database.
 */

/** Stable, key-sorted JSON. Property order must never affect the fingerprint. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical form');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new TypeError(`cannot canonicalize ${typeof value}`);
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnv1a64(input: string, seed: bigint): bigint {
  let hash = seed;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}

/**
 * 128-bit fingerprint as 32 lowercase hex characters.
 *
 * Two independently-seeded 64-bit lanes, which makes accidental collision
 * between two distinct scoring configurations vanishingly unlikely for
 * change-detection purposes.
 */
export function fingerprint(value: unknown): string {
  const canonical = canonicalize(value);
  const a = fnv1a64(canonical, FNV_OFFSET);
  const b = fnv1a64(canonical, FNV_OFFSET ^ 0x9e3779b97f4a7c15n);
  return a.toString(16).padStart(16, '0') + b.toString(16).padStart(16, '0');
}
