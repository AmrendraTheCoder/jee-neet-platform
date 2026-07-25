/**
 * How a review is graded (FR-SRS-06).
 *
 * Read the signature before the body. `deriveRating` takes an outcome and a
 * self-report. It does not take a response time, an elapsed duration, a
 * timestamp or anything from which one could be reconstructed. That is the
 * requirement, expressed the only way that survives a refactor: the information
 * is not in scope, so no future edit can start using it by accident.
 *
 * Why this matters more here than in a general flashcard app. A three-hour paper
 * in these subjects needs roughly fifteen sheets of rough paper. `time_spent_ms`
 * measures how long a question was *on screen*, not how long the student thought
 * about it. A student who works a mechanics problem on paper for four minutes,
 * then looks up and taps an option, generates a four-second "fast, confident"
 * signal — and the usual heuristic, "correct and fast means easy", grades them
 * as needing the concept less often than a student who guessed instantly.
 *
 * The heuristic is not merely noisy here. It is inverted for exactly the
 * students who are studying properly.
 *
 * The honest dwell signal comes from the in-app scratchpad instead: rough work
 * done inside the app keeps the app foregrounded, produces stroke events with
 * real timestamps, and — separately and importantly — stops the platform's own
 * integrity layer from reading "app backgrounded for four minutes" as a cheating
 * signal.
 */

import type { ResponseStatus } from '@platform/domain';

/**
 * The four scheduler grades.
 *
 * Values match the scheduler library's rating enumeration so the mapping in
 * `scheduler.ts` is a lookup rather than a translation with its own bugs.
 */
export const REVIEW_RATINGS = ['AGAIN', 'HARD', 'GOOD', 'EASY'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/**
 * What the student says about the attempt, asked once, immediately after the
 * reveal. Three options, because a four-way self-report on a phone produces
 * mostly the middle two and no extra information.
 */
export const SELF_REPORTS = ['GUESSED', 'UNSURE', 'CONFIDENT'] as const;
export type SelfReport = (typeof SELF_REPORTS)[number];

export const SELF_REPORT_LABELS: Readonly<Record<SelfReport, string>> = {
  GUESSED: 'I guessed',
  UNSURE: 'I was unsure',
  CONFIDENT: 'I knew it',
};

/**
 * Grade a review from what actually happened and what the student says.
 *
 * The wrong-but-confident case is deliberately the harshest grade available: a
 * student who is sure and wrong holds a misconception, which is more expensive
 * than a gap and should come back soonest.
 *
 * The right-but-guessed case is deliberately not `EASY`. Awarding an easy grade
 * to a lucky guess pushes the concept months into the future on the strength of
 * a coin flip, and that single behaviour is what makes most spaced-repetition
 * implementations feel unreliable to their users.
 */
export function deriveRating(outcome: ResponseStatus, selfReport: SelfReport): ReviewRating {
  const correct = outcome === 'CORRECT';
  const partial = outcome === 'PARTIALLY_CORRECT';

  if (!correct && !partial) {
    // Unattempted is a gap, not a failure of recall, but for scheduling purposes
    // both mean "this concept is not available to you yet".
    return 'AGAIN';
  }

  if (partial) {
    return selfReport === 'CONFIDENT' ? 'HARD' : 'AGAIN';
  }

  switch (selfReport) {
    case 'GUESSED':
      return 'HARD';
    case 'UNSURE':
      return 'GOOD';
    case 'CONFIDENT':
      return 'EASY';
  }
}

/**
 * Whether a review should create or reinforce a card at all (FR-SRS-02).
 *
 * Cards are created from wrong answers, marked-for-review questions and
 * formulas. A question answered correctly and confidently on first sight does
 * not need a card, and creating one for every question seen is how a review
 * queue reaches four hundred items in a week and gets abandoned.
 */
export function shouldScheduleCard(args: {
  readonly outcome: ResponseStatus;
  readonly selfReport: SelfReport;
  readonly markedForReview: boolean;
  readonly alreadyScheduled: boolean;
}): boolean {
  if (args.alreadyScheduled) return true;
  if (args.markedForReview) return true;
  if (args.outcome !== 'CORRECT') return true;
  return args.selfReport !== 'CONFIDENT';
}
