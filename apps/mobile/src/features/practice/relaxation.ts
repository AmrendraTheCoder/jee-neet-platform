/**
 * Constraint relaxation (FR-PRC-05, AC-PRC-01).
 *
 * "Rotational Motion + Hard + Unattempted + PYQ 2019-2023" against a sparse bank
 * returns four questions. A bare empty state there is prohibited, and so is a
 * silent substitution: the student asked for something specific and is entitled
 * to know exactly which part of it we could not honour.
 *
 * So relaxation is a *ladder*, applied one rung at a time, stopping as soon as
 * the target is reachable, and every rung that fired produces a sentence the
 * banner shows verbatim. The order is by pedagogical cost, cheapest first:
 * widening the year range changes almost nothing about what the student
 * practises; dropping the question-state filter changes the entire point of the
 * session, so it is last.
 */

import type { BuilderCriteria, Difficulty, YearRange } from './filters.js';
import { countMatching, selectMatchingIds } from './filters.js';

export type RelaxationKind =
  | 'YEAR_RANGE_WIDENED'
  | 'YEAR_RANGE_REMOVED'
  | 'DIFFICULTY_WIDENED'
  | 'SCOPE_WIDENED_TO_CHAPTER'
  | 'STATE_FILTER_WIDENED';

export interface Relaxation {
  readonly kind: RelaxationKind;
  /** Shown verbatim. Names the constraint and what it became. */
  readonly sentence: string;
}

export interface RelaxationResult {
  readonly questionVersionIds: readonly string[];
  readonly appliedCriteria: BuilderCriteria;
  readonly relaxations: readonly Relaxation[];
  /**
   * True when even the fully relaxed criteria cannot reach the target. The
   * caller must still explain the shortfall rather than showing an empty list —
   * `shortfallExplanation` supplies the words.
   */
  readonly exhausted: boolean;
  readonly available: number;
}

const ADJACENT_DIFFICULTY: Readonly<Record<Difficulty, readonly Difficulty[]>> = {
  EASY: ['MEDIUM'],
  MEDIUM: ['EASY', 'HARD'],
  HARD: ['MEDIUM'],
};

const YEAR_WIDEN_STEP = 3;

function widenYears(years: YearRange): YearRange {
  return { from: years.from - YEAR_WIDEN_STEP, to: years.to + YEAR_WIDEN_STEP };
}

function describeYears(years: YearRange): string {
  return `${String(years.from)} to ${String(years.to)}`;
}

/**
 * The ladder itself.
 *
 * Each rung returns the next criteria and the sentence to show, or null when the
 * rung does not apply to these criteria (there is no year range to widen if the
 * student never set one).
 */
const LADDER: readonly ((
  criteria: BuilderCriteria,
  original: BuilderCriteria,
) => { readonly next: BuilderCriteria; readonly relaxation: Relaxation } | null)[] = [
  (criteria, original) => {
    if (criteria.years === null || original.years === null) return null;
    const widened = widenYears(criteria.years);
    return {
      next: { ...criteria, years: widened },
      relaxation: {
        kind: 'YEAR_RANGE_WIDENED',
        sentence: `We widened the year range from ${describeYears(original.years)} to ${describeYears(widened)}.`,
      },
    };
  },
  (criteria) => {
    if (criteria.difficulties.length === 0 || criteria.difficulties.length === 3) return null;
    const widened = new Set<Difficulty>(criteria.difficulties);
    for (const level of criteria.difficulties) {
      for (const neighbour of ADJACENT_DIFFICULTY[level]) widened.add(neighbour);
    }
    const next = [...widened];
    return {
      next: { ...criteria, difficulties: next },
      relaxation: {
        kind: 'DIFFICULTY_WIDENED',
        sentence: `We included neighbouring difficulty levels: ${next
          .map((level) => level.toLowerCase())
          .join(', ')}.`,
      },
    };
  },
  (criteria) => {
    if (criteria.subTopicIds.length === 0 || criteria.chapterIds.length === 0) return null;
    return {
      next: { ...criteria, subTopicIds: [] },
      relaxation: {
        kind: 'SCOPE_WIDENED_TO_CHAPTER',
        sentence: 'We widened from the sub-topics you picked to their whole chapters.',
      },
    };
  },
  (criteria, original) => {
    if (criteria.years === null || original.years === null) return null;
    return {
      next: { ...criteria, years: null },
      relaxation: {
        kind: 'YEAR_RANGE_REMOVED',
        sentence: 'We removed the year filter entirely; there were not enough past-paper questions in range.',
      },
    };
  },
  (criteria, original) => {
    if (original.states.length === 0) return null;
    if (criteria.states.length === 0) return null;
    return {
      next: { ...criteria, states: [] },
      relaxation: {
        kind: 'STATE_FILTER_WIDENED',
        sentence: `We dropped the "${original.states
          .map((state) => state.toLowerCase().replace(/_/g, ' '))
          .join(' or ')}" filter last, because it changes what the session is for. Everything above it was widened first.`,
      },
    };
  },
];

/**
 * Resolve criteria into a question set, relaxing only as far as needed.
 *
 * Deliberately not "relax until the target is met" in one leap: the ladder stops
 * at the first rung that suffices, so a student who is two questions short does
 * not get their state filter dropped.
 */
export async function resolveWithRelaxation(
  criteria: BuilderCriteria,
): Promise<RelaxationResult> {
  const applied: Relaxation[] = [];
  let current = criteria;
  let available = await countMatching(current);

  for (const rung of LADDER) {
    if (available >= criteria.targetCount) break;
    const step = rung(current, criteria);
    if (step === null) continue;
    const candidateCount = await countMatching(step.next);
    // A rung that does not actually help is not reported. Telling a student "we
    // widened the year range" when it changed nothing is noise that trains them
    // to ignore the banner that matters.
    if (candidateCount <= available) {
      current = step.next;
      continue;
    }
    current = step.next;
    available = candidateCount;
    applied.push(step.relaxation);
  }

  const ids = await selectMatchingIds(current, criteria.targetCount);

  return {
    questionVersionIds: ids,
    appliedCriteria: current,
    relaxations: applied,
    exhausted: ids.length < criteria.targetCount,
    available,
  };
}

/**
 * What to say when even the relaxed set falls short.
 *
 * Never "no results". The student gets the number we found, the reason, and the
 * one action that would change it.
 */
export function shortfallExplanation(result: RelaxationResult, target: number): string {
  const found = result.questionVersionIds.length;
  if (found === 0) {
    return (
      'Nothing in this selection has been downloaded to your device yet. ' +
      'Open the chapter and tap Download to make it available offline, or connect to the internet to browse the full bank.'
    );
  }
  return (
    `We could find ${String(found)} of the ${String(target)} questions you asked for, ` +
    'even after widening the filters above. Your session will run with what we found.'
  );
}
