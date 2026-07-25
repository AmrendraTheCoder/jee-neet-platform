/**
 * Question palette state (FR-ATT-01, FR-ATT-03, EC-NOTES-03).
 *
 * The examination interface exposes five states and candidates navigate by
 * their colours. The states are *derived* from three orthogonal facts —
 * visited, has-an-answer, marked-for-review — and are never stored.
 *
 * Storing the palette state instead of deriving it is the bug this module
 * prevents: it makes "marked for review" a variant of the answer, so marking a
 * question can clear it, and an answered-and-marked question can be scored as
 * unattempted. That silently loses marks on precisely the questions the
 * candidate was most careful about.
 */

import type { Response } from '../types.js';

export const PALETTE_STATES = [
  'NOT_VISITED',
  'NOT_ANSWERED',
  'ANSWERED',
  'MARKED_FOR_REVIEW',
  'ANSWERED_AND_MARKED',
] as const;

export type PaletteState = (typeof PALETTE_STATES)[number];

export interface PaletteFacts {
  readonly visited: boolean;
  readonly hasAnswer: boolean;
  readonly markedForReview: boolean;
}

export function paletteState(facts: PaletteFacts): PaletteState {
  if (!facts.visited) return 'NOT_VISITED';
  if (facts.hasAnswer && facts.markedForReview) return 'ANSWERED_AND_MARKED';
  if (facts.hasAnswer) return 'ANSWERED';
  if (facts.markedForReview) return 'MARKED_FOR_REVIEW';
  return 'NOT_ANSWERED';
}

/** Whether a response carries an answer, for either answer modality. */
export function hasAnswer(response: Response | undefined): boolean {
  if (response === undefined) return false;
  if (response.selectedOptionIds.length > 0) return true;
  return response.numericRaw !== null && response.numericRaw.trim() !== '';
}

export function paletteStateFor(response: Response | undefined): PaletteState {
  return paletteState({
    visited: response?.visited ?? false,
    hasAnswer: hasAnswer(response),
    markedForReview: response?.markedForReview ?? false,
  });
}

export interface PaletteCounts {
  readonly notVisited: number;
  readonly notAnswered: number;
  readonly answered: number;
  readonly markedForReview: number;
  readonly answeredAndMarked: number;
}

/**
 * Counts for the submit-confirmation summary (FR-ATT-04).
 *
 * "Answered" here means the palette sense — answered and *not* marked. The
 * confirmation screen shows both this and the answered-and-marked count so the
 * total the candidate reconciles against is unambiguous.
 */
export function paletteCounts(
  questionOrder: readonly string[],
  responsesByQuestion: ReadonlyMap<string, Response>,
): PaletteCounts {
  let notVisited = 0;
  let notAnswered = 0;
  let answered = 0;
  let markedForReview = 0;
  let answeredAndMarked = 0;

  for (const id of questionOrder) {
    switch (paletteStateFor(responsesByQuestion.get(id))) {
      case 'NOT_VISITED':
        notVisited += 1;
        break;
      case 'NOT_ANSWERED':
        notAnswered += 1;
        break;
      case 'ANSWERED':
        answered += 1;
        break;
      case 'MARKED_FOR_REVIEW':
        markedForReview += 1;
        break;
      case 'ANSWERED_AND_MARKED':
        answeredAndMarked += 1;
        break;
    }
  }

  return { notVisited, notAnswered, answered, markedForReview, answeredAndMarked };
}

/** Total questions that will be scored as attempted. */
export function attemptedCount(counts: PaletteCounts): number {
  return counts.answered + counts.answeredAndMarked;
}
