-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0003_identity.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0003_identity.sql
--
-- Tenants, profiles, guardians and the consent ledger.
--
-- The governing fact: most students on this platform are 16 to 18 and are
-- therefore Children under the DPDP Act. Verifiable parental consent is the
-- default path, not an edge case (FR-IDN-03, D5). The schema makes that path
-- structural -- a profile whose consent state is not ACTIVE cannot reach
-- content or start an attempt, and that is enforced in policy, not in the
-- client.
--
-- Requirements: FR-TEN-01, FR-IDN-01..12, FR-COM-07, NFR-PRV-05, NFR-PRV-06.


/* ------------------------------------------------------------------ *
 * Shared trigger helpers
 *
 * Defined here because 0003 is the first migration that needs them; every
 * later migration in this package reuses them rather than redefining the
 * behaviour per table.
 * ------------------------------------------------------------------ */

create function app.tg_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'table %.% is append-only; % is not permitted',
    tg_table_schema, tg_table_name, tg_op
    using errcode = '42501',
          hint = 'Record a compensating row instead. Nothing a student has seen is edited in place.';
end;
$$;

comment on function app.tg_append_only() is
  'Blocks UPDATE and DELETE. Used on the consent ledger, coin ledger and audit log (FR-IDN-04, FR-RWD-03, FR-ADM-18). Enforced by trigger so a service-role client cannot bypass it the way it bypasses RLS.';

create function app.tg_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

/* ------------------------------------------------------------------ *
 * Enumerations
 * ------------------------------------------------------------------ */

create type public.org_kind as enum ('PLATFORM', 'SELF_SERVE', 'INSTITUTE');
create type public.org_status as enum ('ACTIVE', 'SUSPENDED', 'CLOSED');

create type public.consent_purpose as enum (
  'ACCOUNT',
  'ASSESSMENT_DELIVERY',
  'PEDAGOGICAL_ANALYTICS',
  'ENGAGEMENT_ANALYTICS',
  'TRANSACTIONAL_COMMS',
  'MARKETING_COMMS'
);

create type public.consent_action as enum ('GRANT', 'WITHDRAW');

-- DPDP Rules 2025 r.10 permits four verification mechanisms. A tick-box is
-- explicitly not one of them (FR-IDN-03), so there is no enum value for it.
create type public.consent_verification_method as enum (
  'IDENTITY_DETAILS_ALREADY_HELD',
  'DETAILS_VOLUNTARILY_SUPPLIED',
  'VIRTUAL_TOKEN_AUTHORISED_ENTITY',
  'DIGILOCKER_SERVICE_PROVIDER',
  'ADULT_SELF_CONSENT'
);

-- Ideation 5.11: guardian contact is collected for consent, not for selling to.
-- The promise is "we will never call you", and the enum is how that promise is
-- enforced rather than merely stated. There is no marketing value here, so a
-- marketing send against a guardian row cannot be expressed.
create type public.contact_purpose as enum (
  'CONSENT_VERIFICATION',
  'BREACH_NOTIFICATION',
  'PROGRESS_REPORT',
  'BILLING'
);

create type public.guardian_link_status as enum ('PENDING', 'VERIFIED', 'REVOKED', 'EXPIRED');

create type public.lawful_basis as enum ('CONSENT_ADULT', 'CONSENT_GUARDIAN');

-- Gate on every content and attempt policy. A minor sits in
-- PENDING_GUARDIAN_CONSENT until verifiable consent lands (AC-IDN-01).
create type public.processing_state as enum (
  'PENDING_DOB',
  'PENDING_GUARDIAN_CONSENT',
  'ACTIVE',
  'WITHDRAWN',
  'SUSPENDED'
);

/* ------------------------------------------------------------------ *
 * Org
 * ------------------------------------------------------------------ */

