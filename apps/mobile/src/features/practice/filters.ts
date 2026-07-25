/**
 * The custom test builder's filter model (FR-PRC-02, FR-PRC-04).
 *
 * Filtering by *question state* — what this student has already done with each
 * item — is the feature this client is built around. It is the most-imitated
 * feature of the international market leader and is absent from every Indian
 * competitor, and it only works if the per-question history is on the device:
 * a chip whose count arrives 400 ms after the tap is a chip nobody trusts.
 *
 * So the counts are answered from local SQLite, from `question_states`, which
 * the sync layer keeps current. Every chip's count is the number of questions
 * that would match *if that chip were selected*, holding the other dimensions
 * fixed — a marginal count, not a global one, because a global count tells the
 * student nothing about the decision in front of them.
 */

import type { Subject } from '@platform/domain';

import { database } from '../../lib/offline/db.js';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export const DIFFICULTIES: readonly Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

export const QUESTION_STATES = [
  'UNUSED',
  'INCORRECT',
  'CORRECT',
  'MARKED',
  'CORRECT_BUT_GUESSED',
] as const;
export type QuestionStateFilter = (typeof QUESTION_STATES)[number];

export const QUESTION_STATE_LABELS: Readonly<Record<QuestionStateFilter, string>> = {
  UNUSED: 'Unused',
  INCORRECT: 'Incorrect',
  CORRECT: 'Correct',
  MARKED: 'Marked',
  CORRECT_BUT_GUESSED: 'Correct but guessed',
};

export const QUESTION_STATE_HINTS: Readonly<Record<QuestionStateFilter, string>> = {
  UNUSED: 'Questions you have never been served.',
  INCORRECT: 'Your last answer was wrong, partially right, or could not be read.',
  CORRECT: 'You answered correctly and did not mark it as a guess.',
  MARKED: 'You flagged it for review, whatever the outcome.',
  CORRECT_BUT_GUESSED: 'You got the mark but told us you guessed. The most valuable revision set there is.',
};

/**
 * SQL predicate per state.
 *
 * `CORRECT` deliberately excludes guessed-right. If it did not, the correct
 * bucket would swallow the guessed bucket and the one filter nobody else ships
 * would be invisible inside a much larger number.
 *
 * `INCORRECT` includes partially correct and unparseable. Both mean the student
 * did not have the concept, which is the question the filter is really asking.
 */
const STATE_PREDICATES: Readonly<Record<QuestionStateFilter, string>> = {
  UNUSED: '(s.attempt_count IS NULL OR s.attempt_count = 0)',
  INCORRECT: "s.last_outcome IN ('INCORRECT', 'UNPARSEABLE', 'PARTIALLY_CORRECT')",
  CORRECT: "(s.last_outcome = 'CORRECT' AND COALESCE(s.guessed, 0) = 0)",
  MARKED: 'COALESCE(s.marked, 0) = 1',
  CORRECT_BUT_GUESSED: "(s.last_outcome = 'CORRECT' AND COALESCE(s.guessed, 0) = 1)",
};

export interface YearRange {
  readonly from: number;
  readonly to: number;
}

export interface BuilderCriteria {
  readonly subject: Subject | null;
  readonly chapterIds: readonly string[];
  readonly subTopicIds: readonly string[];
  readonly difficulties: readonly Difficulty[];
  readonly states: readonly QuestionStateFilter[];
  readonly years: YearRange | null;
  readonly targetCount: number;
}

export const EMPTY_CRITERIA: BuilderCriteria = {
  subject: null,
  chapterIds: [],
  subTopicIds: [],
  difficulties: [],
  states: [],
  years: null,
  targetCount: 10,
};

interface Clause {
  readonly sql: string;
  readonly params: readonly (string | number)[];
}

function inClause(column: string, values: readonly string[]): Clause | null {
  if (values.length === 0) return null;
  return { sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values };
}

/**
 * Build the WHERE fragment.
 *
 * Dimensions combine with AND; values inside a dimension combine with OR. A
 * student asking for "incorrect or marked, hard, from 2019 to 2023" means
 * exactly that, and the states dimension is the one where an AND would be
 * nonsense — nothing is both unused and incorrect.
 */
