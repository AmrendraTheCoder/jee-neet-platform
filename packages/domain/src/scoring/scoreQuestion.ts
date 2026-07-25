/**
 * Grading of a single response.
 *
 * Requirements: FR-SCR-02 (pure and idempotent), FR-PAT-04 (marking lives on
 * the test/question join, not on the item), FR-SCR-18 (explain the award).
 *
 * PURITY CONTRACT — this function must never:
 *   - read the clock, the environment, or any module-level mutable state
 *   - look at `markedForReview` (FR-ATT-03; asserted by test)
 *   - look at `visited`, `timeSpentMs` or `clientSeq`
 *   - resolve anything by position — identity only (EC-DATA-09)
 */

import type { MarkingRule } from '../exam/pattern.js';
import type { AnswerKey, OptionId, Response, ResponseOutcome } from '../types.js';
import { gradeNumeric } from './numeric.js';

function isNumericBlank(raw: string | null): boolean {
  return raw === null || raw.trim() === '';
}

function unattempted(rule: MarkingRule, key: AnswerKey, why: string): ResponseOutcome {
  return {
    questionVersionId: key.questionVersionId,
    marks: rule.unattempted,
    status: 'UNATTEMPTED',
    explanation: why,
  };
}

/**
 * Grade one response.
 *
 * `response` may be undefined, which means the student never interacted with
 * the question at all. That is distinct from a response row that exists with an
 * empty selection (visited, considered, left blank) — both score as
 * unattempted, but the palette and the analytics treat them differently.
 */
export function scoreQuestion(
  rule: MarkingRule,
  response: Response | undefined,
  key: AnswerKey,
): ResponseOutcome {
  // ---- Key resolutions applied by a rescore (FR-SCR-13) --------------------
  // These are evaluated first because they override the authored key entirely.

  if (key.resolution === 'DROPPED') {
    // Credit everyone who appeared, attempted or not.
    return {
      questionVersionId: key.questionVersionId,
      marks: rule.correct,
      status: 'DROPPED',
      explanation: `This question was dropped. All candidates were awarded ${rule.correct} marks.`,
    };
  }

  const attempted =
    response !== undefined &&
    (rule.questionType === 'NUMERIC_INTEGER' || rule.questionType === 'NUMERIC_DECIMAL'
      ? !isNumericBlank(response.numericRaw)
      : response.selectedOptionIds.length > 0);

  if (key.resolution === 'ALL_CORRECT') {
    if (!attempted) {
      return unattempted(
        rule,
        key,
        'This question was credited to all candidates who attempted it. You did not attempt it.',
      );
    }
    return {
      questionVersionId: key.questionVersionId,
      marks: rule.correct,
      status: 'CORRECT',
      explanation: `This question was found ambiguous. All candidates who attempted it were awarded ${rule.correct} marks.`,
    };
  }

  // ---- Normal grading ------------------------------------------------------

  switch (rule.questionType) {
    case 'MCQ_SINGLE':
    case 'ASSERTION_REASON':
    case 'MATCHING_LIST':
      return scoreSingleChoice(rule, response, key);
    case 'MCQ_MULTI':
      return scoreMultiChoice(rule, response, key);
    case 'NUMERIC_INTEGER':
    case 'NUMERIC_DECIMAL':
      return scoreNumeric(rule, response, key);
  }
}

function scoreSingleChoice(
  rule: Extract<MarkingRule, { questionType: 'MCQ_SINGLE' | 'ASSERTION_REASON' | 'MATCHING_LIST' }>,
  response: Response | undefined,
  key: AnswerKey,
): ResponseOutcome {
  const selected = response?.selectedOptionIds ?? [];

  if (selected.length === 0) {
    return unattempted(rule, key, 'Not answered.');
  }

  // A single-choice question with more than one selection is malformed input,
  // not a partially-correct answer. The player prevents it; a scripted client
  // does not, so the engine must have an opinion.
  if (selected.length > 1) {
    return {
      questionVersionId: key.questionVersionId,
      marks: rule.incorrect,
      status: 'INCORRECT',
      explanation: `More than one option was recorded for a single-answer question. Scored as incorrect (${rule.incorrect}).`,
    };
  }

  const chosen = selected[0] as OptionId;
  const correctSet = new Set(key.correctOptionIds);

  // Under a MULTI_KEY resolution the key carries more than one acceptable
  // option; selecting any of them earns full marks.
  if (correctSet.has(chosen)) {
    const multi = key.resolution === 'MULTI_KEY' && key.correctOptionIds.length > 1;
    return {
      questionVersionId: key.questionVersionId,
      marks: rule.correct,
      status: 'CORRECT',
      explanation: multi
        ? `Correct. The answer key for this question was revised to accept ${key.correctOptionIds.length} options; your response is one of them. Awarded ${rule.correct}.`
        : `Correct. Awarded ${rule.correct}.`,
    };
  }

  return {
    questionVersionId: key.questionVersionId,
    marks: rule.incorrect,
    status: 'INCORRECT',
    explanation: `Incorrect. ${rule.incorrect} applied.`,
  };
}

