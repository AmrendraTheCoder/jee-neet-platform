/**
 * The sync drain loop (FR-SYN-03, FR-SYN-08, FR-SYN-09, EC-NET-03).
 *
 * Three properties this has to hold, each learned from a specific documented
 * failure:
 *
 *  - Single flight. Flapping connectivity on a commute toggles online/offline
 *    every few seconds. Without a mutex each transition starts another drain,
 *    each re-sending the same operations, and ten thousand clients doing that in
 *    a congestion event is a self-inflicted outage.
 *  - Reachability, not connectivity. The network layer reports `isConnected` on
 *    a captive portal or a tower that accepts the association and routes
 *    nothing. Only `isInternetReachable === true` is treated as online.
 *  - Partial acknowledgement. The server returns a per-operation result array
 *    and only acknowledged operations are cleared. Clearing the batch on a 200
 *    loses whatever the server rejected inside it.
 */

import NetInfo from '@react-native-community/netinfo';

import { request } from '../api/client.js';
import { ApiError } from '../api/types.js';
import { DEFAULT_BACKOFF, fullJitterDelay } from './backoff.js';
import type { PendingOp } from './queue.js';
import { acknowledge, markAttempted, pendingAnswerCount, takeBatch } from './queue.js';

/**
 * Batch size (FR-SYN-04).
 *
 * Fifty operations is small enough that the server-side call stays well inside
 * a request CPU ceiling with headroom for the worst case — fifty notes rather
 * than fifty answers — and large enough that a student returning from a long
 * offline stretch drains in a few round trips rather than a few hundred.
 */
const BATCH_SIZE = 50;

/** Debounce on an online transition, so a flapping link does not start a drain per flap. */
const ONLINE_SETTLE_MS = 1500;

export interface OperationResult {
  readonly opId: string;
  readonly applied: boolean;
  /** e.g. 'stale_seq' — accepted, deliberately not applied, do not retry. */
  readonly reason?: string;
}

export interface SyncState {
  readonly pendingAnswers: number;
  readonly online: boolean;
  readonly draining: boolean;
  readonly lastErrorAtMs: number | null;
}

type Listener = (state: SyncState) => void;

let draining = false;
let online = false;
let lastErrorAtMs: number | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

async function publish(): Promise<void> {
  const state: SyncState = {
    pendingAnswers: await pendingAnswerCount(),
    online,
    draining,
    lastErrorAtMs,
  };
  for (const listener of listeners) listener(state);
}

export function subscribeToSync(listener: Listener): () => void {
  listeners.add(listener);
  void publish();
  return () => {
    listeners.delete(listener);
  };
}

function toWirePayload(op: PendingOp): Record<string, unknown> {
  const parsed: unknown = JSON.parse(op.payload);
  return {
    opId: op.opId,
    kind: op.kind,
    scopeId: op.scopeId,
    clientSeq: op.clientSeq,
    createdAtMs: op.createdAtMs,
    data: parsed,
  };
}

/**
 * Drain until the queue is empty or the network gives up.
 *
 * Returns rather than throwing on failure: a failed sync is an expected state on
 * this network, not an error the caller should handle. The passive indicator
 * shows the pending count and the loop tries again (FR-SYN-05).
 */
export async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  await publish();

  let attempt = 0;

  try {
    for (;;) {
      const batch = await takeBatch(BATCH_SIZE);
      if (batch.length === 0) {
        lastErrorAtMs = null;
        return;
      }

      const state = await NetInfo.fetch();
      online = state.isInternetReachable === true;
      if (!online) return;

      try {
        const results = await request<readonly OperationResult[]>('/v1/sync', {
          method: 'POST',
          body: { operations: batch.map(toWirePayload) },
          // The batch's own identity, so a retried batch whose response was lost
          // is recognised rather than re-applied.
          idempotencyKey: batch.map((op) => op.opId).join('.').slice(0, 255),
        });

        // 'applied: false' with a reason is a *settled* outcome — the server
        // dropped a stale sequence on purpose (EC-NET-06). Retrying it would
        // loop forever, so it is acknowledged like a success.
        const settled = results.map((result) => result.opId);
        await acknowledge(settled);

        const unsettled = batch.filter((op) => !settled.includes(op.opId));
        if (unsettled.length > 0) {
          await markAttempted(
            unsettled.map((op) => op.opId),
            'no result returned for operation',
          );
        }

        attempt = 0;
        await publish();
      } catch (error) {
        lastErrorAtMs = Date.now();
        await markAttempted(
          batch.map((op) => op.opId),
          error instanceof ApiError ? `${error.code}: ${error.message}` : 'network',
        );
        await publish();

        attempt += 1;
        if (attempt >= DEFAULT_BACKOFF.maxAttempts) return;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, fullJitterDelay(attempt));
        });
      }
    }
  } finally {
    draining = false;
    await publish();
  }
}

/**
 * Start reacting to connectivity.
 *
 * The settle delay is what stops a metro tunnel from producing a drain per
 * transition. It is applied to the online edge only; going offline is acted on
 * immediately, because continuing to issue requests into a dead link wastes the
 * battery this audience is usually short of.
 */
export function startSync(): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    const reachable = state.isInternetReachable === true;
    if (reachable === online) return;
    online = reachable;
    void publish();

    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (!reachable) return;

    settleTimer = setTimeout(() => {
      settleTimer = null;
      void drain();
    }, ONLINE_SETTLE_MS);
  });

  void NetInfo.fetch().then((state) => {
    online = state.isInternetReachable === true;
    if (online) void drain();
    else void publish();
  });

  return () => {
    unsubscribe();
    if (settleTimer !== null) clearTimeout(settleTimer);
  };
}
