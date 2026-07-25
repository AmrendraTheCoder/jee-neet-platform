/**
 * The durable write queue (FR-SYN-01, FR-SYN-02, EC-NET-02, EC-NET-06).
 *
 * Every student write lands here before the interface acknowledges it. The
 * optimistic update is a consequence of a committed local row, never a
 * substitute for one — which is what makes "the app was killed while offline"
 * a non-event instead of a data-loss incident.
 *
 * `client_seq` is a counter persisted in this same database and incremented in
 * the same transaction as the write it labels. It is deliberately not a
 * timestamp: device clocks on this hardware are wrong, adjustable by the user,
 * and jump when the network operator resyncs them. A timestamp-ordered queue
 * lets a student reorder their own writes by changing the clock.
 */

import type * as SQLite from 'expo-sqlite';

import { database } from './db.js';

export const OP_KINDS = [
  'ANSWER',
  'SESSION_SUBMIT',
  'QUESTION_STATE',
  'SRS_REVIEW',
  'MISTAKE_TAG',
  'NOTE_UPSERT',
  'NOTE_DELETE',
] as const;
export type OpKind = (typeof OP_KINDS)[number];

/**
 * Drain lanes.
 *
 * Answers are P0 and drain first, alone if necessary. Notes are P2 because a
 * 4 KB note with LaTeX in it is two orders of magnitude larger than an answer,
 * and thirty of them queued ahead of an answer on a 2G connection is how a
 * student's last five responses arrive after the session is over.
 */
export const PRIORITY = {
  ANSWER: 0,
  LEARNING_STATE: 1,
  NOTE: 2,
} as const;

const PRIORITY_BY_KIND: Readonly<Record<OpKind, number>> = {
  ANSWER: PRIORITY.ANSWER,
  SESSION_SUBMIT: PRIORITY.ANSWER,
  QUESTION_STATE: PRIORITY.LEARNING_STATE,
  SRS_REVIEW: PRIORITY.LEARNING_STATE,
  MISTAKE_TAG: PRIORITY.LEARNING_STATE,
  NOTE_UPSERT: PRIORITY.NOTE,
  NOTE_DELETE: PRIORITY.NOTE,
};

const CLIENT_SEQ_KEY = 'client_seq';

export interface PendingOp {
  readonly id: number;
  readonly opId: string;
  readonly priority: number;
  readonly kind: OpKind;
  readonly scopeId: string;
  readonly payload: string;
  readonly clientSeq: number;
  readonly createdAtMs: number;
  readonly attempts: number;
}

interface PendingOpRow {
  readonly id: number;
  readonly op_id: string;
  readonly priority: number;
  readonly kind: string;
  readonly scope_id: string;
  readonly payload: string;
  readonly client_seq: number;
  readonly created_at_ms: number;
  readonly attempts: number;
}

/**
 * Idempotency key for one operation.
 *
 * Generated on the client and reused across every retry of the same logical
 * write, so a retried request whose response was lost cannot produce a second
 * effect on the server (EC-NET-05).
 */
function newOpId(): string {
  const random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  const random2 = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${Date.now().toString(16)}-${random}-${random2}`;
}

async function nextClientSeq(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    CLIENT_SEQ_KEY,
  ]);
  const next = (row === null ? 0 : Number(row.value)) + 1;
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [CLIENT_SEQ_KEY, String(next)],
  );
  return next;
}

/**
 * Apply a local change and enqueue its synchronisation in one transaction.
 *
 * The atomicity matters in both directions: a local write with no queue entry is
 * silently never synced, and a queue entry with no local write shows the student
 * an optimistic update that vanishes on the next read.
 */
export async function recordLocalChange<T>(args: {
  readonly kind: OpKind;
  /** Groups related operations, e.g. the session or note id. */
  readonly scopeId: string;
  readonly payload: unknown;
  readonly apply: (db: SQLite.SQLiteDatabase, clientSeq: number) => Promise<T>;
}): Promise<{ readonly result: T; readonly clientSeq: number; readonly opId: string }> {
  const db = await database();
  const opId = newOpId();
  let clientSeq = 0;
  let result!: T;

  await db.withTransactionAsync(async () => {
    clientSeq = await nextClientSeq(db);
    result = await args.apply(db, clientSeq);
    await db.runAsync(
      `INSERT INTO pending_ops (op_id, priority, kind, scope_id, payload, client_seq, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        opId,
        PRIORITY_BY_KIND[args.kind],
        args.kind,
        args.scopeId,
        JSON.stringify({ ...(args.payload as Record<string, unknown>), opId, clientSeq }),
        clientSeq,
        Date.now(),
      ],
    );
  });

  return { result, clientSeq, opId };
}

/**
 * Next batch to send.
 *
 * Strictly ordered by priority then insertion. Serial per lane is a second line
 * of defence behind the server's sequence guard: the server drops a stale
 * `client_seq`, and draining in order means it rarely has to.
 */
export async function takeBatch(limit: number): Promise<readonly PendingOp[]> {
  const db = await database();
  const rows = await db.getAllAsync<PendingOpRow>(
    'SELECT * FROM pending_ops ORDER BY priority ASC, id ASC LIMIT ?',
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    opId: row.op_id,
    priority: row.priority,
    kind: row.kind as OpKind,
    scopeId: row.scope_id,
    payload: row.payload,
    clientSeq: row.client_seq,
    createdAtMs: row.created_at_ms,
    attempts: row.attempts,
  }));
}

/** Clear only what the server acknowledged, never the whole batch (FR-SYN-03). */
export async function acknowledge(opIds: readonly string[]): Promise<void> {
  if (opIds.length === 0) return;
  const db = await database();
  const placeholders = opIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM pending_ops WHERE op_id IN (${placeholders})`, [...opIds]);
}

export async function markAttempted(opIds: readonly string[], error: string | null): Promise<void> {
  if (opIds.length === 0) return;
  const db = await database();
  const placeholders = opIds.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE pending_ops SET attempts = attempts + 1, last_error = ? WHERE op_id IN (${placeholders})`,
    [error, ...opIds],
  );
}

export async function pendingCount(): Promise<number> {
  const db = await database();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops');
  return row?.n ?? 0;
}

/** Count of answer-lane operations only, for the passive indicator (FR-SYN-05). */
export async function pendingAnswerCount(): Promise<number> {
  const db = await database();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM pending_ops WHERE priority = ?',
    [PRIORITY.ANSWER],
  );
  return row?.n ?? 0;
}
