import { useEffect, useState } from 'react';
import { remainingSeconds } from '@platform/domain';
import type { ClockAnchor } from './monotonic.js';
import { monotonicNow, serverNow } from './monotonic.js';

/**
 * The examination countdown.
 *
 * Ticks four times a second rather than once, so the displayed second changes
 * within 250 ms of the true boundary. A one-second interval drifts visibly
 * against the real clock over three hours and candidates notice.
 *
 * `remainingSeconds` comes from @platform/domain so the client and the server
 * round identically: a client that floors where the server ceils will show
 * `00:00:00` while the server still accepts answers, and a candidate who stops
 * typing at that moment loses a mark they had earned.
 */
export function useCountdown(anchor: ClockAnchor | null, deadlineAtMs: number | null): number {
  const [seconds, setSeconds] = useState<number>(() =>
    anchor === null || deadlineAtMs === null ? 0 : remainingSeconds(deadlineAtMs, serverNow(anchor)),
  );

  useEffect(() => {
    if (anchor === null || deadlineAtMs === null) return;

    const tick = (): void => {
      setSeconds(remainingSeconds(deadlineAtMs, serverNow(anchor, monotonicNow())));
    };

    tick();
    const handle = window.setInterval(tick, 250);
    return () => window.clearInterval(handle);
  }, [anchor, deadlineAtMs]);

  return seconds;
}

/** Final-stretch threshold. Drives both the sync cadence and the clock's tone. */
export const FINAL_STRETCH_SECONDS = 600;

export function isFinalStretch(secondsRemaining: number): boolean {
  return secondsRemaining <= FINAL_STRETCH_SECONDS;
}
