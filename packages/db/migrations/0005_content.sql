-- 0005_content.sql
--
-- The item bank: stable identity, immutable content versions, options with
-- UUID identity, shared stems and translations.
--
-- Invariant 2 lives here. Nothing a student has seen is edited in place. A
-- content edit forks a version (FR-ITM-02); retirement is a status, never a
-- delete (FR-ITM-04). Attempts pin the version they served, which is what
-- makes a paper replayable byte-identically months later.
--
-- Note what is absent from every table below: there is no `is_correct` column
-- on an option, no solution text, no rationale and no video URL. Those live in
-- the private schema (0006). RLS controls rows and never columns, so a
-- correctness flag on an otherwise-readable option row is one `?select=` away
-- from dumping the key for the entire bank (NFR-SEC-02, FR-SOL-05).
--
-- Requirements: FR-ITM-01..13, FR-AUT-03..05, FR-MTH-01..09, FR-TAX-02, FR-TAX-05, FR-TAX-06.

begin;

/* ------------------------------------------------------------------ *
 * Enumerations
 * ------------------------------------------------------------------ */

create type public.content_provenance as enum (
  'ORIGINAL',
  'PYQ_NTA',
  'LICENSED',
  'THIRD_PARTY_UNCLEARED'
);

create type public.licence_status as enum (
  'CLEARED',
  'PENDING_REVIEW',
  'RESTRICTED',
  'DARK'
);

create type public.question_status as enum (
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'FLAGGED',
  'RETIRED'
);

create type public.stimulus_kind as enum (
  'PARAGRAPH',
  'MATCHING_LIST',
  'DIAGRAM',
  'DATA_TABLE'
);

create type public.question_relation_kind as enum (
  'VARIANT_OF',
  'DUPLICATE_OF',
  'FOLLOW_UP',
  'SUPERSEDES'
);

/* ------------------------------------------------------------------ *
 * Content sources
 * ------------------------------------------------------------------ */