create table public.org (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind public.org_kind not null,
  status public.org_status not null default 'ACTIVE',
  -- FR-TEN-05 / Rajasthan Coaching Centres Act 2025 s.12(viii)-(ix): a centre
  -- may not publish internal assessment results. Default off, deliberately.
  publishes_ranks boolean not null default false,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.org is
  'A tenant (D1). Two exist before any customer does: the platform org owns the shared content catalogue, the default org holds self-serve B2C students so org_id is never nullable (FR-TEN-01).';
comment on column public.org.publishes_ranks is
  'Institute-controlled rank publication toggle, default off (FR-TEN-05). This is a compliance control, not a preference.';

insert into public.org (id, slug, name, kind, publishes_ranks) values
  (app.platform_org_id(), 'platform', 'Platform catalogue', 'PLATFORM', false),
  (app.default_org_id(), 'self-serve', 'Self-serve students', 'SELF_SERVE', false);

/* ------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------ */

create table public.profile (
  user_id uuid primary key references auth.users (id) on delete restrict,
  org_id uuid not null references public.org (id) on delete restrict,
  display_name text,
  -- Stable pseudonym for bucketed leaderboards (FR-RWD-08). Generated once and
  -- never derived from the display name, so opting into a leaderboard cannot
  -- expose a real name.
  pseudonym text not null default 'aspirant-' || substr(extensions.gen_random_uuid()::text, 1, 8),
  handle text unique,
  locale text not null default 'en-IN',
  time_zone text not null default 'Asia/Kolkata',

  -- FR-IDN-02: neutral capture. The column holds a date, never a self-declared
  -- "18+" flag, because a leading prompt teaches users to lie.
  birth_date date,
  -- Immutable arithmetic rather than a nightly job. FR-IDN-07's eighteenth
  -- birthday transition is then a query, not a scheduled mutation that can miss.
  adult_from date generated always as ((birth_date + interval '18 years')::date) stored,

  lawful_basis public.lawful_basis,
  processing_state public.processing_state not null default 'PENDING_DOB',
  consent_completed_at timestamptz,

  target_exam text,
  -- Drives FR-RWD-13 suppression: no streak breakage or re-engagement push for
  -- a student whose exam is imminent.
  target_exam_date date,

  banned_at timestamptz,
  ban_reason text,

  -- NFR-PRV-05 two-tier erasure. Identity columns are shredded; the statistical
  -- contribution stays so other students' percentiles remain sound. The mapping
  -- key is destroyed, which is what makes the retained rows non-personal.
  identity_shredded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profile_consent_needs_dob
    check (processing_state = 'PENDING_DOB' or birth_date is not null),
  constraint profile_active_needs_basis
    check (processing_state <> 'ACTIVE' or lawful_basis is not null)
);

comment on table public.profile is
  'One row per authenticated principal. Carries org_id (FR-TEN-01) and the processing state that gates every content and attempt policy (AC-IDN-01).';
comment on column public.profile.adult_from is
  'Generated: the date the principal turns 18 (FR-IDN-07). Stored so the lawful-basis transition and guardian-access revocation are indexable predicates rather than a nightly sweep that can silently miss a day.';
comment on column public.profile.processing_state is
  'A minor stays in PENDING_GUARDIAN_CONSENT until verifiable parental consent completes. Content, attempt and telemetry policies all require ACTIVE (FR-IDN-03, AC-IDN-01).';
comment on column public.profile.identity_shredded_at is
  'Set when a DSR erasure runs. Identity columns are nulled; attempt and result rows survive with the mapping destroyed (NFR-PRV-05).';

create index profile_org_idx on public.profile (org_id);
create index profile_org_user_idx on public.profile (org_id, user_id);
create index profile_minor_idx on public.profile (adult_from) where identity_shredded_at is null;
create index profile_exam_date_idx on public.profile (target_exam_date) where target_exam_date is not null;

create trigger profile_touch before update on public.profile
  for each row execute function app.tg_touch_updated_at();

/* ------------------------------------------------------------------ *
 * Guardian channel (FR-IDN-05, FR-COM-07)
 * ------------------------------------------------------------------ */

create table public.guardian_link (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  child_user_id uuid not null references public.profile (user_id) on delete restrict,
  -- Null until the guardian creates their own account. The contact details
  -- below are enough to obtain consent and to discharge the r.7 breach-
  -- intimation duty without one.
  guardian_user_id uuid references public.profile (user_id) on delete set null,
  guardian_name text,
  guardian_email text,
  guardian_phone text,
  contact_purpose public.contact_purpose not null default 'CONSENT_VERIFICATION',
  status public.guardian_link_status not null default 'PENDING',
  verification_method public.consent_verification_method,
  verified_at timestamptz,
  revoked_at timestamptz,
  -- FR-IDN-07: guardian read access auto-revokes when the child turns 18.
  auto_revoke_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint guardian_link_contactable
    check (guardian_email is not null or guardian_phone is not null or guardian_user_id is not null),
  constraint guardian_link_verified_has_method
    check (status <> 'VERIFIED' or (verification_method is not null and verified_at is not null))
);

comment on table public.guardian_link is
  'The guardian channel required for every child principal (FR-IDN-05). DPDP r.7 requires intimating the verified parent on a breach, so this cannot be an optional contact field on the profile.';
comment on column public.guardian_link.contact_purpose is
  'Purpose limitation enforced by type. The enum has no marketing value, so a marketing send to a guardian row is not expressible (ideation 5.11).';
comment on column public.guardian_link.auto_revoke_on is
  'Copied from profile.adult_from at creation. Guardian read access ends on the child eighteenth birthday (FR-IDN-07).';

create unique index guardian_link_active_uidx
  on public.guardian_link (child_user_id, coalesce(guardian_email, ''), coalesce(guardian_phone, ''))
  where revoked_at is null;
create index guardian_link_child_idx on public.guardian_link (org_id, child_user_id);
create index guardian_link_guardian_idx on public.guardian_link (org_id, guardian_user_id)
  where guardian_user_id is not null;

create trigger guardian_link_touch before update on public.guardian_link
  for each row execute function app.tg_touch_updated_at();

/* ------------------------------------------------------------------ *
 * Notices and the consent ledger (FR-IDN-04)
 * ------------------------------------------------------------------ */

create table public.notice_version (
  id uuid primary key default extensions.gen_random_uuid(),
  purpose public.consent_purpose not null,
  language text not null,
  version_no integer not null,
  title text not null,
  body_uri text not null,
  body_sha256 text not null,
  published_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (purpose, language, version_no)
);

comment on table public.notice_version is
  'The exact notice text a consent was given against, per language (FR-ADM-19). Consent without the notice version is not evidence of anything.';
comment on column public.notice_version.body_sha256 is
  'Content hash of the notice as served. Proves months later that the text shown was the text recorded.';

create index notice_version_current_idx on public.notice_version (purpose, language, version_no desc)
  where withdrawn_at is null;

create table public.consent_event (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  -- The principal whose data is processed. For a child this is the student,
  -- even though the consenting party is the guardian.
  user_id uuid not null references public.profile (user_id) on delete restrict,
  guardian_link_id uuid references public.guardian_link (id) on delete restrict,
  purpose public.consent_purpose not null,
  action public.consent_action not null,
  notice_version_id uuid not null references public.notice_version (id) on delete restrict,
  language text not null,
  verification_method public.consent_verification_method not null,
  -- Where the grant physically happened: 'WEB_SIGNUP', 'RN_ONBOARDING',
  -- 'GUARDIAN_EMAIL_LINK', 'ADMIN_CONSOLE'.
  source text not null,
  evidence_ref text,
  occurred_at timestamptz not null default now(),
  -- NFR-PRV-06: consent records are a distinct long-retention class.
  retention_class text not null default 'CONSENT_7Y',

  constraint consent_child_needs_guardian
    check (verification_method = 'ADULT_SELF_CONSENT' or guardian_link_id is not null)
);

comment on table public.consent_event is
  'Immutable consent ledger (FR-IDN-04). Every grant and withdrawal, with purpose, notice version, language, verification mechanism, source and timestamp. Append-only by trigger, seven-year retention class.';

create index consent_event_user_idx on public.consent_event (org_id, user_id, occurred_at desc);
create index consent_event_purpose_idx on public.consent_event (org_id, purpose, occurred_at desc);

create trigger consent_event_append_only
  before update or delete on public.consent_event
  for each row execute function app.tg_append_only();

/* ------------------------------------------------------------------ *
 * Devices (FR-IDN-11, FR-ATT-15)
 * ------------------------------------------------------------------ */

create table public.trusted_device (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete cascade,
  device_id text not null,
  device_label text,
  platform text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Null until a second factor has been satisfied on this device. FR-IDN-11:
  -- possession of the phone number alone is not identity.
  trusted_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, device_id)
);

