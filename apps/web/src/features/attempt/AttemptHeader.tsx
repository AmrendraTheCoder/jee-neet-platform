import { describeRemaining, formatClock } from '../../lib/format.js';
import { isFinalStretch, useCountdown } from '../../lib/time/useCountdown.js';
import { Pill } from '../../components/ui/Feedback.js';
import { useAttemptState } from './context.js';
import './attempt.css';

/**
 * The examination clock and the sync indicator.
 *
 * THE CLOCK NEVER READS `Date.now()`. `useCountdown` derives from a monotonic
 * offset anchored once against server time and re-anchored on each heartbeat
 * (FR-ATT-07). Setting the system clock backwards grants no time; setting it
 * forwards takes none away. The full mechanism is documented in
 * `lib/time/monotonic.ts`.
 */
export function AttemptHeader(): JSX.Element {
  const title = useAttemptState((s) => s.snapshot.testTitle);
  const anchor = useAttemptState((s) => s.anchor);
  const deadlineAtMs = useAttemptState((s) => s.deadlineAtMs);
  const shortened = useAttemptState((s) => s.snapshot.shortened);
  const rankingMode = useAttemptState((s) => s.snapshot.rankingMode);

  const seconds = useCountdown(anchor, deadlineAtMs);
  const final = isFinalStretch(seconds);

  return (
    <header className="attempt-header">
      <div className="attempt-header__identity">
        <h1 className="attempt-header__title">{title}</h1>
        <div className="row">
          {rankingMode === 'pooled' ? (
            <Pill tone="info" title="Each candidate draws from a larger pool of items">
              Randomised paper
            </Pill>
          ) : null}
          {shortened ? (
            <Pill tone="warning" title="Started after the full duration was available">
              Shortened attempt, not ranked
            </Pill>
          ) : null}
        </div>
      </div>

      <div className="spacer" />

      <PendingIndicator />

      <div className={`clock${final ? ' clock--final' : ''}`}>
        <span className="clock__label">Time remaining</span>
        {/* The digits are aria-hidden and a coarser spoken form is announced
            instead: a live region reading "02:14:59" every second would make
            the page unusable with a screen reader. */}
        <span className="clock__value mono" aria-hidden="true">
          {formatClock(seconds)}
        </span>
        <span className="visually-hidden" aria-live="polite" aria-atomic="true">
          {describeRemaining(Math.floor(seconds / 60) * 60)}
        </span>
      </div>
    </header>
  );
}

/**
 * "N answers pending" (FR-SYN-05).
 *
 * Passive and cumulative. There is deliberately no per-answer error toast: the
 * answers are in a durable local queue, the server-side sweeper finalises the
 * attempt regardless (FR-SYN-07), and a toast storm during a network dip costs
 * a candidate attention they cannot spare on a timed paper.
 */
function PendingIndicator(): JSX.Element | null {
  const pendingCount = useAttemptState((s) => s.pendingCount);
  const health = useAttemptState((s) => s.syncHealth);

  if (pendingCount === 0 && health !== 'RETRYING') return null;

  return (
    <div className="sync-indicator" title="Your answers are saved on this device and will sync automatically.">
      <span className={`sync-indicator__dot sync-indicator__dot--${health.toLowerCase()}`} />
      <span>
        {pendingCount === 0
          ? 'Reconnecting'
          : `${pendingCount} answer${pendingCount === 1 ? '' : 's'} pending`}
      </span>
    </div>
  );
}
