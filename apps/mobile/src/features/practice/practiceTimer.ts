/**
 * The practice clock — a deliberately separate code path (FR-ATT-09).
 *
 * This is an *accumulated elapsed* model. It can be paused, it survives being
 * backgrounded by adding the wall-clock gap only while the session was active,
 * and it belongs entirely to the device.
 *
 * That is legitimate here and would be a defect anywhere else. Practice is
 * untimed by policy, unranked, and never contributes to a leaderboard, so no
 * fairness property depends on this number. A ranked attempt's deadline is
 * computed once on the server, is immovable by any client action, and is
 * counted down from a monotonic offset — a completely different mechanism
 * living in the web client (FR-ATT-06, FR-ATT-07).
 *
 * The two must never be unified into one "timer" abstraction. The moment they
 * share code, a pause written for practice becomes reachable from a ranked
 * attempt, and pausing a ranked attempt has to be structurally impossible.
 */

export interface PracticeClock {
  readonly elapsedMs: number;
  readonly running: boolean;
  /** Monotonic reading at the last transition; not a wall-clock time. */
  readonly lastTickMs: number;
  /** Optional self-imposed target, purely informational. */
  readonly targetSeconds: number | null;
}

/**
 * Monotonic milliseconds.
 *
 * `performance.now` is monotonic and unaffected by the user changing the device
 * clock, a network time resync, or a daylight-saving transition. `Date.now`
 * satisfies none of those and is not used for elapsed time anywhere in this app.
 */
export function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function startClock(targetSeconds: number | null): PracticeClock {
  return { elapsedMs: 0, running: true, lastTickMs: monotonicNow(), targetSeconds };
}

export function tick(clock: PracticeClock, nowMs: number = monotonicNow()): PracticeClock {
  if (!clock.running) return { ...clock, lastTickMs: nowMs };
  const delta = Math.max(0, nowMs - clock.lastTickMs);
  return { ...clock, elapsedMs: clock.elapsedMs + delta, lastTickMs: nowMs };
}

export function pause(clock: PracticeClock, nowMs: number = monotonicNow()): PracticeClock {
  if (!clock.running) return clock;
  const ticked = tick(clock, nowMs);
  return { ...ticked, running: false };
}

export function resume(clock: PracticeClock, nowMs: number = monotonicNow()): PracticeClock {
  if (clock.running) return clock;
  return { ...clock, running: true, lastTickMs: nowMs };
}

/**
 * Remaining seconds against a self-imposed target, or null when there is none.
 *
 * Reaching zero does not end anything. A practice session that submits itself
 * because a self-set target expired would be a timed examination wearing a
 * different label, and this client does not run those.
 */
export function remainingAgainstTarget(clock: PracticeClock): number | null {
  if (clock.targetSeconds === null) return null;
  return Math.max(0, Math.ceil(clock.targetSeconds - clock.elapsedMs / 1000));
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
