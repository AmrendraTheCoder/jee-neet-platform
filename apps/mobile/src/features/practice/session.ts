/**
 * Practice session state, as a pure reducer.
 *
 * Every action carries the `clientSeq` allocated by the local database write
 * that already committed. That ordering is deliberate and is the whole of
 * FR-SYN-01: the durable write happens first, the optimistic update is a
 * consequence of it. A reducer that generated its own sequence would let the
 * interface show a state that no storage layer ever agreed to.
 *
 * Tutor Mode and Timed Mode are genuinely different behaviours here, not a
 * boolean on a shared flow (FR-PRC-03):
 *   - Tutor reveals the server-computed result and the solution after each
 *     answer, and navigation forward is gated on having seen it.
 *   - Timed never reveals mid-session, runs an accumulated-elapsed clock, and
 *     shows everything at the end.
 */

import type { OptionId, QuestionVersionId, Response } from '@platform/domain';

import type { PracticeMode, QuestionResult } from '../../lib/api/types.js';

export interface SessionState {
  readonly sessionId: string;
  readonly mode: PracticeMode;
  readonly order: readonly QuestionVersionId[];
  readonly index: number;
  readonly responses: Readonly<Record<string, Response>>;
  /** Server-computed, tutor mode only. Never computed on the client. */
  readonly results: Readonly<Record<string, QuestionResult>>;
  readonly revealPending: boolean;
  readonly status: 'ACTIVE' | 'SUBMITTED';
}

export type SessionAction =
  | { readonly type: 'VISIT'; readonly clientSeq: number }
  | {
      readonly type: 'TOGGLE_OPTION';
      readonly optionId: OptionId;
      readonly multiSelect: boolean;
      readonly clientSeq: number;
    }
  | { readonly type: 'SET_NUMERIC'; readonly raw: string; readonly clientSeq: number }
  | { readonly type: 'TOGGLE_MARK'; readonly clientSeq: number }
  | { readonly type: 'CLEAR_RESPONSE'; readonly clientSeq: number }
  | { readonly type: 'ADD_TIME'; readonly deltaMs: number }
  | { readonly type: 'GO_TO'; readonly index: number }
  | { readonly type: 'REVEAL_REQUESTED' }
  | { readonly type: 'REVEAL_FAILED' }
  | { readonly type: 'REVEAL'; readonly result: QuestionResult }
  | { readonly type: 'SUBMIT' };

export function createSession(args: {
  readonly sessionId: string;
  readonly mode: PracticeMode;
  readonly order: readonly QuestionVersionId[];
}): SessionState {
  return {
    sessionId: args.sessionId,
    mode: args.mode,
    order: args.order,
    index: 0,
    responses: {},
    results: {},
    revealPending: false,
    status: 'ACTIVE',
  };
}

function currentId(state: SessionState): QuestionVersionId | null {
  return state.order[state.index] ?? null;
}

function blankResponse(questionVersionId: QuestionVersionId, clientSeq: number): Response {
  return {
    questionVersionId,
    selectedOptionIds: [],
    numericRaw: null,
    visited: true,
    markedForReview: false,
    timeSpentMs: 0,
    clientSeq,
  };
}

function withResponse(
  state: SessionState,
  questionVersionId: QuestionVersionId,
  update: (previous: Response) => Response,
): SessionState {
  const key = String(questionVersionId);
  const previous = state.responses[key] ?? blankResponse(questionVersionId, 0);
  return { ...state, responses: { ...state.responses, [key]: update(previous) } };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  const id = currentId(state);

  switch (action.type) {
    case 'VISIT': {
      if (id === null) return state;
      return withResponse(state, id, (previous) => ({
        ...previous,
        visited: true,
        clientSeq: action.clientSeq,
      }));
    }

    case 'TOGGLE_OPTION': {
      if (id === null || state.status === 'SUBMITTED') return state;
      // Tutor mode freezes the answer once the solution has been shown. Letting
      // a student change it afterwards produces a history where every question
      // was answered correctly, which destroys the value of the state filters.
      if (state.mode === 'TUTOR' && state.results[String(id)] !== undefined) return state;

      return withResponse(state, id, (previous) => {
        const already = previous.selectedOptionIds.includes(action.optionId);
        const next = action.multiSelect
          ? already
            ? previous.selectedOptionIds.filter((option) => option !== action.optionId)
            : [...previous.selectedOptionIds, action.optionId]
          : already
            ? []
            : [action.optionId];
        return {
          ...previous,
          selectedOptionIds: next,
          numericRaw: null,
          visited: true,
          clientSeq: action.clientSeq,
        };
      });
    }

    case 'SET_NUMERIC': {
      if (id === null || state.status === 'SUBMITTED') return state;
      if (state.mode === 'TUTOR' && state.results[String(id)] !== undefined) return state;
      // The raw keystrokes are kept verbatim (FR-SCR-05). Normalisation is a
      // scoring concern and happens against the stored raw value, never by
      // rewriting what the student typed.
      return withResponse(state, id, (previous) => ({
        ...previous,
        numericRaw: action.raw,
        selectedOptionIds: [],
        visited: true,
        clientSeq: action.clientSeq,
      }));
    }

    case 'TOGGLE_MARK': {
      if (id === null) return state;
      // Orthogonal to the answer, always (FR-ATT-03, EC-NOTES-03). Marking never
      // touches selectedOptionIds or numericRaw.
      return withResponse(state, id, (previous) => ({
        ...previous,
        markedForReview: !previous.markedForReview,
        visited: true,
        clientSeq: action.clientSeq,
      }));
    }

    case 'CLEAR_RESPONSE': {
      if (id === null) return state;
      // Clears the answer and leaves the review flag alone. They are orthogonal
      // and conflating them here is the single most commonly mis-implemented
      // detail in this interface.
      return withResponse(state, id, (previous) => ({
        ...previous,
        selectedOptionIds: [],
        numericRaw: null,
        clientSeq: action.clientSeq,
      }));
    }

    case 'ADD_TIME': {
      if (id === null) return state;
      // Accumulated dwell, recorded for analytics only. It is never an input to
      // an SRS grade — see features/srs/grading.ts and FR-SRS-06.
      return withResponse(state, id, (previous) => ({
        ...previous,
        timeSpentMs: previous.timeSpentMs + action.deltaMs,
      }));
    }

    case 'GO_TO': {
      if (action.index < 0 || action.index >= state.order.length) return state;
      return { ...state, index: action.index, revealPending: false };
    }

    case 'REVEAL_REQUESTED':
      return { ...state, revealPending: true };

    case 'REVEAL_FAILED':
      return { ...state, revealPending: false };

    case 'REVEAL': {
      return {
        ...state,
        revealPending: false,
        results: {
          ...state.results,
          [String(action.result.questionVersionId)]: action.result,
        },
      };
    }

    case 'SUBMIT':
      return { ...state, status: 'SUBMITTED' };
  }
}

export function currentQuestionId(state: SessionState): QuestionVersionId | null {
  return currentId(state);
}

export function isRevealed(state: SessionState, questionVersionId: QuestionVersionId): boolean {
  return state.results[String(questionVersionId)] !== undefined;
}

/** Tutor mode gates advancing until the student has seen the explanation. */
export function canAdvance(state: SessionState): boolean {
  const id = currentId(state);
  if (id === null) return false;
  if (state.mode !== 'TUTOR') return true;
  const response = state.responses[String(id)];
  const answered =
    response !== undefined &&
    (response.selectedOptionIds.length > 0 ||
      (response.numericRaw !== null && response.numericRaw.trim() !== ''));
  return !answered || isRevealed(state, id);
}
