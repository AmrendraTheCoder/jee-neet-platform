-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0010_learning.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0010_learning.sql
--
-- Spaced repetition, the seen ledger, notes, bookmarks and mistake tagging.
--
-- The load-bearing decision is FR-SRS-01: a card is keyed on
-- (user_id, sub_topic_id), never on a question. Scheduling attaches to the
-- concept, so correcting a typo in a published item leaves every student's
-- review history untouched (FR-SRS-04, AC-SRS-01). Keying on the question is
-- the obvious design and it makes content corrections destructive.
--
-- Requirements: FR-SRS-01..09, FR-NTS-01..05, FR-ANL-03, FR-PRC-02.


create type public.srs_state as enum ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');

create type public.srs_grade as enum ('AGAIN', 'HARD', 'GOOD', 'EASY');

create type public.mistake_kind as enum (
  'CONCEPTUAL',
  'CALCULATION',
  'MISREAD',
  'SILLY',
  'GUESSED_RIGHT',
  'UNATTEMPTED'
);

comment on type public.mistake_kind is
  'FR-ANL-03. Student self-tagging on review. GUESSED_RIGHT is the valuable one: it is the only way to distinguish knowledge from luck, and it feeds the correct-but-guessed practice filter (FR-PRC-02).';

/* ------------------------------------------------------------------ *
 * Cards (FR-SRS-01)
 * ------------------------------------------------------------------ */

create table public.srs_card (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  sub_topic_id uuid not null references public.sub_topic (id) on delete restrict,
  state public.srs_state not null default 'NEW',
  -- Scheduler parameters held as plain columns rather than an opaque blob, so a
  -- retraining pass can read them in SQL and a support engineer can explain a
  -- due date without deserialising anything.
  stability numeric(10, 4),
  difficulty numeric(10, 4),
  desired_retention numeric(4, 3) not null default 0.900,
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  -- FR-SRS-02: where the card came from. A card created from a marked-for-review
  -- question is a different pedagogical signal from one created from a wrong
  -- answer, and the distinction is lost if it is not recorded at creation.
  origin text not null default 'WRONG_ANSWER',
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sub_topic_id)
);

comment on table public.srs_card is
  'One review card per (student, sub-topic) (FR-SRS-01). Never per question: a card keyed on a question dies when the question is corrected, and correcting questions is a thing this platform does deliberately and often.';

create index srs_card_due_idx on public.srs_card (org_id, user_id, due_at)
  where suspended_at is null;
create index srs_card_org_user_idx on public.srs_card (org_id, user_id);
create index srs_card_sub_topic_idx on public.srs_card (sub_topic_id);

create trigger srs_card_touch before update on public.srs_card
  for each row execute function app.tg_touch_updated_at();

/* ------------------------------------------------------------------ *
 * Review log -- partitioned (FR-SRS-05)
 * ------------------------------------------------------------------ */

create table public.srs_review_log (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  srs_card_id uuid not null,
  sub_topic_id uuid not null,
  question_version_id uuid,
  grade public.srs_grade not null,
  state_before public.srs_state not null,
  state_after public.srs_state not null,
  stability_before numeric(10, 4),
  stability_after numeric(10, 4),
  scheduled_days numeric(10, 4),
  elapsed_days numeric(10, 4),
  -- Recorded, deliberately NOT used to derive the grade (FR-SRS-06). A student
  -- working on paper for four minutes produces a spurious fast answer; grading
  -- on it penalises exactly the students doing the work properly.
  duration_ms integer,
  reviewed_at timestamptz not null default now(),
  primary key (id, reviewed_at)
) partition by range (reviewed_at);

comment on table public.srs_review_log is
  'The retraining corpus for scheduler parameters (FR-SRS-05). Append-only and partitioned monthly; it is the only record from which a scheduler change can be evaluated against real behaviour rather than a simulation.';

create index srs_review_log_card_idx on public.srs_review_log (srs_card_id, reviewed_at desc);
create index srs_review_log_org_user_idx on public.srs_review_log (org_id, user_id);
create index srs_review_log_brin_idx
  on public.srs_review_log using brin (reviewed_at) with (pages_per_range = 32);

create trigger srs_review_log_append_only
  before update or delete on public.srs_review_log
  for each row execute function app.tg_append_only();

