import type { MarkingRule } from '../src/exam/pattern.js';
import type { TestQuestion } from '../src/scoring/scoreAttempt.js';
import {
  type AnswerKey,
  type OptionId,
  type Response,
  asAnswerKeyVersion,
  asOptionId,
  asQuestionVersionId,
  asSectionId,
  type QuestionVersionId,
  type Subject,
} from '../src/types.js';

export const qv = (n: number): QuestionVersionId => asQuestionVersionId(`q${n}`);
export const opt = (q: number, letter: string): OptionId => asOptionId(`q${q}-${letter}`);
export const sec = (n: number) => asSectionId(`s${n}`);

export const MCQ_SINGLE_4_1: MarkingRule = {
  questionType: 'MCQ_SINGLE',
  correct: 4,
  incorrect: -1,
  unattempted: 0,
};

export const NUMERIC_INT_4_1: MarkingRule = {
  questionType: 'NUMERIC_INTEGER',
  correct: 4,
  incorrect: -1,
  unattempted: 0,
  numeric: { kind: 'EXACT_INTEGER' },
  penaliseUnparseable: true,
};

export function question(
  n: number,
  marking: MarkingRule,
  subject: Subject = 'PHYSICS',
  displayOrder = n,
): TestQuestion {
  return {
    questionVersionId: qv(n),
    sectionId: sec(1),
    subject,
    displayOrder,
    marking,
  };
}

export function response(
  n: number,
  init: Partial<Omit<Response, 'questionVersionId'>> = {},
): Response {
  return {
    questionVersionId: qv(n),
    selectedOptionIds: init.selectedOptionIds ?? [],
    numericRaw: init.numericRaw ?? null,
    visited: init.visited ?? true,
    markedForReview: init.markedForReview ?? false,
    timeSpentMs: init.timeSpentMs ?? 0,
    clientSeq: init.clientSeq ?? 1,
  };
}

export function key(
  n: number,
  init: Partial<Omit<AnswerKey, 'questionVersionId'>> = {},
): AnswerKey {
  return {
    questionVersionId: qv(n),
    version: init.version ?? asAnswerKeyVersion(1),
    correctOptionIds: init.correctOptionIds ?? [],
    numericValue: init.numericValue ?? null,
    resolution: init.resolution ?? null,
  };
}
