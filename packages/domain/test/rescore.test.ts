import { describe, expect, it } from 'vitest';
import { describeRescore, planRescore, reviseKeys } from '../src/scoring/rescore.js';
import { scoreAttempt } from '../src/scoring/scoreAttempt.js';
import { asAttemptId } from '../src/types.js';
import { MCQ_SINGLE_4_1, key, opt, question, response } from './helpers.js';

const attemptId = asAttemptId('attempt-1');

const questions = [
  question(1, MCQ_SINGLE_4_1, 'PHYSICS', 1),
  question(2, MCQ_SINGLE_4_1, 'PHYSICS', 2),
  question(3, MCQ_SINGLE_4_1, 'CHEMISTRY', 3),
];

const responses = [
  response(1, { selectedOptionIds: [opt(1, 'B')] }), // matches original key
  response(2, { selectedOptionIds: [opt(2, 'C')] }), // wrong under original key
  response(3, { selectedOptionIds: [opt(3, 'A')] }), // wrong under original key
];

const originalKeys = [
  key(1, { correctOptionIds: [opt(1, 'B')] }),
  key(2, { correctOptionIds: [opt(2, 'B')] }),
  key(3, { correctOptionIds: [opt(3, 'B')] }),
];

function baseline() {
  return scoreAttempt({ attemptId, questions, responses, keys: originalKeys });
}

describe('planRescore', () => {
  it('reports a no-op when nothing changed', () => {
    const previous = baseline();
    const plan = planRescore({
      attemptId,
      questions,
      responses,
      previousScore: previous,
      newKeys: originalKeys,
    });
    expect(plan.noop).toBe(true);
    expect(plan.rawScoreDelta).toBe(0);
    expect(plan.changes).toHaveLength(0);
    expect(describeRescore(plan)).toMatch(/unchanged/);
  });

  it('applies a MULTI_KEY revision and reports the delta', () => {
    const previous = baseline();
    // Q2's key is revised to accept option C as well.
    const revised = reviseKeys(
      originalKeys,
      new Map([
        [
          'q2',
          {
            correctOptionIds: [opt(2, 'B'), opt(2, 'C')],
            numericValue: null,
            resolution: 'MULTI_KEY' as const,
          },
        ],
      ]),
    );

    const plan = planRescore({
      attemptId,
      questions,
      responses,
      previousScore: previous,
      newKeys: revised,
    });

    expect(plan.noop).toBe(false);
    // Q2 moves from -1 to +4.
    expect(plan.rawScoreDelta).toBe(5);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      marksBefore: -1,
      marksAfter: 4,
      statusBefore: 'INCORRECT',
      statusAfter: 'CORRECT',
    });
  });

  it('applies a DROPPED revision to everyone, including non-attempters', () => {
    const previous = scoreAttempt({
      attemptId,
      questions,
      responses: [responses[0]!],
      keys: originalKeys,
    });
    const revised = reviseKeys(
      originalKeys,
      new Map([
        [
          'q3',
          { correctOptionIds: [opt(3, 'B')], numericValue: null, resolution: 'DROPPED' as const },
        ],
      ]),
    );

    const plan = planRescore({
      attemptId,
      questions,
      responses: [responses[0]!],
      previousScore: previous,
      newKeys: revised,
    });

    const q3 = plan.changes.find((c) => String(c.questionVersionId) === 'q3');
    expect(q3).toMatchObject({ marksBefore: 0, marksAfter: 4, statusAfter: 'DROPPED' });
  });

  it('increments the key version so revised results are distinguishable forever', () => {
    const revised = reviseKeys(
      originalKeys,
      new Map([
        [
          'q2',
          {
            correctOptionIds: [opt(2, 'B'), opt(2, 'C')],
            numericValue: null,
            resolution: 'MULTI_KEY' as const,
          },
        ],
      ]),
    );
    expect(revised.find((k) => String(k.questionVersionId) === 'q2')?.version).toBe(2);
    // Untouched keys keep their version.
    expect(revised.find((k) => String(k.questionVersionId) === 'q1')?.version).toBe(1);
  });
});

/**
 * AC-SCR-01 — idempotency.
 *
 * The rescore pipeline runs as a queued job that can be redelivered. If applying
 * the same revision twice produced a different result, a redelivery would
 * corrupt ranks silently.
 */
