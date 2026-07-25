import type { AttemptId, TestId } from '@platform/domain';
import type {
  AdminBootstrap,
  AttemptSnapshot,
  AuthoredItem,
  ReviewResult,
  SubmitResponse,
  SyncRequest,
  SyncResponse,
} from './types.js';

/**
 * The whole server surface this client uses.
 *
 * Kept as one interface so the fixture transport under `src/dev` and the HTTP
 * transport implement the same contract and cannot drift. Every method is a
 * single round trip; in particular `startAttempt` returns the paper, the
 * deadline, the asset manifest and any existing responses together, because
 * attempt start being multi-call is a documented scaling failure.
 */
export interface ApiClient {
  /**
   * Idempotent (FR-ATT-13). The caller passes a stable key and a duplicate
   * call — double-tap, retried request whose response was lost — returns the
   * existing attempt rather than creating a second one.
   */
  startAttempt(input: {
    readonly testId: TestId;
    readonly idempotencyKey: string;
  }): Promise<AttemptSnapshot>;

  /** Resume. Returns the same materialised order as the first sitting (FR-ATT-11). */
  getAttempt(attemptId: AttemptId): Promise<AttemptSnapshot>;

  /** Coalesced heartbeat plus answer batch (FR-ATT-08). */
  sync(request: SyncRequest): Promise<SyncResponse>;

  /**
   * Finalisation is an O(1) status flip that enqueues scoring (FR-SCR-01).
   * Idempotent: a retried submit on an already-submitted attempt succeeds.
   */
  submitAttempt(input: {
    readonly attemptId: AttemptId;
    readonly idempotencyKey: string;
  }): Promise<SubmitResponse>;

  /** Explicit abandon, available in the first five minutes (FR-ATT-19). */
  abandonAttempt(attemptId: AttemptId): Promise<SubmitResponse>;

  /**
   * Refused with a pending state until scoring completes, and refused outright
   * before `solutions_visible_from` (FR-TST-08).
   */
  getReview(attemptId: AttemptId): Promise<ReviewResult>;

  /** Every question carries a report action (FR-SUP-01). Requires a written reason. */
  reportQuestion(input: {
    readonly attemptId: AttemptId | null;
    readonly questionVersionId: string;
    readonly reason: string;
    readonly category: 'RENDER_FAILURE' | 'WRONG_KEY' | 'AMBIGUOUS' | 'TYPO' | 'OTHER';
  }): Promise<{ readonly reportId: string }>;

  getAdminBootstrap(): Promise<AdminBootstrap>;

  saveItem(item: AuthoredItem): Promise<AuthoredItem>;

  /** Server re-verifies `approved_by <> created_by` as a CHECK (FR-AUT-03). */
  transitionItem(input: {
    readonly questionVersionId: string;
    readonly to: AuthoredItem['lifecycle'];
    readonly note: string;
  }): Promise<AuthoredItem>;

  /**
   * A new pattern is an INSERT, never a release (FR-PAT-02). The payload is
   * the pattern as data; nothing about a 2027 pattern touches this bundle.
   */
  insertPattern(input: { readonly pattern: unknown }): Promise<{ readonly patternId: string }>;

  resolveChallenge(input: {
    readonly challengeId: string;
    readonly resolution: 'MULTI_KEY' | 'ALL_CORRECT' | 'DROPPED' | 'UPHELD_NO_CHANGE' | 'REJECTED';
    /** Visible to every challenger (FR-ADM-08). Mandatory. */
    readonly publicNote: string;
  }): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Whether retrying could plausibly succeed. A 422 for a question outside the
   * attempt's persisted order (FR-ATT-12) never will, and retrying it forever
   * would hide a client bug behind a quiet loop.
   */
  get retryable(): boolean {
    if (this.status === 0) return true; // network failure
    if (this.status === 408 || this.status === 429) return true;
    return this.status >= 500;
  }
}