create table public.content_source (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  name text not null,
  kind public.content_provenance not null,
  url text,
  -- Pointer into private.licence_evidence. The evidence itself -- the signed
  -- agreement, the licensor contact -- is not client-readable.
  agreement_ref text,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

comment on table public.content_source is
  'Registry of where items came from (FR-ITM-06). The licence evidence backing a LICENSED source lives in private.licence_evidence with zero grants (NFR-SEC-02).';

create index content_source_org_idx on public.content_source (org_id);

/* ------------------------------------------------------------------ *
 * Shared stimuli (FR-ITM-08)
 * ------------------------------------------------------------------ */

create table public.question_stimulus (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  kind public.stimulus_kind not null,
  body_latex text,
  body_html text not null,
  body_mathml text,
  plain_text text not null,
  alt_text text,
  spoken_text text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

comment on table public.question_stimulus is
  'A comprehension paragraph or matching list referenced by several child items (FR-ITM-08). Referenced, never duplicated: a duplicated stem drifts between copies and the drift is invisible until a student reads two versions of the same paragraph in one paper.';

create index question_stimulus_org_idx on public.question_stimulus (org_id);

/* ------------------------------------------------------------------ *
 * Item identity (FR-ITM-01)
 * ------------------------------------------------------------------ */

create table public.question (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  -- Short human reference used in admin and in error reports.
  public_ref text not null,
  provenance public.content_provenance not null,
  source_ref text not null,
  content_source_id uuid references public.content_source (id) on delete restrict,
  -- FR-ITM-07: a serving filter, so an entire provenance class can be dark
  -- launched with one flag change rather than a data migration.
  licence_status public.licence_status not null default 'PENDING_REVIEW',
  -- Denormalised pointer to the version currently served. Maintained by
  -- trigger on publish; never the authority for what an attempt served, which
  -- is pinned on the attempt itself.
  current_version_id uuid,
  retired_at timestamptz,
  retire_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  unique (org_id, public_ref),
  -- FR-ITM-06: uncleared third-party content is not publishable. The state is
  -- expressible so an editor can record it honestly; serving it is not.
  constraint question_uncleared_is_dark
    check (provenance <> 'THIRD_PARTY_UNCLEARED' or licence_status in ('PENDING_REVIEW', 'DARK', 'RESTRICTED'))
);

comment on table public.question is
  'Stable item identity (FR-ITM-01). Content lives in question_version. This row survives every edit and every retirement because attempts reference it forever.';
comment on column public.question.licence_status is
  'Serving filter (FR-ITM-07). Blocking dependency B1 -- written permission to reproduce previous-year questions commercially -- is why this is a column and not an assumption.';

create index question_org_idx on public.question (org_id);
create index question_serving_idx on public.question (org_id, licence_status) where retired_at is null;
create index question_source_idx on public.question (content_source_id);

/* ------------------------------------------------------------------ *
 * Item content versions (FR-ITM-02)
 * ------------------------------------------------------------------ */

create table public.question_version (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_id uuid not null references public.question (id) on delete restrict,
  version_no integer not null check (version_no > 0),
  supersedes_version_id uuid references public.question_version (id) on delete restrict,

  question_type public.question_type not null,
  stimulus_id uuid references public.question_stimulus (id) on delete restrict,

  -- FR-MTH-01: rendered once on write, never per view at runtime. The LaTeX
  -- source is kept because it is the editable truth; the rendered forms are
  -- what the clients read.
  body_latex text not null,
  body_html text not null,
  body_mathml text,
  plain_text text not null,

  -- FR-ITM-12: mandatory, and "image" is not a meaningful spoken text. The
  -- publish gate checks length, not merely presence.
  alt_text text,
  spoken_text text,

  -- FR-ITM-10: authored, defaulting off. FR-ITM-11 hard-codes the non-shufflable
  -- types; the CHECK makes the linter unable to be overridden by a bad UI.
  shuffle_options boolean not null default false,

  -- FR-SCR-06: the comparison specification for a numeric item, shape-
  -- compatible with NumericSpec in @platform/domain. Null for non-numeric types.
  numeric_spec jsonb,

  -- FR-TAX-05: two separate columns on purpose. The delta between what the
  -- author believed and what the cohort produced is the author-calibration
  -- signal, and it is destroyed the moment they share a column.
  authored_difficulty smallint check (authored_difficulty between 1 and 5),
  empirical_difficulty_p numeric(5, 4) check (empirical_difficulty_p between 0 and 1),
  empirical_sample_size integer not null default 0,

  sub_topic_id uuid references public.sub_topic (id) on delete restrict,

  -- FR-MTH-02: a hard publish gate. The failure detail is stored so an author
  -- can fix it rather than guess.
  latex_validation jsonb,
  latex_valid boolean not null default false,

  status public.question_status not null default 'DRAFT',

  -- AC-SEC-01: a student token scripting the API directly must not be able to
  -- enumerate the items of a paper whose window has not closed. An item drawn
  -- into a ranked mock is embargoed from the practice bank until that test
  -- ends; the policy predicate is this column on the row itself, so no join and
  -- no per-row subquery is needed. Set by trigger in 0007, never by hand.
  embargoed_until timestamptz,

  created_by uuid not null references auth.users (id) on delete restrict,
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  published_at timestamptz,
  flagged_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (question_id, version_no),

  -- FR-AUT-03 / AC-AUT-01: a single admin cannot author and publish the same
  -- item. Enforced as a database constraint precisely because application logic
  -- is the layer that gets bypassed by a bulk import or a repair script.
  -- Written as "null or different" rather than IS DISTINCT FROM, which would
  -- reject an unapproved draft where both columns are null.
  constraint question_version_second_approver
    check (approved_by is null or approved_by <> created_by),
  constraint question_version_approved_has_approver
    check (status not in ('APPROVED', 'PUBLISHED') or approved_by is not null),
  constraint question_version_published_is_valid
    check (status <> 'PUBLISHED' or latex_valid),
  constraint question_version_published_has_timestamp
    check ((status = 'PUBLISHED') = (published_at is not null)
           or status in ('FLAGGED', 'RETIRED')),
  -- FR-ITM-11: matching, assertion-reason and comprehension items are never
  -- shufflable. Shuffling a matching list changes the question.
  constraint question_version_shuffle_safe_type
    check (not shuffle_options or question_type in ('MCQ_SINGLE', 'MCQ_MULTI')),
  constraint question_version_numeric_spec_presence
    check ((question_type in ('NUMERIC_INTEGER', 'NUMERIC_DECIMAL')) = (numeric_spec is not null))
);

comment on table public.question_version is
  'Immutable item content (FR-ITM-01, FR-ITM-02). Once published, a content edit forks version N+1 and resets item statistics; a metadata-only edit updates in place. The immutability trigger below is the enforcement, not the review process.';
comment on column public.question_version.shuffle_options is
  'FR-ITM-10, default off. Shuffling breaks "all of the above" semantically even though the key stays correct, because the key is an option UUID. The authoring linter is the control; scoring cannot detect it.';
comment on column public.question_version.empirical_difficulty_p is
  'Observed proportion correct. Reset when content forks, because statistics from the old wording do not describe the new one (FR-ITM-02).';

create index question_version_org_idx on public.question_version (org_id);
create index question_version_question_idx on public.question_version (question_id, version_no desc);
create index question_version_sub_topic_idx on public.question_version (org_id, sub_topic_id)
  where status = 'PUBLISHED';
create index question_version_published_idx on public.question_version (org_id, status)
  where status = 'PUBLISHED';
-- Indexed because the serving policy tests it on every practice read.
create index question_version_embargo_idx on public.question_version (embargoed_until)
  where embargoed_until is not null;
create index question_version_stimulus_idx on public.question_version (stimulus_id)
  where stimulus_id is not null;
create index question_version_plain_text_trgm_idx
  on public.question_version using gin (plain_text extensions.gin_trgm_ops);

alter table public.question
  add constraint question_current_version_fk
  foreign key (current_version_id) references public.question_version (id) on delete restrict;

create trigger question_version_touch before update on public.question_version
  for each row execute function app.tg_touch_updated_at();

/* ------------------------------------------------------------------ *
 * Options (FR-ITM-03)
 * ------------------------------------------------------------------ */

create table public.question_option (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  -- Authored order only. It is a display hint, never an identity: answers are
  -- {question_version_id, option_id} and never a position or a letter
  -- (FR-ITM-03, FR-ATT-12, invariant 6).
  ordinal integer not null,
  body_latex text,
  body_html text not null,
  plain_text text not null,
  alt_text text,
  -- FR-ITM-10: options that must move together (a paired numeric range), and
  -- options pinned to the end ("none of these") that a shuffle must not lift.
  option_group text,
  pinned_position integer,
  created_at timestamptz not null default now(),

  unique (question_version_id, ordinal)
);

comment on table public.question_option is
  'One option, with stable UUID identity (FR-ITM-03). Correctness is deliberately not a column here: it lives in private.answer_key. A boolean is_correct on a client-readable row is the whole answer key, one query away.';
comment on column public.question_option.pinned_position is
  'A 1-based position an option must keep under shuffle, for options whose meaning depends on being last (FR-ITM-10).';

create index question_option_org_idx on public.question_option (org_id);
create index question_option_version_idx on public.question_option (question_version_id, ordinal);

/* ------------------------------------------------------------------ *
 * Translations (FR-ITM-09, D9)
 *
 * Versioned children of the English parent. Keys and marks live only on the
 * parent, which is authoritative on ambiguity -- mirroring NTA's own rule.
 * Sibling rows carrying their own keys silently diverge, and the divergence is
 * discovered by a student sitting the Hindi paper.
 * ------------------------------------------------------------------ */

create table public.question_translation (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  language text not null,
  version_no integer not null default 1 check (version_no > 0),
  body_latex text not null,
  body_html text not null,
  plain_text text not null,
  spoken_text text,
  status public.question_status not null default 'DRAFT',
  translated_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_version_id, language, version_no),
  constraint question_translation_second_approver
    check (approved_by is null or approved_by <> translated_by)
);

comment on table public.question_translation is
  'Versioned child of the English question_version (FR-ITM-09). Carries no key, no marks and no numeric spec -- those exist only on the parent.';

create index question_translation_org_idx on public.question_translation (org_id);
create index question_translation_parent_idx on public.question_translation (question_version_id, language);

create table public.question_option_translation (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_option_id uuid not null references public.question_option (id) on delete restrict,
  language text not null,
  body_html text not null,
  plain_text text not null,
  created_at timestamptz not null default now(),
  unique (question_option_id, language)
);

comment on table public.question_option_translation is
  'Translated option text, keyed to the option UUID rather than to its position. Invariant 6: an answer is {question_version_id, option_id}, so a translation can never shift which option a key refers to.';

create index question_option_translation_org_idx on public.question_option_translation (org_id);

/* ------------------------------------------------------------------ *
 * Cross-tagging and relations (FR-TAX-02, FR-TAX-06, FR-ITM-13)
 * ------------------------------------------------------------------ */

create table public.question_exam_tag (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_id uuid not null references public.question (id) on delete restrict,
  exam_code text not null references public.exam (code) on delete restrict,
  -- Previous-year provenance (FR-TAX-06). Null for an original item.
  pyq_year integer,
  pyq_paper text,
  pyq_shift text,
  pyq_question_no integer,
  created_at timestamptz not null default now()
);

-- Expression uniqueness, so a table constraint cannot express it: one tag per
-- (item, exam, year, shift), treating "not a PYQ" as its own slot.
create unique index question_exam_tag_uidx
  on public.question_exam_tag (question_id, exam_code, coalesce(pyq_year, -1), coalesce(pyq_shift, ''));

comment on table public.question_exam_tag is
  'Cross-tags one item into several exams (FR-TAX-02). The marking scheme is NOT here: it lives on the (test_section, question) join, so the same item scores differently in a JEE Main paper and a NEET paper (FR-PAT-04).';

create index question_exam_tag_org_idx on public.question_exam_tag (org_id);
create index question_exam_tag_exam_idx on public.question_exam_tag (org_id, exam_code, pyq_year);

create table public.question_relation (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  from_question_id uuid not null references public.question (id) on delete restrict,
  to_question_id uuid not null references public.question (id) on delete restrict,
  kind public.question_relation_kind not null,
  similarity numeric(5, 4),
  detected_by text not null default 'MANUAL',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (from_question_id, to_question_id, kind),
  constraint question_relation_not_self check (from_question_id <> to_question_id)
);

comment on table public.question_relation is
  'Near-duplicate and variant links (FR-ITM-13). A VARIANT_OF family is an asset, not a defect -- detection surfaces a warning, never a block. The real control is that two members of a family must not land in the same paper, which is a blueprint constraint.';

create index question_relation_org_idx on public.question_relation (org_id);
create index question_relation_from_idx on public.question_relation (from_question_id);
create index question_relation_to_idx on public.question_relation (to_question_id);

/* ------------------------------------------------------------------ *
 * Immutability enforcement (FR-ITM-02, FR-ITM-04)
 * ------------------------------------------------------------------ */

create function app.tg_question_version_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Before publication a version is freely editable: that is what DRAFT means.
  if old.published_at is null then
    return new;
  end if;

  -- After publication, content is frozen and an edit forks version N+1
  -- (FR-ITM-02). A metadata edit -- retagging, difficulty calibration,
  -- flagging, retirement -- updates in place, because none of it changes what
  -- a student read.
  if new.body_latex is distinct from old.body_latex
     or new.body_html is distinct from old.body_html
     or new.body_mathml is distinct from old.body_mathml
     or new.plain_text is distinct from old.plain_text
     or new.question_type is distinct from old.question_type
     or new.stimulus_id is distinct from old.stimulus_id
     or new.shuffle_options is distinct from old.shuffle_options
     or new.numeric_spec is distinct from old.numeric_spec
     or new.alt_text is distinct from old.alt_text
     or new.spoken_text is distinct from old.spoken_text
     or new.version_no is distinct from old.version_no
     or new.question_id is distinct from old.question_id
     or new.created_by is distinct from old.created_by
     or new.published_at is distinct from old.published_at then
    raise exception
      'question_version % is published and its content is immutable (FR-ITM-02)', old.id
      using errcode = '42501',
            hint = 'Fork a new version with supersedes_version_id set. Editing in place would silently change what past attempts scored against.';
  end if;

  return new;
end;
$$;

create trigger question_version_immutable
  before update on public.question_version
  for each row execute function app.tg_question_version_immutable();

create function app.tg_question_option_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_published timestamptz;
  v_version uuid;
begin
  v_version := case when tg_op = 'DELETE' then old.question_version_id else new.question_version_id end;
  select qv.published_at into v_published
  from public.question_version qv
  where qv.id = v_version;

  if v_published is not null then
    raise exception
      'options of published question_version % are frozen (FR-ITM-02)', v_version
      using errcode = '42501',
            hint = 'Fork the question version. An option added, edited or removed after publication invalidates every answer key and every attempt that pinned it.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger question_option_frozen
  before insert or update or delete on public.question_option
  for each row execute function app.tg_question_option_frozen();

create function app.tg_no_hard_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'rows in %.% are never hard-deleted (FR-ITM-04); set a retirement status instead',
    tg_table_schema, tg_table_name
    using errcode = '42501';
end;
$$;

comment on function app.tg_no_hard_delete() is
  'FR-ITM-04 / AC-ITM-03. Retirement is a status transition. Retired versions stay readable because past attempts depend on them, and a cascade here would silently rewrite history.';

create trigger question_no_delete
  before delete on public.question
  for each row execute function app.tg_no_hard_delete();

create trigger question_version_no_delete
  before delete on public.question_version
  for each row execute function app.tg_no_hard_delete();

commit;
