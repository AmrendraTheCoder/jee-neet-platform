/**
 * Deterministic ranking (FR-SCR-09, FR-SCR-10, EC-FAIR-03).
 *
 * At 10,000 candidates on a 300-mark paper, hundreds share a score. If ordering
 * among them is not total, a candidate's displayed rank changes between page
 * loads — with no error, no explanation, and a direct hit to the one thing a
 * mock test series sells. Every chain therefore terminates in STABLE_ID, and
 * `buildComparator` refuses a chain that does not.
 */

import type { TieBreakChain, TieBreakStep } from '../exam/pattern.js';
import type { Subject } from '../types.js';

export interface RankableAttempt {
  /** Stable, unique, and never reused. The final tie-break. */
  readonly id: string;
  readonly rawScore: number;
  readonly positiveMarks: number;
  readonly incorrectCount: number;
  /** Epoch milliseconds. Earlier submission ranks better where the chain says so. */
  readonly submittedAt: number;
  readonly bySubject: readonly {
    readonly subject: Subject;
    readonly score: number;
    readonly incorrect: number;
  }[];
}

export class NonTotalTieBreakError extends Error {
  constructor() {
    super(
      'tie-break chain must terminate in STABLE_ID; without it, tied candidates order non-deterministically and displayed ranks flicker between reads',
    );
    this.name = 'NonTotalTieBreakError';
  }
}

function subjectScore(a: RankableAttempt, subject: Subject): number {
  return a.bySubject.find((s) => s.subject === subject)?.score ?? 0;
}

function subjectGroupScore(a: RankableAttempt, subjects: readonly Subject[]): number {
  let total = 0;
  for (const s of a.bySubject) if (subjects.includes(s.subject)) total += s.score;
  return total;
}

function subjectIncorrect(a: RankableAttempt, subject: Subject): number {
  return a.bySubject.find((s) => s.subject === subject)?.incorrect ?? 0;
}

/** Negative when `a` ranks better than `b`. */
function applyStep(step: TieBreakStep, a: RankableAttempt, b: RankableAttempt): number {
  switch (step.kind) {
    case 'TOTAL_SCORE_DESC':
      return b.rawScore - a.rawScore;
    case 'SUBJECT_SCORE_DESC':
      return subjectScore(b, step.subject) - subjectScore(a, step.subject);
    case 'SUBJECT_GROUP_SCORE_DESC':
      return subjectGroupScore(b, step.subjects) - subjectGroupScore(a, step.subjects);
    case 'FEWER_INCORRECT':
      return a.incorrectCount - b.incorrectCount;
    case 'FEWER_INCORRECT_IN_SUBJECT':
      return subjectIncorrect(a, step.subject) - subjectIncorrect(b, step.subject);
    case 'HIGHER_POSITIVE_MARKS':
      return b.positiveMarks - a.positiveMarks;
    case 'EARLIER_SUBMISSION':
      return a.submittedAt - b.submittedAt;
    case 'STABLE_ID':
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
}

export function buildComparator(
  chain: TieBreakChain,
): (a: RankableAttempt, b: RankableAttempt) => number {
  if (chain.at(-1)?.kind !== 'STABLE_ID') throw new NonTotalTieBreakError();
  return (a, b) => {
    for (const step of chain) {
      const verdict = applyStep(step, a, b);
      if (verdict !== 0) return verdict;
    }
    return 0;
  };
}

export interface RankedEntry {
  readonly id: string;
  /** 1-based position after the full chain. Unique, because the chain is total. */
  readonly rank: number;
  /**
   * Rank ignoring tie-breaks — candidates on equal raw score share this.
   * Shown to students as "you are one of N on this score" so a tie-break
   * outcome never reads as an arbitrary penalty.
   */
  readonly scoreRank: number;
  readonly tiedOnScore: number;
}

/**
 * Produce a full ranking.
 *
 * Emits both the strict position and the score-level position, because showing
 * only the former makes tie-breaking feel capricious to the candidate who lost
 * it, and showing only the latter makes prize allocation ambiguous.
 */
export function rank(
  attempts: readonly RankableAttempt[],
  chain: TieBreakChain,
): RankedEntry[] {
  const comparator = buildComparator(chain);
  const sorted = [...attempts].sort(comparator);

  const countByScore = new Map<number, number>();
  for (const a of attempts) {
    countByScore.set(a.rawScore, (countByScore.get(a.rawScore) ?? 0) + 1);
  }

  const out: RankedEntry[] = [];
  let scoreRank = 0;
  let seen = 0;
  let previousScore: number | null = null;

  for (const a of sorted) {
    seen += 1;
    if (previousScore === null || a.rawScore !== previousScore) {
      scoreRank = seen;
      previousScore = a.rawScore;
    }
    out.push({
      id: a.id,
      rank: seen,
      scoreRank,
      tiedOnScore: countByScore.get(a.rawScore) ?? 1,
    });
  }

  return out;
}
