/**
 * Wire types for everything this client reads and writes.
 *
 * Two rules govern this file and neither is negotiable.
 *
 * 1. There is no client type for an answer key. Not an optional field, not a
 *    nullable one, not a commented-out one. Keys live in a non-exposed schema
 *    with no grants to the authenticated role and are reachable only through a
 *    state-checking RPC (NFR-SEC-02). A type here would be an invitation to add
 *    a select for it.
 *
 * 2. Solution content is a separate type reached through a separate call
 *    (`SolutionPayload`). It is never a field on a question. The moment a
 *    solution is a nullable property of the question type, some screen will
 *    request the question and get the solution "for free" — which is exactly
 *    EC-NOTES-01 and EC-NOTES-04.
 */

import type {
  MarkingRule,
  OptionId,
  QuestionId,
  QuestionType,
  QuestionVersionId,
  Subject,
  SubTopicId,
} from '@platform/domain';
import type { ContentBlock } from '../../components/math/protocol.js';

/* ------------------------------------------------------------------ *
 * Taxonomy (FR-TAX-01)
 * ------------------------------------------------------------------ */

export type TaxonomyLevel = 'SUBJECT' | 'CHAPTER' | 'TOPIC' | 'SUB_TOPIC';

export interface TaxonomyNode {
  readonly id: string;
  readonly level: TaxonomyLevel;
  readonly parentId: string | null;
  readonly name: string;
  readonly subject: Subject;
  readonly questionCount: number;
  /**
   * 0..1, or null when the student has attempted too few questions for the
   * figure to mean anything. Null is rendered as "not enough data yet", never as
   * zero — telling a student their mastery is 0% because they have seen two
   * questions is both wrong and demoralising (FR-A11Y-09).
   */
  readonly mastery: number | null;
  readonly dueCardCount: number;
}

/* ------------------------------------------------------------------ *
 * Questions
 * ------------------------------------------------------------------ */

export interface RenderableOptionPayload {
  readonly optionId: OptionId;
  readonly blocks: readonly ContentBlock[];
  readonly plainText: string;
  /** Authored accessibility string (FR-ITM-12). */
  readonly spokenText: string | null;
}

export interface PracticeQuestion {
  readonly questionId: QuestionId;
  readonly questionVersionId: QuestionVersionId;
  readonly subTopicId: SubTopicId;
  readonly subject: Subject;
  readonly questionType: QuestionType;
  readonly stem: readonly ContentBlock[];
  /** LaTeX-stripped projection, used for list rows and for search (FR-MTH-01). */
  readonly stemPlainText: string;
  readonly options: readonly RenderableOptionPayload[];
  /**
   * The marking rule for this question *in this session*, supplied by the server
   * from the (test_section, question) join (FR-PAT-04). It is not a property of
   * the item: the same item scores differently in a JEE paper and a NEET paper.
   */
  readonly marking: MarkingRule;
  readonly imageUris: readonly string[];
  /** Server-computed. Drives the native-versus-WebView routing decision. */
  readonly containsMath: boolean;
  readonly authoredDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

/**
 * What the in-attempt note editor is allowed to see (FR-NTS-04, EC-NOTES-01).
 *
 * The absence of fields is the point. This type cannot carry a solution, a
 * rationale, a key or a video URL, so no amount of prop-drilling can leak one
 * into the editor, and a reviewer can verify that by reading six lines.
 */
export interface StemOnlyQuestion {
  readonly questionVersionId: QuestionVersionId;
  readonly stem: readonly ContentBlock[];
  readonly stemPlainText: string;
}

export interface OptionRationale {
  readonly optionId: OptionId;
  /** Why this distractor is wrong, not merely that it is (FR-AUT-04). */
  readonly blocks: readonly ContentBlock[];
}

/**
 * Solutions, fetched only once the server has decided they are visible
 * (FR-TST-08, FR-SOL-05). The client asks; the server decides.
 */
export interface SolutionPayload {
  readonly questionVersionId: QuestionVersionId;
  readonly blocks: readonly ContentBlock[];
  readonly rationales: readonly OptionRationale[];
  /**
   * Opened by deep link, never embedded (FR-SOL-04): the standard embedded
   * player transmits platform identifiers, and most of these users are children.
   */
  readonly videoUrl: string | null;
}

/**
 * Server-computed per-question result (FR-SCR-17).
 *
 * `marks` and `explanation` are computed on the server. The client renders them.
 * The one exception is tutor-mode preview, which runs the shared domain engine
 * locally for immediate feedback and is reconciled against the server result
 * when the session syncs.
 */
export interface QuestionResult {
  readonly questionVersionId: QuestionVersionId;
  readonly marks: number;
  readonly status: string;
  readonly explanation: string;
  readonly correctOptionIds: readonly OptionId[];
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export type PracticeMode = 'TUTOR' | 'TIMED';

export interface PracticeSessionDescriptor {
  readonly sessionId: string;
  readonly mode: PracticeMode;
  readonly questionVersionIds: readonly QuestionVersionId[];
  /** Null in tutor mode; practice is never ranked and never server-deadlined. */
  readonly durationSeconds: number | null;
  readonly createdAtMs: number;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
