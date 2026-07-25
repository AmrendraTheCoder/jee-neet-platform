-- 0006_content_private.sql
--
-- Answer keys, solutions, per-option rationales and licence evidence.
--
-- Everything in this file lives in the `private` schema with zero grants to
-- `anon` and `authenticated` (NFR-SEC-02, FR-SOL-05, invariant 3). This is not
-- belt-and-braces on top of RLS; it is the control. RLS filters rows and has no
-- opinion about columns, so a key column on a table a student may read at all
-- is a full key dump behind one `?select=`. The only way in is the state-
-- checking RPCs at the bottom of this file.
--
-- Two things are easy to get wrong and are called out where they occur:
--   1. Per-option rationales are answer-key material. "This option is wrong
--      because it forgets the factor of two" identifies the correct option. They
--      cannot sit on public.question_option however mandatory the field is.
--   2. A video solution URL is key material too. A student who can read the
--      URL during an attempt has the answer, and prefetching one into a client
--      cache is the same leak with extra steps (FR-SOL-03, EC-LEAK-01).
--
-- Requirements: FR-SOL-01..07, FR-AUT-04, FR-SCR-11, FR-SCR-13, NFR-SEC-02, AC-SOL-01, AC-NTS-01.

begin;

create type public.key_resolution as enum ('MULTI_KEY', 'ALL_CORRECT', 'DROPPED');

comment on type public.key_resolution is
  'The three key-revision flags with distinct eligible populations (FR-SCR-13). Exposed as a type because attempt_question_result reports it to the student; the key rows themselves stay private.';

/* ------------------------------------------------------------------ *
 * Answer keys (FR-SCR-11)
 * ------------------------------------------------------------------ */

create table private.answer_key (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  -- Monotonic per item version. A correction never overwrites: it inserts
  -- version N+1 and enqueues a rescore (FR-SCR-11, FR-SCR-12).
  version integer not null check (version > 0),
  supersedes_id uuid references private.answer_key (id) on delete restrict,

  -- Answers are option identities, never letters or positions (invariant 6).
  correct_option_ids uuid[] not null default '{}',
  numeric_value text,
  -- Copied from the item version at key creation so the key is self-contained:
  -- a scorer replaying this key years later must not have to reconstruct the
  -- tolerance from a table that has since been retagged.
  numeric_spec jsonb,

  -- Null means the key stands as authored. A value records the resolution a
  -- rescore applied and is what makes "why did my mark change" answerable.
  resolution public.key_resolution,
  resolution_reason text,

  effective_from timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),

  unique (question_version_id, version),
  constraint answer_key_has_an_answer
    check (cardinality(correct_option_ids) > 0
           or numeric_value is not null
           or resolution in ('ALL_CORRECT', 'DROPPED'))
);

comment on table private.answer_key is
  'Immutable versioned answer keys (FR-SCR-11). Append-only: a correction is version N+1 with a recorded reason, and the rescore that follows writes new result rows rather than overwriting old ones (FR-SCR-12).';
comment on column private.answer_key.resolution is
  'MULTI_KEY credits anyone selecting any correct option; ALL_CORRECT credits all who attempted; DROPPED credits all who appeared (FR-SCR-13). The three have genuinely different eligible populations and conflating them is a silent fairness bug.';

create index answer_key_version_idx on private.answer_key (question_version_id, version desc);
create index answer_key_org_idx on private.answer_key (org_id);

create trigger answer_key_append_only
  before update or delete on private.answer_key
  for each row execute function app.tg_append_only();

alter table private.answer_key enable row level security;

/* ------------------------------------------------------------------ *
 * Solutions (FR-SOL-01, FR-SOL-03)
 * ------------------------------------------------------------------ */

create table private.question_solution (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  body_latex text not null,
  body_html text not null,
  plain_text text not null,
  -- FR-SOL-03: the video link lives on the solution row, never on the item row.
  -- On the item row it would be readable by anyone who can read an item, which
  -- during an attempt is every candidate sitting the paper.
  video_url text,
  video_provider text,
  video_checked_at timestamptz,
  video_healthy boolean,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_version_id)
);

comment on table private.question_solution is
  'Text solution and optional video link (FR-SOL-01, FR-SOL-03). Private schema, zero grants. AC-SOL-01 asserts a student JWT mid-attempt gets 403 or empty on every column here including the video URL and its metadata.';

create index question_solution_org_idx on private.question_solution (org_id);
create index question_solution_video_health_idx on private.question_solution (video_healthy)
  where video_url is not null;

create trigger question_solution_touch before update on private.question_solution
  for each row execute function app.tg_touch_updated_at();

alter table private.question_solution enable row level security;

