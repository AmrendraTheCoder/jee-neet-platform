/**
 * Percentile computation (FR-SCR-07).
 *
 * The published method is:
 *
 *     percentile = 100 x (candidates with raw score <= this candidate) / total
 *
 * computed on the **total** raw score within a cohort, to seven decimal places.
 *
 * Two mistakes this module exists to prevent:
 *
 *   1. Averaging subject percentiles to produce an overall percentile. The
 *      bulletin states outright that the overall percentile is not an average
 *      of subject percentiles. `subjectPercentiles` below computes each subject
 *      independently and there is deliberately no helper that averages them.
 *
 *   2. Floating-point formatting. At seven decimal places, `toFixed` on a
 *      double loses the last digit for some cohort sizes, and two candidates
 *      with genuinely different percentiles can print identically. All
 *      arithmetic here is exact integer arithmetic on BigInt.
 */

import type { Subject } from '../types.js';

const SCALE = 7;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

export interface CohortEntry {
  readonly id: string;
  readonly rawScore: number;
}

/** Format a scaled integer as a fixed-point decimal string. */
function formatScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(SCALE + 1, '0');
  const cut = digits.length - SCALE;
  const body = `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  return negative ? `-${body}` : body;
}

/**
 * Percentile for every member of a cohort, keyed by entry id.
 *
 * Returned as exact decimal strings, not numbers — the caller stores them
 * verbatim so that what is displayed, what is stored and what is recomputed on
 * a rescore are provably the same value.
 */
export function computePercentiles(cohort: readonly CohortEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  const n = cohort.length;
  if (n === 0) return out;

  // Count how many candidates sit at or below each distinct score, once.
  const sorted = [...cohort].sort((a, b) => a.rawScore - b.rawScore);
  const countAtOrBelow = new Map<number, number>();
  for (let i = 0; i < sorted.length; i += 1) {
    const score = sorted[i]!.rawScore;
    // The last index at which this score appears, plus one.
    countAtOrBelow.set(score, i + 1);
  }

  const denominator = BigInt(n);
  for (const entry of cohort) {
    const le = countAtOrBelow.get(entry.rawScore);
    /* c8 ignore next */
    if (le === undefined) throw new Error('unreachable: score not indexed');
    const numerator = BigInt(le) * 100n * SCALE_FACTOR;
    let quotient = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder * 2n >= denominator) quotient += 1n;
    out.set(entry.id, formatScaled(quotient));
  }

  return out;
}

/**
 * Per-subject percentiles, each computed independently within the cohort.
 *
 * There is intentionally no function here that combines these into an overall
 * figure. Use `computePercentiles` on total raw score for that.
 */
export function subjectPercentiles(
  cohort: readonly {
    readonly id: string;
    readonly bySubject: readonly { readonly subject: Subject; readonly score: number }[];
  }[],
): Map<Subject, Map<string, string>> {
  const subjects = new Set<Subject>();
  for (const c of cohort) for (const s of c.bySubject) subjects.add(s.subject);

  const out = new Map<Subject, Map<string, string>>();
  for (const subject of subjects) {
    const entries: CohortEntry[] = cohort.map((c) => ({
      id: c.id,
      rawScore: c.bySubject.find((s) => s.subject === subject)?.score ?? 0,
    }));
    out.set(subject, computePercentiles(entries));
  }
  return out;
}
