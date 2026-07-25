-- 0009_results.sql
--
-- Results, per-question marks, leaderboards and the rescore trail.
--
-- The governing rule is FR-SCR-12: a rescore writes NEW result rows and never
-- overwrites, then atomically swaps the published pointer and emits a new
-- leaderboard snapshot in one transaction. That is why there is a pointer table
-- and why leaderboard_entry hangs off an immutable snapshot rather than being
-- updated in place. An in-place update destroys the before/after delta that
-- FR-SCR-15 requires the platform to show the student, and it is unbuildable
-- afterwards (D10).
--
-- Requirements: FR-SCR-01..18, FR-ANL-01, FR-ANL-05, FR-ANL-08, FR-RWD-08..10,
--               FR-TEN-05, AC-SCR-01, AC-SCR-03.

begin;

-- Mirrors ResponseStatus in @platform/domain. The engine is the reference
-- implementation and the two vocabularies must not drift.
create type public.response_status as enum (
  'CORRECT',
  'PARTIALLY_CORRECT',
  'INCORRECT',
  'UNATTEMPTED',
  'DROPPED',
  'UNPARSEABLE'
);

create type public.void_policy as enum (
  'FULL_MARKS_TO_ALL',
  'FULL_MARKS_TO_ATTEMPTED',
  'DROP_AND_RESCALE'
);

comment on type public.void_policy is
  'FR-SCR-14. Voiding requires an explicit recorded policy per void. The three have different winners and losers, and choosing silently is how a void becomes a fairness complaint.';

/* ------------------------------------------------------------------ *
 * Attempt results
 * ------------------------------------------------------------------ */

create table public.attempt_result (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  test_id uuid not null references public.test (id) on delete restrict,

  -- FR-SCR-02: scoring is a pure, idempotent function of these two plus the
  -- pinned configuration. Recording all three is what makes a mark reproducible
  -- and a dispute answerable months later (FR-ADM-20).
  answer_key_version integer not null,
  scoring_config_fingerprint text not null,
  revision integer not null default 1 check (revision > 0),

  raw_score numeric(10, 3) not null,
  -- FR-SCR-08: persisted separately from the net score. It cannot be
  -- backfilled -- the information is gone once only the net is stored -- and
  -- JEE Advanced tie-breaking needs it in v2.
  positive_marks numeric(10, 3) not null,
  negative_marks numeric(10, 3) not null,

  -- {PHYSICS: {raw, positive, negative, correct, incorrect, unattempted}, ...}
  by_subject jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,

  -- FR-SCR-07: computed on the TOTAL raw score per cohort, to seven decimal
  -- places. It is never the average of the subject percentiles, which is a
  -- different and wrong number that looks plausible.
  percentile numeric(12, 7),
  subject_percentiles jsonb,
  cohort_size integer,

  rank integer,
  computed_at timestamptz not null default now(),
  superseded_by uuid references public.attempt_result (id) on delete restrict,

  unique (attempt_id, revision)
);

comment on table public.attempt_result is
  'One scoring run over one attempt. Never updated: a rescore inserts revision N+1 and the pointer below swaps (FR-SCR-12). AC-SCR-01 requires a second run to produce zero drift, which only holds because the inputs are all recorded here.';
comment on column public.attempt_result.percentile is
  'Seven decimal places, matching computePercentiles in @platform/domain. Stored as exact numeric, never float: a float percentile ties two students who are not tied.';

create index attempt_result_org_user_idx on public.attempt_result (org_id, user_id);
create index attempt_result_test_idx on public.attempt_result (test_id, raw_score desc);
create index attempt_result_attempt_idx on public.attempt_result (attempt_id, revision desc);

create table public.attempt_result_pointer (
  attempt_id uuid primary key references public.attempt (id) on delete restrict,
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  attempt_result_id uuid not null references public.attempt_result (id) on delete restrict,
  published_at timestamptz not null default now()
);

comment on table public.attempt_result_pointer is
  'The published result for an attempt. A rescore swaps this row inside the same transaction that writes the new results and the new leaderboard snapshot, so a student never observes a half-applied rescore (FR-SCR-12, AC-SCR-03).';

create index attempt_result_pointer_org_user_idx on public.attempt_result_pointer (org_id, user_id);
create index attempt_result_pointer_result_idx on public.attempt_result_pointer (attempt_result_id);

