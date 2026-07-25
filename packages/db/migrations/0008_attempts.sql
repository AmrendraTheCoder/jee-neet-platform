-- 0008_attempts.sql
--
-- Attempts, responses, session takeover, incidents, extensions and
-- accommodations.
--
-- Three invariants converge on this file.
--
--   Invariant 6: answers are {question_version_id, option_id}. There is no
--   column anywhere below that could hold a position or a letter, and a trigger
--   asserts every submitted question version is a member of the attempt's
--   persisted order (FR-ATT-12, AC-ATT-04).
--
--   Invariant 7: the deadline is server-authoritative and immovable. It is
--   computed once at attempt creation and no client-supplied value reaches it.
--   The only thing that can move it is an audited admin extension bound to an
--   incident (FR-ADM-05, AC-ADM-02).
--
--   NFR-SCL-08: attempt_response is range-partitioned by month with future
--   partitions maintained automatically. A missing partition does not degrade
--   anything -- it fails every INSERT at once, for everyone, mid-exam.
--
-- Requirements: FR-ATT-03, FR-ATT-06..19, FR-SYN-01..09, FR-A11Y-05,
--               FR-ADM-05, FR-ADM-06, NFR-SCL-08.

begin;

create type public.attempt_status as enum (
  'IN_PROGRESS',
  'SUBMITTED',
  'AUTO_SUBMITTED',
  'EXPIRED',
  'ABANDONED',
  'VOIDED'
);

comment on type public.attempt_status is
  'ABANDONED is not a zero score. An attempt with zero answers and zero recorded question views finalises here, is excluded from scores, averages, analytics and the leaderboard, and does not consume the ranked slot (FR-ATT-18).';

create type public.attempt_session_status as enum ('ACTIVE', 'SUPERSEDED', 'REVOKED');

create type public.attempt_source as enum ('WEB', 'RN');

create type public.incident_kind as enum (
  'PLATFORM_ERROR',
  'SYNC_FAILURE',
  'ASSET_FAILURE',
  'RENDER_FAILURE',
  'SESSION_TAKEOVER',
  'STUDENT_REPORTED',
  'ADMIN_RECORDED'
);

/* ------------------------------------------------------------------ *
 * Accommodations (FR-A11Y-05)
 *
 * An entitlement attached to a person, not an ad-hoc extension attached to an
 * incident. Where an examining body grants a candidate a compensatory hour or
 * pro-rata additional time, the platform grants the equivalent, and the
 * leaderboard represents a lawfully longer attempt without misranking it.
 * Without this table a blind NEET aspirant cannot use the product at all.
 * ------------------------------------------------------------------ */

create table public.accommodation_entitlement (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  -- Fraction of base duration, e.g. 0.3333 for twenty minutes per hour.
  extra_time_ratio numeric(6, 4) check (extra_time_ratio >= 0),
  -- Flat additional seconds, e.g. a compensatory hour.
  extra_seconds integer check (extra_seconds >= 0),
  scribe_permitted boolean not null default false,
  reason text not null,
  evidence_ref text,
  granted_by uuid not null references auth.users (id) on delete restrict,
  valid_from date not null default current_date,
  valid_to date,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint accommodation_grants_something
    check (coalesce(extra_time_ratio, 0) > 0 or coalesce(extra_seconds, 0) > 0 or scribe_permitted)
);

comment on table public.accommodation_entitlement is
  'FR-A11Y-05, AC-A11Y-02. A lawfully longer attempt is ranked correctly and is not flagged by the integrity layer, because the entitlement is known to the deadline calculation rather than discovered by an anomaly detector.';

create index accommodation_user_idx on public.accommodation_entitlement (org_id, user_id)
  where revoked_at is null;

/* ------------------------------------------------------------------ *
 * Attempt
 * ------------------------------------------------------------------ */

