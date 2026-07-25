-- 0012_governance.sql
--
-- Audit log, idempotency, feature flags, data-subject requests, error reports,
-- notifications and the two telemetry pipelines.
--
-- Two things here are not conveniences. The audit log is append-only by trigger
-- because an audit log a privileged client can edit is not an audit log
-- (FR-ADM-18). And the telemetry split is two physically separate tables, not
-- one table with a category column, because NFR-PRV-02 requires the engagement
-- pipeline to be disabled entirely for under-18 principals -- a requirement you
-- cannot verify against a column value, and can verify against a table that has
-- no minor rows in it.
--
-- Requirements: FR-ADM-17..22, FR-SUP-01..06, FR-NOT-01..05, NFR-PRV-02..06, AC-ADM-01.

begin;

create type public.dsr_kind as enum ('ACCESS', 'CORRECTION', 'ERASURE', 'PORTABILITY', 'GRIEVANCE');
create type public.dsr_status as enum ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

create type public.report_kind as enum (
  'CONTENT_ERROR',
  'RENDER_FAILURE',
  'ANSWER_CHALLENGE',
  'ACCESSIBILITY',
  'OTHER'
);

create type public.report_status as enum (
  'OPEN',
  'TRIAGED',
  'UPHELD',
  'REJECTED',
  'DUPLICATE'
);

create type public.notification_category as enum ('TRANSACTIONAL', 'PEDAGOGICAL', 'ENGAGEMENT');

/* ------------------------------------------------------------------ *
 * Audit log -- partitioned, append-only (FR-ADM-18, AC-ADM-01)
 * ------------------------------------------------------------------ */

