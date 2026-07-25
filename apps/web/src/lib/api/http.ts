import type { AttemptId, TestId } from '@platform/domain';
import { ApiError } from './client.js';
import type { ApiClient } from './client.js';
import type {
  AdminBootstrap,
  AttemptSnapshot,
  AuthoredItem,
  ReviewResult,
  SubmitResponse,
  SyncRequest,
  SyncResponse,
} from './types.js';

export interface HttpTransportOptions {
  readonly baseUrl: string;
  /**
   * Supplies the bearer token. Async because refresh is single-flighted
   * upstream (FR-ATT-17): concurrent refreshes with the same rotating token
   * revoke the whole session as a suspected compromise, which mid-paper means
   * a candidate is logged out of a live examination.
   */
  readonly getToken: () => Promise<string | null>;
  readonly onUnauthorized?: () => void;
}

/**
 * The HTTP transport.
 *
 * Deliberately thin: it does no retrying of its own. Retry policy belongs to
 * the caller, because the two callers need different policies. The sync engine
 * retries under a jittered backoff and a token budget (FR-SYN-08); an admin
 * form must surface a failure to the operator immediately rather than quietly
 * retrying a mutation.
 */
export function createHttpApiClient(options: HttpTransportOptions): ApiClient {
  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await options.getToken();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token !== null) headers['authorization'] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        // The exam paper is never cached by the browser: a ranked mock is
        // online-only and must never be servable from a stale store (FR-SYN-10).
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (cause) {
      throw new ApiError(0, 'NETWORK', cause instanceof Error ? cause.message : 'network failure');
    }

    if (response.status === 401) {
      options.onUnauthorized?.();
      throw new ApiError(401, 'UNAUTHORIZED', 'session is no longer valid');
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        message?: string;
      } | null;
      throw new ApiError(
        response.status,
        payload?.code ?? 'UNKNOWN',
        payload?.message ?? `request failed with ${response.status}`,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    startAttempt: (input) =>
      request<AttemptSnapshot>('POST', '/attempts', {
        testId: input.testId,
        idempotencyKey: input.idempotencyKey,
      }),

    getAttempt: (attemptId: AttemptId) =>
      request<AttemptSnapshot>('GET', `/attempts/${encodeURIComponent(String(attemptId))}`),

    sync: (payload: SyncRequest) =>
      request<SyncResponse>(
        'POST',
        `/attempts/${encodeURIComponent(String(payload.attemptId))}/sync`,
        payload,
      ),

    submitAttempt: (input) =>
      request<SubmitResponse>(
        'POST',
        `/attempts/${encodeURIComponent(String(input.attemptId))}/submit`,
        { idempotencyKey: input.idempotencyKey },
      ),

    abandonAttempt: (attemptId: AttemptId) =>
      request<SubmitResponse>(
        'POST',
        `/attempts/${encodeURIComponent(String(attemptId))}/abandon`,
        {},
      ),

    getReview: (attemptId: AttemptId) =>
      request<ReviewResult>('GET', `/attempts/${encodeURIComponent(String(attemptId))}/review`),

    reportQuestion: (input) =>
      request<{ reportId: string }>('POST', '/reports', input),

    getAdminBootstrap: () => request<AdminBootstrap>('GET', '/admin/bootstrap'),

    saveItem: (item: AuthoredItem) =>
      request<AuthoredItem>('POST', '/admin/items', item),

    transitionItem: (input) =>
      request<AuthoredItem>(
        'POST',
        `/admin/items/${encodeURIComponent(input.questionVersionId)}/transition`,
        input,
      ),

    insertPattern: (input) =>
      request<{ patternId: string }>('POST', '/admin/patterns', input),

    resolveChallenge: (input) =>
      request<void>(
        'POST',
        `/admin/challenges/${encodeURIComponent(input.challengeId)}/resolve`,
        input,
      ),
  };
}

/** Convenience for callers holding a `TestId` from a route param. */
export function toTestId(value: string): TestId {
  return value as TestId;
}
