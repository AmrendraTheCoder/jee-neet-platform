import type { ApiClient } from '../../../lib/api/client.js';
import { ApiError } from '../../../lib/api/client.js';
import type { ResponseOp, SyncRequest, SyncResponse } from '../../../lib/api/types.js';
import { SYNC_BACKOFF, fullJitterDelayMs, jitteredInterval } from '../../../lib/net/backoff.js';
import { createSyncRetryBudget } from '../../../lib/net/tokenBucket.js';
import { FINAL_STRETCH_SECONDS } from '../../../lib/time/useCountdown.js';

/**
 * The coalesced heartbeat and answer-sync engine (FR-ATT-08, FR-SYN-01..09).
 *
 * ONE request carries both. Splitting them doubles request volume for ten
 * thousand concurrent candidates and creates the state where the server
 * believes a client is alive while its answers sit unseen on a device.
 *
 * The interval is adaptive: 60 s for most of the paper, 30 s in the final ten
 * minutes, because that is where an unsynced answer is most expensive and
 * least recoverable. Per-second heartbeats are prohibited outright. Every
 * interval is jittered so a cohort that started together does not spike the
 * endpoint once a minute for three hours.
 *
 * Failures never surface as a toast (FR-SYN-05). The answers are in a durable
 * local queue and the sweeper finalises server-side regardless (FR-SYN-07), so
 * the only honest thing to show a candidate mid-paper is a passive count.
 */

export const NORMAL_INTERVAL_MS = 60_000;
export const FINAL_STRETCH_INTERVAL_MS = 30_000;

export interface SyncEngineHooks {
  readonly api: ApiClient;
  /** Everything the next request needs, read at send time, not at schedule time. */
  readonly buildRequest: () => Promise<SyncRequest | null>;
  readonly onResponse: (response: SyncResponse, sentOps: readonly ResponseOp[]) => Promise<void>;
  readonly onHealthChange: (health: 'CLEAR' | 'SYNCING' | 'RETRYING') => void;
  /** Seconds left, used to pick the cadence. Read fresh on every schedule. */
  readonly remainingSeconds: () => number;
  readonly onFatal: (error: ApiError) => void;
}

export class SyncEngine {
  private timer: number | null = null;
  private inFlight = false;
  private stopped = true;
  private consecutiveFailures = 0;
  private readonly retryBudget = createSyncRetryBudget();

  constructor(private readonly hooks: SyncEngineHooks) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // Fire once immediately so the first answers are durable server-side long
    // before the first scheduled interval elapses.
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Force a cycle now — used on foreground, on network recovery, and
   * immediately before submit so the final answers are acknowledged first.
   */
  flushNow(): void {
    if (this.stopped) return;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    void this.run();
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delayMs);
  }

  private nextIntervalMs(): number {
    const remaining = this.hooks.remainingSeconds();
    const base =
      remaining <= FINAL_STRETCH_SECONDS ? FINAL_STRETCH_INTERVAL_MS : NORMAL_INTERVAL_MS;
    return jitteredInterval(base);
  }

  private async run(): Promise<void> {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;

    try {
      const request = await this.hooks.buildRequest();
      if (request === null) {
        this.schedule(this.nextIntervalMs());
        return;
      }

      this.hooks.onHealthChange(request.ops.length > 0 ? 'SYNCING' : 'CLEAR');
      const response = await this.hooks.api.sync(request);
      await this.hooks.onResponse(response, request.ops);

      this.consecutiveFailures = 0;
      this.hooks.onHealthChange('CLEAR');
      this.schedule(this.nextIntervalMs());
    } catch (error) {
      this.handleFailure(error);
    } finally {
      this.inFlight = false;
    }
  }

  private handleFailure(error: unknown): void {
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(0, 'UNEXPECTED', error instanceof Error ? error.message : 'sync failed');

    // A non-retryable failure is a client bug or a rejected attempt state, and
    // retrying it forever would hide it behind a quiet loop. Surface it once.
    if (!apiError.retryable) {
      this.hooks.onFatal(apiError);
      this.hooks.onHealthChange('RETRYING');
      this.schedule(this.nextIntervalMs());
      return;
    }

    this.consecutiveFailures += 1;
    this.hooks.onHealthChange('RETRYING');

    // Budget exhausted, or too many consecutive failures: fall back to the
    // ordinary cadence rather than giving up. The paper may have two hours to
    // run and the local queue is holding every answer (FR-SYN-09).
    const withinAttemptCap = this.consecutiveFailures <= SYNC_BACKOFF.maxAttempts;
    if (!withinAttemptCap || !this.retryBudget.tryTake()) {
      this.schedule(this.nextIntervalMs());
      return;
    }

    this.schedule(fullJitterDelayMs(this.consecutiveFailures - 1, SYNC_BACKOFF));
  }
}
