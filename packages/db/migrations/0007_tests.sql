-- 0007_tests.sql
--
-- Blueprints, tests, sections, the item set, and the publish freeze.
--
-- The lifecycle is create -> schedule -> publish (freeze) -> run -> close ->
-- score -> publish results -> rescore (FR-TST-01). Publishing a strict-ranked
-- test freezes its composition, and the freeze is a trigger rather than a
-- convention: a paper that changes under a live cohort is unrankable and the
-- damage is not detectable after the fact (FR-TST-02, AC-TST-01).
--
-- Requirements: FR-TST-01..10, FR-PAT-04, FR-PAT-07, FR-PAT-08, FR-ATT-14,
--               FR-AUT-09, NFR-SEC-11, NFR-SCL-04.

begin;

create type public.test_kind as enum (
  'RANKED_MOCK',
  'PRACTICE',
  'PYQ_REPLAY',
  'CUSTOM',
  'DIAGNOSTIC'
);

create type public.test_status as enum (
  'DRAFT',
  'SCHEDULED',
  'PUBLISHED',
  'CLOSED',
  'SCORED',
  'RESULTS_PUBLISHED',
  'ARCHIVED'
);

-- Lowercase deliberately: FR-TST-05 names these values verbatim and the client
-- badge copy quotes them.
create type public.ranking_mode as enum ('strict', 'pooled');

comment on type public.ranking_mode is
  'FR-TST-05. strict: identical item set for every attempt, only presentation order randomised, leaderboard valid. pooled: per-student draw from a larger pool, leaderboard is percentile-within-pool and the client must show a randomised-paper badge. Ideation 5.9 names these separately on purpose -- conflating shuffle_scope with pool_draw destroys rank comparability.';

create type public.ranked_attempt_selection as enum ('FIRST', 'BEST', 'LAST');

/* ------------------------------------------------------------------ *
 * Blueprints (FR-AUT-09)
 * ------------------------------------------------------------------ */

create table public.blueprint (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  exam_pattern_id uuid not null references public.exam_pattern (id) on delete restrict,
  name text not null,
  -- Chapter counts, difficulty histogram, PYQ-year spread, key balance,
  -- variant-family exclusion and recency exclusion. Held as JSON because the
  -- constraint vocabulary grows and each addition must not be a migration.
  constraints jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (org_id, name),
  constraint blueprint_status_known check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED'))
);

comment on table public.blueprint is
  'Assembly constraints for drawing a paper (FR-AUT-09). Variant-family exclusion matters most: two members of a VARIANT_OF family in one paper is the failure the duplicate detector exists to prevent.';

create index blueprint_org_idx on public.blueprint (org_id);

/* ------------------------------------------------------------------ *
 * Test
 * ------------------------------------------------------------------ */

create table public.test (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  exam_pattern_id uuid not null references public.exam_pattern (id) on delete restrict,
  blueprint_id uuid references public.blueprint (id) on delete restrict,
  title text not null,
  kind public.test_kind not null,
  status public.test_status not null default 'DRAFT',
  ranking_mode public.ranking_mode not null default 'strict',

  -- FR-TST-03: exactly one absolute window. Per-timezone windows are prohibited
  -- -- they are the mechanism by which a paper leaks from an earlier zone into
  -- a later one. The client renders IST and local time side by side (FR-TST-04)
  -- from this single pair.
  starts_at timestamptz,
  ends_at timestamptz,
  duration_seconds integer not null check (duration_seconds > 0),

  -- FR-TST-06: after this many seconds into the window, a new attempt is
  -- refused rather than started materially truncated.
  late_join_cutoff_seconds integer,

  -- FR-TST-08: never earlier than window close for a live test. Enforced by the
  -- publish validator, not by an admin remembering.
  solutions_visible_from timestamptz,

  -- FR-TST-07
  max_attempts integer not null default 1 check (max_attempts >= 1),
  ranked_attempt_selection public.ranked_attempt_selection not null default 'FIRST',
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),

  -- FR-TST-09: a mid-window change creates version N+1 and applies only to
  -- attempts started afterwards. Every attempt records the version it ran.
  test_version integer not null default 1 check (test_version > 0),

  -- FR-PAT-07: the scoring configuration in force when the paper was published.
  -- Snapshotted onto every attempt so a later configuration change cannot
  -- silently alter a historical score.
  scoring_config_fingerprint text,

  published_at timestamptz,
  closed_at timestamptz,
  results_published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  published_by uuid references auth.users (id) on delete restrict,

  constraint test_window_ordered check (ends_at is null or starts_at is null or ends_at > starts_at),
  -- NFR-SEC-11: a ranked paper has a fixed live window. An open multi-hour
  -- window for a ranked test is a content leak with a countdown attached.
  constraint test_ranked_needs_window
    check (kind <> 'RANKED_MOCK' or (starts_at is not null and ends_at is not null)),
  constraint test_published_has_publisher
    check (published_at is null or published_by is not null)
);

