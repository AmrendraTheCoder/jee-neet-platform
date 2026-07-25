/**
 * Whole-attempt scoring.
 *
 * Requirements: FR-SCR-02 (pure, idempotent), FR-SCR-08 (positive marks
 * persisted separately), FR-PAT-07 (scoring config pinned).
 *
 * This function is the reference implementation and the test oracle. The
 * database is authoritative in production (FR-SCR-01) and runs the same
 * algorithm as set-based SQL; the shared golden fixtures keep the two honest.
 */

import type { MarkingRule } from '../exam/pattern.js';
import type {
  AnswerKey,
  AttemptId,
  QuestionVersionId,
  Response,
  ResponseOutcome,
  SectionId,
  Subject,
} from '../types.js';
import { fingerprint } from './fingerprint.js';
import { scoreQuestion } from './scoreQuestion.js';

/**
 * One question as it appears in one paper.
 *
 * Note that `marking` lives here, on the paper/question join, and not on the
 * question itself (FR-PAT-04). The same item cross-tagged into a JEE paper and
 * a NEET paper scores differently in each, and that is not an edge case.
 */
export interface TestQuestion {
  readonly questionVersionId: QuestionVersionId;
  readonly sectionId: SectionId;
  readonly subject: Subject;
  readonly displayOrder: number;
  readonly marking: MarkingRule;
}

export interface SubjectScore {
  readonly subject: Subject;
  readonly score: number;
  readonly positiveMarks: number;
  readonly correct: number;
  readonly partiallyCorrect: number;
  readonly incorrect: number;
  readonly unattempted: number;
}

export interface AttemptScore {
  readonly attemptId: AttemptId;
  readonly outcomes: readonly ResponseOutcome[];
  /** Net marks, which may be negative. */
  readonly rawScore: number;
  /**
   * Sum of positive awards only, ignoring penalties.
   * Cannot be derived from `rawScore` after the fact, and at least one exam's
   * tie-break chain needs it — so it is computed once, here (FR-SCR-08).
   */
  readonly positiveMarks: number;
  readonly negativeMarks: number;
  readonly bySubject: readonly SubjectScore[];
  readonly counts: {
    readonly correct: number;
    readonly partiallyCorrect: number;
    readonly incorrect: number;
    readonly unattempted: number;
    readonly dropped: number;
    readonly unparseable: number;
  };
  /** Pins the marking configuration this score was computed under. */
  readonly scoringConfigFingerprint: string;
  /** Which key version each question was scored against, for reproducibility. */
  readonly answerKeyVersions: Readonly<Record<string, number>>;
}

export class MissingAnswerKeyError extends Error {
  constructor(readonly questionVersionId: QuestionVersionId) {
    super(`no answer key supplied for question version ${String(questionVersionId)}`);
    this.name = 'MissingAnswerKeyError';
  }
}

export class UnknownQuestionError extends Error {
  constructor(readonly questionVersionId: QuestionVersionId) {
    super(
      `response references question version ${String(questionVersionId)}, which is not part of this paper`,
    );
    this.name = 'UnknownQuestionError';
  }
}

/**
 * Compute the scoring-configuration fingerprint for a paper.
 *
 * Deliberately excludes `displayOrder`: two students who saw the same questions
 * in different orders were scored under the same rules, and their fingerprints
 * must match or the shuffle-invariance guarantee is unprovable.
 */
export function scoringConfigFingerprint(questions: readonly TestQuestion[]): string {
  const canonical = [...questions]
    .map((q) => ({
      questionVersionId: String(q.questionVersionId),
      sectionId: String(q.sectionId),
      subject: q.subject,
      marking: q.marking,
    }))
    .sort((a, b) => (a.questionVersionId < b.questionVersionId ? -1 : 1));
  return fingerprint(canonical);
}

