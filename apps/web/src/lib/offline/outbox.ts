import type { AttemptId } from '@platform/domain';
import type { ResponseOp } from '../api/types.js';
import { deleteKey, getAllFrom, getOne, openDatabase, put, withTransaction } from './idb.js';

/**
 * The durable answer outbox (FR-SYN-01 through FR-SYN-05, FR-SYN-09).
 *
 * Ordering guarantee: every operation carries a monotonic `clientSeq` issued
 * here and persisted alongside it, so the counter survives a reload. The server
 * DROPS an operation whose sequence it has already surpassed rather than
 * applying it (FR-SYN-02) — an out-of-order arrival is a retry of something
 * already superseded, and applying it would resurrect a cleared answer.
 *
 * The queue is the system of record on the client. If the sync API is
 * unavailable for twenty minutes the candidate keeps answering, every answer
 * lands here, and the batch drains when the network returns (FR-SYN-09).
 */

const DB_NAME = 'platform-attempt-outbox';
const DB_VERSION = 1;
const OPS_STORE = 'ops';
const META_STORE = 'meta';

/**
 * Cap on one batch (FR-SYN-04).
 *
 * Sized so the server-side transaction stays well inside the per-request CPU
 * ceiling. A 180-question paper that has been offline for an hour drains in
 * four batches rather than one request the platform kills halfway through.
 */
export const MAX_BATCH_OPS = 50;

interface StoredOp extends ResponseOp {
  /** `${attemptId}:${clientSeq}` — unique, and sortable within an attempt. */
  readonly opKey: string;
}

interface OutboxMeta {
  readonly attemptId: string;
  readonly nextClientSeq: number;
  readonly lastAckClientSeq: number;
}

export class AttemptOutbox {
  private constructor(
    private readonly db: IDBDatabase,
    private readonly attemptId: AttemptId,
    private nextClientSeq: number,
    private lastAckClientSeq: number,
  ) {}

  static async open(attemptId: AttemptId, serverLastAckSeq: number): Promise<AttemptOutbox> {
    const db = await openDatabase({
      name: DB_NAME,
      version: DB_VERSION,
      stores: [
        { name: OPS_STORE, keyPath: 'opKey' },
        { name: META_STORE, keyPath: 'attemptId' },
      ],
    });

    const meta = await withTransaction(db, [META_STORE], 'readonly', (tx) =>
      getOne<OutboxMeta>(tx, META_STORE, String(attemptId)),
    );

    // The sequence counter never regresses. If the server has acknowledged a
    // higher sequence than this device has ever issued — a resume on a second
    // device (FR-ATT-15) — the counter jumps forward so the two devices cannot
    // mint colliding sequences for the same attempt.
    const nextSeq = Math.max(meta?.nextClientSeq ?? 1, serverLastAckSeq + 1);
    const lastAck = Math.max(meta?.lastAckClientSeq ?? 0, serverLastAckSeq);

    return new AttemptOutbox(db, attemptId, nextSeq, lastAck);
  }

  issueClientSeq(): number {
    const seq = this.nextClientSeq;
    this.nextClientSeq += 1;
    return seq;
  }

  /**
   * Persist one operation. Resolves only once the transaction has COMMITTED.
   *
   * Callers await this before touching UI state. That ordering is the
   * requirement: durable write first, optimistic update second (FR-SYN-01).
   * Reversing it produces the failure where the candidate sees a saved answer
   * that no longer exists after a crash.
   */
  async append(op: ResponseOp): Promise<void> {
    const stored: StoredOp = { ...op, opKey: `${String(this.attemptId)}:${op.clientSeq}` };
    await withTransaction(this.db, [OPS_STORE, META_STORE], 'readwrite', async (tx) => {
      await put(tx, OPS_STORE, stored);
      await put(tx, META_STORE, {
        attemptId: String(this.attemptId),
        nextClientSeq: this.nextClientSeq,
        lastAckClientSeq: this.lastAckClientSeq,
      } satisfies OutboxMeta);
    });
  }

  /** The next batch, oldest first, capped at `MAX_BATCH_OPS`. */
  async pending(): Promise<readonly ResponseOp[]> {
    const all = await withTransaction(this.db, [OPS_STORE], 'readonly', (tx) =>
      getAllFrom<StoredOp>(tx, OPS_STORE),
    );
    return all
      .filter((op) => String(op.attemptId) === String(this.attemptId))
      .sort((a, b) => a.clientSeq - b.clientSeq)
      .slice(0, MAX_BATCH_OPS)
      .map(({ opKey: _opKey, ...op }) => op);
  }

  async pendingCount(): Promise<number> {
    const all = await withTransaction(this.db, [OPS_STORE], 'readonly', (tx) =>
      getAllFrom<StoredOp>(tx, OPS_STORE),
    );
    return all.filter((op) => String(op.attemptId) === String(this.attemptId)).length;
  }

  /**
   * Clear ONLY the sequences the server acknowledged (FR-SYN-03).
   *
   * The response carries a per-operation result array, and an unacknowledged
   * operation stays in the queue for the next batch. Clearing the whole batch
   * on a 200 would silently discard any operation the server rejected or
   * failed to apply within its transaction.
   */
  async acknowledge(results: readonly { clientSeq: number; accepted: boolean }[]): Promise<void> {
    const acknowledged = results.map((r) => r.clientSeq);
    if (acknowledged.length === 0) return;
    const highest = Math.max(this.lastAckClientSeq, ...acknowledged);

    await withTransaction(this.db, [OPS_STORE, META_STORE], 'readwrite', async (tx) => {
      for (const seq of acknowledged) {
        await deleteKey(tx, OPS_STORE, `${String(this.attemptId)}:${seq}`);
      }
      this.lastAckClientSeq = highest;
      await put(tx, META_STORE, {
        attemptId: String(this.attemptId),
        nextClientSeq: this.nextClientSeq,
        lastAckClientSeq: highest,
      } satisfies OutboxMeta);
    });
  }

  get acknowledgedThrough(): number {
    return this.lastAckClientSeq;
  }

  close(): void {
    this.db.close();
  }
}
