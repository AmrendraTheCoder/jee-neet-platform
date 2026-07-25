/**
 * Retry timing and the client-side request budget (FR-SYN-08).
 *
 * Fixed-delay retry is prohibited, and the reason is not politeness. Ten
 * thousand clients that all lost connectivity in the same tower congestion event
 * will all retry at the same instant on a fixed delay, and keep doing so in
 * lockstep — a self-inflicted denial of service that arrives exactly when the
 * service is already unwell. Full jitter breaks the lockstep.
 */

export interface BackoffConfig {
  readonly baseMs: number;
  readonly capMs: number;
  readonly maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 500,
  capMs: 30_000,
  maxAttempts: 8,
};

/**
 * Full jitter: `random(0, min(cap, base * 2^attempt))`.
 *
 * Note the delay is drawn from zero, not from a floor. A "decorrelated" variant
 * that keeps a minimum spacing reintroduces exactly the correlation this exists
 * to destroy.
 */
export function fullJitterDelay(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(config.capMs, config.baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * exponential);
}

export function shouldGiveUp(attempt: number, config: BackoffConfig = DEFAULT_BACKOFF): boolean {
  return attempt >= config.maxAttempts;
}

/**
 * Honour a server-supplied `Retry-After`, in seconds or as an HTTP date.
 *
 * A server under load telling the client when to come back is strictly better
 * information than the client's own backoff curve, and ignoring it is how a
 * recovering service gets knocked over again.
 */
export function retryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return null;
}

/**
 * Token bucket bounding how often this client may talk to the server at all.
 *
 * Sits above the backoff curve and covers the cases backoff does not: a render
 * loop that fires a request per frame, or a screen that refetches on every
 * keystroke. Capacity is small on purpose — a well-behaved screen issues a
 * handful of requests, and NFR-SCL-11 makes exceeding that a build failure
 * rather than a runtime surprise.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    nowMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = nowMs;
  }

  tryTake(nowMs: number, cost = 1): boolean {
    const elapsedSeconds = Math.max(0, (nowMs - this.lastRefillMs) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillMs = nowMs;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Milliseconds until `cost` tokens will be available. Zero when ready now. */
  waitMs(cost = 1): number {
    if (this.tokens >= cost) return 0;
    return Math.ceil(((cost - this.tokens) / this.refillPerSecond) * 1000);
  }
}