create table public.attempt (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  test_id uuid not null references public.test (id) on delete restrict,
  -- FR-TST-09: pinned at start. A mid-window change to a pooled paper produces
  -- version N+1 and does not reach an attempt already running.
  test_version integer not null default 1,
  status public.attempt_status not null default 'IN_PROGRESS',
  source public.attempt_source not null default 'WEB',

  started_at timestamptz not null default now(),
  -- FR-ATT-06: min(started_at + effective duration, test.ends_at), computed
  -- once at creation. No client action moves it. The client counts down from a
  -- monotonic offset and reconciles here on every heartbeat (FR-ATT-07).
  deadline_at timestamptz not null,
  base_duration_seconds integer not null check (base_duration_seconds > 0),
  accommodation_seconds integer not null default 0 check (accommodation_seconds >= 0),
  accommodation jsonb,
  submitted_at timestamptz,
  finalised_at timestamptz,

  -- FR-ATT-10, FR-ATT-11: materialised once at start from a seeded shuffle and
  -- identical on every resume, every device and after reinstall. Review renders
  -- from this snapshot, never from live item rows (AC-ATT-05).
  question_order uuid[] not null,
  -- {question_version_id: [option_id, ...]}. Option identity, never position.
  option_order jsonb not null default '{}'::jsonb,
  -- hmac(server_secret, attempt_id). SENSITIVE: 0013 revokes column SELECT for
  -- `authenticated`, because RLS filters rows and has no opinion about columns
  -- and FR-ATT-10 requires the seed never reaches a client.
  shuffle_seed bytea not null,

  is_ranked boolean not null default false,
  -- FR-TST-06: a late joiner runs a materially truncated paper. Tagged, and
  -- excluded from the ranked leaderboard rather than silently compared against
  -- full-length attempts.
  shortened boolean not null default false,
  late_join boolean not null default false,
  -- Tutor-mode practice reveals the solution after each question (FR-PRC-03).
  -- The solution gate reads this: an attempt with it false locks the item for
  -- everyone while it is in progress (FR-SOL-05).
  reveals_solutions_during boolean not null default false,

  -- FR-PAT-07: the marking configuration in force for this attempt. A later
  -- configuration change cannot silently alter this score, because the score
  -- records which configuration produced it.
  scoring_config_fingerprint text,

  -- FR-ATT-15: explicit session takeover. The newest session wins; the previous
  -- one goes read-only. SENSITIVE: the token column is revoked in 0013.
  active_session_token uuid,
  active_device_id text,

  -- FR-ATT-13: attempt start is idempotent under a double tap on a slow
  -- network. Two guards, because either alone has a hole: the key catches a
  -- retried request, the partial unique index catches two distinct requests.
  idempotency_key text,

  -- FR-ATT-18: both counters must be zero for an attempt to finalise abandoned.
  -- A student who read the paper and answered nothing has still sat it.
  answered_count integer not null default 0,
  viewed_count integer not null default 0,
  abandon_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attempt_deadline_after_start check (deadline_at > started_at),
  constraint attempt_order_not_empty check (cardinality(question_order) > 0),
  -- FR-TST-06: a truncated attempt is never ranked. Expressed as a constraint
  -- so no code path can set both.
  constraint attempt_shortened_not_ranked check (not (shortened and is_ranked)),
  constraint attempt_submitted_has_timestamp
    check (status not in ('SUBMITTED', 'AUTO_SUBMITTED') or submitted_at is not null)
);

comment on table public.attempt is
  'One student sitting of one test. Pins the test version, the question order, the option order and the scoring configuration, which is what makes the paper replayable byte-identically and the mark explainable months later.';
comment on column public.attempt.shuffle_seed is
  'hmac(server_secret, attempt_id) (FR-ATT-10). Never sent to a client: column SELECT is revoked for authenticated in 0013. The order it produced is persisted above, so the client needs the result and never the input.';
comment on column public.attempt.question_order is
  'The materialised order. GIN-indexed because the solution gate asks "is this item inside any in-progress attempt" on every solution read (FR-SOL-05).';
comment on column public.attempt.deadline_at is
  'Server-authoritative and immovable (FR-ATT-06, AC-ATT-01). Setting a device clock back 45 minutes grants no time, because no client value is an input to this column.';

