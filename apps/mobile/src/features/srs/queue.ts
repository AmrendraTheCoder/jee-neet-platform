/**
 * The review queue: due cards, and the fresh-unseen draw (FR-SRS-03).
 *
 * When a card falls due the student is served a *new* item from that sub-topic,
 * not the item that created the card. Re-showing the original question tests
 * whether they remember that question; drawing a fresh one tests whether they
 * have the concept, which is what the examination will do.
 *
 * "Revisit this exact question" is a separate feature — a bookmark and redo —
 * and lives outside the scheduler entirely (FR-SRS-09). Conflating the two is
 * the most common way this feature is built wrong.
 */

import type { QuestionVersionId, SubTopicId } from '@platform/domain';
import { asSubTopicId } from '@platform/domain';

import { drawForReview } from '../../lib/api/endpoints.js';
import type { PracticeQuestion } from '../../lib/api/types.js';
import { database } from '../../lib/offline/db.js';
import { recordLocalChange } from '../../lib/offline/queue.js';
import type { ReviewRating } from './grading.js';
import type { CardState, ReviewCard } from './scheduler.js';
import { applyReview, newCard, targetDifficulty } from './scheduler.js';

interface CardRow {
  readonly sub_topic_id: string;
  readonly subject: string;
  readonly state: string;
  readonly due_ms: number;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsed_days: number;
  readonly scheduled_days: number;
  readonly reps: number;
  readonly lapses: number;
  readonly learning_steps: number;
  readonly last_review_ms: number | null;
}

function fromRow(row: CardRow): ReviewCard {
  return {
    subTopicId: asSubTopicId(row.sub_topic_id),
    state: row.state as CardState,
    dueMs: row.due_ms,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    learningSteps: row.learning_steps,
    lastReviewMs: row.last_review_ms,
  };
}

export interface DueCard {
  readonly card: ReviewCard;
  readonly subject: string;
}

/**
 * Cards due now, oldest first, capped.
 *
 * The cap is a product decision, not a performance one. A queue that opens with
 * "218 due" is a queue a student closes; a guaranteed-completable daily target
 * is what FR-PRC-06 asks for and what actually gets done. Overflow stays due and
 * appears tomorrow.
 */
export async function dueCards(nowMs: number, limit = 20): Promise<readonly DueCard[]> {
  const db = await database();
  const rows = await db.getAllAsync<CardRow>(
    'SELECT * FROM srs_cards WHERE due_ms <= ? ORDER BY due_ms ASC LIMIT ?',
    [nowMs, limit],
  );
  return rows.map((row) => ({ card: fromRow(row), subject: row.subject }));
}

export async function dueCount(nowMs: number): Promise<number> {
  const db = await database();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM srs_cards WHERE due_ms <= ?',
    [nowMs],
  );
  return row?.n ?? 0;
}

export async function loadCard(subTopicId: SubTopicId): Promise<ReviewCard | null> {
  const db = await database();
  const row = await db.getFirstAsync<CardRow>('SELECT * FROM srs_cards WHERE sub_topic_id = ?', [
    String(subTopicId),
  ]);
  return row === null ? null : fromRow(row);
}

async function writeCard(card: ReviewCard, subject: string): Promise<void> {
  const db = await database();
  await db.runAsync(
    `INSERT INTO srs_cards
       (sub_topic_id, subject, state, due_ms, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, last_review_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sub_topic_id) DO UPDATE SET
       state = excluded.state,
       due_ms = excluded.due_ms,
       stability = excluded.stability,
       difficulty = excluded.difficulty,
       elapsed_days = excluded.elapsed_days,
       scheduled_days = excluded.scheduled_days,
       reps = excluded.reps,
       lapses = excluded.lapses,
       learning_steps = excluded.learning_steps,
       last_review_ms = excluded.last_review_ms,
       updated_at_ms = excluded.updated_at_ms`,
    [
      String(card.subTopicId),
      subject,
      card.state,
      card.dueMs,
      card.stability,
      card.difficulty,
      card.elapsedDays,
      card.scheduledDays,
      card.reps,
      card.lapses,
      card.learningSteps,
      card.lastReviewMs,
      Date.now(),
    ],
  );
}

export async function ensureCard(
  subTopicId: SubTopicId,
  subject: string,
  nowMs: number,
): Promise<ReviewCard> {
  const existing = await loadCard(subTopicId);
  if (existing !== null) return existing;
  const created = newCard(subTopicId, nowMs);
  await writeCard(created, subject);
  return created;
}

/**
 * Record a review: advance the card, append to the review log, queue the sync.
 *
 * The log is retained as the retraining corpus for scheduler parameters
 * (FR-SRS-05), which is why it stores the pre-review stability and difficulty —
 * those cannot be reconstructed from the post-review card.
 */
export async function recordReview(args: {
  readonly card: ReviewCard;
  readonly subject: string;
  readonly rating: ReviewRating;
  readonly questionVersionId: QuestionVersionId | null;
  readonly reviewedAtMs: number;
}): Promise<ReviewCard> {
  const next = applyReview(args.card, args.rating, args.reviewedAtMs);

  await recordLocalChange({
    kind: 'SRS_REVIEW',
    scopeId: String(args.card.subTopicId),
    payload: {
      subTopicId: String(args.card.subTopicId),
      questionVersionId: args.questionVersionId === null ? null : String(args.questionVersionId),
      rating: args.rating,
      reviewedAtMs: args.reviewedAtMs,
    },
    apply: async (db) => {
      await db.runAsync(
        `INSERT INTO srs_reviews
           (sub_topic_id, question_version_id, rating, reviewed_at_ms, stability_before, difficulty_before)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(args.card.subTopicId),
          args.questionVersionId === null ? null : String(args.questionVersionId),
          ['AGAIN', 'HARD', 'GOOD', 'EASY'].indexOf(args.rating) + 1,
          args.reviewedAtMs,
          args.card.stability,
          args.card.difficulty,
        ],
      );
      return undefined;
    },
  });

  await writeCard(next, args.subject);
  return next;
}

/**
 * Draw a fresh unseen item for a due card.
 *
 * Local cache first, so a review session works with no connectivity at all
 * (FR-SYN-10 permits exactly this: untimed practice and SRS review). The seen
 * ledger is the exclusion set. Falls back to the server only when the local
 * cache is exhausted, and returns null rather than repeating an item — the
 * caller then tells the student this sub-topic needs a download, which is true
 * and actionable, rather than serving them a question they have already met.
 */
export async function drawUnseenItem(
  card: ReviewCard,
  online: boolean,
): Promise<PracticeQuestion | null> {
  const db = await database();
  const difficulty = targetDifficulty(card);

  const local = await db.getFirstAsync<{ payload: string }>(
    `SELECT q.payload
       FROM cached_questions q
       LEFT JOIN seen_ledger l ON l.question_version_id = q.question_version_id
      WHERE q.sub_topic_id = ? AND l.question_version_id IS NULL
      ORDER BY CASE WHEN q.difficulty = ? THEN 0 ELSE 1 END, q.question_version_id ASC
      LIMIT 1`,
    [String(card.subTopicId), difficulty],
  );

  if (local !== null) return JSON.parse(local.payload) as PracticeQuestion;
  if (!online) return null;

  const seen = await db.getAllAsync<{ question_version_id: string }>(
    'SELECT question_version_id FROM seen_ledger WHERE sub_topic_id = ?',
    [String(card.subTopicId)],
  );

  return drawForReview({
    subTopicId: card.subTopicId,
    excludeQuestionVersionIds: seen.map((row) => row.question_version_id),
    targetDifficulty: difficulty,
  });
}