describe('planRescore — idempotency', () => {
  it('produces an identical plan when run twice', () => {
    const previous = baseline();
    const revised = reviseKeys(
      originalKeys,
      new Map([
        [
          'q2',
          {
            correctOptionIds: [opt(2, 'C')],
            numericValue: null,
            resolution: null,
          },
        ],
      ]),
    );

    const input = {
      attemptId,
      questions,
      responses,
      previousScore: previous,
      newKeys: revised,
    };
    expect(planRescore(input)).toEqual(planRescore(input));
  });

  it('re-applying the revision to the already-rescored result is a no-op', () => {
    const previous = baseline();
    const revised = reviseKeys(
      originalKeys,
      new Map([
        ['q2', { correctOptionIds: [opt(2, 'C')], numericValue: null, resolution: null }],
      ]),
    );

    const first = planRescore({
      attemptId,
      questions,
      responses,
      previousScore: previous,
      newKeys: revised,
    });
    expect(first.noop).toBe(false);

    const second = planRescore({
      attemptId,
      questions,
      responses,
      previousScore: first.next,
      newKeys: revised,
    });
    expect(second.noop).toBe(true);
    expect(second.rawScoreDelta).toBe(0);
  });

  it('shows zero drift across 10,000 synthetic attempts rescored twice', () => {
    const revised = reviseKeys(
      originalKeys,
      new Map([
        [
          'q2',
          {
            correctOptionIds: [opt(2, 'B'), opt(2, 'C')],
            numericValue: null,
            resolution: 'MULTI_KEY' as const,
          },
        ],
      ]),
    );

    let drift = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const id = asAttemptId(`attempt-${i}`);
      const previous = scoreAttempt({ attemptId: id, questions, responses, keys: originalKeys });
      const args = { attemptId: id, questions, responses, previousScore: previous, newKeys: revised };
      const a = planRescore(args);
      const b = planRescore(args);
      if (a.next.rawScore !== b.next.rawScore) drift += 1;
      // And the second application on top of the first must settle.
      const settled = planRescore({ ...args, previousScore: a.next });
      if (!settled.noop) drift += 1;
    }
    expect(drift).toBe(0);
  });
});

/**
 * FR-SCR-16 — compensating top-up only, never a clawback.
 *
 * A candidate may already have spent coins earned under the previous result.
 * Taking them back is a worse trust event than the original scoring error, so
 * the floor is enforced in the engine rather than left to caller discipline.
 */
describe('planRescore — reward adjustment', () => {
  it('tops up when the score rises', () => {
    const previous = baseline();
    const revised = reviseKeys(
      originalKeys,
      new Map([
        [
          'q2',
          {
            correctOptionIds: [opt(2, 'B'), opt(2, 'C')],
            numericValue: null,
            resolution: 'MULTI_KEY' as const,
          },
        ],
      ]),
    );
    const plan = planRescore({
      attemptId,
      questions,
      responses,
      previousScore: previous,
      newKeys: revised,
      coinsPerMark: 2,
    });
    expect(plan.rawScoreDelta).toBe(5);
    expect(plan.coinTopUp).toBe(10);
  });

  it('never claws back when the score falls', () => {
    const previous = baseline();
    // A revision that makes Q1 wrong: the candidate loses 5 marks.
    const revised = reviseKeys(
      originalKeys,
      new Map([
        ['q1', { correctOptionIds: [opt(1, 'D')], numericValue: null, resolution: null }],
      ]),
    );
    const plan = planRescore({
      attemptId,
      questions,
      responses,
      previousScore: previous,
      newKeys: revised,
      coinsPerMark: 2,
    });
    expect(plan.rawScoreDelta).toBe(-5);
    expect(plan.coinTopUp).toBe(0);
    expect(plan.coinTopUp).toBeGreaterThanOrEqual(0);
  });
});

describe('describeRescore', () => {
  it('states the before and after, not just that something changed', () => {
    const previous = baseline();
    const revised = reviseKeys(
      originalKeys,
      new Map([
        [
          'q2',
          {
            correctOptionIds: [opt(2, 'B'), opt(2, 'C')],
            numericValue: null,
            resolution: 'MULTI_KEY' as const,
          },
        ],
      ]),
    );
    const plan = planRescore({
      attemptId,
      questions,
      responses,
      previousScore: previous,
      newKeys: revised,
      coinsPerMark: 1,
    });

    const message = describeRescore(plan);
    expect(message).toContain('increased');
    expect(message).toContain(`${previous.rawScore} to ${plan.next.rawScore}`);
    expect(message).toContain('1 question affected');
    expect(message).toContain('coins have been added');
  });
});
