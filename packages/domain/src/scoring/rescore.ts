/**
 * Rescore planning (FR-SCR-11 through FR-SCR-16, EC-DATA-03, EC-FAIR-02).
 *
 * A rescore is the most consequential fairness operation the platform performs.
 * It is also the one most likely to be attempted as an in-place UPDATE, which
 * silently invalidates every existing score, corrupts historical analytics,
 * leaves the leaderboard inconsistent with stored results, and makes the change
 * unexplainable to the student it affected.
 *
 * This module produces a *plan*: a pure, inspectable description of what would
 * change. Nothing here writes. The caller applies the plan inside one
 * transaction that writes new result rows, emits a new leaderboard snapshot and
 * swaps a pointer.
 */

import type { AnswerKey, AttemptId, QuestionVersionId, ResponseStatus } from '../types.js';
import type { AttemptScore, TestQuestion } from './scoreAttempt.js';
import { scoreAttempt } from './scoreAttempt.js';
import type { Response } from '../types.js';

export interface QuestionChange {
  readonly questionVersionId: QuestionVersionId;
  readonly marksBefore: number;
  readonly marksAfter: number;
  readonly statusBefore: ResponseStatus;
  readonly statusAfter: ResponseStatus;
  readonly explanation: string;
}

export interface RescorePlan {
  readonly attemptId: AttemptId;
  readonly previous: AttemptScore;
  readonly next: AttemptScore;
  readonly rawScoreDelta: number;
  readonly positiveMarksDelta: number;
  readonly changes: readonly QuestionChange[];
  /**
   * Coins to grant. Always >= 0.
   *
   * Reward adjustment is compensating top-up only, never clawback (FR-SCR-16).
   * A student may already have spent coins earned under the previous result;
   * taking them back is a worse trust event than the original scoring error,
   * and this is enforced here rather than left to the caller's discipline.
   */
  readonly coinTopUp: number;
  /** True when nothing changed — the caller should write nothing at all. */
  readonly noop: boolean;
}

export interface RescoreInput {
  readonly attemptId: AttemptId;
  readonly questions: readonly TestQuestion[];
  readonly responses: readonly Response[];
  readonly previousScore: AttemptScore;
  readonly newKeys: readonly AnswerKey[];
  /** Coins awarded per mark under the current reward configuration. */
  readonly coinsPerMark?: number;
}

/**
 * Compute what a key revision would do to one attempt.
 *
 * Idempotent by construction: it is a pure function of its inputs, so applying
 * the same revision twice produces an identical plan and the second application
 * is a no-op. That property is what makes the rescore pipeline safe to retry,
 * which it must be, because it runs as a queued job that can be redelivered.
 */
export function planRescore(input: RescoreInput): RescorePlan {
  const next = scoreAttempt({
    attemptId: input.attemptId,
    questions: input.questions,
    responses: input.responses,
    keys: input.newKeys,
  });

  const previousByQuestion = new Map(
    input.previousScore.outcomes.map((o) => [String(o.questionVersionId), o]),
  );

  const changes: QuestionChange[] = [];
  for (const after of next.outcomes) {
    const before = previousByQuestion.get(String(after.questionVersionId));
    if (before === undefined) continue;
    if (before.marks === after.marks && before.status === after.status) continue;
    changes.push({
      questionVersionId: after.questionVersionId,
      marksBefore: before.marks,
      marksAfter: after.marks,
      statusBefore: before.status,
      statusAfter: after.status,
      explanation: after.explanation,
    });
  }

  const rawScoreDelta = next.rawScore - input.previousScore.rawScore;
  const positiveMarksDelta = next.positiveMarks - input.previousScore.positiveMarks;

  const coinsPerMark = input.coinsPerMark ?? 0;
  const rawCoinDelta = Math.round(rawScoreDelta * coinsPerMark);
  const coinTopUp = Math.max(0, rawCoinDelta);

  return {
    attemptId: input.attemptId,
    previous: input.previousScore,
    next,
    rawScoreDelta,
    positiveMarksDelta,
    changes,
    coinTopUp,
    noop: changes.length === 0 && rawScoreDelta === 0,
  };
}

/**
 * Student-facing summary of a rescore (FR-SCR-15).
 *
 * A rescore notification that says only "your score has been updated" is worse
 * than none: it tells a candidate their result moved without telling them why,
 * on the one number they care about most.
 */
export function describeRescore(plan: RescorePlan): string {
  if (plan.noop) return 'Your result was reviewed and is unchanged.';

  const direction =
    plan.rawScoreDelta > 0 ? 'increased' : plan.rawScoreDelta < 0 ? 'decreased' : 'been revised';
  const magnitude = Math.abs(plan.rawScoreDelta);

  const lines: string[] = [
    `Your score has ${direction}${magnitude === 0 ? '' : ` by ${magnitude} mark${magnitude === 1 ? '' : 's'}`}: ` +
      `${plan.previous.rawScore} to ${plan.next.rawScore}.`,
    '',
    `${plan.changes.length} question${plan.changes.length === 1 ? '' : 's'} affected:`,
  ];

  for (const c of plan.changes) {
    lines.push(
      `  - ${String(c.questionVersionId)}: ${c.marksBefore} to ${c.marksAfter}. ${c.explanation}`,
    );
  }

  if (plan.coinTopUp > 0) {
    lines.push('', `${plan.coinTopUp} coins have been added to your balance.`);
  }

  return lines.join('\n');
}

/**
 * Apply a key resolution to a set of keys, producing the revised set.
 *
 * Pure. The revised keys carry an incremented version so the result rows they
 * produce are distinguishable from the originals for ever.
 */
export function reviseKeys(
  keys: readonly AnswerKey[],
  revisions: ReadonlyMap<string, Pick<AnswerKey, 'correctOptionIds' | 'numericValue' | 'resolution'>>,
): AnswerKey[] {
  return keys.map((k) => {
    const revision = revisions.get(String(k.questionVersionId));
    if (revision === undefined) return k;
    return {
      questionVersionId: k.questionVersionId,
      version: ((k.version as unknown as number) + 1) as AnswerKey['version'],
      correctOptionIds: revision.correctOptionIds,
      numericValue: revision.numericValue,
      resolution: revision.resolution,
    };
  });
}