/* ------------------------------------------------------------------ *
 * Per-question marks -- partitioned
 * ------------------------------------------------------------------ */

create table public.attempt_question_result (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  attempt_id uuid not null,
  attempt_result_id uuid not null,
  question_version_id uuid not null,
  answer_key_version integer not null,
  marks numeric(8, 3) not null,
  status public.response_status not null,
  resolution public.key_resolution,
  -- FR-SCR-18: plain language, explaining partial credit where it applies.
  -- Generated by the scorer alongside the mark so the explanation and the mark
  -- cannot disagree.
  explanation text not null,
  computed_at timestamptz not null default now(),
  primary key (id, computed_at)
) partition by range (computed_at);

comment on table public.attempt_question_result is
  'Server-computed per-question marks (FR-SCR-17). The review screen renders these; a score is never computed on a client. Partitioned monthly because this is roughly ninety rows per attempt and grows with the same slope as the response table.';

create index attempt_question_result_attempt_idx
  on public.attempt_question_result (attempt_id, computed_at desc);
create index attempt_question_result_result_idx
  on public.attempt_question_result (attempt_result_id);
create index attempt_question_result_org_user_idx
  on public.attempt_question_result (org_id, user_id);
create index attempt_question_result_item_idx
  on public.attempt_question_result (question_version_id, status);
create index attempt_question_result_brin_idx
  on public.attempt_question_result using brin (computed_at) with (pages_per_range = 32);

/* ------------------------------------------------------------------ *
 * Leaderboards (FR-SCR-10, FR-RWD-08, FR-RWD-09)
 * ------------------------------------------------------------------ */

create table public.leaderboard_opt_in (
  user_id uuid primary key references public.profile (user_id) on delete cascade,
  org_id uuid not null references public.org (id) on delete restrict,
  -- FR-RWD-08: opt-IN. Default false, and the opt-out below is permanent.
  opted_in boolean not null default false,
  opted_in_at timestamptz,
  -- One tap, permanent. Once set, opted_in cannot return to true, so a nudge
  -- campaign cannot walk a student back into a comparison they left.
  permanently_opted_out_at timestamptz,
  constraint leaderboard_opt_out_is_final
    check (permanently_opted_out_at is null or not opted_in)
);

comment on table public.leaderboard_opt_in is
  'FR-RWD-08. Bucketed peer groups of roughly thirty, pseudonymous, opt-in, with a one-tap permanent opt-out. A public all-India rank wall is prohibited (FR-RWD-09) and there is no table here that could hold one.';

create index leaderboard_opt_in_org_idx on public.leaderboard_opt_in (org_id);

create table public.leaderboard_snapshot (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  test_id uuid not null references public.test (id) on delete restrict,
  answer_key_version integer not null,
  score_revision_id uuid,
  -- The chain actually used, copied from the pattern. Published in the UI
  -- (FR-SCR-09) and preserved here so a historical ordering can be explained
  -- even after the pattern is superseded.
  tie_break jsonb not null,
  bucket_size integer not null default 30,
  entry_count integer not null default 0,
  cohort_size integer not null default 0,
  is_current boolean not null default false,
  generated_at timestamptz not null default now()
);

comment on table public.leaderboard_snapshot is
  'Immutable materialised leaderboard (FR-SCR-10). Live rows are never mutated in place; a rescore emits a new snapshot and flips is_current atomically, which is what makes AC-SCR-03 -- a rank that does not change between page loads -- true.';

create unique index leaderboard_snapshot_current_uidx
  on public.leaderboard_snapshot (test_id)
  where is_current;
create index leaderboard_snapshot_org_idx on public.leaderboard_snapshot (org_id);
create index leaderboard_snapshot_test_idx on public.leaderboard_snapshot (test_id, generated_at desc);

