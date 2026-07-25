/**
 * The clock the examination runs on (FR-ATT-07).
 *
 * WHY THIS IS NOT `Date.now()`
 * ----------------------------
 * `Date.now()` reads the system wall clock, which any user can set. A candidate
 * who moves the system clock backwards by an hour would, on a wall-clock
 * countdown, be handed an extra hour. Moving it forwards would truncate an
 * honest candidate's paper. Neither may be possible.
 *
 * `performance.now()` is a monotonic clock measured from the page's time
 * origin. It is unaffected by system clock changes, by NTP steps, and by
 * timezone or DST transitions. It is the only clock in the browser with that
 * property, so it is the only clock the countdown is allowed to read.
 *
 * The mechanism:
 *
 *   1. The server tells us its own epoch time and the attempt deadline, both in
 *      server epoch milliseconds. The deadline is computed once, server-side,
 *      at attempt creation and is immovable (FR-ATT-06).
 *   2. We capture `performance.now()` in the same turn and store the pair as an
 *      *anchor*. The offset between the two clocks is fixed from then on.
 *   3. Every countdown tick reads `performance.now()`, adds the offset, and
 *      derives server-time. No wall clock is consulted, ever.
 *   4. Every heartbeat carries a fresh server time, and we re-anchor (FR-ATT-08
 *      makes heartbeat and answer-sync one request, so this costs nothing
 *      extra). Re-anchoring corrects for the one thing the monotonic clock can
 *      get wrong: some platforms suspend `performance.now()` while the device
 *      sleeps, which would make the countdown run slow.
 *
 * Re-anchoring is deliberately allowed to move the displayed time in either
 * direction, because the server is authoritative and the client is not. It
 * cannot extend the attempt: the deadline itself is a server value the client
 * only ever reads.
 */

export interface ClockAnchor {
  /** Server epoch milliseconds at the moment of capture. */
  readonly serverEpochMs: number;
  /** Monotonic reading at the same moment. */
  readonly monotonicMs: number;
  /**
   * Half the round-trip of the request that produced this anchor. Server time
   * is reported as of the server's processing instant, so the client's estimate
   * is that instant plus roughly one leg of the trip.
   */
  readonly halfRoundTripMs: number;
}

export function monotonicNow(): number {
  return performance.now();
}

export function createAnchor(args: {
  readonly serverEpochMs: number;
  readonly requestStartedMonotonicMs: number;
  readonly responseReceivedMonotonicMs: number;
}): ClockAnchor {
  const roundTrip = Math.max(0, args.responseReceivedMonotonicMs - args.requestStartedMonotonicMs);
  return {
    serverEpochMs: args.serverEpochMs,
    monotonicMs: args.responseReceivedMonotonicMs,
    halfRoundTripMs: roundTrip / 2,
  };
}

/** Current server epoch time, estimated from the monotonic clock alone. */
export function serverNow(anchor: ClockAnchor, monotonic: number = monotonicNow()): number {
  return anchor.serverEpochMs + anchor.halfRoundTripMs + (monotonic - anchor.monotonicMs);
}

/**
 * Adopt a newer anchor, but never let a re-anchor move server-time backwards
 * by more than a threshold.
 *
 * A backwards jump is almost always a stale response arriving out of order
 * after a retry. Honouring it would make the displayed countdown tick upwards,
 * which reads as the platform granting time and destroys trust in the clock
 * even though the deadline never moved. A genuinely large correction (device
 * suspend, long offline period) is still adopted, because there the client
 * estimate really is wrong.
 */
export const ANCHOR_REGRESSION_TOLERANCE_MS = 2_000;

export function reconcileAnchor(
  current: ClockAnchor,
  candidate: ClockAnchor,
  monotonic: number = monotonicNow(),
): ClockAnchor {
  const currentEstimate = serverNow(current, monotonic);
  const candidateEstimate = serverNow(candidate, monotonic);
  const regression = currentEstimate - candidateEstimate;
  if (regression > 0 && regression <= ANCHOR_REGRESSION_TOLERANCE_MS) return current;
  return candidate;
}
