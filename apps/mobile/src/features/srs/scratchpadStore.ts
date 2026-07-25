/**
 * Persistence for rough work.
 *
 * Local only, and deliberately not queued for sync. A student's working is
 * personal data with no pedagogical purpose that would justify collecting it,
 * and this product's users are predominantly children — the default answer to
 * "should we upload this?" is no unless there is a stated purpose (NFR-PRV-02,
 * NFR-PRV-03).
 *
 * Kept out of `queue.ts` so it is obvious from the import graph that nothing
 * here reaches the network.
 */

import type { QuestionVersionId } from '@platform/domain';

import { database } from '../../lib/offline/db.js';

/**
 * Cap on retained strokes per question.
 *
 * A long algebraic derivation runs to a few hundred strokes; two thousand is a
 * scribble loop or a child drawing. The cap bounds the row size so a single
 * question cannot bloat the database on a device that is usually short of space.
 */
const MAX_STROKES = 2000;

export async function loadStrokes(
  questionVersionId: QuestionVersionId,
): Promise<readonly string[]> {
  const db = await database();
  const row = await db.getFirstAsync<{ strokes: string }>(
    'SELECT strokes FROM scratchpad_pages WHERE question_version_id = ?',
    [String(questionVersionId)],
  );
  if (row === null) return [];
  try {
    const parsed: unknown = JSON.parse(row.strokes);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export async function saveStrokes(
  questionVersionId: QuestionVersionId,
  strokes: readonly string[],
): Promise<void> {
  const db = await database();
  const bounded = strokes.slice(-MAX_STROKES);
  await db.runAsync(
    `INSERT INTO scratchpad_pages (question_version_id, strokes, updated_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(question_version_id) DO UPDATE SET
       strokes = excluded.strokes,
       updated_at_ms = excluded.updated_at_ms`,
    [String(questionVersionId), JSON.stringify(bounded), Date.now()],
  );
}

/**
 * Total engaged drawing time is not derived here, and deliberately so.
 *
 * The scratchpad exists to stop response time being used as a proxy for
 * thinking time. Replacing one time-derived grade with another would reintroduce
 * the same defect with a better story attached. Stroke data informs the student
 * and nothing else (FR-SRS-06).
 */
export async function clearStrokes(questionVersionId: QuestionVersionId): Promise<void> {
  const db = await database();
  await db.runAsync('DELETE FROM scratchpad_pages WHERE question_version_id = ?', [
    String(questionVersionId),
  ]);
}
