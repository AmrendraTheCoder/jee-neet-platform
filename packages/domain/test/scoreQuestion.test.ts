import { describe, expect, it } from 'vitest';
import { scoreQuestion } from '../src/scoring/scoreQuestion.js';
import type { MarkingRule } from '../src/exam/pattern.js';
import {
  JEE_ADV_2026_MCQ_MULTI,
  JEE_ADV_2026_NUMERIC,
} from '../src/exam/patterns/jee-advanced-2026.js';
import { MCQ_SINGLE_4_1, NUMERIC_INT_4_1, key, opt, response } from './helpers.js';
import { asAnswerKeyVersion } from '../src/types.js';

describe('scoreQuestion — single choice', () => {
  const correctKey = key(1, { correctOptionIds: [opt(1, 'B')] });

  it('awards full marks for the correct option', () => {
    const out = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, { selectedOptionIds: [opt(1, 'B')] }),
      correctKey,
    );
    expect(out.marks).toBe(4);
    expect(out.status).toBe('CORRECT');
  });

  it('applies the negative for a wrong option', () => {
    const out = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, { selectedOptionIds: [opt(1, 'A')] }),
      correctKey,
    );
    expect(out.marks).toBe(-1);
    expect(out.status).toBe('INCORRECT');
  });

  it('scores an absent response as unattempted, not incorrect', () => {
    const out = scoreQuestion(MCQ_SINGLE_4_1, undefined, correctKey);
    expect(out.marks).toBe(0);
    expect(out.status).toBe('UNATTEMPTED');
  });

  it('scores a visited-but-blank response as unattempted', () => {
    const out = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, { visited: true, selectedOptionIds: [] }),
      correctKey,
    );
    expect(out.status).toBe('UNATTEMPTED');
  });

  it('rejects multiple selections on a single-answer question', () => {
    const out = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'B')] }),
      correctKey,
    );
    expect(out.status).toBe('INCORRECT');
    expect(out.marks).toBe(-1);
  });
});

describe('scoreQuestion — is blind to marked-for-review (FR-ATT-03)', () => {
  const correctKey = key(1, { correctOptionIds: [opt(1, 'B')] });

  it('scores identically whether or not the question is marked', () => {
    const plain = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, { selectedOptionIds: [opt(1, 'B')], markedForReview: false }),
      correctKey,
    );
    const marked = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, { selectedOptionIds: [opt(1, 'B')], markedForReview: true }),
      correctKey,
    );
    expect(marked).toEqual(plain);
  });

  it('scores identically regardless of visited, time spent or client sequence', () => {
    const a = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, {
        selectedOptionIds: [opt(1, 'B')],
        visited: true,
        timeSpentMs: 5,
        clientSeq: 1,
      }),
      correctKey,
    );
    const b = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, {
        selectedOptionIds: [opt(1, 'B')],
        visited: false,
        timeSpentMs: 900_000,
        clientSeq: 99,
      }),
      correctKey,
    );
    expect(b).toEqual(a);
  });
});

/**
 * The centrepiece.
 *
 * Two errors about this scheme are near-universal on the Indian web:
 * the negative is widely published as -2 (it is -1), and partial credit is
 * widely published as the proportional formula 4 x correct/total (it has never
 * been that). These tests pin the real ladder.
 */
describe('scoreQuestion — JEE Advanced multi-correct partial ladder', () => {
  const rule = JEE_ADV_2026_MCQ_MULTI;
  const threeCorrect = key(1, {
    correctOptionIds: [opt(1, 'A'), opt(1, 'B'), opt(1, 'C')],
  });
  const fourCorrect = key(1, {
    correctOptionIds: [opt(1, 'A'), opt(1, 'B'), opt(1, 'C'), opt(1, 'D')],
  });

  it('awards +4 when all correct options are selected', () => {
    const out = scoreQuestion(
      rule,
      response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'B'), opt(1, 'C')] }),
      threeCorrect,
    );
    expect(out.marks).toBe(4);
    expect(out.status).toBe('CORRECT');
  });

  it('awards +2 for two of three correct — NOT the proportional 2.67', () => {
    const out = scoreQuestion(
      rule,
      response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'B')] }),
      threeCorrect,
    );
    expect(out.marks).toBe(2);
    expect(out.status).toBe('PARTIALLY_CORRECT');

    // The widely-published wrong answer, asserted explicitly so a future
    // refactor toward "simplify to a formula" fails loudly.
    const proportional = (4 * 2) / 3;
    expect(out.marks).not.toBeCloseTo(proportional);
  });

  it('awards +1 for one of three correct', () => {
    const out = scoreQuestion(rule, response(1, { selectedOptionIds: [opt(1, 'A')] }), threeCorrect);
    expect(out.marks).toBe(1);
    expect(out.status).toBe('PARTIALLY_CORRECT');
  });

  it('awards +3 for three of four correct', () => {
    const out = scoreQuestion(
      rule,
      response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'B'), opt(1, 'C')] }),
      fourCorrect,
    );
    expect(out.marks).toBe(3);
    expect(out.status).toBe('PARTIALLY_CORRECT');
  });

  it('applies -1, not -2, when any incorrect option is selected', () => {
    const out = scoreQuestion(
      rule,
      response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'D')] }),
      threeCorrect,
    );
    expect(out.marks).toBe(-1);
    expect(out.status).toBe('INCORRECT');
  });

  it('applies the penalty even when every correct option was also selected', () => {
    const out = scoreQuestion(
      rule,
      response(1, {
        selectedOptionIds: [opt(1, 'A'), opt(1, 'B'), opt(1, 'C'), opt(1, 'D')],
      }),
      threeCorrect,
    );
    expect(out.marks).toBe(-1);
  });

  it('awards zero for no selection', () => {
    const out = scoreQuestion(rule, response(1, { selectedOptionIds: [] }), threeCorrect);
    expect(out.marks).toBe(0);
    expect(out.status).toBe('UNATTEMPTED');
  });

  it('does not inflate partial credit from a duplicated option id', () => {
    // A retried sync could in principle deliver the same option twice.
    const out = scoreQuestion(
      rule,
      response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'A')] }),
      threeCorrect,
    );
    expect(out.marks).toBe(1);
  });

  it('explains the award in terms a candidate can check', () => {
    const out = scoreQuestion(
      rule,
      response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'B')] }),
      threeCorrect,
    );
    expect(out.explanation).toContain('2 of the 3 correct options');
    expect(out.explanation).toContain('awards 2');
  });
});