/* ------------------------------------------------------------------ *
 * Seen ledger (FR-SRS-03, AC-SRS-02)
 * ------------------------------------------------------------------ */

create table public.seen_ledger (
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  -- Keyed on the item identity, not the version. A student who has seen v1 has
  -- seen the question; serving them v2 of the same item as "fresh" is the bug
  -- this table exists to prevent.
  question_id uuid not null references public.question (id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1 check (seen_count > 0),
  -- 'SRS', 'PRACTICE', 'MOCK'. A question met in a mock is still seen.
  last_context text not null default 'PRACTICE',
  primary key (user_id, question_id)
);

comment on table public.seen_ledger is
  'Per-student record of which items have been served (FR-SRS-03). AC-SRS-02: a student never receives the same item twice through the scheduler while unseen items remain in that sub-topic.';

create index seen_ledger_org_user_idx on public.seen_ledger (org_id, user_id);
create index seen_ledger_question_idx on public.seen_ledger (question_id);

/* ------------------------------------------------------------------ *
 * Notes and bookmarks (FR-NTS-01..05)
 * ------------------------------------------------------------------ */

create table public.note (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  title text,
  body_md text not null default '',
  body_latex text,
  plain_text text not null default '',
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || plain_text)) stored,
  -- Backlinks to the source. A note written during an attempt records the
  -- attempt; the note editor still fetches only the stem (FR-NTS-04).
  question_id uuid references public.question (id) on delete restrict,
  attempt_id uuid references public.attempt (id) on delete restrict,
  sub_topic_id uuid references public.sub_topic (id) on delete restrict,
  -- FR-NTS-05: optimistic concurrency. A concurrent edit produces a recorded
  -- conflict row, never a silently lost write.
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.note is
  'The persistent notebook (FR-NTS-02). The simple text-search configuration is deliberate: no stemmer helps with LaTeX, and Postgres ships no Devanagari stemmer, so pretending otherwise would produce confidently wrong recall. Formula search needs a normalised symbolic index and is Phase 2.';
comment on column public.note.revision is
  'Optimistic concurrency token (FR-NTS-05). A write carrying a stale revision writes a note_conflict row instead of overwriting.';

create index note_org_user_idx on public.note (org_id, user_id) where deleted_at is null;
create index note_search_idx on public.note using gin (search_vector);
create index note_question_idx on public.note (question_id) where question_id is not null;
create index note_attempt_idx on public.note (attempt_id) where attempt_id is not null;

create trigger note_touch before update on public.note
  for each row execute function app.tg_touch_updated_at();

create table public.note_conflict (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  note_id uuid not null references public.note (id) on delete restrict,
  base_revision integer not null,
  incoming_body_md text not null,
  device_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.note_conflict is
  'FR-NTS-05. The losing side of a concurrent edit, kept so the student can recover their text. Student-authored text is never silently discarded.';

create index note_conflict_org_user_idx on public.note_conflict (org_id, user_id);
create index note_conflict_note_idx on public.note_conflict (note_id) where resolved_at is null;

create table public.bookmark (
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  question_id uuid not null references public.question (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

comment on table public.bookmark is
  'Revisit this exact question (FR-NTS-01, FR-SRS-09). Deliberately separate from the scheduler: "show me this again" and "schedule this concept" are different requests and merging them corrupts both.';

create index bookmark_org_user_idx on public.bookmark (org_id, user_id);
create index bookmark_question_idx on public.bookmark (question_id);

/* ------------------------------------------------------------------ *
 * Mistake tagging (FR-ANL-03)
 * ------------------------------------------------------------------ */

create table public.mistake_tag (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  kind public.mistake_kind not null,
  note text,
  created_at timestamptz not null default now(),
  unique (attempt_id, question_version_id)
);

comment on table public.mistake_tag is
  'The student own classification of why they lost a mark -- conceptual, calculation, misread, time. Self-reported on purpose: an inferred cause would be behavioural profiling of a minor, and the error-type analytics are only as honest as the person entering them.';

create index mistake_tag_org_user_idx on public.mistake_tag (org_id, user_id);
create index mistake_tag_attempt_idx on public.mistake_tag (attempt_id);
