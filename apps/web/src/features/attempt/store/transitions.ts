import type { OptionId, QuestionVersionId } from '@platform/domain';
import type { AttemptQuestion, AttemptSnapshot, PersistedResponse } from '../../../lib/api/types.js';
import type { AttemptState, DraftAnswer } from './types.js';

/**
 * Pure state transitions for the player.
 *
 * Everything that decides examination behaviour lives here rather than in a
 * component, so it can be reasoned about and tested without a DOM. The
 * controller performs I/O around these; these never do I/O.
 */

export function questionAt(snapshot: AttemptSnapshot, index: number): AttemptQuestion | undefined {
  return snapshot.questions[index];
}

export function indexOfQuestion(
  snapshot: AttemptSnapshot,
  questionVersionId: QuestionVersionId,
): number {
  return snapshot.questions.findIndex((q) => q.questionVersionId === questionVersionId);
}

export function questionById(
  snapshot: AttemptSnapshot,
  questionVersionId: QuestionVersionId,
): AttemptQuestion | undefined {
  return snapshot.questions.find((q) => q.questionVersionId === questionVersionId);
}

/** The committed answer as a draft, i.e. what the controls show on entry. */
export function draftFromResponse(response: PersistedResponse | undefined): DraftAnswer {
  if (response === undefined) return { selectedOptionIds: [], numericRaw: null };
  return {
    selectedOptionIds: response.selectedOptionIds,
    numericRaw: response.numericRaw,
  };
}

export function effectiveDraft(state: AttemptState): DraftAnswer {
  if (state.draft !== null) return state.draft;
  return draftFromResponse(state.responses.get(String(state.currentQuestionVersionId)));
}

/**
 * NAVIGATE WITHOUT SAVING (FR-ATT-02).
 *
 * This is the single most commonly mis-implemented detail in every clone of
 * this interface, and it is worth being explicit about why it matters.
 *
 * In the real computer-based test, selecting an option and then clicking a
 * different question in the palette DISCARDS that selection. Candidates learn
 * this and use it deliberately: they try an option, look at another question,
 * and come back expecting the original state. A clone that quietly saves on
 * navigation gives them a saved answer they believe they abandoned — which on
 * a paper with negative marking converts a deliberate non-attempt into a wrong
 * answer worth minus one.
 *
 * So: `draft` is dropped, `responses` is untouched, and the only thing that
 * persists is that the destination question is now `visited` — which is the
 * other half of the real behaviour, because a question the candidate looked at
 * and left goes from Not Visited to Not Answered.
 */
export function navigateWithoutSaving(
  state: AttemptState,
  target: QuestionVersionId,
  monotonicNowMs: number,
): AttemptState {
  if (indexOfQuestion(state.snapshot, target) < 0) return state;
  return {
    ...state,
    currentQuestionVersionId: target,
    draft: null,
    screen: 'PLAYER',
    questionShownAtMonotonicMs: monotonicNowMs,
  };
}

export function setDraft(state: AttemptState, draft: DraftAnswer): AttemptState {
  return { ...state, draft };
}

/**
 * Toggle an option, honouring the question type.
 *
 * Single-answer types replace; multi-correct types toggle. Note that an option
 * is identified by its UUID throughout — a letter is a rendering artefact of
 * the persisted option order and never reaches this function (FR-ITM-03).
 */
export function toggleOption(
  state: AttemptState,
  optionId: OptionId,
  multi: boolean,
): AttemptState {
  const current = effectiveDraft(state);
  if (!multi) {
    return setDraft(state, { selectedOptionIds: [optionId], numericRaw: null });
  }
  const selected = new Set(current.selectedOptionIds);
  if (selected.has(optionId)) selected.delete(optionId);
  else selected.add(optionId);
  // Re-projected through the persisted option order so the committed array is
  // deterministic regardless of the order the candidate clicked in.
  const question = questionById(state.snapshot, state.currentQuestionVersionId);
  const ordered =
    question === undefined
      ? [...selected]
      : question.options.map((o) => o.optionId).filter((id) => selected.has(id));
  return setDraft(state, { selectedOptionIds: ordered, numericRaw: null });
}

export function setNumeric(state: AttemptState, raw: string): AttemptState {
  return setDraft(state, { selectedOptionIds: [], numericRaw: raw });
}

/**
 * The next question, crossing section boundaries.
 *
 * Auto-advance on Save & Next from the last question of a section is real
 * behaviour (FR-ATT-01): the candidate lands on the first question of the next
 * section rather than being stranded. Returns null on the last question of the
 * paper, where the player holds position rather than wrapping — wrapping to
 * question one after the final Save is disorienting at the end of a paper.
 */
export function nextQuestionId(
  state: AttemptState,
  from: QuestionVersionId,
): QuestionVersionId | null {
  const index = indexOfQuestion(state.snapshot, from);
  if (index < 0) return null;
  for (let i = index + 1; i < state.snapshot.questions.length; i += 1) {
    const candidate = state.snapshot.questions[i];
    if (candidate === undefined) continue;
    if (state.closedSectionIds.has(String(candidate.sectionId))) continue;
    return candidate.questionVersionId;
  }
  return null;
}

export function previousQuestionId(
  state: AttemptState,
  from: QuestionVersionId,
): QuestionVersionId | null {
  const index = indexOfQuestion(state.snapshot, from);
  if (index <= 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = state.snapshot.questions[i];
    if (candidate === undefined) continue;
    if (state.closedSectionIds.has(String(candidate.sectionId))) continue;
    return candidate.questionVersionId;
  }
  return null;
}

/**
 * Build the response row a commit will persist.
 *
 * `markedForReview` and `visited` are carried through as ORTHOGONAL columns
 * (FR-ATT-03). Nothing here folds them into the answer, and the server-side
 * scoring function is provably blind to `markedForReview` — there is a test
 * asserting it in the engine package.
 */
export function buildCommit(args: {
  readonly previous: PersistedResponse | undefined;
  readonly questionVersionId: QuestionVersionId;
  readonly draft: DraftAnswer;
  readonly markedForReview: boolean;
  readonly clientSeq: number;
  readonly elapsedMs: number;
}): PersistedResponse {
  return {
    questionVersionId: args.questionVersionId,
    selectedOptionIds: args.draft.selectedOptionIds,
    numericRaw: args.draft.numericRaw,
    visited: true,
    markedForReview: args.markedForReview,
    // Accumulates across visits. Measures time with the question on screen,
    // which is explicitly NOT time thinking — a candidate doing rough work on
    // paper generates a spuriously fast answer, so this feeds presentation
    // only and never an SRS grade or an integrity signal (FR-SRS-06).
    timeSpentMs: (args.previous?.timeSpentMs ?? 0) + Math.max(0, Math.round(args.elapsedMs)),
    clientSeq: args.clientSeq,
  };
}

export function withResponse(state: AttemptState, response: PersistedResponse): AttemptState {
  const responses = new Map(state.responses);
  responses.set(String(response.questionVersionId), response);
  return { ...state, responses, draft: null };
}

/** Marks the current question visited without touching the answer. */
export function markVisited(
  state: AttemptState,
  questionVersionId: QuestionVersionId,
  clientSeq: number,
): PersistedResponse | null {
  const existing = state.responses.get(String(questionVersionId));
  if (existing?.visited === true) return null;
  return {
    questionVersionId,
    selectedOptionIds: existing?.selectedOptionIds ?? [],
    numericRaw: existing?.numericRaw ?? null,
    visited: true,
    markedForReview: existing?.markedForReview ?? false,
    timeSpentMs: existing?.timeSpentMs ?? 0,
    clientSeq,
  };
}