-- FR-ATT-13 / AC-ATT-03: exactly one attempt row from a double-tapped Start.
create unique index attempt_one_in_progress_uidx
  on public.attempt (user_id, test_id)
  where status = 'IN_PROGRESS';

-- FR-TST-07: only one attempt per student per test may be ranked.
create unique index attempt_one_ranked_uidx
  on public.attempt (user_id, test_id)
  where is_ranked;

create unique index attempt_idempotency_uidx
  on public.attempt (org_id, user_id, idempotency_key)
  where idempotency_key is not null;

create index attempt_org_user_idx on public.attempt (org_id, user_id);
create index attempt_test_idx on public.attempt (test_id, status);
-- The sweeper scans exactly this: in-progress attempts whose deadline passed
-- (FR-SYN-07). Batched with skip-locking; no client is trusted to call submit.
create index attempt_sweeper_idx on public.attempt (deadline_at)
  where status = 'IN_PROGRESS';
create index attempt_question_order_gin_idx on public.attempt using gin (question_order);

create trigger attempt_touch before update on public.attempt
  for each row execute function app.tg_touch_updated_at();

create function app.tg_attempt_deadline_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Invariant 7. The deadline moves only through the audited extension path
  -- below, which sets a session flag first. Everything else -- a resume, a
  -- heartbeat, a takeover, a status change -- leaves it alone.
  if new.deadline_at is distinct from old.deadline_at
     and coalesce(current_setting('app.granting_extension', true), 'off') <> 'on' then
    raise exception 'attempt % deadline is server-authoritative and immovable (FR-ATT-06)', old.id
      using errcode = '42501',
            hint = 'Grant an audited deadline extension against an incident (FR-ADM-05, AC-ADM-02).';
  end if;

  if new.started_at is distinct from old.started_at
     or new.question_order is distinct from old.question_order
     or new.option_order is distinct from old.option_order
     or new.shuffle_seed is distinct from old.shuffle_seed then
    raise exception 'attempt % order and seed are fixed at start (FR-ATT-10, FR-ATT-11)', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger attempt_immutable_core
  before update on public.attempt
  for each row execute function app.tg_attempt_deadline_immutable();

/* ------------------------------------------------------------------ *
 * Sessions (FR-ATT-15, FR-ATT-17)
 * ------------------------------------------------------------------ */

create table public.attempt_session (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  device_id text not null,
  status public.attempt_session_status not null default 'ACTIVE',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.attempt_session (id) on delete set null,
  revoke_reason text
);

comment on table public.attempt_session is
  'Explicit session takeover (FR-ATT-15). Resuming on a second device supersedes the first, which goes read-only with a distinct status rather than silently double-writing. FR-ATT-17: a concurrent refresh with the same rotating token revokes the whole session as suspected compromise, recorded here.';

create unique index attempt_session_one_active_uidx
  on public.attempt_session (attempt_id)
  where status = 'ACTIVE';
create index attempt_session_org_user_idx on public.attempt_session (org_id, user_id);
create index attempt_session_attempt_idx on public.attempt_session (attempt_id, started_at desc);

/* ------------------------------------------------------------------ *
 * Attempt sections
 * ------------------------------------------------------------------ */

create table public.attempt_section (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  test_section_id uuid not null references public.test_section (id) on delete restrict,
  entered_at timestamptz,
  exited_at timestamptz,
  -- Set when a time-locked section closes. After this the section is read-only
  -- and its items must have left the client prefetch scope (FR-SYN-11).
  locked_at timestamptz,
  time_spent_ms bigint not null default 0,
  unique (attempt_id, test_section_id)
);

comment on table public.attempt_section is
  'Per-section progress within one attempt: entry, exit, lock and accumulated time. locked_at is the durable record that a time-locked section closed, so a resumed client cannot re-enter it and a prefetch cannot keep its items in scope (FR-SYN-11).';

create index attempt_section_org_user_idx on public.attempt_section (org_id, user_id);
create index attempt_section_attempt_idx on public.attempt_section (attempt_id);

