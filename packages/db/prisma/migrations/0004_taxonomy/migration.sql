-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0004_taxonomy.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0004_taxonomy.sql
--
-- Taxonomy, syllabus versioning, exam patterns and marking rules.
--
-- This migration is where invariant 1 lives: exam mechanics are data, not code.
-- A pattern for a new exam year is an INSERT (FR-PAT-02). Nothing in the
-- scoring path may branch on exam or year -- if it does, the shape below is
-- wrong and that is the defect to fix.
--
-- The marking-rule JSON is deliberately byte-compatible with the `MarkingRule`
-- discriminated union in @platform/domain, camelCase keys included. The engine
-- is the reference implementation; a translation layer between the two is a
-- place for the two to disagree.
--
-- Requirements: FR-TAX-01..06, FR-PAT-01..09, FR-SCR-09.


/* ------------------------------------------------------------------ *
 * Enumerations mirroring @platform/domain
 * ------------------------------------------------------------------ */

create type public.question_type as enum (
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'NUMERIC_INTEGER',
  'NUMERIC_DECIMAL',
  'MATCHING_LIST',
  'ASSERTION_REASON'
);

create type public.subject_code as enum (
  'PHYSICS',
  'CHEMISTRY',
  'MATHEMATICS',
  'BOTANY',
  'ZOOLOGY'
);

create type public.pattern_provenance_status as enum ('VERIFIED_PRIMARY', 'UNVERIFIED');

create type public.exam_calendar_kind as enum (
  'SESSION',
  'SHIFT',
  'CANCELLATION',
  'RE_EXAM',
  'RESULT',
  'COUNSELLING'
);

/* ------------------------------------------------------------------ *
 * Exams
 * ------------------------------------------------------------------ */

