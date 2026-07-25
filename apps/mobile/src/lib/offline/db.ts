/**
 * Local database lifecycle.
 *
 * Opened once, migrated once, and shared. Opening a second connection to the
 * same file from a feature module is the usual way a write-ahead-log database
 * starts returning "database is locked" on a mid-range Android device under a
 * fling, so the handle is a module singleton and there is no exported open.
 */

import * as SQLite from 'expo-sqlite';

import { FORBIDDEN_TABLE_PATTERNS, MIGRATIONS, NOTES_FTS_SETUP, SCHEMA_VERSION } from './schema.js';

const DATABASE_NAME = 'practice.db';

let handle: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;
let ftsAvailable = false;

export class ForbiddenLocalTableError extends Error {
  constructor(readonly tableName: string) {
    super(
      `Local table "${tableName}" matches a forbidden pattern. This device database may hold practice content, SRS state and notes only. ` +
        'Answer keys, solutions and deadlines are server-side (FR-SYN-10, NFR-SEC-02, FR-ATT-06); caching any of them on the device defeats every control above them.',
    );
    this.name = 'ForbiddenLocalTableError';
  }
}

/**
 * Startup assertion.
 *
 * Cheap — one query over `sqlite_master` — and it runs on every launch rather
 * than only in development, because the case it guards against is a build that
 * shipped with a table someone added in a hurry before a live test window.
 */
async function assertNoForbiddenTables(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view')",
  );
  for (const row of rows) {
    const lowered = row.name.toLowerCase();
    for (const pattern of FORBIDDEN_TABLE_PATTERNS) {
      if (lowered.includes(pattern)) {
        throw new ForbiddenLocalTableError(row.name);
      }
    }
  }
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const current = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const from = current?.user_version ?? 0;

  for (let version = from; version < MIGRATIONS.length; version += 1) {
    const statement = MIGRATIONS[version];
    if (statement === undefined) continue;
    await db.execAsync(statement);
  }

  if (from < SCHEMA_VERSION) {
    await db.execAsync(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
  }

  // FTS5 is a compile-time option. A runtime without it must degrade to
  // substring search rather than refusing to launch — losing search ranking is
  // an inconvenience, failing to start is a lost session.
  try {
    await db.execAsync(NOTES_FTS_SETUP);
    ftsAvailable = true;
  } catch {
    ftsAvailable = false;
  }
}

export async function database(): Promise<SQLite.SQLiteDatabase> {
  if (handle !== null) return handle;
  opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await migrate(db);
    await assertNoForbiddenTables(db);
    handle = db;
    return db;
  })();
  return opening;
}

export function isFullTextSearchAvailable(): boolean {
  return ftsAvailable;
}

/** Read a scalar from the meta table. */
export async function readMeta(key: string): Promise<string | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    key,
  ]);
  return row?.value ?? null;
}

export async function writeMeta(key: string, value: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

/** Test and diagnostics hook: drops the shared handle so the next call reopens. */
export async function closeDatabase(): Promise<void> {
  if (handle !== null) {
    await handle.closeAsync();
    handle = null;
    opening = null;
  }
}
