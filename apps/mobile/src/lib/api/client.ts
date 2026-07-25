/**
 * HTTP client.
 *
 * Every network call in this app goes through `request`. That is what makes the
 * per-client request budget (NFR-SCL-11) and the retry token bucket (FR-SYN-08)
 * enforceable rather than aspirational — a feature module cannot quietly call
 * `fetch` and escape both.
 *
 * The client holds no privileged credential. The only secret it ever carries is
 * the student's own access token, supplied by the auth layer at call time and
 * never written to disk by this module (NFR-SEC-04).
 */

import Constants from 'expo-constants';

import { DEFAULT_BACKOFF, TokenBucket, fullJitterDelay, retryAfterMs, shouldGiveUp } from '../offline/backoff.js';
import { ApiError } from './types.js';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * 30 requests of headroom refilling at 3 per second.
 *
 * Sized for a screen that legitimately needs a handful of calls plus a retry
 * burst, and far too small to hide a query inside a `.map()`. If a screen starts
 * hitting this, the screen is wrong.
 */
const bucket = new TokenBucket(30, 3, Date.now());

type TokenProvider = () => Promise<string | null>;

let getAuthToken: TokenProvider = async () => null;

export function setAuthTokenProvider(provider: TokenProvider): void {
  getAuthToken = provider;
}

function baseUrl(): string {
  const configured = Constants.expoConfig?.extra?.['apiBaseUrl'];
  if (typeof configured !== 'string' || configured === '') {
    throw new Error('apiBaseUrl is not configured in app.json extra');
  }
  return configured.replace(/\/+$/, '');
}

export class RequestBudgetExceededError extends Error {
  constructor(readonly waitMs: number) {
    super(
      `Client request budget exhausted; next token in ${String(waitMs)} ms. ` +
        'A screen exceeding this is issuing requests in a loop — see NFR-SCL-11.',
    );
    this.name = 'RequestBudgetExceededError';
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH';
  readonly body?: unknown;
  readonly timeoutMs?: number;
  /** Reused across retries so a lost response cannot double-apply (EC-NET-05). */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

interface Attempted {
  readonly response: Response;
  readonly retryAfter: number | null;
}

async function once(path: string, options: RequestOptions): Promise<Attempted> {
  const token = await getAuthToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  if (options.signal !== undefined) {
    options.signal.addEventListener('abort', () => {
      controller.abort();
    });
  }

  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': options.idempotencyKey }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    return { response, retryAfter: retryAfterMs(response.headers.get('retry-after'), Date.now()) };
  } finally {
    clearTimeout(timeout);
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!bucket.tryTake(Date.now())) {
    throw new RequestBudgetExceededError(bucket.waitMs());
  }

  let attempt = 0;
  let lastError: unknown = null;

  while (!shouldGiveUp(attempt, DEFAULT_BACKOFF)) {
    try {
      const { response, retryAfter } = await once(path, options);

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      if (!RETRYABLE_STATUSES.has(response.status)) {
        const detail = await response.text();
        throw new ApiError(response.status, `http_${String(response.status)}`, detail.slice(0, 500));
      }

      // A server that says when to come back knows more than the local curve.
      const delay = retryAfter ?? fullJitterDelay(attempt);
      await sleep(delay);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error;
      await sleep(fullJitterDelay(attempt));
    }
    attempt += 1;
  }

  throw new ApiError(
    0,
    'network_unavailable',
    lastError instanceof Error ? lastError.message : 'request failed after retries',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
