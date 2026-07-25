/**
 * The spaced-repetition scheduler.
 *
 * Cards key on `(user, sub_topic)`, never on the question (FR-SRS-01, FR-SRS-04).
 * That single choice is what makes content corrections non-destructive: an item
 * can be re-versioned, retired or replaced without touching any student's
 * scheduling history, because the history was never attached to the item.
 *
 * The algorithm itself is delegated to `ts-fsrs`, and the delegation is confined
 * to this file on purpose. Everything above it speaks in `ReviewCard` and
 * `ReviewRating`, so a change of scheduler implementation is a rewrite of this
 * module and nothing else.
 */

import { Rating, State, createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs';
import type { Card as FsrsCard, FSRS, FSRSParameters, Grade } from 'ts-fsrs';

import type { SubTopicId } from '@platform/domain';

import type { ReviewRating } from './grading.js';

export type CardState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';

export interface ReviewCard {
  readonly subTopicId: SubTopicId;
  readonly state: CardState;
  readonly dueMs: number;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsedDays: number;
  readonly scheduledDays: number;
  readonly reps: number;
  readonly lapses: number;
  readonly learningSteps: number;
  readonly lastReviewMs: number | null;
}

// `Grade`, not `Rating`. Rating additionally carries `Manual`, which the
// scheduler's `next()` rejects because a manual reschedule is not a review and
// produces no interval. The four values below are exactly `Grade`, so naming it
// here is what keeps that guarantee at the type level rather than at the call.
const RATING_BY_NAME: Readonly<Record<ReviewRating, Grade>> = {
  AGAIN: Rating.Again,
  HARD: Rating.Hard,
  GOOD: Rating.Good,
  EASY: Rating.Easy,
};

const STATE_TO_LIBRARY: Readonly<Record<CardState, State>> = {
  NEW: State.New,
  LEARNING: State.Learning,
  REVIEW: State.Review,
  RELEARNING: State.Relearning,
};

const STATE_FROM_LIBRARY: Readonly<Record<number, CardState>> = {
  [State.New]: 'NEW',
  [State.Learning]: 'LEARNING',
  [State.Review]: 'REVIEW',
  [State.Relearning]: 'RELEARNING',
};

/**
 * Scheduler parameters.
 *
 * `enable_fuzz` matters at this scale for a reason that has nothing to do with
 * memory: without it, a student who reviews forty cards in one sitting gets all
 * forty back on the same future day, and every subsequent session is either
 * enormous or empty. Fuzz spreads the return.
 *
 * `maximum_interval` is capped well below the library default because the whole
 * product has a horizon: a card scheduled 180 days out for a student sitting the
 * examination in 90 is a card that will never be seen again.
 */
const PARAMETERS: FSRSParameters = generatorParameters({
  enable_fuzz: true,
  enable_short_term: true,
  maximum_interval: 180,
  request_retention: 0.9,
});

let engine: FSRS | null = null;

function scheduler(): FSRS {
  engine ??= fsrs(PARAMETERS);
  return engine;
}

export function newCard(subTopicId: SubTopicId, nowMs: number): ReviewCard {
  const empty = createEmptyCard(new Date(nowMs));
  return {
    subTopicId,
    state: 'NEW',
    dueMs: empty.due.getTime(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsedDays: empty.elapsed_days,
    scheduledDays: empty.scheduled_days,
    reps: empty.reps,
    lapses: empty.lapses,
    learningSteps: 0,
    lastReviewMs: null,
  };
}

function toLibraryCard(card: ReviewCard): FsrsCard {
  const base = createEmptyCard(new Date(card.lastReviewMs ?? card.dueMs));
  return {
    ...base,
    due: new Date(card.dueMs),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_LIBRARY[card.state],
    ...(card.lastReviewMs === null ? {} : { last_review: new Date(card.lastReviewMs) }),
  };
}

function fromLibraryCard(card: FsrsCard, subTopicId: SubTopicId): ReviewCard {
  return {
    subTopicId,
    state: STATE_FROM_LIBRARY[card.state] ?? 'REVIEW',
    dueMs: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: 0,
    lastReviewMs: card.last_review === undefined ? null : card.last_review.getTime(),
  };
}

/**
 * Advance a card.
 *
 * Pure with respect to its arguments: the review instant is passed in rather
 * than read from the clock, so a review recorded offline at 22:40 and synced at
 * 08:00 the next morning schedules from when it happened.
 */
export function applyReview(card: ReviewCard, rating: ReviewRating, reviewedAtMs: number): ReviewCard {
  const next = scheduler().next(toLibraryCard(card), new Date(reviewedAtMs), RATING_BY_NAME[rating]);
  return fromLibraryCard(next.card, card.subTopicId);
}

/**
 * Preview the interval each grade would produce, for the grade buttons.
 *
 * Showing "3 days / 6 days / 12 days / 25 days" under the four buttons is the
 * difference between a scheduler the student trusts and one that feels arbitrary.
 */
export function previewIntervals(
  card: ReviewCard,
  nowMs: number,
): Readonly<Record<ReviewRating, number>> {
  const source = toLibraryCard(card);
  const now = new Date(nowMs);
  const preview = (rating: ReviewRating): number => {
    const next = scheduler().next(source, now, RATING_BY_NAME[rating]);
    return Math.max(0, Math.round((next.card.due.getTime() - nowMs) / 86_400_000));
  };
  return {
    AGAIN: preview('AGAIN'),
    HARD: preview('HARD'),
    GOOD: preview('GOOD'),
    EASY: preview('EASY'),
  };
}

export function describeInterval(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${String(days)} days`;
  const months = Math.round(days / 30);
  return months === 1 ? 'in a month' : `in ${String(months)} months`;
}

/**
 * Difficulty to draw next for this card (FR-SRS-03: "matched difficulty").
 *
 * The library difficulty runs 1..10. The bank has three authored bands, so the
 * mapping is deliberately coarse — pretending to ten levels of item difficulty
 * against three authored ones would be false precision.
 */
export function targetDifficulty(card: ReviewCard): 'EASY' | 'MEDIUM' | 'HARD' {
  if (card.difficulty >= 7) return 'EASY';
  if (card.difficulty <= 4) return 'HARD';
  return 'MEDIUM';
}
