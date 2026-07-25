import type { QuestionVersionId, SectionId } from '@platform/domain';
import { paletteCounts, paletteStateFor } from '@platform/domain';
import type { PaletteCounts, PaletteState } from '@platform/domain';
import type { AttemptQuestion } from '../../../lib/api/types.js';
import type { AttemptState, SectionNavigability } from './types.js';

/**
 * Derived views of attempt state.
 *
 * PALETTE STATE IS NEVER STORED. Every read goes through `paletteStateFor` in
 * @platform/domain, which derives it from the three orthogonal facts (visited,
 * has-answer, marked-for-review). Storing it instead makes "marked for review"
 * a variant of the answer, so marking a question can clear it and an
 * answered-and-marked question can score as unattempted — silently losing
 * marks on exactly the questions the candidate was most careful about.
 */

export function paletteStateOf(state: AttemptState, id: QuestionVersionId): PaletteState {
  return paletteStateFor(state.responses.get(String(id)));
}

export function countsForQuestions(
  state: AttemptState,
  questions: readonly AttemptQuestion[],
): PaletteCounts {
  return paletteCounts(
    questions.map((q) => String(q.questionVersionId)),
    state.responses,
  );
}

export function countsForSection(state: AttemptState, sectionId: SectionId): PaletteCounts {
  return countsForQuestions(state, questionsInSection(state, sectionId));
}

export function countsForAttempt(state: AttemptState): PaletteCounts {
  return countsForQuestions(state, state.snapshot.questions);
}

export function questionsInSection(
  state: AttemptState,
  sectionId: SectionId,
): readonly AttemptQuestion[] {
  return state.snapshot.questions.filter((q) => q.sectionId === sectionId);
}

export function currentQuestion(state: AttemptState): AttemptQuestion | undefined {
  return state.snapshot.questions.find(
    (q) => q.questionVersionId === state.currentQuestionVersionId,
  );
}

export function currentSectionId(state: AttemptState): SectionId | null {
  return currentQuestion(state)?.sectionId ?? null;
}

/** 1-based position of a question WITHIN its section, which is what is displayed. */
export function positionInSection(state: AttemptState, id: QuestionVersionId): number {
  const question = state.snapshot.questions.find((q) => q.questionVersionId === id);
  if (question === undefined) return 0;
  return questionsInSection(state, question.sectionId).findIndex(
    (q) => q.questionVersionId === id,
  ) + 1;
}

export function isMultiSelect(question: AttemptQuestion): boolean {
  return question.questionType === 'MCQ_MULTI';
}

export function isNumeric(question: AttemptQuestion): boolean {
  return (
    question.questionType === 'NUMERIC_INTEGER' || question.questionType === 'NUMERIC_DECIMAL'
  );
}

/**
 * Whether each section may be entered right now.
 *
 * Where the pattern does not time-lock a section, switching is free and every
 * section reports enterable — that is the JEE Main and NEET case and it is the
 * default. Where the pattern DOES lock, the rule is: a locked section may be
 * entered only if it is the earliest locked section not yet closed, and a
 * closed section can never be re-entered. Getting this backwards either lets a
 * candidate return to a completed timed section, or strands them out of one
 * they have not started.
 */
export function sectionNavigability(state: AttemptState): readonly SectionNavigability[] {
  const ordered = [...state.snapshot.sections].sort((a, b) => a.ordinal - b.ordinal);
  const firstOpenLocked = ordered.find(
    (s) => s.timeLocked && !state.closedSectionIds.has(String(s.sectionId)),
  );

  return ordered.map((section) => {
    const closed = state.closedSectionIds.has(String(section.sectionId));
    if (closed) {
      return {
        sectionId: section.sectionId,
        enterable: false,
        reason: 'This section has been closed and cannot be reopened.',
      };
    }
    if (!section.timeLocked) {
      return { sectionId: section.sectionId, enterable: true, reason: null };
    }
    if (firstOpenLocked !== undefined && firstOpenLocked.sectionId === section.sectionId) {
      return { sectionId: section.sectionId, enterable: true, reason: null };
    }
    return {
      sectionId: section.sectionId,
      enterable: false,
      reason: 'This section is timed separately and opens after the current section closes.',
    };
  });
}

export function canEnterSection(state: AttemptState, sectionId: SectionId): boolean {
  return (
    sectionNavigability(state).find((s) => s.sectionId === sectionId)?.enterable ?? false
  );
}

export function firstQuestionOfSection(
  state: AttemptState,
  sectionId: SectionId,
): QuestionVersionId | null {
  return questionsInSection(state, sectionId)[0]?.questionVersionId ?? null;
}

/** Total attempted, as the submit confirmation reports it (FR-ATT-04). */
export function attemptedTotal(counts: PaletteCounts): number {
  return counts.answered + counts.answeredAndMarked;
}
