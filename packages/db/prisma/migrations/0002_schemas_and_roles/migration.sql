-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0002_schemas_and_roles.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0002_schemas_and_roles.sql
--
-- Schema layout, default-privilege hygiene, the server-owned role and
-- capability vocabulary, and the policy helper functions every later migration
-- depends on.
--
-- Three schemas:
--
--   public   client-exposed through PostgREST. Every table here ships with RLS
--            enabled and at least one policy, or it does not ship (NFR-SEC-01).
--   private  NOT exposed. Answer keys, solutions, per-option rationales, role
--            assignments and licence evidence live here with zero grants to
--            `authenticated` (NFR-SEC-02). RLS controls rows, never columns, so
--            a sensitive column sitting on an otherwise-readable table is one
--            `?select=` away from a full dump. Schema separation is the control.
--   app      helper functions only, no tables of consequence. `authenticated`
--            gets USAGE and EXECUTE on named functions so RLS policies can call
--            them; it never gets to read what they read.
--
-- Requirements: FR-TEN-01..04, FR-IDN-08..10, NFR-SEC-01, NFR-SEC-02, NFR-SEC-06.


/* ------------------------------------------------------------------ *
 * Compatibility bootstrap
 *
 * Supabase provisions `anon`, `authenticated`, `service_role` and the `auth`
 * schema. A bare Postgres instance -- which is what a fast migration test
 * harness uses -- does not. Everything below is a no-op on a real Supabase
 * project and makes the migration set self-contained everywhere else.
 * ------------------------------------------------------------------ */

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