comment on table public.test is
  'One assessment instance (FR-TST-01). Composition freezes on publish for a strict-ranked test; everything downstream -- attempts, results, leaderboards -- assumes that freeze holds.';
comment on column public.test.late_join_cutoff_seconds is
  'FR-TST-06. Past this offset a new attempt is refused. Inside it, the candidate sees a blocking confirmation stating their actual available time and the attempt is tagged shortened and excluded from the ranked leaderboard (AC-TST-02).';
comment on column public.test.test_version is
  'FR-TST-09. Bumped by trigger when a published pooled paper changes. Strict-ranked papers cannot change at all, so their version stays 1.';

create index test_org_idx on public.test (org_id);
create index test_org_status_idx on public.test (org_id, status);
create index test_window_idx on public.test (org_id, starts_at, ends_at)
  where status in ('PUBLISHED', 'SCHEDULED');
create index test_pattern_idx on public.test (exam_pattern_id);

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

create table public.test_section (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  test_id uuid not null references public.test (id) on delete restrict,
  pattern_section_id uuid references public.pattern_section (id) on delete restrict,
  ordinal integer not null,
  name text not null,
  subject public.subject_code not null,
  question_type public.question_type not null,
  max_marks integer not null,
  question_count integer not null check (question_count > 0),
  required_count integer not null check (required_count > 0),
  -- Null: the section shares the paper clock and the candidate may move freely.
  -- A value time-locks the section, which changes both navigation and prefetch
  -- scope (FR-SYN-11).
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  allows_free_navigation boolean not null default true,
  created_at timestamptz not null default now(),
  unique (test_id, ordinal),
  constraint test_section_required_fits check (required_count <= question_count)
);

comment on table public.test_section is
  'A section of a paper. Time-locked sections gate prefetch: the client may hold exactly the content it may legally navigate to at that moment, never the whole paper (FR-SYN-11).';

create index test_section_org_idx on public.test_section (org_id);
create index test_section_test_idx on public.test_section (test_id, ordinal);

/* ------------------------------------------------------------------ *
 * The item set (FR-PAT-04)
 * ------------------------------------------------------------------ */

create table public.test_question (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  test_id uuid not null references public.test (id) on delete restrict,
  test_section_id uuid not null references public.test_section (id) on delete restrict,
  -- Pins the exact content version. An attempt records the same identity, which
  -- is what makes a paper replayable byte-identically (FR-ITM-01, FR-TST-10).
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  display_order integer not null,
  -- FR-PAT-04: the marking scheme is attached HERE, on the (test_section,
  -- question) join. Not on the item, not in global configuration. One item
  -- cross-tagged into a JEE Main paper and a NEET paper must score differently
  -- in each, and this column is the only reason it can.
  marking_rule_id uuid not null references public.marking_rule (id) on delete restrict,
  max_marks numeric(8, 3) not null,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id) on delete set null,

  unique (test_id, question_version_id),
  unique (test_section_id, display_order)
);

comment on table public.test_question is
  'The frozen item set of a paper. Composition is immutable once a strict-ranked test is published (FR-TST-02); the trigger below raises rather than trusting the console to disable a button.';

create index test_question_org_idx on public.test_question (org_id);
create index test_question_test_idx on public.test_question (test_id, display_order);
create index test_question_section_idx on public.test_question (test_section_id, display_order);
create index test_question_version_idx on public.test_question (question_version_id);
create index test_question_rule_idx on public.test_question (marking_rule_id);

/* ------------------------------------------------------------------ *
 * Assets (FR-ATT-14, NFR-SCL-04)
 * ------------------------------------------------------------------ */

