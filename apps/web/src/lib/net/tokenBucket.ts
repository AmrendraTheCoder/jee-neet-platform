/**
 * Client-side retry budget (FR-SYN-08).
 *
 * Backoff alone bounds the *rate* of one client's retries but not the total.
 * A client stuck in a failure loop for an hour still issues hundreds of
 * requests, and multiplied across a cohort that is a meaningful share of the
 * load on an already-degraded service. The bucket caps how much of the request
 * budget retries may consume, leaving room for the requests that matter — the
 * scheduled heartbeat and the final submission.
 *
 * Refills continuously rather than in discrete windows, so a long quiet period
 * restores the budget smoothly instead of releasing a burst on a window edge.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMonotonicMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number = performance.now(),
  ) {
    if (capacity <= 0) throw new RangeError('capacity must be positive');
    if (refillPerSecond <= 0) throw new RangeError('refillPerSecond must be positive');
    this.tokens = capacity;
    this.lastRefillMonotonicMs = now;
  }

  private refill(now: number): void {
    const elapsedSeconds = Math.max(0, now - this.lastRefillMonotonicMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillMonotonicMs = now;
  }

  /** Consumes one token if available. Returns false when the budget is spent. */
  tryTake(now: number = performance.now()): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  available(now: number = performance.now()): number {
    this.refill(now);
    return Math.floor(this.tokens);
  }
}

/**
 * Twenty retries in hand, replenishing at one every ten seconds.
 *
 * Sized against the worst honest case: a three-hour paper on an intermittent
 * connection. That client will exhaust the burst during the first outage, then
 * retry at a steady six per minute, which is the same order as its scheduled
 * heartbeat and therefore does not change the load the server plans for.
 */
export function createSyncRetryBudget(now: number = performance.now()): TokenBucket {
  return new TokenBucket(20, 0.1, now);
}
