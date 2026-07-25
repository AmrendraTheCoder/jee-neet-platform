/**
 * Core domain identifiers and shared value types.
 *
 * Design note (FR-ITM-03, FR-ATT-12): every identifier is a *branded string*.
 * The brand is compile-time only, but it makes the single most catastrophic bug
 * class in this system — passing a positional index where an identity is
 * required — a type error rather than a silent scoring corruption (EC-DATA-09).
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type OrgId = Brand<string, 'OrgId'>;
export type UserId = Brand<string, 'UserId'>;
export type QuestionId = Brand<string, 'QuestionId'>;
export type QuestionVersionId = Brand<string, 'QuestionVersionId'>;
export type OptionId = Brand<string, 'OptionId'>;
export type TestId = Brand<string, 'TestId'>;
export type SectionId = Brand<string, 'SectionId'>;
export type AttemptId = Brand<string, 'AttemptId'>;
export type SubTopicId = Brand<string, 'SubTopicId'>;
export type AnswerKeyVersion = Brand<number, 'AnswerKeyVersion'>;

/** Unsafe casts, confined to persistence and test boundaries. */
export const asOrgId = (s: string): OrgId => s as OrgId;
export const asUserId = (s: string): UserId => s as UserId;
export const asQuestionId = (s: string): QuestionId => s as QuestionId;
export const asQuestionVersionId = (s: string): QuestionVersionId => s as QuestionVersionId;
export const asOptionId = (s: string): OptionId => s as OptionId;
export const asTestId = (s: string): TestId => s as TestId;
export const asSectionId = (s: string): SectionId => s as SectionId;
export const asAttemptId = (s: string): AttemptId => s as AttemptId;
export const asSubTopicId = (s: string): SubTopicId => s as SubTopicId;
export const asAnswerKeyVersion = (n: number): AnswerKeyVersion => n as AnswerKeyVersion;

export const EXAMS = ['JEE_MAIN', 'JEE_ADVANCED', 'NEET'] as const;
export type Exam = (typeof EXAMS)[number];

export const QUESTION_TYPES = [
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'NUMERIC_INTEGER',
  'NUMERIC_DECIMAL',
  'MATCHING_LIST',
  'ASSERTION_REASON',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const SUBJECTS = ['PHYSICS', 'CHEMISTRY', 'MATHEMATICS', 'BOTANY', 'ZOOLOGY'] as const;
export type Subject = (typeof SUBJECTS)[number];

/**
 * A student's response to one question.
 *
 * `visited`, `markedForReview` and the answer payload are *orthogonal*
 * (FR-ATT-03, EC-NOTES-03). Scoring reads only the answer payload; a test
 * asserts it is blind to `markedForReview`.
 */
export interface Response {
  readonly questionVersionId: QuestionVersionId;
  /** Empty array means "no option selected", which is distinct from not visiting. */
  readonly selectedOptionIds: readonly OptionId[];
  /** Raw student keystrokes for numeric questions, stored verbatim (FR-SCR-05). */
  readonly numericRaw: string | null;
  readonly visited: boolean;
  readonly markedForReview: boolean;
  readonly timeSpentMs: number;
  /** Monotonic per-attempt sequence used to drop out-of-order syncs (FR-SYN-02). */
  readonly clientSeq: number;
}

export interface AnswerKey {
  readonly questionVersionId: QuestionVersionId;
  readonly version: AnswerKeyVersion;
  readonly correctOptionIds: readonly OptionId[];
  readonly numericValue: string | null;
  /** Resolution applied by a rescore; null means the key stands as authored. */
  readonly resolution: KeyResolution | null;
}

export const KEY_RESOLUTIONS = ['MULTI_KEY', 'ALL_CORRECT', 'DROPPED'] as const;
export type KeyResolution = (typeof KEY_RESOLUTIONS)[number];

export interface ResponseOutcome {
  readonly questionVersionId: QuestionVersionId;
  readonly marks: number;
  readonly status: ResponseStatus;
  /** Human-readable justification rendered in review (FR-SCR-18). */
  readonly explanation: string;
}

export const RESPONSE_STATUSES = [
  'CORRECT',
  'PARTIALLY_CORRECT',
  'INCORRECT',
  'UNATTEMPTED',
  'DROPPED',
  'UNPARSEABLE',
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];