create table public.exam (
  code text primary key,
  display_name text not null,
  conducting_body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.exam is
  'Exam registry. Not org-scoped: the catalogue is shared and read by every tenant. Adding BITSAT or a state CET is a row, not a release.';

insert into public.exam (code, display_name, conducting_body) values
  ('JEE_MAIN',     'JEE (Main)',     'National Testing Agency'),
  ('JEE_ADVANCED', 'JEE (Advanced)', 'IIT (rotating zonal organiser)'),
  ('NEET',         'NEET (UG)',      'National Testing Agency');

/* ------------------------------------------------------------------ *
 * Concept tree (FR-TAX-01, FR-TAX-03)
 *
 * The tree is per exam family, not shared: JEE and NEET have overlapping but
 * genuinely different chapter structures, and forcing one tree produces a
 * taxonomy that is wrong for both. Cross-tagging an item into both trees is
 * FR-TAX-02 and is handled on the item, not here.
 * ------------------------------------------------------------------ */

create table public.chapter (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  exam_code text not null references public.exam (code) on delete restrict,
  subject public.subject_code not null,
  code text not null,
  name text not null,
  ordinal integer not null,
  ncert_class smallint,
  created_at timestamptz not null default now(),
  unique (org_id, exam_code, code)
);

comment on table public.chapter is
  'Level 2 of Subject to Chapter to Topic to Sub-topic (FR-TAX-01). Org-scoped so an institute can maintain its own tree; the platform org owns the canonical one.';

create index chapter_org_idx on public.chapter (org_id);
create index chapter_exam_idx on public.chapter (org_id, exam_code, subject, ordinal);

create table public.topic (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  chapter_id uuid not null references public.chapter (id) on delete restrict,
  code text not null,
  name text not null,
  ordinal integer not null,
  created_at timestamptz not null default now(),
  unique (chapter_id, code)
);

comment on table public.topic is
  'Second taxonomy level, under chapter. Org-scoped so a tenant may extend the shared platform taxonomy without forking it; the read policy unions the caller org with the platform org.';

create index topic_org_idx on public.topic (org_id);
create index topic_chapter_idx on public.topic (chapter_id, ordinal);

create table public.sub_topic (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  topic_id uuid not null references public.topic (id) on delete restrict,
  code text not null,
  name text not null,
  ordinal integer not null,
  created_at timestamptz not null default now(),
  unique (topic_id, code)
);

comment on table public.sub_topic is
  'The SRS card key (FR-TAX-01, FR-SRS-01). Cards attach to the concept, never to a question, which is what makes item corrections non-destructive to a student review history (FR-SRS-04).';

create index sub_topic_org_idx on public.sub_topic (org_id);
create index sub_topic_topic_idx on public.sub_topic (topic_id, ordinal);

/* ------------------------------------------------------------------ *
 * Syllabus versioning (FR-TAX-04)
 *
 * A syllabus is a membership set over the stable concept tree, keyed by
 * (exam, year). A chapter dropped in 2027 is simply absent from the 2027
 * syllabus: items tagged to it keep scoring in a PYQ replay, and a 2027
 * blueprint draw cannot reach them. Versioning the tree itself instead would
 * fragment every student SRS card across years.
 * ------------------------------------------------------------------ */

create table public.syllabus (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  exam_code text not null references public.exam (code) on delete restrict,
  year integer not null,
  status text not null default 'DRAFT',
  source_ref text,
  effective_from date,
  created_at timestamptz not null default now(),
  unique (org_id, exam_code, year),
  constraint syllabus_status_known check (status in ('DRAFT', 'ACTIVE', 'SUPERSEDED'))
);

comment on table public.syllabus is
  'Versioned syllabus keyed by (exam, year) (FR-TAX-04). Membership lives in syllabus_chapter so the concept tree stays stable across years.';

create index syllabus_org_idx on public.syllabus (org_id);

create table public.syllabus_chapter (
  syllabus_id uuid not null references public.syllabus (id) on delete cascade,
  chapter_id uuid not null references public.chapter (id) on delete restrict,
  org_id uuid not null references public.org (id) on delete restrict,
  -- Blueprint weighting hint, expressed as a share of the paper.
  weight numeric(6, 4),
  primary key (syllabus_id, chapter_id)
);

comment on table public.syllabus_chapter is
  'Chapters in scope for one syllabus year, with the blueprint weighting hint. Carries its own org_id rather than reaching through syllabus_id, so the tenancy predicate stays a column comparison and never becomes a join inside a policy.';

create index syllabus_chapter_org_idx on public.syllabus_chapter (org_id);
create index syllabus_chapter_chapter_idx on public.syllabus_chapter (chapter_id);

/* ------------------------------------------------------------------ *
 * Marking rules (FR-PAT-01, FR-PAT-03, FR-PAT-04)
 * ------------------------------------------------------------------ */

create function app.is_valid_marking_rule(p_rule jsonb) returns boolean
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_type text;
  v_partial jsonb;
  v_numeric jsonb;
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    return false;
  end if;

  v_type := p_rule ->> 'questionType';
  if v_type is null then
    return false;
  end if;

  -- FR-PAT-03: full marks, negative marks and zero-on-unanswered are mandatory
  -- on every rule regardless of type. A missing value is not "zero" -- it is an
  -- unfinished rule, and an unfinished rule silently mis-scores a whole cohort.
  if jsonb_typeof(p_rule -> 'correct') <> 'number'
     or jsonb_typeof(p_rule -> 'incorrect') <> 'number'
     or jsonb_typeof(p_rule -> 'unattempted') <> 'number' then
    return false;
  end if;

  if v_type = 'MCQ_MULTI' then
    v_partial := p_rule -> 'partial';
    -- FR-PAT-08: a multi-correct rule with no explicit partial policy is
    -- refused. Defaulting to all-or-nothing under-scores every candidate on a
    -- partial-credit paper and nobody notices until the challenge queue fills.
    if v_partial is null or jsonb_typeof(v_partial) <> 'object' then
      return false;
    end if;
    if (v_partial ->> 'mode') = 'ALL_OR_NOTHING' then
      return true;
    end if;
    if (v_partial ->> 'mode') <> 'LADDER_BY_CORRECT_SELECTED' then
      return false;
    end if;
    -- The real JEE Advanced scheme is a fixed ladder keyed on the number of
    -- correct options selected, not the proportional formula 4*correct/total
    -- that circulates widely and has never been the published scheme. Storing
    -- it as a lookup table is what makes it data rather than a formula in code.
    if jsonb_typeof(v_partial -> 'awardIfAllCorrectSelected') <> 'number'
       or jsonb_typeof(v_partial -> 'awardBySelectedCorrectCount') <> 'object'
       or jsonb_typeof(v_partial -> 'penaltyIfAnyIncorrect') <> 'number' then
      return false;
    end if;
    return true;
  end if;

  if v_type in ('NUMERIC_INTEGER', 'NUMERIC_DECIMAL') then
    v_numeric := p_rule -> 'numeric';
    if v_numeric is null or jsonb_typeof(v_numeric) <> 'object' then
      return false;
    end if;
    if jsonb_typeof(p_rule -> 'penaliseUnparseable') <> 'boolean' then
      return false;
    end if;
    -- FR-SCR-06: tolerance is data per question. String equality is prohibited,
    -- so a numeric rule without a comparison specification cannot be stored.
    case v_numeric ->> 'kind'
      when 'EXACT_INTEGER' then return true;
      when 'TOLERANCE' then return jsonb_typeof(v_numeric -> 'toleranceAbs') = 'string';
      when 'ROUNDED' then return jsonb_typeof(v_numeric -> 'decimals') = 'number'
                                 and (v_numeric ->> 'mode') in ('HALF_UP', 'TRUNCATE');
      else return false;
    end case;
  end if;

  return v_type in ('MCQ_SINGLE', 'MATCHING_LIST', 'ASSERTION_REASON');
end;
$$;

comment on function app.is_valid_marking_rule(jsonb) is
  'Structural gate on the marking-rule JSON, mirroring the MarkingRule union in @platform/domain. IMMUTABLE so it can back a CHECK constraint: a malformed rule must be unstorable, not merely unshippable (FR-PAT-08).';

grant execute on function app.is_valid_marking_rule(jsonb) to authenticated;

create table public.marking_rule (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  label text not null,
  question_type public.question_type not null,
  rule jsonb not null,
  -- Provenance is on the rule, not on a wiki page. A marking scheme sourced
  -- from a coaching site is the documented way this platform gets scoring wrong.
  source_url text,
  source_label text,
  retrieved_on date,
  provenance_status public.pattern_provenance_status not null default 'UNVERIFIED',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint marking_rule_shape check (app.is_valid_marking_rule(rule)),
  constraint marking_rule_type_agrees check ((rule ->> 'questionType') = question_type::text),
  constraint marking_rule_verified_has_source
    check (provenance_status <> 'VERIFIED_PRIMARY'
           or (source_url is not null and retrieved_on is not null))
);

comment on table public.marking_rule is
  'A reusable marking scheme (FR-PAT-01). Attached to the (test_section, question) join, never to the item and never to global configuration, so one item cross-tagged into a JEE Main paper and a NEET paper scores differently in each (FR-PAT-04).';
comment on column public.marking_rule.provenance_status is
  'UNVERIFIED rules may back practice. A ranked test refuses to publish against one (FR-PAT-06 verification note). The JEE Advanced multi-correct negative moved from -2 to -1 between 2025 and 2026 and major secondary sources still publish the stale value.';

create index marking_rule_org_idx on public.marking_rule (org_id);
create index marking_rule_type_idx on public.marking_rule (org_id, question_type);

/* ------------------------------------------------------------------ *
 * Exam patterns (FR-PAT-01, FR-PAT-02)
 * ------------------------------------------------------------------ */

create function app.is_valid_tie_break_chain(p_chain jsonb) returns boolean
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_len integer;
begin
  if p_chain is null or jsonb_typeof(p_chain) <> 'array' then
    return false;
  end if;
  v_len := jsonb_array_length(p_chain);
  if v_len = 0 then
    return false;
  end if;
  -- FR-SCR-09: the chain must terminate in a stable identifier. Without it,
  -- tied candidates order arbitrarily and a student rank flickers between page
  -- loads with no error attached -- a credibility hit that looks like a bug in
  -- the scoring rather than in the ordering.
  return (p_chain -> (v_len - 1) ->> 'kind') = 'STABLE_ID';
end;
$$;

grant execute on function app.is_valid_tie_break_chain(jsonb) to authenticated;

create table public.exam_pattern (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  -- Human-stable identifier matching the registry in @platform/domain, e.g.
  -- 'JEE-MAIN-2026-P1'. Golden fixtures join on this.
  external_id text not null,
  exam_code text not null references public.exam (code) on delete restrict,
  year integer not null,
  paper text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  total_marks integer not null,
  tie_break jsonb not null,
  source_url text,
  source_label text,
  retrieved_on date,
  provenance_status public.pattern_provenance_status not null default 'UNVERIFIED',
  provenance_notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  retired_at timestamptz,

  unique (org_id, external_id),
  constraint exam_pattern_tie_break_terminates check (app.is_valid_tie_break_chain(tie_break)),
  constraint exam_pattern_verified_has_source
    check (provenance_status <> 'VERIFIED_PRIMARY'
           or (source_url is not null and retrieved_on is not null))
);

comment on table public.exam_pattern is
  'A versioned description of an exam structure, keyed by (exam, year, paper) (FR-PAT-01). A pattern change for a future year is an INSERT with no application release (FR-PAT-02).';
comment on column public.exam_pattern.tie_break is
  'Ordered tie-break chain, shape-compatible with TieBreakChain in @platform/domain. Constrained to terminate in STABLE_ID (FR-SCR-09).';

create index exam_pattern_org_idx on public.exam_pattern (org_id);
create index exam_pattern_exam_idx on public.exam_pattern (org_id, exam_code, year) where retired_at is null;

create table public.pattern_section (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  exam_pattern_id uuid not null references public.exam_pattern (id) on delete cascade,
  ordinal integer not null,
  name text not null,
  subject public.subject_code not null,
  question_type public.question_type not null,
  question_count integer not null check (question_count > 0),
  -- Equal to question_count unless the pattern offers internal choice, which
  -- JEE Main Section B has used. Modelled explicitly so "attempt any 5 of 10"
  -- is data rather than a special case in the scorer.
  required_count integer not null check (required_count > 0),
  max_marks integer not null,
  marking_rule_id uuid not null references public.marking_rule (id) on delete restrict,
  -- Null means the section shares the paper clock. A value time-locks it.
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),

  unique (exam_pattern_id, ordinal),
  constraint pattern_section_required_fits check (required_count <= question_count)
);