create table private.option_rationale (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_option_id uuid not null references public.question_option (id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  -- FR-AUT-04: mandatory at authoring. NOT NULL here rather than in the console,
  -- because the console is the layer a bulk import bypasses.
  body_html text not null,
  plain_text text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_option_id),
  constraint option_rationale_not_empty check (length(btrim(plain_text)) >= 10)
);

comment on table private.option_rationale is
  'Per-option rationale explaining why a distractor is wrong (FR-AUT-04, FR-SOL-02). Private because a rationale is answer-key material: "this forgets the factor of two" names the correct option as surely as the key does.';

create index option_rationale_version_idx on private.option_rationale (question_version_id);
create index option_rationale_org_idx on private.option_rationale (org_id);

create trigger option_rationale_touch before update on private.option_rationale
  for each row execute function app.tg_touch_updated_at();

alter table private.option_rationale enable row level security;

/* ------------------------------------------------------------------ *
 * Licence evidence (NFR-SEC-02, B1)
 * ------------------------------------------------------------------ */

create table private.licence_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  question_id uuid references public.question (id) on delete restrict,
  content_source_id uuid references public.content_source (id) on delete restrict,
  licensor text not null,
  agreement_ref text not null,
  document_uri text not null,
  document_sha256 text,
  valid_from date,
  valid_to date,
  territory text not null default 'IN',
  commercial_use_permitted boolean not null default false,
  notes text,
  recorded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint licence_evidence_target
    check (question_id is not null or content_source_id is not null)
);

comment on table private.licence_evidence is
  'Evidence backing a LICENSED or PYQ provenance claim (FR-ITM-06, blocking dependency B1). Private: the agreement reference and licensor are commercially sensitive and are not a student concern.';

create index licence_evidence_question_idx on private.licence_evidence (question_id);
create index licence_evidence_org_idx on private.licence_evidence (org_id);

alter table private.licence_evidence enable row level security;

/* ------------------------------------------------------------------ *
 * The state-checking gate (FR-SOL-05)
 *
 * One function decides, and everything that reveals key material calls it. A
 * second implementation of this rule is a second place for it to be wrong.
 * ------------------------------------------------------------------ */

create function app.solution_visible(p_question_version_id uuid) returns boolean
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return false;
  end if;

  -- Authors and key revisers need solutions to do their job. This is a
  -- capability check against the live role tables, not against a cached claim
  -- (FR-IDN-10).
  if app.has_permission('questions.write') or app.has_permission('keys.revise') then
    return true;
  end if;

  -- Hard lock. While ANY attempt that must not see solutions still holds this
  -- item, nobody outside the editorial roles reads it -- not the candidate
  -- sitting it, and not a second student who finished early and would otherwise
  -- pass the answer on (FR-SOL-05, EC-LEAK-01). Tutor-mode practice attempts
  -- are exempt by construction: they set reveals_solutions_during, which is
  -- what tutor mode means.
  if exists (
    select 1
    from public.attempt a
    where a.status = 'IN_PROGRESS'
      and not a.reveals_solutions_during
      and a.question_order @> array[p_question_version_id]
  ) then
    return false;
  end if;

  -- Tutor mode: the student's own in-progress practice attempt reveals the
  -- solution after they have answered, and only for a question they have
  -- actually reached (FR-PRC-03).
  if exists (
    select 1
    from public.attempt a
    join public.attempt_response r
      on r.attempt_id = a.id and r.question_version_id = p_question_version_id
    where a.user_id = v_user
      and a.status = 'IN_PROGRESS'
      and a.reveals_solutions_during
      and a.question_order @> array[p_question_version_id]
  ) then
    return true;
  end if;

  -- Otherwise: the caller finished an attempt containing this item and the
  -- test's solutions_visible_from has passed. For a live test that is never
  -- earlier than window close for everyone (FR-TST-08), so an early finisher
  -- cannot read out the paper while others are still sitting it.
  return exists (
    select 1
    from public.attempt a
    join public.test t on t.id = a.test_id
    where a.user_id = v_user
      and a.status in ('SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED')
      and a.question_order @> array[p_question_version_id]
      and t.solutions_visible_from is not null
      and t.solutions_visible_from <= now()
  );
end;
$$;

comment on function app.solution_visible(uuid) is
  'The single gate on key material (FR-SOL-05). SECURITY DEFINER because it must read attempt and test rows the caller may not read directly, and an empty search_path because a definer function with a mutable one is a privilege-escalation primitive (NFR-SEC-06).';

grant execute on function app.solution_visible(uuid) to authenticated;

/* ------------------------------------------------------------------ *
 * Exposed RPCs
 *
 * These are the only doors into the private schema for a student token. They
 * return nothing rather than raising when the gate is shut, so a caller cannot
 * distinguish "locked" from "does not exist" and use the RPC as an oracle for
 * which items are in a live paper.
 * ------------------------------------------------------------------ */