export function scoreAttempt(args: {
  readonly attemptId: AttemptId;
  readonly questions: readonly TestQuestion[];
  readonly responses: readonly Response[];
  readonly keys: readonly AnswerKey[];
}): AttemptScore {
  const { attemptId, questions, responses, keys } = args;

  const keyByQuestion = new Map<string, AnswerKey>();
  for (const k of keys) keyByQuestion.set(String(k.questionVersionId), k);

  const questionIds = new Set(questions.map((q) => String(q.questionVersionId)));

  const responseByQuestion = new Map<string, Response>();
  for (const r of responses) {
    const id = String(r.questionVersionId);
    // EC-DATA-09: a response referencing a question outside this paper means
    // either a scripted client or a positional-mapping bug. Both are fatal and
    // must never be silently absorbed.
    if (!questionIds.has(id)) throw new UnknownQuestionError(r.questionVersionId);
    const existing = responseByQuestion.get(id);
    // Last write wins by client sequence, never by arrival order (FR-SYN-02).
    if (existing === undefined || r.clientSeq > existing.clientSeq) {
      responseByQuestion.set(id, r);
    }
  }

  const outcomes: ResponseOutcome[] = [];
  const subjectAcc = new Map<Subject, { score: number; pos: number; c: number; p: number; i: number; u: number }>();
  const answerKeyVersions: Record<string, number> = {};

  let rawScore = 0;
  let positiveMarks = 0;
  let negativeMarks = 0;
  const counts = {
    correct: 0,
    partiallyCorrect: 0,
    incorrect: 0,
    unattempted: 0,
    dropped: 0,
    unparseable: 0,
  };

  // Iterate the paper, not the responses: a question with no response still
  // scores (as unattempted), and iterating responses would silently skip it.
  for (const q of questions) {
    const id = String(q.questionVersionId);
    const key = keyByQuestion.get(id);
    if (key === undefined) throw new MissingAnswerKeyError(q.questionVersionId);

    const outcome = scoreQuestion(q.marking, responseByQuestion.get(id), key);
    outcomes.push(outcome);
    answerKeyVersions[id] = key.version as unknown as number;

    rawScore += outcome.marks;
    if (outcome.marks > 0) positiveMarks += outcome.marks;
    else if (outcome.marks < 0) negativeMarks += outcome.marks;

    switch (outcome.status) {
      case 'CORRECT':
        counts.correct += 1;
        break;
      case 'PARTIALLY_CORRECT':
        counts.partiallyCorrect += 1;
        break;
      case 'INCORRECT':
        counts.incorrect += 1;
        break;
      case 'UNATTEMPTED':
        counts.unattempted += 1;
        break;
      case 'DROPPED':
        counts.dropped += 1;
        break;
      case 'UNPARSEABLE':
        counts.unparseable += 1;
        break;
    }

    const acc = subjectAcc.get(q.subject) ?? { score: 0, pos: 0, c: 0, p: 0, i: 0, u: 0 };
    acc.score += outcome.marks;
    if (outcome.marks > 0) acc.pos += outcome.marks;
    if (outcome.status === 'CORRECT' || outcome.status === 'DROPPED') acc.c += 1;
    else if (outcome.status === 'PARTIALLY_CORRECT') acc.p += 1;
    else if (outcome.status === 'INCORRECT' || outcome.status === 'UNPARSEABLE') acc.i += 1;
    else acc.u += 1;
    subjectAcc.set(q.subject, acc);
  }

  const bySubject: SubjectScore[] = [...subjectAcc.entries()]
    .map(([subject, a]) => ({
      subject,
      score: a.score,
      positiveMarks: a.pos,
      correct: a.c,
      partiallyCorrect: a.p,
      incorrect: a.i,
      unattempted: a.u,
    }))
    .sort((x, y) => (x.subject < y.subject ? -1 : 1));

  return {
    attemptId,
    outcomes,
    rawScore,
    positiveMarks,
    negativeMarks,
    bySubject,
    counts,
    scoringConfigFingerprint: scoringConfigFingerprint(questions),
    answerKeyVersions,
  };
}