create table public.test_asset (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  test_id uuid not null references public.test (id) on delete restrict,
  -- One URL per object, byte-identical for every student. Per-user signed URLs
  -- for shared immutable assets eliminate CDN caching entirely and turn roughly
  -- 13.5 MB of paper assets into roughly 135 GB of origin egress per test
  -- (NFR-SCL-04). The tell is origin egress scaling with student count rather
  -- than with asset count.
  uri text not null,
  sha256 text not null,
  byte_size integer not null check (byte_size > 0),
  content_type text not null,
  width_px integer,
  created_at timestamptz not null default now(),
  unique (test_id, uri)
);

comment on table public.test_asset is
  'The prefetch manifest returned by attempt start (FR-ATT-14). Hashes and byte sizes let the client show determinate progress and verify what it cached; the timer does not start until prefetch completes.';

create index test_asset_org_idx on public.test_asset (org_id);
create index test_asset_test_idx on public.test_asset (test_id);

/* ------------------------------------------------------------------ *
 * Publish validation (FR-PAT-08)
 * ------------------------------------------------------------------ */

create function public.validate_test_for_publish(p_test_id uuid)
returns table (code text, message text)
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_test public.test;
  v_pattern public.exam_pattern;
  v_section_sum integer;
begin
  select * into v_test from public.test where id = p_test_id;
  if not found then
    return query select 'NO_SUCH_TEST'::text, format('test %s does not exist', p_test_id);
    return;
  end if;

  select * into v_pattern from public.exam_pattern where id = v_test.exam_pattern_id;

  -- A ranked paper may not be scored against a marking scheme nobody has
  -- checked against the examining body's own document. The JEE Advanced
  -- multi-correct negative moved from -2 to -1 between 2025 and 2026 and major
  -- coaching sites still publish the stale value; sourcing a scheme from a
  -- search result is how this platform gets scoring wrong.
  if v_test.kind = 'RANKED_MOCK' and v_pattern.provenance_status <> 'VERIFIED_PRIMARY' then
    return query select 'PATTERN_UNVERIFIED'::text,
      format('pattern %s has provenance %s and cannot back a ranked test',
             v_pattern.external_id, v_pattern.provenance_status);
  end if;

  if v_test.kind = 'RANKED_MOCK' and exists (
    select 1
    from public.test_question tq
    join public.marking_rule mr on mr.id = tq.marking_rule_id
    where tq.test_id = p_test_id and mr.provenance_status <> 'VERIFIED_PRIMARY'
  ) then
    return query select 'MARKING_RULE_UNVERIFIED'::text,
      'at least one marking rule on this paper has unverified provenance';
  end if;

  -- FR-PAT-08: the sum of section max marks must equal the declared total.
  select coalesce(sum(ts.max_marks), 0) into v_section_sum
  from public.test_section ts where ts.test_id = p_test_id;

  if v_section_sum <> v_pattern.total_marks then
    return query select 'MARKS_MISMATCH'::text,
      format('section max marks sum to %s, pattern declares %s', v_section_sum, v_pattern.total_marks);
  end if;

  return query
  select 'SECTION_COUNT_MISMATCH'::text,
         format('section %s declares %s questions but holds %s', ts.name, ts.question_count, cnt.n)
  from public.test_section ts
  join lateral (
    select count(*)::integer as n from public.test_question tq where tq.test_section_id = ts.id
  ) cnt on true
  where ts.test_id = p_test_id and cnt.n <> ts.question_count;

  -- FR-MTH-02 / AC-MTH-02: a paper containing an item that fails strict LaTeX
  -- validation is refused here, not merely in the console.
  return query
  select 'ITEM_NOT_PUBLISHABLE'::text,
         format('question_version %s has status %s and latex_valid %s', qv.id, qv.status, qv.latex_valid)
  from public.test_question tq
  join public.question_version qv on qv.id = tq.question_version_id
  where tq.test_id = p_test_id and (qv.status <> 'PUBLISHED' or not qv.latex_valid);

  -- FR-ITM-06 / FR-ITM-07: uncleared or dark content never reaches a paper.
  return query
  select 'ITEM_NOT_LICENSED'::text,
         format('question %s has provenance %s and licence status %s', q.id, q.provenance, q.licence_status)
  from public.test_question tq
  join public.question_version qv on qv.id = tq.question_version_id
  join public.question q on q.id = qv.question_id
  where tq.test_id = p_test_id
    and (q.provenance = 'THIRD_PARTY_UNCLEARED' or q.licence_status <> 'CLEARED');

  -- Every item needs a key before anyone sits the paper. Reading private here
  -- is why this function is SECURITY DEFINER; it returns the absence of a key,
  -- never the key itself.
  return query
  select 'MISSING_ANSWER_KEY'::text,
         format('question_version %s has no answer key', tq.question_version_id)
  from public.test_question tq
  where tq.test_id = p_test_id
    and not exists (
      select 1 from private.answer_key k where k.question_version_id = tq.question_version_id
    );

  -- FR-AUT-04: per-option rationales are mandatory, and "mandatory" that is not
  -- checked at the publish gate means "usually present".
  return query
  select 'MISSING_OPTION_RATIONALE'::text,
         format('option %s has no rationale', o.id)
  from public.test_question tq
  join public.question_option o on o.question_version_id = tq.question_version_id
  where tq.test_id = p_test_id
    and not exists (select 1 from private.option_rationale r where r.question_option_id = o.id);

  -- FR-ITM-12: accessibility strings must be meaningful. A spoken text of
  -- "image" passes a NOT NULL and fails a blind student.
  return query
  select 'WEAK_ACCESSIBILITY_TEXT'::text,
         format('question_version %s has missing or trivial alt/spoken text', qv.id)
  from public.test_question tq
  join public.question_version qv on qv.id = tq.question_version_id
  where tq.test_id = p_test_id
    and (qv.spoken_text is null or length(btrim(qv.spoken_text)) < 8);

  -- FR-TST-08: for a live test, solutions open no earlier than window close --
  -- for everyone, not per candidate. An early finisher reading solutions while
  -- the window is open is a leak with the platform's name on it.
  if v_test.ends_at is not null
     and (v_test.solutions_visible_from is null or v_test.solutions_visible_from < v_test.ends_at) then
    return query select 'SOLUTIONS_TOO_EARLY'::text,
      'solutions_visible_from must be at or after the window close for a live test';
  end if;

  if v_test.kind = 'RANKED_MOCK' and v_test.ranking_mode <> 'strict' then
    return query select 'RANKED_POOLED'::text,
      'a pooled paper cannot be a strict ranked mock; its leaderboard is percentile-within-pool';
  end if;

  return;
