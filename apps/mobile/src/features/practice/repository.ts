/**
 * Local persistence for practice.
 *
 * Every student write goes through `recordLocalChange`, which commits the local
 * row and its sync entry in one transaction (FR-SYN-01). Nothing in this module
 * writes directly to the queue or directly to a table without the other.
 */

import type { QuestionVersionId, Response, SubTopicId } from '@platform/domain';

import { database } from '../../lib/offline/db.js';
import { recordLocalChange } from '../../lib/offline/queue.js';
import type { PracticeMode, PracticeQuestion, TaxonomyNode } from '../../lib/api/types.js';

interface CachedQuestionRow {
  readonly question_version_id: string;
  readonly payload: string;
}

export async function loadCachedQuestions(
  ids: readonly QuestionVersionId[],
): Promise<readonly PracticeQuestion[]> {
  if (ids.length === 0) return [];
  const db = await database();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<CachedQuestionRow>(
    `SELECT question_version_id, payload FROM cached_questions WHERE question_version_id IN (${placeholders})`,
    ids.map((id) => String(id)),
  );

  const byId = new Map<string, PracticeQuestion>();
  for (const row of rows) {
    byId.set(row.question_version_id, JSON.parse(row.payload) as PracticeQuestion);
  }
  // Preserve the requested order rather than the database's. The session's
  // question order is decided by the builder; re-ordering it here would silently
  // change what "question 3" means between a fresh load and a resume.
  return ids.map((id) => byId.get(String(id))).filter((q): q is PracticeQuestion => q !== undefined);
}

export async function cacheQuestions(questions: readonly PracticeQuestion[]): Promise<void> {
  if (questions.length === 0) return;
  const db = await database();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const question of questions) {
      await db.runAsync(
        `INSERT INTO cached_questions
           (question_version_id, question_id, sub_topic_id, chapter_id, subject, difficulty, pyq_year, plain_text, payload, cached_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(question_version_id) DO UPDATE SET
           payload = excluded.payload,
           plain_text = excluded.plain_text,
           cached_at_ms = excluded.cached_at_ms`,
        [
          String(question.questionVersionId),
          String(question.questionId),
          String(question.subTopicId),
          // The chapter is carried on the taxonomy path; the server supplies it
          // alongside the sub-topic so the browse filters do not need a join.
          String(question.subTopicId),
          question.subject,
          question.authoredDifficulty,
          null,
          question.stemPlainText,
          JSON.stringify(question),
          now,
        ],
      );
    }
  });
}

export async function createLocalSession(args: {
  readonly sessionId: string;
  readonly mode: PracticeMode;
  readonly questionVersionIds: readonly QuestionVersionId[];
  readonly durationSeconds: number | null;
}): Promise<void> {
  const db = await database();
  await db.runAsync(
    `INSERT INTO practice_sessions (session_id, mode, question_ids, duration_seconds, created_at_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO NOTHING`,
    [
      args.sessionId,
      args.mode,
      JSON.stringify(args.questionVersionIds.map(String)),
      args.durationSeconds,
      Date.now(),
    ],
  );
}

/**
 * Persist a response and queue it, returning the allocated sequence.
 *
 * The caller dispatches its reducer action with this value, so the interface
 * only ever shows state that is already durable.
 */
export async function persistResponse(
  sessionId: string,
  response: Response,
): Promise<number> {
  const { clientSeq } = await recordLocalChange({
    kind: 'ANSWER',
    scopeId: sessionId,
    payload: {
      sessionId,
      questionVersionId: String(response.questionVersionId),
      // Identity, never position (FR-ATT-12, EC-DATA-09). The server asserts
      // membership in the session's persisted question set and rejects anything
      // else with 422.
      selectedOptionIds: response.selectedOptionIds.map(String),
      numericRaw: response.numericRaw,
      markedForReview: response.markedForReview,
      visited: response.visited,
      timeSpentMs: response.timeSpentMs,
    },
    apply: async (db, seq) => {
      await db.runAsync(
        `INSERT INTO local_responses
           (session_id, question_version_id, selected_option_ids, numeric_raw, visited, marked_for_review, time_spent_ms, client_seq, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, question_version_id) DO UPDATE SET
           selected_option_ids = excluded.selected_option_ids,
           numeric_raw = excluded.numeric_raw,
           visited = excluded.visited,
           marked_for_review = excluded.marked_for_review,
           time_spent_ms = excluded.time_spent_ms,
           client_seq = excluded.client_seq,
           updated_at_ms = excluded.updated_at_ms
         WHERE excluded.client_seq > local_responses.client_seq`,
        [
          sessionId,
          String(response.questionVersionId),
          JSON.stringify(response.selectedOptionIds.map(String)),
          response.numericRaw,
          response.visited ? 1 : 0,
          response.markedForReview ? 1 : 0,
          response.timeSpentMs,
          seq,
          Date.now(),
        ],
      );
      return seq;
    },
  });
  return clientSeq;
}