/* ------------------------------------------------------------------ *
 * Responses -- partitioned (NFR-SCL-08)
 *
 * Partition key is answered_at, fixed at first write and immutable thereafter,
 * so an update never migrates a row between partitions.
 *
 * Trade-off, recorded because it is not obvious: a partitioned table can only
 * declare a unique constraint that contains the partition key, so
 * (attempt_id, question_version_id) alone is not expressible declaratively. The
 * real one-answer-per-question invariant is enforced by the trigger below,
 * backed by the (attempt_id, question_version_id) index. Writes go through
 * record_attempt_responses, which updates in place and never inserts twice.
 * ------------------------------------------------------------------ */

create table public.attempt_response (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  test_question_id uuid references public.test_question (id) on delete restrict,

  -- Invariant 6. Option identities. Empty array means "no option selected",
  -- which is a different fact from never having visited the question.
  selected_option_ids uuid[] not null default '{}',
  -- FR-SCR-05: the raw keystrokes verbatim AND a normalised canonical form.
  -- Storing only the canonical form loses the evidence needed to adjudicate a
  -- challenge; storing only the raw form forces normalisation at score time.
  numeric_raw text,
  numeric_canonical text,

  -- FR-ATT-03: orthogonal to the answer, and provably invisible to scoring.
  -- There is a test asserting the scorer is blind to marked_for_review; keep it
  -- passing. Clear Response clears the answer and must not clear this flag.
  visited boolean not null default true,
  marked_for_review boolean not null default false,
  time_spent_ms integer not null default 0 check (time_spent_ms >= 0),

  -- FR-SYN-02: monotonic per attempt. An arrival with a stale sequence is
  -- DROPPED by the guard, never applied. AC-SYN-02 is exactly this: B, then D,
  -- then offline to A, must land on A.
  client_seq bigint not null default 0,

  answered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source public.attempt_source not null default 'WEB',

  primary key (attempt_id, question_version_id, answered_at)
) partition by range (answered_at);

comment on table public.attempt_response is
  'The current answer for one question of one attempt. Range-partitioned monthly: a missing future partition fails every INSERT simultaneously, for everyone, mid-exam (NFR-SCL-08). See app.ensure_time_partitions in 0014 and the runbook in README.';
comment on column public.attempt_response.marked_for_review is
  'FR-ATT-03. Never reaches the scoring function. Scoring reads selected_option_ids and numeric_canonical and nothing else.';
comment on column public.attempt_response.answered_at is
  'Partition key. Set at first write and immutable, so an update cannot migrate the row across partitions.';
comment on column public.attempt_response.time_spent_ms is
  'Time with the question VISIBLE, not time thinking (FR-SRS-06). A student doing four minutes of rough work on paper produces a spurious fast answer. Do not derive an SRS grade from this on paper-heavy subjects, and do not treat a low value as a guess.';

create index attempt_response_attempt_question_idx
  on public.attempt_response (attempt_id, question_version_id);
create index attempt_response_org_user_idx
  on public.attempt_response (org_id, user_id);
create index attempt_response_answered_brin_idx
  on public.attempt_response using brin (answered_at) with (pages_per_range = 32);

