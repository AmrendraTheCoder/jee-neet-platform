/**
 * Local SQLite schema.
 *
 * Scope discipline (FR-SYN-10): this database holds untimed practice content,
 * SRS state and notes. It holds no answer key, no solution, no rationale and no
 * deadline. Those three exclusions are not left to reviewer vigilance —
 * `assertNoForbiddenTables` in db.ts fails startup if a table appears whose name
 * suggests otherwise, and `FORBIDDEN_TABLE_PATTERNS` below is the list.
 *
 * A deadline in particular must never be cached. The timer is server
 * authoritative (FR-ATT-06); a locally stored deadline is a locally editable
 * deadline, and a device with a writable clock plus a writable deadline is not a
 * timed examination.
 */

export const SCHEMA_VERSION = 1;

/**
 * Names that must never appear in this database.
 *
 * Matched case-insensitively as substrings against `sqlite_master`. The list is
 * deliberately broad: a false positive costs a rename, and a false negative
 * costs the product's central claim.
 */
export const FORBIDDEN_TABLE_PATTERNS: readonly string[] = [
  'answer_key',
  'answerkey',
  'key_version',
  'solution',
  'rationale',
  'deadline',
  'attempt_deadline',
  'correct_option',
];

export const MIGRATIONS: readonly string[] = [
  // -- 1 -------------------------------------------------------------------
  `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  -- The offline write queue (FR-SYN-01, FR-SYN-02).
  --
  -- 'priority' exists because notes and answers must not share a lane
  -- (EC-NOTES-02): a student who writes thirty 4 KB notes on a 2G connection
  -- must not have their answers queued behind them. Answers drain first,
  -- always.
  CREATE TABLE IF NOT EXISTS pending_ops (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id          TEXT    NOT NULL UNIQUE,
    priority       INTEGER NOT NULL,
    kind           TEXT    NOT NULL,
    scope_id       TEXT    NOT NULL,
    payload        TEXT    NOT NULL,
    client_seq     INTEGER NOT NULL,
    created_at_ms  INTEGER NOT NULL,
    attempts       INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT
  );
  CREATE INDEX IF NOT EXISTS pending_ops_drain
    ON pending_ops (priority ASC, id ASC);

  -- Cached practice questions. The payload is a PracticeQuestion, which has no
  -- field capable of holding a key or a solution (see lib/api/types.ts).
  CREATE TABLE IF NOT EXISTS cached_questions (
    question_version_id TEXT PRIMARY KEY NOT NULL,
    question_id         TEXT NOT NULL,
    sub_topic_id        TEXT NOT NULL,
    chapter_id          TEXT NOT NULL,
    subject             TEXT NOT NULL,
    difficulty          TEXT NOT NULL,
    pyq_year            INTEGER,
    plain_text          TEXT NOT NULL,
    payload             TEXT NOT NULL,
    cached_at_ms        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cached_questions_subtopic
    ON cached_questions (sub_topic_id);
  CREATE INDEX IF NOT EXISTS cached_questions_chapter
    ON cached_questions (chapter_id, difficulty);

  -- Per-question history. This is what makes the question-state filters
  -- (FR-PRC-02) and their live counts (FR-PRC-04) answerable locally and
  -- instantly, rather than as a round trip per chip toggle.
  CREATE TABLE IF NOT EXISTS question_states (
    question_version_id TEXT PRIMARY KEY NOT NULL,
    sub_topic_id        TEXT NOT NULL,
    chapter_id          TEXT NOT NULL,
    subject             TEXT NOT NULL,
    difficulty          TEXT NOT NULL,
    pyq_year            INTEGER,
    last_outcome        TEXT,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    marked              INTEGER NOT NULL DEFAULT 0,
    -- Self-reported, never inferred. "Correct but guessed" is the single most
    -- useful revision filter there is and only the student knows it.
    guessed             INTEGER NOT NULL DEFAULT 0,
    last_seen_ms        INTEGER
  );
  CREATE INDEX IF NOT EXISTS question_states_filters
    ON question_states (chapter_id, difficulty, last_outcome, marked, guessed);

  -- Subject > Chapter > Topic > Sub-topic (FR-TAX-01). Cached so the browse
  -- screen renders offline and so a chapter's counts do not need a round trip
  -- per row, which on a 30-chapter subject would be 30 requests (NFR-SCL-11).
  CREATE TABLE IF NOT EXISTS taxonomy_nodes (
    id             TEXT PRIMARY KEY NOT NULL,
    level          TEXT NOT NULL,
    parent_id      TEXT,
    name           TEXT NOT NULL,
    subject        TEXT NOT NULL,
    question_count INTEGER NOT NULL DEFAULT 0,
    -- Null means "not enough attempts to say", which is rendered as exactly
    -- that. Rendering it as zero tells a beginner they have zero mastery, which
    -- is both untrue and the kind of framing FR-A11Y-09 prohibits.
    mastery        REAL,
    updated_at_ms  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS taxonomy_children ON taxonomy_nodes (parent_id);
  CREATE INDEX IF NOT EXISTS taxonomy_by_subject ON taxonomy_nodes (subject, level);

  CREATE TABLE IF NOT EXISTS practice_sessions (
    session_id       TEXT PRIMARY KEY NOT NULL,
    mode             TEXT NOT NULL,
    question_ids     TEXT NOT NULL,
    duration_seconds INTEGER,
    created_at_ms    INTEGER NOT NULL,
    submitted_at_ms  INTEGER
  );

  -- Local responses. 'marked_for_review' and 'visited' are columns beside the
  -- answer, never variants of it (FR-ATT-03, EC-NOTES-03).
  CREATE TABLE IF NOT EXISTS local_responses (
    session_id          TEXT NOT NULL,
    question_version_id TEXT NOT NULL,
    selected_option_ids TEXT NOT NULL DEFAULT '[]',
    numeric_raw         TEXT,
    visited             INTEGER NOT NULL DEFAULT 0,
    marked_for_review   INTEGER NOT NULL DEFAULT 0,
    time_spent_ms       INTEGER NOT NULL DEFAULT 0,
    client_seq          INTEGER NOT NULL,
    updated_at_ms       INTEGER NOT NULL,
    PRIMARY KEY (session_id, question_version_id)
  );

  -- SRS cards key on the sub-topic, not the question (FR-SRS-01).
  CREATE TABLE IF NOT EXISTS srs_cards (
    sub_topic_id    TEXT PRIMARY KEY NOT NULL,
    subject         TEXT NOT NULL,
    state           TEXT NOT NULL,
    due_ms          INTEGER NOT NULL,
    stability       REAL NOT NULL,
    difficulty      REAL NOT NULL,
    elapsed_days    REAL NOT NULL DEFAULT 0,
    scheduled_days  REAL NOT NULL DEFAULT 0,
    reps            INTEGER NOT NULL DEFAULT 0,
    lapses          INTEGER NOT NULL DEFAULT 0,
    learning_steps  INTEGER NOT NULL DEFAULT 0,
    last_review_ms  INTEGER,
    updated_at_ms   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS srs_cards_due ON srs_cards (due_ms ASC);

  -- The seen ledger (FR-SRS-03). A card falling due serves a fresh unseen item
  -- from its sub-topic, which is only possible if every delivery is recorded.
  CREATE TABLE IF NOT EXISTS seen_ledger (
    question_version_id TEXT PRIMARY KEY NOT NULL,
    sub_topic_id        TEXT NOT NULL,
    first_seen_ms       INTEGER NOT NULL,
    source              TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS seen_ledger_subtopic ON seen_ledger (sub_topic_id);

  -- Retained as the retraining corpus for scheduler parameters (FR-SRS-05).
  CREATE TABLE IF NOT EXISTS srs_reviews (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_topic_id        TEXT NOT NULL,
    question_version_id TEXT,
    rating              INTEGER NOT NULL,
    reviewed_at_ms      INTEGER NOT NULL,
    stability_before    REAL,
    difficulty_before   REAL,
    synced              INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notes (
    note_id       TEXT PRIMARY KEY NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    body          TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    revision      INTEGER NOT NULL DEFAULT 1,
    deleted       INTEGER NOT NULL DEFAULT 0
  );

  -- Backlinks to source questions (FR-NTS-02).
  CREATE TABLE IF NOT EXISTS note_links (
    note_id             TEXT NOT NULL,
    question_version_id TEXT NOT NULL,
    created_at_ms       INTEGER NOT NULL,
    PRIMARY KEY (note_id, question_version_id)
  );
  CREATE INDEX IF NOT EXISTS note_links_by_question
    ON note_links (question_version_id);

  -- FR-NTS-05, EC-NOTES-02: a concurrent edit produces a recorded conflict copy.
  -- No student's text is ever destroyed by a sync.
  CREATE TABLE IF NOT EXISTS note_conflicts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id         TEXT NOT NULL,
    losing_body     TEXT NOT NULL,
    losing_revision INTEGER NOT NULL,
    detected_at_ms  INTEGER NOT NULL,
    resolved        INTEGER NOT NULL DEFAULT 0
  );

  -- Mistake taxonomy self-tagging (FR-ANL-03).
  CREATE TABLE IF NOT EXISTS mistake_tags (
    question_version_id TEXT PRIMARY KEY NOT NULL,
    tag                 TEXT NOT NULL,
    tagged_at_ms        INTEGER NOT NULL
  );

  -- Rough-work strokes (FR-SRS-06). Kept locally and never used as a timing
  -- signal for grading; see features/srs/grading.ts.
  CREATE TABLE IF NOT EXISTS scratchpad_pages (
    question_version_id TEXT PRIMARY KEY NOT NULL,
    strokes             TEXT NOT NULL,
    updated_at_ms       INTEGER NOT NULL
  );
  `,
];

/**
 * Full-text index over notes.
 *
 * Kept out of MIGRATIONS because FTS5 is a compile-time option and a build
 * without it must degrade to substring search rather than failing to start. See
 * `notes/store.ts`.
 */
export const NOTES_FTS_SETUP = `
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, body, note_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (title, body, note_id) VALUES (new.title, new.body, new.note_id);
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE note_id = old.note_id;
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE note_id = old.note_id;
  INSERT INTO notes_fts (title, body, note_id) VALUES (new.title, new.body, new.note_id);
END;
`;