comment on table public.trusted_device is
  'Device registry backing the second-factor requirement on a new device after dormancy (FR-IDN-11) and explicit session takeover during an attempt (FR-ATT-15).';

create index trusted_device_user_idx on public.trusted_device (org_id, user_id) where revoked_at is null;

/* ------------------------------------------------------------------ *
 * Identity helpers used by policies elsewhere
 * ------------------------------------------------------------------ */

create function app.processing_allowed() returns boolean
language plpgsql stable parallel safe
set search_path = ''
as $$
declare
  v_state public.processing_state;
begin
  select p.processing_state into v_state
  from public.profile p
  where p.user_id = auth.uid();
  return v_state = 'ACTIVE';
end;
$$;

comment on function app.processing_allowed() is
  'AC-IDN-01: a synthetic under-18 signup cannot reach question content, create an attempt or emit a telemetry event until verifiable parental consent completes. Content and attempt policies require this.';

create function app.is_minor(p_user_id uuid) returns boolean
language plpgsql stable parallel safe
set search_path = ''
as $$
declare
  v_adult_from date;
begin
  select p.adult_from into v_adult_from from public.profile p where p.user_id = p_user_id;
  -- Unknown date of birth is treated as a minor. The safe default is the
  -- restrictive one: an unknown-age principal must not reach the engagement
  -- pipeline (NFR-PRV-02).
  return v_adult_from is null or v_adult_from > current_date;
end;
$$;

comment on function app.is_minor(uuid) is
  'Age gate for the engagement telemetry pipeline and for profiling prohibitions (NFR-PRV-02, NFR-PRV-03, FR-NOT-03). Unknown date of birth means minor.';

create function app.is_guardian_of(p_child_user_id uuid) returns boolean
language plpgsql stable parallel safe
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return false;
  end if;
  return exists (
    select 1
    from public.guardian_link gl
    where gl.child_user_id = p_child_user_id
      and gl.guardian_user_id = v_user
      and gl.status = 'VERIFIED'
      and gl.revoked_at is null
      -- FR-IDN-07: access ends on the child eighteenth birthday, enforced here
      -- rather than by a job that might not have run yet.
      and (gl.auto_revoke_on is null or gl.auto_revoke_on > current_date)
  );
end;
$$;

comment on function app.is_guardian_of(uuid) is
  'Read-only guardian progress view (FR-IDN-05), self-revoking at 18 (FR-IDN-07). Used in policies so the guardian predicate is not a join.';

grant execute on function app.processing_allowed() to authenticated;
grant execute on function app.is_minor(uuid) to authenticated;
grant execute on function app.is_guardian_of(uuid) to authenticated;