create function public.get_question_solution(p_question_version_id uuid)
returns table (
  question_version_id uuid,
  body_html text,
  plain_text text,
  video_url text,
  video_provider text,
  -- FR-SOL-04: for an under-18 session the client must deep-link out rather
  -- than embed. The standard embedded player transmits platform identifiers and
  -- may serve interest-based advertising to a child. The server states the
  -- requirement; the client does not decide it.
  video_deep_link_only boolean
)
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not app.processing_allowed() then
    return;
  end if;
  if not app.solution_visible(p_question_version_id) then
    return;
  end if;

  return query
  select s.question_version_id,
         s.body_html,
         s.plain_text,
         s.video_url,
         s.video_provider,
         app.is_minor(auth.uid())
  from private.question_solution s
  where s.question_version_id = p_question_version_id;
end;
$$;

comment on function public.get_question_solution(uuid) is
  'The only path from a student token to a solution (FR-SOL-05, AC-SOL-01). Returns zero rows rather than raising when the gate is shut, so it cannot be used to enumerate which items are in a live paper.';

create function public.get_option_rationales(p_question_version_id uuid)
returns table (question_option_id uuid, body_html text)
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not app.processing_allowed() then
    return;
  end if;
  if not app.solution_visible(p_question_version_id) then
    return;
  end if;

  return query
  select r.question_option_id, r.body_html
  from private.option_rationale r
  where r.question_version_id = p_question_version_id;
end;
$$;

create function public.get_answer_key(p_question_version_id uuid)
returns table (
  question_version_id uuid,
  key_version integer,
  correct_option_ids uuid[],
  numeric_value text,
  resolution public.key_resolution
)
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not app.processing_allowed() then
    return;
  end if;
  if not app.solution_visible(p_question_version_id) then
    return;
  end if;

  return query
  select k.question_version_id, k.version, k.correct_option_ids, k.numeric_value, k.resolution
  from private.answer_key k
  where k.question_version_id = p_question_version_id
  order by k.version desc
  limit 1;
end;
$$;

comment on function public.get_answer_key(uuid) is
  'Post-submission key reveal for the review screen (FR-SCR-17, FR-SCR-18). Gated identically to solutions. Per-question marks come from attempt_question_result and are never recomputed on the client.';

create function public.get_attempt_review_keys(p_attempt_id uuid)
returns table (
  question_version_id uuid,
  key_version integer,
  correct_option_ids uuid[],
  numeric_value text,
  resolution public.key_resolution,
  solution_html text,
  video_url text,
  video_deep_link_only boolean
)
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ok boolean;
begin
  if v_user is null or not app.processing_allowed() then
    return;
  end if;

  -- One gate evaluation for the whole attempt rather than one per question:
  -- the review screen is a single round trip (NFR-SCL-02), and ninety
  -- independent gate calls is the N+1 this codebase treats as a build failure.
  select exists (
    select 1
    from public.attempt a
    join public.test t on t.id = a.test_id
    where a.id = p_attempt_id
      and a.user_id = v_user
      and a.status in ('SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED')
      and t.solutions_visible_from is not null
      and t.solutions_visible_from <= now()
  ) into v_ok;

  if not v_ok and not app.has_permission('keys.revise') then
    return;
  end if;

  return query
  select qv_id.qvid,
         k.version,
         k.correct_option_ids,
         k.numeric_value,
         k.resolution,
         s.body_html,
         s.video_url,
         app.is_minor(v_user)
  from (
    select unnest(a.question_order) as qvid
    from public.attempt a
    where a.id = p_attempt_id
  ) qv_id
  left join lateral (
    select ak.version, ak.correct_option_ids, ak.numeric_value, ak.resolution
    from private.answer_key ak
    where ak.question_version_id = qv_id.qvid
    order by ak.version desc
    limit 1
  ) k on true
  left join private.question_solution s on s.question_version_id = qv_id.qvid;
end;
$$;

comment on function public.get_attempt_review_keys(uuid) is
  'Whole-attempt review payload in one round trip. Reads the attempt persisted question order, so review renders from the pinned snapshot and not from live item rows (FR-ATT-11, AC-ATT-05).';

revoke execute on function public.get_question_solution(uuid) from public;
revoke execute on function public.get_option_rationales(uuid) from public;
revoke execute on function public.get_answer_key(uuid) from public;
revoke execute on function public.get_attempt_review_keys(uuid) from public;

grant execute on function public.get_question_solution(uuid) to authenticated;
grant execute on function public.get_option_rationales(uuid) to authenticated;
grant execute on function public.get_answer_key(uuid) to authenticated;
grant execute on function public.get_attempt_review_keys(uuid) to authenticated;

commit;