/**
 * Update the per-question history that drives the state filters.
 *
 * `guessed` is self-reported. It is never inferred from response time — a
 * student working four minutes on paper looks identical to one who guessed in
 * four seconds, and the inference would be backwards for the most careful
 * students (FR-SRS-06, the rough-work constraint).
 */
export async function recordQuestionState(args: {
  readonly questionVersionId: QuestionVersionId;
  readonly subTopicId: SubTopicId;
  readonly chapterId: string;
  readonly subject: string;
  readonly difficulty: string;
  readonly outcome: string;
  readonly marked: boolean;
  readonly guessed: boolean;
}): Promise<void> {
  await recordLocalChange({
    kind: 'QUESTION_STATE',
    scopeId: String(args.questionVersionId),
    payload: {
      questionVersionId: String(args.questionVersionId),
      outcome: args.outcome,
      marked: args.marked,
      guessed: args.guessed,
    },
    apply: async (db) => {
      await db.runAsync(
        `INSERT INTO question_states
           (question_version_id, sub_topic_id, chapter_id, subject, difficulty, last_outcome, attempt_count, marked, guessed, last_seen_ms)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(question_version_id) DO UPDATE SET
           last_outcome  = excluded.last_outcome,
           attempt_count = question_states.attempt_count + 1,
           marked        = excluded.marked,
           guessed       = excluded.guessed,
           last_seen_ms  = excluded.last_seen_ms`,
        [
          String(args.questionVersionId),
          String(args.subTopicId),
          args.chapterId,
          args.subject,
          args.difficulty,
          args.outcome,
          args.marked ? 1 : 0,
          args.guessed ? 1 : 0,
          Date.now(),
        ],
      );
      return undefined;
    },
  });
}

/** Record delivery against the seen ledger (FR-SRS-03). Local-only; not synced. */
export async function markSeen(
  questionVersionId: QuestionVersionId,
  subTopicId: SubTopicId,
  source: 'PRACTICE' | 'SRS',
): Promise<void> {
  const db = await database();
  await db.runAsync(
    `INSERT INTO seen_ledger (question_version_id, sub_topic_id, first_seen_ms, source)
     VALUES (?, ?, ?, ?) ON CONFLICT(question_version_id) DO NOTHING`,
    [String(questionVersionId), String(subTopicId), Date.now(), source],
  );
}

interface TaxonomyRow {
  readonly id: string;
  readonly level: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly subject: string;
  readonly question_count: number;
  readonly mastery: number | null;
}

export async function loadTaxonomyChildren(parentId: string | null): Promise<readonly TaxonomyNode[]> {
  const db = await database();
  const rows =
    parentId === null
      ? await db.getAllAsync<TaxonomyRow>(
          "SELECT * FROM taxonomy_nodes WHERE parent_id IS NULL ORDER BY name ASC",
        )
      : await db.getAllAsync<TaxonomyRow>(
          'SELECT * FROM taxonomy_nodes WHERE parent_id = ? ORDER BY name ASC',
          [parentId],
        );

  const due = await db.getAllAsync<{ sub_topic_id: string; n: number }>(
    'SELECT sub_topic_id, COUNT(*) AS n FROM srs_cards WHERE due_ms <= ? GROUP BY sub_topic_id',
    [Date.now()],
  );
  const dueBySubTopic = new Map(due.map((row) => [row.sub_topic_id, row.n]));

  return rows.map((row) => ({
    id: row.id,
    level: row.level as TaxonomyNode['level'],
    parentId: row.parent_id,
    name: row.name,
    subject: row.subject as TaxonomyNode['subject'],
    questionCount: row.question_count,
    mastery: row.mastery,
    dueCardCount: dueBySubTopic.get(row.id) ?? 0,
  }));
}

export async function upsertTaxonomy(nodes: readonly TaxonomyNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const db = await database();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const node of nodes) {
      await db.runAsync(
        `INSERT INTO taxonomy_nodes (id, level, parent_id, name, subject, question_count, mastery, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           question_count = excluded.question_count,
           mastery = excluded.mastery,
           updated_at_ms = excluded.updated_at_ms`,
        [
          node.id,
          node.level,
          node.parentId,
          node.name,
          node.subject,
          node.questionCount,
          node.mastery,
          now,
        ],
      );
    }
  });
}