-- Minimal stand-ins. Created only when absent, so the real Supabase auth schema
-- is never shadowed or altered.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
  ) then
    create table auth.users (
      id uuid primary key default extensions.gen_random_uuid(),
      email text,
      phone text,
      created_at timestamptz not null default now()
    );
    comment on table auth.users is
      'Compatibility stand-in for the Supabase auth.users table. Never created on a real project.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'jwt'
  ) then
    execute $fn$
      create function auth.jwt() returns jsonb
      language sql stable
      as 'select coalesce(nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb, ''{}''::jsonb)';
    $fn$;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as 'select nullif(auth.jwt() ->> ''sub'', '''')::uuid';
    $fn$;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'role'
  ) then
    execute $fn$
      create function auth.role() returns text
      language sql stable
      as 'select coalesce(auth.jwt() ->> ''role'', ''anon'')';
    $fn$;
  end if;
end;
$$;

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

create schema if not exists private;
create schema if not exists app;

comment on schema private is
  'Non-exposed schema. Answer keys, solutions, per-option rationales, role assignments and licence evidence. Zero grants to anon or authenticated (NFR-SEC-02); reachable only through SECURITY DEFINER RPCs that check state.';
comment on schema app is
  'Policy and RPC helper functions. No client-readable data. USAGE is granted so RLS policies can call these; the underlying private tables stay unreadable.';

-- Belt and braces: `private` must never become reachable, even if a later
-- migration forgets and grants something table-wide.
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

grant usage on schema app to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

/* ------------------------------------------------------------------ *
 * Default privileges
 *
 * Postgres grants EXECUTE on new functions to PUBLIC and, on Supabase, the
 * project template grants table privileges to anon and authenticated. Both
 * defaults are wrong here: a table must be granted deliberately, alongside the
 * policy that makes the grant safe. Every later migration in this package
 * grants explicitly.
 * ------------------------------------------------------------------ */

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from public;

/* ------------------------------------------------------------------ *
 * Role and capability vocabulary (FR-IDN-08, FR-IDN-09)
 *
 * Roles are server-owned rows, projected into the JWT by the access-token hook
 * below. They are never read from `user_metadata`, which the user can write --
 * that would be a one-line privilege escalation (AC-IDN-02).
 * ------------------------------------------------------------------ */

create table private.permission (
  key text primary key,
  description text not null,
  is_destructive boolean not null default false
);

comment on table private.permission is
  'The capability vocabulary (FR-IDN-09). Exists in full from v1 even though only ADMIN and STUDENT are populated, so adding REVIEWER or SUBJECT_LEAD later is an INSERT and not a migration.';
comment on column private.permission.is_destructive is
  'Destructive capabilities are re-verified inside a SECURITY DEFINER RPC against the live table rather than against the cached JWT claim (FR-IDN-10). A revoked admin must lose the capability before their token expires.';

create table private.app_role (
  key text primary key,
  description text not null,
  is_user_facing boolean not null default true
);

comment on table private.app_role is
  'Role keys. The product exposes two roles (STUDENT, ADMIN); the table exists so the internal decomposition into six capability sets (FR-IDN-08) is row data.';

create table private.role_permission (
  role_key text not null references private.app_role (key) on delete restrict,
  permission_key text not null references private.permission (key) on delete restrict,
  primary key (role_key, permission_key)
);

comment on table private.role_permission is
  'Role to capability mapping. Lives in the private schema: a student who can read this can enumerate exactly which capability to target.';

create table private.user_role (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- FR-TEN-01: a role grant is always scoped to one org. A user who administers
  -- org A must be an ordinary student in org B.
  org_id uuid not null,
  role_key text not null references private.app_role (key) on delete restrict,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text
);

comment on table private.user_role is
  'Server-owned role assignments (FR-IDN-08). Never in the exposed schema, never in user_metadata. Revocation is a timestamp, never a delete, because the audit trail must survive it.';

create unique index user_role_active_uidx
  on private.user_role (user_id, org_id, role_key)
  where revoked_at is null;

create index user_role_lookup_idx
  on private.user_role (user_id, org_id)
  where revoked_at is null;

-- RLS on a private table is defence in depth, not the control. There are no
-- grants and no policies, so any accidental future grant still denies. The
-- definer functions below run as the table owner and are unaffected.
alter table private.permission enable row level security;
alter table private.app_role enable row level security;
alter table private.role_permission enable row level security;
alter table private.user_role enable row level security;

insert into private.permission (key, description, is_destructive) values
  ('questions.write',    'Create and edit question drafts and versions',        false),
  ('questions.approve',  'Approve a question version for publication',          false),
  ('tests.publish',      'Publish a test, freezing its composition',            true),
  ('keys.revise',        'Create a new answer key version and enqueue rescore', true),
  ('attempts.extend',    'Grant a deadline extension against an incident',      true),
  ('rewards.configure',  'Configure earn rules, caps and the global mint cap',  true),
  ('users.ban',          'Ban a user and revoke their sessions',                true),
  ('analytics.read',     'Read cohort analytics and per-attempt inspection',    false),
  ('audit.read',         'Read the append-only audit log',                      false);

insert into private.app_role (key, description, is_user_facing) values
  ('STUDENT',      'Primary user. Sits attempts, practises, reviews.', true),
  ('GUARDIAN',     'Verified parent. Read-only progress view.',        true),
  ('ADMIN',        'Platform or institute administrator.',             true),
  ('REVIEWER',     'Editorial second approver. Not populated in v1.',  false),
  ('SUBJECT_LEAD', 'Owns a subject bank. Not populated in v1.',        false),
  ('OPS',          'Live operations and compensation. Not in v1.',     false),
  ('ANALYST',      'Read-only analytics. Not populated in v1.',        false);

insert into private.role_permission (role_key, permission_key) values
  ('ADMIN', 'questions.write'),
  ('ADMIN', 'questions.approve'),
  ('ADMIN', 'tests.publish'),
  ('ADMIN', 'keys.revise'),
  ('ADMIN', 'attempts.extend'),
  ('ADMIN', 'rewards.configure'),
  ('ADMIN', 'users.ban'),
  ('ADMIN', 'analytics.read'),
  ('ADMIN', 'audit.read'),
  ('REVIEWER', 'questions.write'),
  ('REVIEWER', 'questions.approve'),
  ('SUBJECT_LEAD', 'questions.write'),
  ('SUBJECT_LEAD', 'questions.approve'),
  ('SUBJECT_LEAD', 'analytics.read'),
  ('OPS', 'attempts.extend'),
  ('OPS', 'analytics.read'),
  ('ANALYST', 'analytics.read');

/* ------------------------------------------------------------------ *
 * Well-known org identifiers
 *
 * Two orgs exist before any tenant does. Both are fixed UUIDs so that policies
 * and seed data can reference them without a lookup.
 * ------------------------------------------------------------------ */

create function app.platform_org_id() returns uuid
language sql immutable parallel safe
as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

comment on function app.platform_org_id() is
  'Owner of the shared content catalogue: canonical taxonomy, exam patterns, PYQ bank. Every tenant may read its published content; only platform admins may write it.';

create function app.default_org_id() returns uuid
language sql immutable parallel safe
as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

comment on function app.default_org_id() is
  'The self-serve B2C tenant (FR-TEN-01). A student who signs up without an institute lands here, so org_id is never nullable anywhere.';

/* ------------------------------------------------------------------ *
 * Policy helpers
 *
 * Policies must not contain joins (skill.md add-table, step 8): a join inside a
 * policy is re-planned per row and leaks table structure into the policy. These
 * helpers are SECURITY DEFINER with an explicitly empty search path, so the
 * policy is a predicate over the row's own columns plus a function call.
 *
 * Call them wrapped -- `(select app.has_permission('tests.publish'))` -- so the
 * planner hoists the call into an InitPlan and evaluates it once per statement
 * rather than once per row.
 * ------------------------------------------------------------------ */

create function app.jwt_claim(p_claim text) returns text
language sql stable parallel safe
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> p_claim;
$$;

comment on function app.jwt_claim(text) is
  'Reads a top-level custom claim written by the access-token hook. Top-level claims are server-signed and unreachable from user_metadata, which is client-writable (FR-TEN-03, FR-IDN-08).';

create function app.current_org_id() returns uuid
language plpgsql stable parallel safe
set search_path = ''
as $$
declare
  v_claim text;
  v_org uuid;
begin
  v_claim := app.jwt_claim('org_id');
  if v_claim is not null then
    return v_claim::uuid;
  end if;

  -- Fallback for the window between signup and the first token refresh, and for
  -- background workers that authenticate without going through the hook. The
  -- profile row is server-owned, so this is not a weaker check than the claim --
  -- it is the same fact read from the same place the hook reads it.
  select p.org_id into v_org from public.profile p where p.user_id = auth.uid();
  return v_org;
end;
$$;

comment on function app.current_org_id() is
  'The caller org for tenancy predicates (FR-TEN-02, FR-TEN-03). Claim first, server-owned profile row as fallback. Never reads user_metadata.';

create function app.has_permission(p_permission text) returns boolean
language plpgsql stable parallel safe
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    return false;
  end if;
  v_org := app.current_org_id();
  if v_org is null then
    return false;
  end if;

  -- Live table read, not a cached claim (FR-IDN-10). A revoked admin loses the
  -- capability immediately rather than at token expiry.
  return exists (
    select 1
    from private.user_role ur
    join private.role_permission rp on rp.role_key = ur.role_key
    where ur.user_id = v_user
      and ur.org_id = v_org
      and ur.revoked_at is null
      and rp.permission_key = p_permission
  );
end;
$$;

comment on function app.has_permission(text) is
  'Capability check against the live role tables. Used in policies wrapped in a subselect so it evaluates once per statement.';

create function app.is_admin() returns boolean
language plpgsql stable parallel safe
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    return false;
  end if;
  v_org := app.current_org_id();
  return exists (
    select 1 from private.user_role ur
    where ur.user_id = v_user
      and ur.org_id = v_org
      and ur.role_key = 'ADMIN'
      and ur.revoked_at is null
  );
end;
$$;

create function app.is_platform_admin() returns boolean
language plpgsql stable parallel safe
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return false;
  end if;
  -- The only principal permitted to write the shared catalogue. Deliberately
  -- not "admin of any org": an institute admin must never edit PYQ content
  -- every other tenant reads.
  return exists (
    select 1 from private.user_role ur
    where ur.user_id = v_user
      and ur.org_id = app.platform_org_id()
      and ur.role_key = 'ADMIN'
      and ur.revoked_at is null
  );
end;
$$;

comment on function app.is_platform_admin() is
  'Writer of the shared catalogue owned by the platform org. Distinct from app.is_admin(), which is tenant-scoped.';

grant execute on function app.jwt_claim(text) to authenticated;
grant execute on function app.current_org_id() to authenticated;
grant execute on function app.has_permission(text) to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.is_platform_admin() to authenticated;
grant execute on function app.platform_org_id() to authenticated, anon;
grant execute on function app.default_org_id() to authenticated, anon;

/* ------------------------------------------------------------------ *
 * Access token hook (FR-IDN-08, FR-TEN-03)
 *
 * Projects org and capabilities into top-level, server-signed claims. Supabase
 * calls this as `supabase_auth_admin` on every token issue and refresh.
 * ------------------------------------------------------------------ */

create function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_org uuid;
  v_roles jsonb;
  v_perms jsonb;
begin
  select p.org_id into v_org from public.profile p where p.user_id = v_user;

  select coalesce(jsonb_agg(distinct ur.role_key), '[]'::jsonb)
    into v_roles
  from private.user_role ur
  where ur.user_id = v_user
    and ur.revoked_at is null
    and ur.org_id = v_org;

  select coalesce(jsonb_agg(distinct rp.permission_key), '[]'::jsonb)
    into v_perms
  from private.user_role ur
  join private.role_permission rp on rp.role_key = ur.role_key
  where ur.user_id = v_user
    and ur.revoked_at is null
    and ur.org_id = v_org;

  -- Top level, not app_metadata and never user_metadata. A claim the user can
  -- write is not an authorisation input (AC-IDN-02).
  v_claims := v_claims
    || jsonb_build_object('org_id', v_org)
    || jsonb_build_object('roles', v_roles)
    || jsonb_build_object('perms', v_perms);

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

comment on function private.custom_access_token_hook(jsonb) is
  'Supabase custom access token hook (FR-IDN-08, FR-TEN-03). Projects the server-owned org and capability set into top-level claims. Claims are a fast path only: every destructive capability is re-verified against the live table inside its RPC (FR-IDN-10).';

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant select on private.user_role, private.role_permission to supabase_auth_admin;
    revoke execute on function private.custom_access_token_hook(jsonb) from authenticated, anon, public;
  end if;
end;
$$;
