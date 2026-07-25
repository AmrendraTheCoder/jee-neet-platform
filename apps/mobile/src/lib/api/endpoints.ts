/**
 * Every server call this client makes.
 *
 * Collected in one module so the surface is auditable in one read. Two things a
 * reviewer should be able to confirm here without following any call chain:
 *
 *  - there is no endpoint that returns an answer key, and no parameter anywhere
 *    that asks for one (NFR-SEC-02);
 *  - the in-attempt note path calls `fetchStemOnly`, which returns a type that
 *    structurally cannot carry a solution (FR-NTS-04, EC-NOTES-01).
 *
 * Solution content has exactly one entry point, `fetchSolution`, and the server
 * decides whether to answer it. The client never gates its own access to a
 * solution; asking and being refused is the correct shape.
 */

import type { QuestionVersionId, SubTopicId } from '@platform/domain';

import { request } from './client.js';
import type {
  PracticeQuestion,
  QuestionResult,
  SolutionPayload,
  StemOnlyQuestion,
  TaxonomyNode,
} from './types.js';

export async function fetchTaxonomy(parentId: string | null): Promise<readonly TaxonomyNode[]> {
  const query = parentId === null ? '' : `?parentId=${encodeURIComponent(parentId)}`;
  return request<readonly TaxonomyNode[]>(`/v1/taxonomy${query}`);
}

/**
 * Fetch a set of questions in one call.
 *
 * Batched by identity rather than fetched per row. A 30-chapter browse screen
 * that requests one chapter at a time issues 30 requests, which is the exact
 * pattern NFR-SCL-11 makes a build failure.
 */
export async function fetchQuestions(
  ids: readonly QuestionVersionId[],
): Promise<readonly PracticeQuestion[]> {
  if (ids.length === 0) return [];
  return request<readonly PracticeQuestion[]>('/v1/questions/batch', {
    method: 'POST',
    body: { questionVersionIds: ids.map(String) },
  });
}

/**
 * Download a chapter for offline practice (FR-SYN-10).
 *
 * Untimed practice only. The response carries stems, options and images. It
 * carries no key, no solution and no rationale, and the server enforces that —
 * an offline chapter download is a bulk export to a device we do not control, so
 * it is limited to the free practice class of content.
 */
export async function downloadChapter(chapterId: string): Promise<{
  readonly questions: readonly PracticeQuestion[];
  readonly approximateBytes: number;
}> {
  return request(`/v1/chapters/${encodeURIComponent(chapterId)}/offline`);
}

/**
 * Tutor mode reveal (FR-PRC-03).
 *
 * One round trip that records the answer and returns the server-computed result
 * plus the solution. The result is computed on the server, never on the client
 * (FR-SCR-17); the client's own engine is used only for an immediate preview
 * that this response then replaces.
 *
 * There is no offline variant. Revealing offline would require the key on the
 * device, which FR-SYN-10 forbids outright.
 */
export async function revealPracticeAnswer(args: {
  readonly sessionId: string;
  readonly questionVersionId: QuestionVersionId;
  readonly selectedOptionIds: readonly string[];
  readonly numericRaw: string | null;
  readonly idempotencyKey: string;
}): Promise<{ readonly result: QuestionResult; readonly solution: SolutionPayload }> {
  return request('/v1/practice/reveal', {
    method: 'POST',
    body: {
      sessionId: args.sessionId,
      questionVersionId: String(args.questionVersionId),
      selectedOptionIds: args.selectedOptionIds,
      numericRaw: args.numericRaw,
    },
    idempotencyKey: args.idempotencyKey,
  });
}

/**
 * The only question fetch the in-attempt note editor is permitted to make.
 *
 * Separate endpoint, separate return type, no options and no metadata — so a
 * note opened during a live attempt on the web client cannot become a side
 * channel to the key (EC-NOTES-01, EC-NOTES-04).
 */
export async function fetchStemOnly(
  questionVersionId: QuestionVersionId,
): Promise<StemOnlyQuestion> {
  return request<StemOnlyQuestion>(
    `/v1/questions/${encodeURIComponent(String(questionVersionId))}/stem`,
  );
}

/** Server-gated (FR-SOL-05). A 403 here is a correct answer, not an error to work around. */
export async function fetchSolution(
  questionVersionId: QuestionVersionId,
): Promise<SolutionPayload> {
  return request<SolutionPayload>(
    `/v1/questions/${encodeURIComponent(String(questionVersionId))}/solution`,
  );
}

/**
 * Draw a fresh unseen item for a due card (FR-SRS-03).
 *
 * The seen ledger is sent so the server can exclude what this student has
 * already been served. It is sent as identities, capped, and the server holds
 * the authoritative ledger too — this is an optimisation for the offline case,
 * not the control.
 */
export async function drawForReview(args: {
  readonly subTopicId: SubTopicId;
  readonly excludeQuestionVersionIds: readonly string[];
  readonly targetDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
}): Promise<PracticeQuestion | null> {
  return request<PracticeQuestion | null>('/v1/srs/draw', {
    method: 'POST',
    body: {
      subTopicId: String(args.subTopicId),
      excludeQuestionVersionIds: args.excludeQuestionVersionIds.slice(0, 500),
      targetDifficulty: args.targetDifficulty,
    },
  });
}

export interface StudentNotice {
  readonly id: string;
  readonly kind: 'RESCORE' | 'KEY_REVISION' | 'INCIDENT' | 'ANNOUNCEMENT' | 'TEST_WINDOW';
  readonly title: string;
  readonly body: string;
  readonly createdAtMs: number;
  readonly actionUrl: string | null;
}

/**
 * In-app notice feed (FR-NOT-05).
 *
 * Push is unreliable on a large share of this market's devices, whose vendor
 * skins drop background deliveries aggressively. Anything time-critical must be
 * readable here without a notification ever having arrived.
 */
export async function fetchNotices(): Promise<readonly StudentNotice[]> {
  return request<readonly StudentNotice[]>('/v1/notices');
}