export function buildWhere(criteria: BuilderCriteria): Clause {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (criteria.subject !== null) {
    clauses.push('q.subject = ?');
    params.push(criteria.subject);
  }

  const subTopics = inClause('q.sub_topic_id', criteria.subTopicIds);
  const chapters = inClause('q.chapter_id', criteria.chapterIds);
  // Sub-topic selection is a refinement of chapter selection, not an alternative
  // to it: choosing a sub-topic and its parent chapter must not exclude the rest
  // of the chapter the student also asked for.
  if (subTopics !== null && chapters !== null) {
    clauses.push(`(${subTopics.sql} OR ${chapters.sql})`);
    params.push(...subTopics.params, ...chapters.params);
  } else if (subTopics !== null) {
    clauses.push(subTopics.sql);
    params.push(...subTopics.params);
  } else if (chapters !== null) {
    clauses.push(chapters.sql);
    params.push(...chapters.params);
  }

  const difficulties = inClause('q.difficulty', criteria.difficulties);
  if (difficulties !== null) {
    clauses.push(difficulties.sql);
    params.push(...difficulties.params);
  }

  if (criteria.years !== null) {
    clauses.push('q.pyq_year IS NOT NULL AND q.pyq_year BETWEEN ? AND ?');
    params.push(criteria.years.from, criteria.years.to);
  }

  if (criteria.states.length > 0) {
    const predicates = criteria.states.map((state) => STATE_PREDICATES[state]);
    clauses.push(`(${predicates.join(' OR ')})`);
  }

  return {
    sql: clauses.length === 0 ? '1 = 1' : clauses.join(' AND '),
    params,
  };
}

const FROM = `
FROM cached_questions q
LEFT JOIN question_states s ON s.question_version_id = q.question_version_id
`;

export async function countMatching(criteria: BuilderCriteria): Promise<number> {
  const db = await database();
  const where = buildWhere(criteria);
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n ${FROM} WHERE ${where.sql}`,
    [...where.params],
  );
  return row?.n ?? 0;
}

export async function selectMatchingIds(
  criteria: BuilderCriteria,
  limit: number,
): Promise<readonly string[]> {
  const db = await database();
  const where = buildWhere(criteria);
  // Ordered by least-recently-seen so a repeat session does not open with the
  // same five questions, and deterministically by id after that so the same
  // criteria produce a stable set within one build.
  const rows = await db.getAllAsync<{ question_version_id: string }>(
    `SELECT q.question_version_id ${FROM} WHERE ${where.sql}
     ORDER BY COALESCE(s.last_seen_ms, 0) ASC, q.question_version_id ASC
     LIMIT ?`,
    [...where.params, limit],
  );
  return rows.map((row) => row.question_version_id);
}

export interface ChipCounts {
  readonly states: Readonly<Record<QuestionStateFilter, number>>;
  readonly difficulties: Readonly<Record<Difficulty, number>>;
  readonly total: number;
}

/**
 * Marginal counts for every chip in one pass per dimension.
 *
 * Two queries, not one per chip. Eight chips at one query each is the N+1
 * pattern NFR-SCL-11 makes a build failure, and it would fire on every keystroke
 * of the target-count field.
 */
export async function chipCounts(criteria: BuilderCriteria): Promise<ChipCounts> {
  const db = await database();

  const withoutStates = buildWhere({ ...criteria, states: [] });
  const stateColumns = QUESTION_STATES.map(
    (state) => `SUM(CASE WHEN ${STATE_PREDICATES[state]} THEN 1 ELSE 0 END) AS ${state.toLowerCase()}`,
  ).join(', ');

  const stateRow = await db.getFirstAsync<Record<string, number | null>>(
    `SELECT ${stateColumns} ${FROM} WHERE ${withoutStates.sql}`,
    [...withoutStates.params],
  );

  const withoutDifficulty = buildWhere({ ...criteria, difficulties: [] });
  const difficultyColumns = DIFFICULTIES.map(
    (level) => `SUM(CASE WHEN q.difficulty = '${level}' THEN 1 ELSE 0 END) AS ${level.toLowerCase()}`,
  ).join(', ');

  const difficultyRow = await db.getFirstAsync<Record<string, number | null>>(
    `SELECT ${difficultyColumns} ${FROM} WHERE ${withoutDifficulty.sql}`,
    [...withoutDifficulty.params],
  );

  const states = Object.fromEntries(
    QUESTION_STATES.map((state) => [state, stateRow?.[state.toLowerCase()] ?? 0]),
  ) as Record<QuestionStateFilter, number>;

  const difficulties = Object.fromEntries(
    DIFFICULTIES.map((level) => [level, difficultyRow?.[level.toLowerCase()] ?? 0]),
  ) as Record<Difficulty, number>;

  return { states, difficulties, total: await countMatching(criteria) };
}