create table public.audit_log (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null,
  actor_user_id uuid,
  -- The capability that authorised the action, not merely the role. "Who could
  -- have done this" is answerable from role_permission; "what permitted this
  -- specific write" is only answerable if it is recorded at the time.
  capability text,
  action text not null,
  entity_schema text not null default 'public',
  entity_table text not null,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  request_id text,
  ip_hash text,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

comment on table public.audit_log is
  'Append-only audit trail across all twelve admin planes (FR-ADM-18, AC-ADM-01). Trigger-enforced rather than convention-enforced: the service role bypasses RLS, and a trigger is the only control that still applies to it.';
comment on column public.audit_log.ip_hash is
  'Hashed, never raw. An IP address is personal data and the platform serves children (NFR-PRV-03); the operational question is "same origin or different", which a hash answers.';

create index audit_log_org_time_idx on public.audit_log (org_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_user_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_table, entity_id, occurred_at desc);
create index audit_log_brin_idx on public.audit_log using brin (occurred_at) with (pages_per_range = 32);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function app.tg_append_only();

/* ------------------------------------------------------------------ *
 * Idempotency (FR-ATT-13, FR-SCR-02)
 * ------------------------------------------------------------------ */

create table public.idempotency_key (
  org_id uuid not null references public.org (id) on delete restrict,
  scope text not null,
  key text not null,
  user_id uuid references public.profile (user_id) on delete cascade,
  -- Hash of the request body. A repeated key with a different body is a client
  -- bug, and returning the first response for it would be worse than an error.
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (org_id, scope, key)
);

comment on table public.idempotency_key is
  'Client-supplied idempotency for attempt start and batch sync (FR-ATT-13, AC-ATT-03). Paired with the partial unique index on attempt: the key catches a retried request, the index catches two genuinely distinct ones.';

create index idempotency_key_expiry_idx on public.idempotency_key (expires_at);
create index idempotency_key_user_idx on public.idempotency_key (org_id, user_id);

/* ------------------------------------------------------------------ *
 * Feature flags and kill switches (FR-ADM-18, FR-RWD-12)
 * ------------------------------------------------------------------ */

create table public.feature_flag (
  key text not null,
  org_id uuid not null references public.org (id) on delete restrict,
  enabled boolean not null default false,
  -- A flag without an owner and an expiry becomes permanent configuration
  -- nobody remembers the reason for. Both are mandatory.
  owner text not null,
  expires_on date not null,
  description text not null,
  is_kill_switch boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

comment on table public.feature_flag is
  'Feature flags and per-module kill switches with an owner and an expiry (FR-ADM-18). The rewards module kill switch (FR-RWD-12) is a row here, which is what makes switching rewards off a configuration change rather than a re-architecture.';

create index feature_flag_expiry_idx on public.feature_flag (expires_on);

/* ------------------------------------------------------------------ *
 * Data-subject requests (FR-ADM-19, NFR-PRV-05)
 * ------------------------------------------------------------------ */

create table public.dsr_request (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  -- A guardian may exercise rights on behalf of a child principal.
  raised_by_user_id uuid references public.profile (user_id) on delete set null,
  kind public.dsr_kind not null,
  status public.dsr_status not null default 'RECEIVED',
  received_at timestamptz not null default now(),
  -- The statutory clock. Held as a column so an SLA breach is a query rather
  -- than a discovery during an audit.
  due_at timestamptz not null,
  completed_at timestamptz,
  handler_user_id uuid references auth.users (id) on delete set null,
  resolution_note text,
  -- NFR-PRV-05: identity is cryptographically shredded, statistical
  -- contribution is retained with the mapping key destroyed. Recording which
  -- tier ran matters, because "erased" means two different things.
  erasure_tier text
);

comment on table public.dsr_request is
  'The data-subject-request queue with an SLA timer (FR-ADM-19). Erasure is two-tier so that other students cohort percentiles stay sound after one student leaves (NFR-PRV-05).';

create index dsr_request_org_idx on public.dsr_request (org_id, status, due_at);
create index dsr_request_user_idx on public.dsr_request (org_id, user_id);

/* ------------------------------------------------------------------ *
 * Error reports and answer challenges (FR-SUP-01..05)
 * ------------------------------------------------------------------ */

create table public.error_report (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  question_version_id uuid not null references public.question_version (id) on delete restrict,
  attempt_id uuid references public.attempt (id) on delete restrict,
  kind public.report_kind not null default 'CONTENT_ERROR',
  -- FR-SUP-03: a written reason is mandatory. A one-tap report is an
  -- amplification mechanism, not a signal.
  reason text not null,
  status public.report_status not null default 'OPEN',
  -- Weighted by the reporter historical precision. A coordinated campaign of
  -- three thousand reports raises an item for review; it must never void one
  -- (FR-SUP-04, AC-SUP-01). Volume is not evidence.
  reporter_precision numeric(4, 3),
  challenge_window_closes_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  -- FR-ADM-08: a public note visible to every challenger, not a private
  -- disposition.
  public_resolution_note text,
  created_at timestamptz not null default now(),
  constraint error_report_reason_substantive check (length(btrim(reason)) >= 10)
);

comment on table public.error_report is
  'Error reports and time-boxed answer challenges (FR-SUP-01, FR-SUP-02). Deduplicated per (question_version, user) so one student cannot manufacture volume, and volume alone can never trigger a void (FR-SUP-04).';

create unique index error_report_dedupe_uidx
  on public.error_report (question_version_id, user_id);
create index error_report_org_user_idx on public.error_report (org_id, user_id);
create index error_report_triage_idx on public.error_report (org_id, status, created_at desc);
create index error_report_item_idx on public.error_report (question_version_id, status);

/* ------------------------------------------------------------------ *
 * Notifications (FR-NOT-01..05)
 * ------------------------------------------------------------------ */

create table public.notification_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  category public.notification_category not null,
  template_key text not null,
  channel text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  suppressed_reason text,
  created_at timestamptz not null default now()
);

comment on table public.notification_outbox is
  'Outbound notifications with server-side gating (FR-NOT-01, FR-NOT-02). TRANSACTIONAL messages -- rescore, key revision, incident, refund -- are never suppressed by a marketing frequency cap (FR-NOT-04). Push is never the sole channel for a live test start; an in-app surface carries the same information (FR-NOT-05).';

create index notification_outbox_pending_idx on public.notification_outbox (scheduled_for)
  where sent_at is null and suppressed_reason is null;
create index notification_outbox_org_user_idx on public.notification_outbox (org_id, user_id, created_at desc);

create function app.tg_notification_gate() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_local time;
  v_tz text;
  v_suspended date;
begin
  if new.category = 'TRANSACTIONAL' then
    -- Never suppressed. A student must learn that their score changed
    -- (FR-NOT-04); a frequency cap that swallows that is a defect.
    return new;
  end if;

  select p.time_zone into v_tz from public.profile p where p.user_id = new.user_id;
  v_local := (new.scheduled_for at time zone coalesce(v_tz, 'Asia/Kolkata'))::time;

  -- FR-NOT-01: quiet hours are enforced server-side and campaign configuration
  -- cannot override them. Expressed here rather than in the composer because
  -- the composer is the thing a campaign misconfigures.
  if v_local >= time '21:30' or v_local < time '07:00' then
    new.suppressed_reason := 'QUIET_HOURS';
    return new;
  end if;

  if new.category = 'ENGAGEMENT' then
    -- FR-RWD-13, AC-RWD-02: no re-engagement push for a student whose declared
    -- exam is imminent or in progress.
    select s.suspended_until into v_suspended from public.streak s where s.user_id = new.user_id;
    if v_suspended is not null and v_suspended >= current_date then
      new.suppressed_reason := 'EXAM_WINDOW_SUPPRESSION';
      return new;
    end if;

    -- FR-NOT-03, NFR-PRV-03: engagement messaging to a minor is not a tuning
    -- question. Behavioural profiling and per-user optimised timing for
    -- children are prohibited, so the whole category is refused.
    if app.is_minor(new.user_id) then
      new.suppressed_reason := 'MINOR_ENGAGEMENT_BLOCKED';
      return new;
    end if;
  end if;

  return new;
end;
$$;

create trigger notification_gate
  before insert on public.notification_outbox
  for each row execute function app.tg_notification_gate();

/* ------------------------------------------------------------------ *
 * Telemetry -- two physically separate pipelines (NFR-PRV-02)
 * ------------------------------------------------------------------ */

create table public.telemetry_pedagogical_event (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  event_key text not null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

comment on table public.telemetry_pedagogical_event is
  'The disclosed, defensible, guardian-visible pipeline (NFR-PRV-02): what was practised, what was answered, what is due. Lawful for a child principal because it is the service the guardian consented to.';

create index telemetry_pedagogical_org_user_idx
  on public.telemetry_pedagogical_event (org_id, user_id, occurred_at desc);
create index telemetry_pedagogical_brin_idx
  on public.telemetry_pedagogical_event using brin (occurred_at) with (pages_per_range = 32);

create table public.telemetry_engagement_event (
  id uuid not null default extensions.gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  event_key text not null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

comment on table public.telemetry_engagement_event is
  'The engagement pipeline: session length, funnel, retention. Physically separate from the pedagogical one and blocked entirely for under-18 principals at the gateway (NFR-PRV-02). The trigger below is the second line, not the first -- AC-PRV-01 is verified at the gateway.';

create index telemetry_engagement_org_user_idx
  on public.telemetry_engagement_event (org_id, user_id, occurred_at desc);
create index telemetry_engagement_brin_idx
  on public.telemetry_engagement_event using brin (occurred_at) with (pages_per_range = 32);

create function app.tg_block_minor_engagement() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- NFR-PRV-02, NFR-PRV-03. Behavioural monitoring of children is unlawful, not
  -- merely inadvisable. A row here for a minor is a compliance incident, so it
  -- raises rather than silently dropping: silent drops hide a broken gateway.
  if app.is_minor(new.user_id) then
    raise exception
      'engagement telemetry is prohibited for under-18 principals (NFR-PRV-02)'
      using errcode = '42501',
            hint = 'The gateway must drop this event. If it reached the database, the gateway block is broken.';
  end if;
  return new;
end;
$$;

create trigger telemetry_engagement_minor_block
  before insert on public.telemetry_engagement_event
  for each row execute function app.tg_block_minor_engagement();

/* ------------------------------------------------------------------ *
 * Subprocessor register (FR-ADM-19, NFR-PRV-04)
 * ------------------------------------------------------------------ */

create table public.subprocessor (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique,
  purpose text not null,
  data_categories text not null,
  -- NFR-PRV-04: any processor operating outside the jurisdiction is assessed
  -- before inclusion. Recorded so the assessment is a fact and not a memory.
  jurisdiction text not null,
  cross_border_transfer boolean not null,
  assessment_ref text,
  added_on date not null default current_date,
  removed_on date
);

comment on table public.subprocessor is
  'The subprocessor register (FR-ADM-19). Two of the obvious analytics choices are US processors that would be profiling children; this table exists so that decision is visible rather than incidental.';

commit;
