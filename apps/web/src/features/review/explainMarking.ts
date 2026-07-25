import type { MarkingRule, PartialPolicy, ResponseStatus } from '@platform/domain';
import { formatMarks } from '../../lib/format.js';

/**
 * Plain-language explanation of the marking scheme (FR-SCR-18).
 *
 * THIS FILE COMPUTES NOTHING. The marks and the status shown to a candidate
 * are always the server's (FR-SCR-17); everything here reads the marking rule
 * — which is DATA carried on the (test_section, question) join — and turns it
 * into sentences. That separation is what lets the explanation be right for a
 * pattern this bundle has never seen: a 2027 scheme is an INSERT, and its
 * ladder renders here without a release.
 *
 * The ladder is described from `awardBySelectedCorrectCount`, an explicit
 * lookup table, and never from a formula. The proportional formula
 * `4 x correct/total` circulates very widely and has never been the real
 * scheme; implementing it — even only in an explanation — would tell a
 * candidate their marks were computed a way they were not.
 */

export interface MarkingExplanation {
  /** One line stating what happened on this question. */
  readonly headline: string;
  /** The full scheme for this question, as bullet points. */
  readonly rules: readonly string[];
}

function describePartial(policy: PartialPolicy, correctMark: number): readonly string[] {
  if (policy.mode === 'ALL_OR_NOTHING') {
    return [
      `Selecting every correct option and nothing else: ${formatMarks(correctMark)}.`,
      'Any other combination earns no partial credit.',
    ];
  }

  const ladder = Object.entries(policy.awardBySelectedCorrectCount)
    .map(([count, award]) => ({ count: Number(count), award }))
    .filter((entry) => Number.isFinite(entry.count))
    .sort((a, b) => b.count - a.count)
    .map(
      (entry) =>
        `${entry.count} correct option${entry.count === 1 ? '' : 's'} selected: ${formatMarks(entry.award)}`,
    );

  return [
    `All correct options selected, and nothing else: ${formatMarks(policy.awardIfAllCorrectSelected)}.`,
    'If you selected only correct options but not all of them, the marks are fixed by how many you selected:',
    ...ladder,
    `If you selected any incorrect option, the question scores ${formatMarks(policy.penaltyIfAnyIncorrect)} regardless of what else you selected.`,
    'If you selected nothing, the question scores 0.',
  ];
}

function describeNumeric(rule: Extract<MarkingRule, { numeric: unknown }>): readonly string[] {
  const spec = rule.numeric;
  const tolerance =
    spec.kind === 'EXACT_INTEGER'
      ? 'Your answer had to match the key exactly, as an integer.'
      : spec.kind === 'TOLERANCE'
        ? `Your answer was accepted if it was within ${spec.toleranceAbs} of the key.`
        : `Your answer was compared after rounding to ${spec.decimals} decimal place${spec.decimals === 1 ? '' : 's'} (${spec.mode === 'HALF_UP' ? 'rounding half up' : 'truncating'}).`;

  return [
    `Correct: ${formatMarks(rule.correct)}.`,
    rule.incorrect === 0
      ? 'There is no negative marking on this question.'
      : `Incorrect: ${formatMarks(rule.incorrect)}.`,
    'Unanswered: 0.',
    tolerance,
    rule.penaliseUnparseable
      ? 'An entry that is not a number is treated as a wrong answer.'
      : 'An entry that is not a number scores 0 rather than a penalty.',
  ];
}

const STATUS_HEADLINE: Readonly<Record<ResponseStatus, string>> = {
  CORRECT: 'Correct',
  PARTIALLY_CORRECT: 'Partially correct',
  INCORRECT: 'Incorrect',
  UNATTEMPTED: 'Not answered',
  DROPPED: 'This question was dropped',
  UNPARSEABLE: 'Your entry could not be read as a number',
};

export function explainMarking(args: {
  readonly rule: MarkingRule;
  readonly status: ResponseStatus;
  readonly marks: number;
}): MarkingExplanation {
  const { rule, status, marks } = args;

  const headline =
    status === 'DROPPED'
      ? `This question was dropped after the paper. ${formatMarks(marks)} awarded.`
      : status === 'UNATTEMPTED'
        ? 'You did not answer this question, so it scores 0.'
        : `${STATUS_HEADLINE[status]}. ${formatMarks(marks)} awarded.`;

  if (rule.questionType === 'MCQ_MULTI') {
    return { headline, rules: describePartial(rule.partial, rule.correct) };
  }

  if (rule.questionType === 'NUMERIC_INTEGER' || rule.questionType === 'NUMERIC_DECIMAL') {
    return { headline, rules: describeNumeric(rule) };
  }

  return {
    headline,
    rules: [
      `Correct: ${formatMarks(rule.correct)}.`,
      rule.incorrect === 0
        ? 'There is no negative marking on this question.'
        : `Incorrect: ${formatMarks(rule.incorrect)}.`,
      `Unanswered: ${formatMarks(rule.unattempted)}.`,
    ],
  };
}