create function app.tg_attempt_response_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.attempt;
begin
  select * into v_attempt from public.attempt a where a.id = new.attempt_id;
  if not found then
    raise exception 'attempt % does not exist', new.attempt_id using errcode = '23503';
  end if;

  -- FR-ATT-12 / AC-ATT-04: the server asserts membership in the attempt's
  -- persisted order. A scripted client sending an item that is not in this
  -- candidate's paper is rejected, not quietly stored.
  if not (v_attempt.question_order @> array[new.question_version_id]) then
    raise exception
      'question_version % is not a member of attempt % question order (FR-ATT-12)',
      new.question_version_id, new.attempt_id
      using errcode = '22023';
  end if;

  -- FR-SYN-06: answers received after deadline plus a documented grace are
  -- rejected. The grace constant is 30 seconds and matches
  -- SUBMISSION_GRACE_SECONDS in @platform/domain; the two must not drift.
  if now() > v_attempt.deadline_at + interval '30 seconds' then
    raise exception
      'attempt % closed at %; response rejected after the 30 second grace (FR-SYN-06)',
      new.attempt_id, v_attempt.deadline_at
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    -- Cross-partition uniqueness the declarative constraint cannot express.
    if exists (
      select 1 from public.attempt_response r
      where r.attempt_id = new.attempt_id
        and r.question_version_id = new.question_version_id
    ) then
      raise exception
        'attempt % already holds a response for question_version %',
        new.attempt_id, new.question_version_id
        using errcode = '23505',
              hint = 'Update the existing row through record_attempt_responses; the partition key is immutable.';
    end if;
    -- Denormalised from the attempt rather than trusted from the caller: these
    -- two columns carry the whole RLS predicate for this table.
    new.org_id := v_attempt.org_id;
    new.user_id := v_attempt.user_id;
  else
    if new.answered_at is distinct from old.answered_at then
      raise exception 'attempt_response.answered_at is the partition key and is immutable'
        using errcode = '42501';
    end if;
    if new.attempt_id is distinct from old.attempt_id
       or new.question_version_id is distinct from old.question_version_id then
      raise exception 'attempt_response identity is immutable' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger attempt_response_guard
  before insert or update on public.attempt_response
  for each row execute function app.tg_attempt_response_guard();

/* ------------------------------------------------------------------ *
 * Sync event log -- partitioned
 * ------------------------------------------------------------------ */