function scoreMultiChoice(
  rule: Extract<MarkingRule, { questionType: 'MCQ_MULTI' }>,
  response: Response | undefined,
  key: AnswerKey,
): ResponseOutcome {
  const selected = response?.selectedOptionIds ?? [];

  if (selected.length === 0) {
    return unattempted(rule, key, 'Not answered.');
  }

  const correctSet = new Set(key.correctOptionIds);
  // De-duplicate defensively: a retried sync could in principle deliver a
  // repeated option id, and it must not inflate the partial-credit count.
  const selectedSet = new Set(selected);

  let selectedCorrect = 0;
  let selectedIncorrect = 0;
  for (const id of selectedSet) {
    if (correctSet.has(id)) selectedCorrect += 1;
    else selectedIncorrect += 1;
  }
  const totalCorrect = correctSet.size;

  if (rule.partial.mode === 'ALL_OR_NOTHING') {
    const exact = selectedIncorrect === 0 && selectedCorrect === totalCorrect;
    return exact
      ? {
          questionVersionId: key.questionVersionId,
          marks: rule.correct,
          status: 'CORRECT',
          explanation: `Correct. You selected all ${totalCorrect} correct options and nothing else. Awarded ${rule.correct}.`,
        }
      : {
          questionVersionId: key.questionVersionId,
          marks: rule.incorrect,
          status: 'INCORRECT',
          explanation: `Incorrect. This question is scored all-or-nothing and requires exactly the ${totalCorrect} correct options. ${rule.incorrect} applied.`,
        };
  }

  const ladder = rule.partial;

  if (selectedIncorrect > 0) {
    return {
      questionVersionId: key.questionVersionId,
      marks: ladder.penaltyIfAnyIncorrect,
      status: 'INCORRECT',
      explanation: `Incorrect. You selected ${selectedIncorrect} option(s) that are not in the answer key, so the partial-credit ladder does not apply and ${ladder.penaltyIfAnyIncorrect} is applied.`,
    };
  }

  if (selectedCorrect === totalCorrect) {
    return {
      questionVersionId: key.questionVersionId,
      marks: ladder.awardIfAllCorrectSelected,
      status: 'CORRECT',
      explanation: `Correct. You selected all ${totalCorrect} correct options. Awarded ${ladder.awardIfAllCorrectSelected}.`,
    };
  }

  // Only-correct-but-not-all: the published ladder awards by count.
  const award = ladder.awardBySelectedCorrectCount[selectedCorrect] ?? 0;
  return {
    questionVersionId: key.questionVersionId,
    marks: award,
    status: 'PARTIALLY_CORRECT',
    explanation:
      `Partially correct. You selected ${selectedCorrect} of the ${totalCorrect} correct options and no incorrect ones. ` +
      `The marking ladder awards ${award} for this — not ${formatProportional(rule.correct, selectedCorrect, totalCorrect)}, which is a commonly published but incorrect formula.`,
  };
}

function formatProportional(full: number, selectedCorrect: number, totalCorrect: number): string {
  const value = (full * selectedCorrect) / totalCorrect;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function scoreNumeric(
  rule: Extract<MarkingRule, { questionType: 'NUMERIC_INTEGER' | 'NUMERIC_DECIMAL' }>,
  response: Response | undefined,
  key: AnswerKey,
): ResponseOutcome {
  const raw = response?.numericRaw ?? null;

  if (isNumericBlank(raw)) {
    return unattempted(rule, key, 'Not answered.');
  }

  if (key.numericValue === null) {
    // A numeric question whose key has no value is a content defect. Refusing
    // to guess is correct: surface it rather than scoring the student zero.
    throw new Error(
      `answer key ${String(key.questionVersionId)} v${String(key.version)} is a numeric question with no numericValue`,
    );
  }

  const verdict = gradeNumeric(raw, key.numericValue, rule.numeric);

  if (verdict === 'CORRECT') {
    return {
      questionVersionId: key.questionVersionId,
      marks: rule.correct,
      status: 'CORRECT',
      explanation: `Correct. Awarded ${rule.correct}.`,
    };
  }

  if (verdict === 'UNPARSEABLE') {
    return {
      questionVersionId: key.questionVersionId,
      marks: rule.penaliseUnparseable ? rule.incorrect : 0,
      status: 'UNPARSEABLE',
      explanation: rule.penaliseUnparseable
        ? `Your response could not be read as a number. Scored as incorrect (${rule.incorrect}).`
        : 'Your response could not be read as a number. No marks awarded and no penalty applied.',
    };
  }

  return {
    questionVersionId: key.questionVersionId,
    marks: rule.incorrect,
    status: 'INCORRECT',
    explanation: describeNumericMiss(rule, key.numericValue),
  };
}

function describeNumericMiss(
  rule: Extract<MarkingRule, { questionType: 'NUMERIC_INTEGER' | 'NUMERIC_DECIMAL' }>,
  keyValue: string,
): string {
  switch (rule.numeric.kind) {
    case 'EXACT_INTEGER':
      return `Incorrect. The expected answer is the integer ${keyValue}. ${rule.incorrect} applied.`;
    case 'TOLERANCE':
      return `Incorrect. The expected answer is ${keyValue} within ${rule.numeric.toleranceAbs}. ${rule.incorrect} applied.`;
    case 'ROUNDED':
      return (
        `Incorrect. The expected answer is ${keyValue}, compared after ` +
        `${rule.numeric.mode === 'TRUNCATE' ? 'truncating' : 'rounding'} to ${rule.numeric.decimals} decimal place(s). ` +
        `${rule.incorrect} applied.`
      );
  }
}