comment on table public.pattern_section is
  'One section of a pattern (FR-PAT-01). max_marks must equal required_count * rule.correct; the publish validator asserts it rather than trusting the author (FR-PAT-08).';

create index pattern_section_org_idx on public.pattern_section (org_id);
create index pattern_section_pattern_idx on public.pattern_section (exam_pattern_id, ordinal);
create index pattern_section_rule_idx on public.pattern_section (marking_rule_id);

/* ------------------------------------------------------------------ *
 * Exam calendar (FR-PAT-09, FR-RWD-13)
 * ------------------------------------------------------------------ */

create table public.exam_calendar_event (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  exam_code text not null references public.exam (code) on delete restrict,
  kind public.exam_calendar_kind not null,
  label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Generated so the exclusion constraint and the suppression lookups both use
  -- the same range rather than two hand-written comparisons that can drift.
  window_range tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  shift_label text,
  is_cancelled boolean not null default false,
  notes text,
  source_ref text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint exam_calendar_window check (ends_at > starts_at),
  -- Two live shifts of the same exam cannot overlap. A cancelled row is exempt,
  -- because a re-exam legitimately reuses the slot of the sitting it replaces.
  constraint exam_calendar_no_overlap
    exclude using gist (org_id with =, exam_code with =, shift_label with =, window_range with &&)
    where (kind in ('SESSION', 'SHIFT') and not is_cancelled)
);

comment on table public.exam_calendar_event is
  'Admin-editable exam calendar (FR-PAT-09). Drives three things that are not optional: the automatic deploy freeze (FR-ATT-20), suppression of streaks, relegation and re-engagement pushes around a real exam (FR-RWD-13), and the compensation record for a cancellation or re-exam.';

create index exam_calendar_org_idx on public.exam_calendar_event (org_id);
create index exam_calendar_window_idx on public.exam_calendar_event using gist (window_range);
create index exam_calendar_exam_idx on public.exam_calendar_event (org_id, exam_code, starts_at);