create table public.leaderboard_entry (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  snapshot_id uuid not null references public.leaderboard_snapshot (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  -- Bucketed peer group of roughly thirty. Rank is within the bucket, so there
  -- is no all-India position to screenshot.
  bucket_no integer not null,
  rank_in_bucket integer not null,
  pseudonym text not null,
  total_score numeric(10, 3) not null,
  percentile numeric(12, 7),
  unique (snapshot_id, user_id)
);

comment on table public.leaderboard_entry is
  'One row per ranked attempt inside an immutable snapshot. Pseudonymous by construction: the display name is never copied here.';

create index leaderboard_entry_snapshot_bucket_idx
  on public.leaderboard_entry (snapshot_id, bucket_no, rank_in_bucket);
create index leaderboard_entry_org_user_idx on public.leaderboard_entry (org_id, user_id);

create function app.tg_leaderboard_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- FR-SCR-10: entries inside a snapshot are immutable. Correcting a rank means
  -- emitting a new snapshot, never editing this one, because a student who
  -- screenshotted the old one must be able to resolve it (FR-ANL-08).
  raise exception 'leaderboard entries are immutable; emit a new snapshot (FR-SCR-10)'
    using errcode = '42501';
end;
$$;

create trigger leaderboard_entry_immutable
  before update or delete on public.leaderboard_entry
  for each row execute function app.tg_leaderboard_immutable();

/* ------------------------------------------------------------------ *
 * Rescore trail (FR-SCR-11..16)
 * ------------------------------------------------------------------ */

create table public.score_revision (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  test_id uuid not null references public.test (id) on delete restrict,
  question_version_id uuid references public.question_version (id) on delete restrict,
  from_key_version integer,
  to_key_version integer not null,
  resolution public.key_resolution,
  void_policy public.void_policy,
  reason text not null,
  -- The plan produced by planRescore in @platform/domain before execution, so
  -- the change is reviewable before it lands and auditable after.
  plan jsonb not null default '{}'::jsonb,
  affected_attempt_count integer not null default 0,
  -- FR-SCR-16: compensating top-ups only. Clawback is prohibited -- it is a
  -- worse trust event than the original error -- so there is no column here
  -- that could hold a negative adjustment total.
  coin_topup_total integer not null default 0 check (coin_topup_total >= 0),
  requested_by uuid not null references auth.users (id) on delete restrict,
  executed_at timestamptz,
  executed_by uuid references auth.users (id) on delete restrict,
  leaderboard_snapshot_id uuid references public.leaderboard_snapshot (id) on delete restrict,
  -- FR-ADM-08: a public note visible to every challenger.
  public_note text,
  created_at timestamptz not null default now()
);

comment on table public.score_revision is
  'One key revision or void and the rescore it caused (FR-SCR-11..16, D10). Ships pre-launch and not later: it is unbuildable once leaderboards and coin ledgers have been denormalised around the assumption that scores are final.';

create index score_revision_org_idx on public.score_revision (org_id);
create index score_revision_test_idx on public.score_revision (test_id, created_at desc);
create index score_revision_item_idx on public.score_revision (question_version_id);

alter table public.leaderboard_snapshot
  add constraint leaderboard_snapshot_revision_fk
  foreign key (score_revision_id) references public.score_revision (id) on delete restrict;

create table public.score_revision_notice (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  score_revision_id uuid not null references public.score_revision (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  -- FR-SCR-15: an explicit before/after delta and the reason. A rescore that
  -- changes a number without saying so is indistinguishable from a bug.
  score_before numeric(10, 3) not null,
  score_after numeric(10, 3) not null,
  percentile_before numeric(12, 7),
  percentile_after numeric(12, 7),
  reason text not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (score_revision_id, attempt_id)
);

comment on table public.score_revision_notice is
  'Per-student notification payload for a rescore (FR-SCR-15). Transactional: never suppressed by a marketing frequency cap (FR-NOT-04).';

create index score_revision_notice_org_user_idx on public.score_revision_notice (org_id, user_id);
create index score_revision_notice_revision_idx on public.score_revision_notice (score_revision_id);

/* ------------------------------------------------------------------ *
 * Shareable results (FR-ANL-08)
 * ------------------------------------------------------------------ */

create table public.result_share_link (
  token text primary key,
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.result_share_link is
  'A short link that resolves to the CURRENT annotated result, not to the number that existed when it was created (FR-ANL-08, AC-ANL-01). Predicted rank is a regulated representation, and a stale screenshot resolving to a corrected value with an explanation is the control.';

create index result_share_link_org_user_idx on public.result_share_link (org_id, user_id);
create index result_share_link_attempt_idx on public.result_share_link (attempt_id);

commit;