create table public.attempt_response_event (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  attempt_id uuid not null,
  question_version_id uuid not null,
  client_seq bigint not null,
  -- 'APPLIED' or 'DROPPED_STALE_SEQ' or 'REJECTED_CLOSED' or
  -- 'REJECTED_NOT_IN_ORDER'. Dropped operations are recorded, not discarded:
  -- "the answer I sent did not save" is otherwise unanswerable (FR-SYN-02).
  outcome text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

comment on table public.attempt_response_event is
  'Append-only log of every sync operation including the ones the sequence guard dropped (FR-SYN-02, FR-SYN-03). This is the evidence for a disputed answer and for the explain-this-decision export (FR-ADM-20).';

create index attempt_response_event_attempt_idx
  on public.attempt_response_event (attempt_id, occurred_at desc);
create index attempt_response_event_org_user_idx
  on public.attempt_response_event (org_id, user_id);
create index attempt_response_event_brin_idx
  on public.attempt_response_event using brin (occurred_at) with (pages_per_range = 32);

create trigger attempt_response_event_append_only
  before update or delete on public.attempt_response_event
  for each row execute function app.tg_append_only();

/* ------------------------------------------------------------------ *
 * Focus events -- partitioned
 * ------------------------------------------------------------------ */

create table public.attempt_focus_event (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  attempt_id uuid not null,
  kind text not null,
  duration_ms integer,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

comment on table public.attempt_focus_event is
  'Application focus and background transitions. An integrity SIGNAL only: automated leaderboard removal or banning on this data is prohibited (FR-ADM-15). On Android, a student putting the phone down to do rough work produces the same trace as a student leaving to look something up -- the most diligent candidates look the most like cheaters (FR-SRS-06), so this routes to a human queue with a second independent signal or it routes nowhere.';

create index attempt_focus_event_attempt_idx on public.attempt_focus_event (attempt_id, occurred_at desc);
create index attempt_focus_event_org_user_idx on public.attempt_focus_event (org_id, user_id);
create index attempt_focus_event_brin_idx
  on public.attempt_focus_event using brin (occurred_at) with (pages_per_range = 32);

/* ------------------------------------------------------------------ *
 * Incidents, extensions (FR-ADM-05, FR-ADM-06)
 * ------------------------------------------------------------------ */

create table public.attempt_incident (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  attempt_id uuid references public.attempt (id) on delete restrict,
  test_id uuid references public.test (id) on delete restrict,
  user_id uuid references public.profile (user_id) on delete restrict,
  kind public.incident_kind not null,
  severity smallint not null default 3 check (severity between 1 and 5),
  detail jsonb not null default '{}'::jsonb,
  -- FR-ADM-06: platform-caused time loss is measured, not negotiated. Derived
  -- from server-observed error rates, corroborated. A student's own poor
  -- network is not compensated, so the source column is load-bearing.
  lost_seconds integer not null default 0 check (lost_seconds >= 0),
  server_corroborated boolean not null default false,
  reported_by text not null default 'SERVER',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text
);

comment on table public.attempt_incident is
  'Incident stream feeding the live-operations plane (FR-ADM-04) and the compensation ladder (FR-ADM-06). lost_seconds is only compensable when server_corroborated is true.';

create index attempt_incident_org_idx on public.attempt_incident (org_id);
create index attempt_incident_attempt_idx on public.attempt_incident (attempt_id);
create index attempt_incident_test_idx on public.attempt_incident (test_id, detected_at desc);
create index attempt_incident_user_idx on public.attempt_incident (org_id, user_id);

create table public.attempt_deadline_extension (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  attempt_id uuid not null references public.attempt (id) on delete restrict,
  -- AC-ADM-02: not nullable. A deadline extension cannot be granted without an
  -- incident reference, because an extension with no recorded cause is
  -- indistinguishable from favouritism when it is audited a year later.
  incident_id uuid not null references public.attempt_incident (id) on delete restrict,
  granted_seconds integer not null check (granted_seconds > 0),
  reason text not null,
  granted_by uuid not null references auth.users (id) on delete restrict,
  granted_at timestamptz not null default now()
);

comment on table public.attempt_deadline_extension is
  'The only mechanism that may move a deadline (FR-ADM-05). Append-only, mandatorily linked to an incident, and applied by trigger so the extension and the new deadline cannot disagree.';

create index attempt_deadline_extension_attempt_idx on public.attempt_deadline_extension (attempt_id);
create index attempt_deadline_extension_org_idx on public.attempt_deadline_extension (org_id);

create trigger attempt_deadline_extension_append_only
  before update or delete on public.attempt_deadline_extension
  for each row execute function app.tg_append_only();

create function app.tg_apply_deadline_extension() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Capability re-verified against the live table, not against a cached JWT
  -- claim (FR-IDN-10). A revoked administrator loses this immediately.
  if not app.has_permission('attempts.extend') then
    raise exception 'granting a deadline extension requires the attempts.extend capability'
      using errcode = '42501';
  end if;

  perform set_config('app.granting_extension', 'on', true);
  update public.attempt
     set deadline_at = deadline_at + make_interval(secs => new.granted_seconds)
   where id = new.attempt_id;
  perform set_config('app.granting_extension', 'off', true);

  return new;
end;
$$;

create trigger attempt_deadline_extension_apply
  after insert on public.attempt_deadline_extension
  for each row execute function app.tg_apply_deadline_extension();

/* ------------------------------------------------------------------ *
 * Paper fetch (NFR-SCL-02, FR-TST-10, FR-SYN-11)
 *
 * One round trip. Attempt start returning the attempt row and then the client
 * fetching stems, then options, then assets is the multi-call paper fetch the
 * requirements prohibit -- at ten thousand concurrent starts it is four
 * simultaneous thundering herds instead of one.
 *
 * This is also the only path to an item embargoed out of the practice bank, so
 * a candidate reads their own live paper and nobody reads anyone else's.
 * ------------------------------------------------------------------ */

create function public.get_attempt_paper(p_attempt_id uuid)
returns table (
  question_version_id uuid,
  display_index integer,
  test_section_id uuid,
  section_ordinal integer,
  section_name text,
  subject public.subject_code,
  question_type public.question_type,
  body_html text,
  body_mathml text,
  plain_text text,
  alt_text text,
  spoken_text text,
  stimulus_html text,
  -- Option identities in this attempt's persisted order (FR-ATT-10). Positions
  -- are a rendering detail; the client answers with the identity.
  option_ids uuid[],
  option_html text[],
  max_marks numeric,
  section_locked boolean
)
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempt;
begin
  if v_user is null or not app.processing_allowed() then
    return;
  end if;

  select * into v_attempt from public.attempt a
   where a.id = p_attempt_id and a.user_id = v_user;
  if not found then
    return;
  end if;

  return query
  with ordered as (
    select u.qvid, u.ord::integer as display_index
    from unnest(v_attempt.question_order) with ordinality as u(qvid, ord)
  )
  select o.qvid,
         o.display_index,
         ts.id,
         ts.ordinal,
         ts.name,
         ts.subject,
         qv.question_type,
         qv.body_html,
         qv.body_mathml,
         qv.plain_text,
         qv.alt_text,
         qv.spoken_text,
         st.body_html,
         coalesce(shuffled.ids, authored.ids),
         coalesce(shuffled.html, authored.html),
         tq.max_marks,
         -- FR-SYN-11: prefetch scope equals what the candidate may legally
         -- navigate to right now. A locked section is reported so the client
         -- can drop its content rather than hold the whole paper.
         (asec.locked_at is not null)
  from ordered o
  join public.test_question tq
    on tq.test_id = v_attempt.test_id and tq.question_version_id = o.qvid
  join public.question_version qv on qv.id = o.qvid
  join public.test_section ts on ts.id = tq.test_section_id
  left join public.attempt_section asec
    on asec.attempt_id = p_attempt_id and asec.test_section_id = ts.id
  left join public.question_stimulus st on st.id = qv.stimulus_id
  left join lateral (
    select array_agg(qo.id order by x.ord) as ids,
           array_agg(qo.body_html order by x.ord) as html
    from jsonb_array_elements_text(v_attempt.option_order -> o.qvid::text)
         with ordinality as x(oid_text, ord)
    join public.question_option qo on qo.id = x.oid_text::uuid
  ) shuffled on true
  left join lateral (
    select array_agg(qo.id order by qo.ordinal) as ids,
           array_agg(qo.body_html order by qo.ordinal) as html
    from public.question_option qo
    where qo.question_version_id = o.qvid
  ) authored on true
  order by o.display_index;
end;
$$;

comment on function public.get_attempt_paper(uuid) is
  'The whole paper in one call (NFR-SCL-02), rendered from the attempt persisted order rather than from live item rows, so a resume, a reinstall and the post-submission review all produce identical output (FR-ATT-11, AC-ATT-05). Returns no solution, no rationale, no key and no video URL -- those are not in any table it reads.';

revoke execute on function public.get_attempt_paper(uuid) from public;
grant execute on function public.get_attempt_paper(uuid) to authenticated;

/* ------------------------------------------------------------------ *
 * Batch response sync (FR-SYN-02, FR-SYN-03, FR-SYN-04)
 *
 * The only supported write path for attempt_response. It exists in the database
 * rather than the API layer because three invariants converge on it -- the
 * sequence guard, the deadline grace and the cross-partition upsert -- and a
 * second implementation is a second place for them to be wrong.
 * ------------------------------------------------------------------ */

create function public.record_attempt_responses(p_attempt_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.attempt;
  v_op jsonb;
  v_qv uuid;
  v_seq bigint;
  v_existing_seq bigint;
  v_results jsonb := '[]'::jsonb;
  v_outcome text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ops) <> 'array' then
    raise exception 'p_ops must be a JSON array' using errcode = '22023';
  end if;
  -- FR-SYN-04: bounded so one call stays well inside the per-request CPU
  -- ceiling. An unbounded batch is how a retry storm becomes an outage.
  if jsonb_array_length(p_ops) > 100 then
    raise exception 'batch of % operations exceeds the cap of 100 (FR-SYN-04)', jsonb_array_length(p_ops)
      using errcode = '54000';
  end if;

  select * into v_attempt from public.attempt a
   where a.id = p_attempt_id and a.user_id = v_user
   for update;

  if not found then
    raise exception 'attempt % not found for this principal', p_attempt_id using errcode = '42501';
  end if;
  if v_attempt.status <> 'IN_PROGRESS' then
    raise exception 'attempt % is %; it accepts no further responses', p_attempt_id, v_attempt.status
      using errcode = '22023';
  end if;

  for v_op in select * from jsonb_array_elements(p_ops)
  loop
    v_qv := (v_op ->> 'questionVersionId')::uuid;
    v_seq := coalesce((v_op ->> 'clientSeq')::bigint, 0);
    v_outcome := 'APPLIED';

    if not (v_attempt.question_order @> array[v_qv]) then
      v_outcome := 'REJECTED_NOT_IN_ORDER';
    elsif now() > v_attempt.deadline_at + interval '30 seconds' then
      v_outcome := 'REJECTED_CLOSED';
    else
      select r.client_seq into v_existing_seq
      from public.attempt_response r
      where r.attempt_id = p_attempt_id and r.question_version_id = v_qv;

      if found and v_existing_seq >= v_seq then
        -- FR-SYN-02: out-of-order arrivals are DROPPED, never applied. This is
        -- what makes AC-SYN-02 hold when a delayed earlier answer lands after a
        -- later one.
        v_outcome := 'DROPPED_STALE_SEQ';
      elsif found then
        update public.attempt_response r
           set selected_option_ids = coalesce(
                 (select array_agg(value::text::uuid)
                  from jsonb_array_elements_text(v_op -> 'selectedOptionIds') as t(value)),
                 '{}'::uuid[]),
               numeric_raw = v_op ->> 'numericRaw',
               numeric_canonical = v_op ->> 'numericCanonical',
               visited = coalesce((v_op ->> 'visited')::boolean, r.visited),
               marked_for_review = coalesce((v_op ->> 'markedForReview')::boolean, r.marked_for_review),
               time_spent_ms = greatest(r.time_spent_ms, coalesce((v_op ->> 'timeSpentMs')::integer, 0)),
               client_seq = v_seq
         where r.attempt_id = p_attempt_id and r.question_version_id = v_qv;
      else
        insert into public.attempt_response (
          org_id, user_id, attempt_id, question_version_id,
          selected_option_ids, numeric_raw, numeric_canonical,
          visited, marked_for_review, time_spent_ms, client_seq, source
        ) values (
          v_attempt.org_id, v_attempt.user_id, p_attempt_id, v_qv,
          coalesce(
            (select array_agg(value::text::uuid)
             from jsonb_array_elements_text(v_op -> 'selectedOptionIds') as t(value)),
            '{}'::uuid[]),
          v_op ->> 'numericRaw',
          v_op ->> 'numericCanonical',
          coalesce((v_op ->> 'visited')::boolean, true),
          coalesce((v_op ->> 'markedForReview')::boolean, false),
          coalesce((v_op ->> 'timeSpentMs')::integer, 0),
          v_seq,
          v_attempt.source
        );
      end if;
    end if;

    insert into public.attempt_response_event (
      org_id, user_id, attempt_id, question_version_id, client_seq, outcome, payload
    ) values (
      v_attempt.org_id, v_attempt.user_id, p_attempt_id, v_qv, v_seq, v_outcome, v_op
    );

    -- FR-SYN-03: a per-operation result array. The client clears only what was
    -- acknowledged, so a partial failure cannot silently lose an answer.
    v_results := v_results || jsonb_build_object(
      'questionVersionId', v_qv, 'clientSeq', v_seq, 'outcome', v_outcome);
  end loop;

  update public.attempt a
     set answered_count = (
           select count(*) from public.attempt_response r
           where r.attempt_id = p_attempt_id
             and (cardinality(r.selected_option_ids) > 0 or r.numeric_raw is not null)),
         viewed_count = (
           select count(*) from public.attempt_response r
           where r.attempt_id = p_attempt_id and r.visited)
   where a.id = p_attempt_id;

  return jsonb_build_object('attemptId', p_attempt_id, 'results', v_results);
end;
$$;

comment on function public.record_attempt_responses(uuid, jsonb) is
  'Atomic batch sync (FR-SYN-03). One transaction, one per-operation result array, the sequence guard applied per operation, and every operation logged including the dropped ones. Heartbeat and answer sync are one request (FR-ATT-08) and this is the request.';

revoke execute on function public.record_attempt_responses(uuid, jsonb) from public;
grant execute on function public.record_attempt_responses(uuid, jsonb) to authenticated;

commit;