describe('scoreQuestion — all-or-nothing multi-correct', () => {
  const rule: MarkingRule = {
    questionType: 'MCQ_MULTI',
    correct: 4,
    incorrect: -1,
    unattempted: 0,
    partial: { mode: 'ALL_OR_NOTHING' },
  };
  const k = key(1, { correctOptionIds: [opt(1, 'A'), opt(1, 'B')] });

  it('awards full marks only for the exact set', () => {
    expect(
      scoreQuestion(rule, response(1, { selectedOptionIds: [opt(1, 'A'), opt(1, 'B')] }), k).marks,
    ).toBe(4);
  });

  it('gives no partial credit for a correct subset', () => {
    const out = scoreQuestion(rule, response(1, { selectedOptionIds: [opt(1, 'A')] }), k);
    expect(out.marks).toBe(-1);
    expect(out.status).toBe('INCORRECT');
  });
});

describe('scoreQuestion — numeric', () => {
  it('awards full marks for a correct integer in any numeral system', () => {
    const k = key(1, { numericValue: '25' });
    expect(scoreQuestion(NUMERIC_INT_4_1, response(1, { numericRaw: '25' }), k).marks).toBe(4);
    expect(scoreQuestion(NUMERIC_INT_4_1, response(1, { numericRaw: '२५' }), k).marks).toBe(4);
    expect(scoreQuestion(NUMERIC_INT_4_1, response(1, { numericRaw: ' 25.00 ' }), k).marks).toBe(4);
  });

  it('penalises an unparseable response only where the scheme says so', () => {
    const k = key(1, { numericValue: '25' });
    const penalising = scoreQuestion(NUMERIC_INT_4_1, response(1, { numericRaw: 'xyz' }), k);
    expect(penalising.marks).toBe(-1);
    expect(penalising.status).toBe('UNPARSEABLE');

    const lenient = scoreQuestion(JEE_ADV_2026_NUMERIC, response(1, { numericRaw: 'xyz' }), k);
    expect(lenient.marks).toBe(0);
    expect(lenient.status).toBe('UNPARSEABLE');
  });

  it('refuses to score a numeric question whose key has no value', () => {
    const broken = key(1, { numericValue: null });
    expect(() =>
      scoreQuestion(NUMERIC_INT_4_1, response(1, { numericRaw: '25' }), broken),
    ).toThrowError(/numeric question with no numericValue/);
  });
});

describe('scoreQuestion — key resolutions applied by a rescore', () => {
  it('DROPPED credits every candidate, attempted or not', () => {
    const k = key(1, {
      correctOptionIds: [opt(1, 'B')],
      resolution: 'DROPPED',
      version: asAnswerKeyVersion(2),
    });
    expect(scoreQuestion(MCQ_SINGLE_4_1, undefined, k).marks).toBe(4);
    expect(
      scoreQuestion(MCQ_SINGLE_4_1, response(1, { selectedOptionIds: [opt(1, 'A')] }), k).marks,
    ).toBe(4);
  });

  it('ALL_CORRECT credits only candidates who attempted', () => {
    const k = key(1, {
      correctOptionIds: [opt(1, 'B')],
      resolution: 'ALL_CORRECT',
      version: asAnswerKeyVersion(2),
    });
    expect(
      scoreQuestion(MCQ_SINGLE_4_1, response(1, { selectedOptionIds: [opt(1, 'A')] }), k).marks,
    ).toBe(4);
    const skipped = scoreQuestion(MCQ_SINGLE_4_1, undefined, k);
    expect(skipped.marks).toBe(0);
    expect(skipped.status).toBe('UNATTEMPTED');
  });

  it('MULTI_KEY credits any of the accepted options', () => {
    const k = key(1, {
      correctOptionIds: [opt(1, 'B'), opt(1, 'C')],
      resolution: 'MULTI_KEY',
      version: asAnswerKeyVersion(2),
    });
    expect(
      scoreQuestion(MCQ_SINGLE_4_1, response(1, { selectedOptionIds: [opt(1, 'B')] }), k).marks,
    ).toBe(4);
    expect(
      scoreQuestion(MCQ_SINGLE_4_1, response(1, { selectedOptionIds: [opt(1, 'C')] }), k).marks,
    ).toBe(4);
    expect(
      scoreQuestion(MCQ_SINGLE_4_1, response(1, { selectedOptionIds: [opt(1, 'A')] }), k).marks,
    ).toBe(-1);
  });

  it('explains a MULTI_KEY award so the candidate understands the revision', () => {
    const k = key(1, {
      correctOptionIds: [opt(1, 'B'), opt(1, 'C')],
      resolution: 'MULTI_KEY',
      version: asAnswerKeyVersion(2),
    });
    const out = scoreQuestion(
      MCQ_SINGLE_4_1,
      response(1, { selectedOptionIds: [opt(1, 'C')] }),
      k,
    );
    expect(out.explanation).toContain('revised to accept 2 options');
  });
});
