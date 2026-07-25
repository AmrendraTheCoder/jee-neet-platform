/**
 * Attempt deadline arithmetic (FR-ATT-06, FR-ATT-07, FR-TST-06, FR-A11Y-05).
 *
 * The deadline is computed once, server-side, at attempt creation, and is
 * immovable by any client action. The client counts down from a monotonic
 * offset and reconciles on each heartbeat; it never contributes to the value.
 *
 * Everything here is pure arithmetic over epoch milliseconds supplied by the
 * caller. This module does not read the clock — that is what makes it testable
 * and what keeps a device clock out of the authority chain.
 */

export interface AccommodationEntitlement {
  /**
   * Additional time as a fraction of the base duration, e.g. 1/3 for the
   * commonly granted twenty-minutes-per-hour provision.
   */
  readonly extraTimeRatio?: number;
  /** Flat additional seconds, e.g. a compensatory hour. */
  readonly extraSeconds?: number;
  /** Recorded for audit; never inferred. */
  readonly reason: string;
}

export interface DeadlineInput {
  readonly startedAtMs: number;
  readonly baseDurationSeconds: number;
  /** Hard close of the test window, or null for an untimed-window practice test. */
  readonly windowEndsAtMs: number | null;
  /**
   * Attached to the *person*, not to an incident (FR-A11Y-05).
   *
   * Where an examining body grants a candidate additional time, the platform
   * must be able to grant the equivalent. Without this, a candidate lawfully
   * entitled to a longer sitting simply cannot use the product.
   */
  readonly accommodation?: AccommodationEntitlement | null;
}

export interface DeadlineResult {
  readonly deadlineAtMs: number;
  readonly effectiveDurationSeconds: number;
  readonly accommodationSeconds: number;
  /**
   * True when the window closed before the candidate could use their full
   * duration. Such attempts are tagged and excluded from ranked comparison
   * (FR-TST-06) rather than silently ranked against full-length attempts.
   */
  readonly shortened: boolean;
}

export function accommodationSeconds(
  baseDurationSeconds: number,
  accommodation: AccommodationEntitlement | null | undefined,
): number {
  if (!accommodation) return 0;
  const ratio = accommodation.extraTimeRatio ?? 0;
  const flat = accommodation.extraSeconds ?? 0;
  if (ratio < 0 || flat < 0) {
    throw new RangeError('accommodation entitlements must be non-negative');
  }
  return Math.floor(baseDurationSeconds * ratio) + flat;
}

/**
 * `deadline = min(startedAt + effectiveDuration, windowEndsAt + accommodation)`
 *
 * The accommodation extends the window as well as the duration. Extending only
 * the duration would grant a candidate extra time and then take it back at the
 * window boundary, which is worse than granting nothing.
 */
export function computeDeadline(input: DeadlineInput): DeadlineResult {
  if (input.baseDurationSeconds <= 0) {
    throw new RangeError('baseDurationSeconds must be positive');
  }

  const extra = accommodationSeconds(input.baseDurationSeconds, input.accommodation);
  const effectiveDurationSeconds = input.baseDurationSeconds + extra;
  const naturalEnd = input.startedAtMs + effectiveDurationSeconds * 1000;

  if (input.windowEndsAtMs === null) {
    return {
      deadlineAtMs: naturalEnd,
      effectiveDurationSeconds,
      accommodationSeconds: extra,
      shortened: false,
    };
  }

  const windowEnd = input.windowEndsAtMs + extra * 1000;
  const deadlineAtMs = Math.min(naturalEnd, windowEnd);

  return {
    deadlineAtMs,
    effectiveDurationSeconds,
    accommodationSeconds: extra,
    shortened: deadlineAtMs < naturalEnd,
  };
}

/** Seconds remaining, floored at zero. Never negative, never NaN. */
export function remainingSeconds(deadlineAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineAtMs - nowMs) / 1000));
}

export interface LateJoinDecision {
  readonly allowed: boolean;
  readonly availableSeconds: number;
  readonly shortened: boolean;
  readonly reason: string | null;
}

/**
 * Whether a candidate may still start, and what they must be told first
 * (FR-TST-06).
 *
 * A candidate who starts a three-hour paper with eighty minutes left must be
 * told that before a single question is revealed. Discovering it from the
 * timer is the failure this prevents.
 */
export function evaluateLateJoin(args: {
  readonly nowMs: number;
  readonly startsAtMs: number;
  readonly windowEndsAtMs: number;
  readonly baseDurationSeconds: number;
  readonly lateJoinCutoffSeconds: number | null;
  readonly accommodation?: AccommodationEntitlement | null;
}): LateJoinDecision {
  const extra = accommodationSeconds(args.baseDurationSeconds, args.accommodation);
  const effectiveDuration = args.baseDurationSeconds + extra;
  const windowEnd = args.windowEndsAtMs + extra * 1000;

  if (args.nowMs < args.startsAtMs) {
    return {
      allowed: false,
      availableSeconds: 0,
      shortened: false,
      reason: 'This test has not started yet.',
    };
  }

  if (args.nowMs >= windowEnd) {
    return {
      allowed: false,
      availableSeconds: 0,
      shortened: false,
      reason: 'This test window has closed.',
    };
  }

  if (args.lateJoinCutoffSeconds !== null) {
    const cutoff = args.startsAtMs + args.lateJoinCutoffSeconds * 1000;
    if (args.nowMs > cutoff) {
      return {
        allowed: false,
        availableSeconds: 0,
        shortened: false,
        reason: 'The joining window for this test has closed.',
      };
    }
  }

  const availableMs = Math.min(effectiveDuration * 1000, windowEnd - args.nowMs);
  const availableSeconds = Math.floor(availableMs / 1000);
  const shortened = availableSeconds < effectiveDuration;

  return {
    allowed: true,
    availableSeconds,
    shortened,
    reason: shortened
      ? `This test closes before you would complete the full duration. You will have ${formatDuration(availableSeconds)}, not ${formatDuration(effectiveDuration)}. Your attempt will be recorded as a shortened attempt and will not be ranked against full-length attempts.`
      : null,
  };
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Whether an inbound response arrived in time.
 *
 * The grace window absorbs network latency on a submission issued before the
 * deadline whose response was lost. It is a published constant, not a tunable,
 * because it is the difference between "your last answer counted" and not.
 */
export const SUBMISSION_GRACE_SECONDS = 30;

export function acceptsResponseAt(
  deadlineAtMs: number,
  receivedAtMs: number,
  graceSeconds: number = SUBMISSION_GRACE_SECONDS,
): boolean {
  return receivedAtMs <= deadlineAtMs + graceSeconds * 1000;
}