end;
$$;

comment on function public.validate_test_for_publish(uuid) is
  'Publish-time validator (FR-PAT-08, AC-MTH-02). Returns a problem list; the publish trigger refuses on any row. SECURITY DEFINER so it can assert the existence of keys and rationales without exposing either.';

revoke execute on function public.validate_test_for_publish(uuid) from public;
grant execute on function public.validate_test_for_publish(uuid) to authenticated;

create function app.tg_test_publish_gate() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_problems text;
begin
  if new.published_at is null or old.published_at is not null then
    return new;
  end if;

  select string_agg(format('[%s] %s', code, message), E'\n')
    into v_problems
  from public.validate_test_for_publish(new.id);

  if v_problems is not null then
    raise exception 'test % cannot be published (FR-PAT-08):%', new.id, E'\n' || v_problems
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger test_publish_gate
  before update on public.test
  for each row execute function app.tg_test_publish_gate();

/* ------------------------------------------------------------------ *
 * Publish freeze (FR-TST-02, AC-TST-01)
 * ------------------------------------------------------------------ */

create function app.tg_test_composition_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_test_id uuid;
  v_published timestamptz;
  v_mode public.ranking_mode;
begin
  v_test_id := case when tg_op = 'DELETE' then old.test_id else new.test_id end;

  select t.published_at, t.ranking_mode into v_published, v_mode
  from public.test t where t.id = v_test_id;

  if v_published is not null and v_mode = 'strict' then
    raise exception
      'test % is published with ranking_mode=strict; its composition is frozen (FR-TST-02)', v_test_id
      using errcode = '42501',
            hint = 'Create test_version N+1 for a pooled paper, or a new test. A strict-ranked paper that changes under a live cohort is unrankable and the damage is undetectable afterwards.';
  end if;

  -- FR-TST-09: a published pooled paper may change, and every such change is a
  -- new test version. Attempts started before the bump keep running the version
  -- they pinned.
  if v_published is not null and v_mode = 'pooled' then
    update public.test set test_version = test_version + 1 where id = v_test_id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger test_question_frozen
  before insert or update or delete on public.test_question
  for each row execute function app.tg_test_composition_frozen();

create trigger test_section_frozen
  before insert or update or delete on public.test_section
  for each row execute function app.tg_test_composition_frozen();

commit;
