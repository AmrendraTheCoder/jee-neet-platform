import { describe, expect, it } from 'vitest';
import {
  MissingAnswerKeyError,
  UnknownQuestionError,
  scoreAttempt,
  scoringConfigFingerprint,
} from '../src/scoring/scoreAttempt.js';
import { seededShuffle } from '../src/attempt/shuffle.js';
import { asAttemptId, asQuestionVersionId } from '../src/types.js';
import { MCQ_SINGLE_4_1, key, opt, question, response } from './helpers.js';

const attemptId = asAttemptId('attempt-1');

function paper() {
  return [
    question(1, MCQ_SINGLE_4_1, 'PHYSICS', 1),
    question(2, MCQ_SINGLE_4_1, 'PHYSICS', 2),
    question(3, MCQ_SINGLE_4_1, 'CHEMISTRY', 3),
    question(4, MCQ_SINGLE_4_1, 'CHEMISTRY', 4),
    question(5, MCQ_SINGLE_4_1, 'MATHEMATICS', 5),
  ];
}

function keys() {
  return [1, 2, 3, 4, 5].map((n) => key(n, { correctOptionIds: [opt(n, 'B')] }));
}

describe('scoreAttempt', () => {
  it('aggregates net, positive and negative marks separately', () => {
    const result = scoreAttempt({
      attemptId,
      questions: paper(),
      keys: keys(),
      responses: [
        response(1, { selectedOptionIds: [opt(1, 'B')] }), // +4
        response(2, { selectedOptionIds: [opt(2, 'A')] }), // -1
        response(3, { selectedOptionIds: [opt(3, 'B')] }), // +4
        response(4, { selectedOptionIds: [opt(4, 'C')] }), // -1
        // q5 not answered -> 0
      ],
    });

    expect(result.rawScore).toBe(6);
    // FR-SCR-08: positive marks cannot be derived from the net score after the
    // fact, which is why they are computed and persisted here.
    expect(result.positiveMarks).toBe(8);
    expect(result.negativeMarks).toBe(-2);
    expect(result.counts).toEqual({
      correct: 2,
      partiallyCorrect: 0,
      incorrect: 2,
      unattempted: 1,
      dropped: 0,
      unparseable: 0,
    });
  });

  it('scores every question in the paper, including ones never touched', () => {
    const result = scoreAttempt({ attemptId, questions: paper(), keys: keys(), responses: [] });
    expect(result.outcomes).toHaveLength(5);
    expect(result.rawScore).toBe(0);
    expect(result.counts.unattempted).toBe(5);
  });

  it('breaks down by subject', () => {
    const result = scoreAttempt({
      attemptId,
      questions: paper(),
      keys: keys(),
      responses: [
        response(1, { selectedOptionIds: [opt(1, 'B')] }),
        response(2, { selectedOptionIds: [opt(2, 'B')] }),
        response(3, { selectedOptionIds: [opt(3, 'A')] }),
      ],
    });

    const physics = result.bySubject.find((s) => s.subject === 'PHYSICS');
    const chemistry = result.bySubject.find((s) => s.subject === 'CHEMISTRY');
    expect(physics?.score).toBe(8);
    expect(physics?.correct).toBe(2);
    expect(chemistry?.score).toBe(-1);
    expect(chemistry?.incorrect).toBe(1);
  });

  it('resolves duplicate responses by client sequence, never by arrival order', () => {
    // EC-NET-06: the student answered B, then changed to A while offline.
    // The later write must win regardless of which arrives first.
    const result = scoreAttempt({
      attemptId,
      questions: paper(),
      keys: keys(),
      responses: [
        response(1, { selectedOptionIds: [opt(1, 'A')], clientSeq: 7 }),
        response(1, { selectedOptionIds: [opt(1, 'B')], clientSeq: 3 }),
      ],
    });
    // Sequence 7 wins: option A, which is wrong.
    expect(result.outcomes[0]?.marks).toBe(-1);
  });

  it('rejects a response for a question outside this paper', () => {
    expect(() =>
      scoreAttempt({
        attemptId,
        questions: paper(),
        keys: keys(),
        responses: [
          { ...response(1), questionVersionId: asQuestionVersionId('not-in-paper') },
        ],
      }),
    ).toThrowError(UnknownQuestionError);
  });

  it('refuses to score without a key rather than guessing zero', () => {
    expect(() =>
      scoreAttempt({
        attemptId,
        questions: paper(),
        keys: keys().slice(0, 3),
        responses: [],
      }),
    ).toThrowError(MissingAnswerKeyError);
  });
});

/**
 * AC-ITM-02 — the shuffle-invariance contract test.
 *
 * EC-DATA-09 is the most dangerous bug class in this system: answers mapped by
 * position rather than identity. It is silent, it corrupts every score, and it
 * presents as poor student performance. This test is the guard.
 */
describe('scoreAttempt — shuffle invariance', () => {
  it('scores a shuffled and an unshuffled attempt identically', () => {
    const questions = paper();
    const responses = [
      response(1, { selectedOptionIds: [opt(1, 'B')] }),
      response(2, { selectedOptionIds: [opt(2, 'A')] }),
      response(3, { selectedOptionIds: [opt(3, 'B')] }),
      response(5, { selectedOptionIds: [opt(5, 'B')] }),
    ];

    const straight = scoreAttempt({ attemptId, questions, keys: keys(), responses });

    // Same paper, presented in a different order, with responses delivered in
    // yet another order.
    const shuffledQuestions = seededShuffle(questions, 'seed-alpha');
    const shuffledResponses = seededShuffle(responses, 'seed-beta');
    const shuffled = scoreAttempt({
      attemptId,
      questions: shuffledQuestions,
      keys: seededShuffle(keys(), 'seed-gamma'),
      responses: shuffledResponses,
    });

    expect(shuffled.rawScore).toBe(straight.rawScore);
    expect(shuffled.positiveMarks).toBe(straight.positiveMarks);
    expect(shuffled.counts).toEqual(straight.counts);
    expect(shuffled.bySubject).toEqual(straight.bySubject);

    // Per-question outcomes must match by identity, not by position.
    const byId = new Map(shuffled.outcomes.map((o) => [String(o.questionVersionId), o]));
    for (const outcome of straight.outcomes) {
      expect(byId.get(String(outcome.questionVersionId))).toEqual(outcome);
    }
  });

  it('produces the same scoring-config fingerprint regardless of display order', () => {
    const a = scoringConfigFingerprint(paper());
    const b = scoringConfigFingerprint(seededShuffle(paper(), 'any-seed'));
    expect(b).toBe(a);
  });

  it('produces a different fingerprint when a marking rule changes', () => {
    const base = paper();
    const changed = [
      { ...base[0]!, marking: { ...MCQ_SINGLE_4_1, incorrect: -2 } },
      ...base.slice(1),
    ];
    expect(scoringConfigFingerprint(changed)).not.toBe(scoringConfigFingerprint(base));
  });
});

describe('scoreAttempt — determinism', () => {
  it('is a pure function: identical inputs produce identical output', () => {
    const args = {
      attemptId,
      questions: paper(),
      keys: keys(),
      responses: [response(1, { selectedOptionIds: [opt(1, 'B')] })],
    };
    expect(scoreAttempt(args)).toEqual(scoreAttempt(args));
  });
});
