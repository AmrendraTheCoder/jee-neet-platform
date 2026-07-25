/**
 * Retry policy (FR-SYN-08, and the `perf-sentinel` build-failure list).
 *
 * Fixed-delay retry is prohibited, and not as a style preference. Ten thousand
 * candidates sit one paper simultaneously. When the sync endpoint has a bad
 * ten seconds, every client fails at the same instant; with a fixed delay they
 * all retry at the same instant too, and keep doing so, so the recovering
 * service is hit by a synchronised wave that knocks it over again. That is a
 * self-sustaining outage during a live examination.
 *
 * Full jitter breaks the correlation: the delay is drawn uniformly from
 * `[0, exponential_backoff]` rather than being that value. It is the variant
 * with the lowest measured contention of the published families, and it is the
 * one used here.
 */

export interface BackoffPolicy {
  readonly baseMs: number;
  readonly capMs: number;
  readonly maxAttempts: number;
}

export const SYNC_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  capMs: 30_000,
  // A capped attempt count, then the engine falls back to its normal interval.
  // It never gives up permanently: the paper may still have two hours to run,
  // and the local durable queue is holding the answers regardless (FR-SYN-09).
  maxAttempts: 6,
};

/**
 * Delay for attempt `n` (0-based), drawn uniformly from `[0, min(cap, base*2^n)]`.
 *
 * `random` is injectable so the retry behaviour is testable without a clock.
 */
export function fullJitterDelayMs(
  attempt: number,
  policy: BackoffPolicy = SYNC_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * exponential);
}

/**
 * Jitter applied to the *scheduled* interval, not to a retry.
 *
 * Without this, every client that started the paper in the same minute
 * heartbeats in the same second for three hours, producing a request spike
 * once a minute for the whole window instead of a flat load.
 */
export function jitteredInterval(
  baseMs: number,
  spread = 0.2,
  random: () => number = Math.random,
): number {
  const delta = baseMs * spread;
  return Math.round(baseMs - delta + random() * delta * 2);
}
