-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0015_policy_helper_security.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0015_policy_helper_security.sql
--
-- Makes the policy helpers SECURITY DEFINER, which 0002 says they are and the
-- code did not do.
--
-- The block comment above the helpers in 0002 reads:
--
--   "These helpers are SECURITY DEFINER with an explicitly empty search path,
--    so the policy is a predicate over the row's own columns plus a function
--    call."
--
-- Only the second half was true. Every one of them shipped as INVOKER, and the
-- gap was invisible for as long as no policy called them -- which was the case
-- until 0013. Three separate failures follow from it, and all three are
-- runtime, not compile time:
--
-- 1. `permission denied for table user_role`. app.has_permission(),
--    app.is_admin() and app.is_platform_admin() read `private.user_role`. That
--    schema has zero grants to `authenticated` by design (NFR-SEC-02), so
--    every policy that asks whether the caller is an admin raises instead of
--    answering. Under RLS a raising predicate is not a denied row; it is a
--    failed statement, so this breaks reads for students too.
--
-- 2. Infinite recursion on public.profile. app.current_org_id() falls back to
--    reading `public.profile` when the org claim is absent -- which is exactly
--    the window between signup and the first token refresh that the fallback
--    exists to cover. With RLS enabled on profile, that read evaluates the
--    profile policy, which calls app.current_org_id(), which reads profile.
--    Postgres detects the cycle and errors. The same cycle runs through
--    app.processing_allowed(), app.is_minor() and app.is_guardian_of().
--
-- 3. The access token hook silently issues a null org. It reads public.profile
--    as `supabase_auth_admin`, which is neither the table owner nor a grantee,
--    so RLS filters the row away and `org_id` comes back null -- for every
--    user, on every token issue and refresh. A null org claim then sends
--    app.current_org_id() down the fallback path in (2).
--
-- Definer is the correct answer rather than a workaround. These functions exist
-- precisely to read what the caller may not: that is what makes them usable as
-- a policy predicate instead of a join. Each one already pins an empty
-- search_path and schema-qualifies every reference, which is the property that
-- makes a definer function safe (NFR-SEC-06), and each returns a boolean or a
-- single uuid rather than any row the caller could not otherwise see.
--
-- app.solution_visible() in 0006 was already written this way. These are the
-- ones that were missed.
--
-- Requirements: NFR-SEC-02, NFR-SEC-06, FR-TEN-02, FR-TEN-03, FR-IDN-08,
--               FR-IDN-10, AC-IDN-01, AC-IDN-02.


/* ------------------------------------------------------------------ *
 * Tenancy
 * ------------------------------------------------------------------ */

create or replace function app.current_org_id() returns uuid
language plpgsql stable parallel safe
security definer
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
  --
  -- Definer matters here: as invoker this read re-enters the profile policy,
  -- which calls this function.
  select p.org_id into v_org from public.profile p where p.user_id = auth.uid();
  return v_org;
end;
$$;

/* ------------------------------------------------------------------ *
 * Capabilities
 *
 * All three read private.user_role, which `authenticated` has no grant on.
 * ------------------------------------------------------------------ */

create or replace function app.has_permission(p_permission text) returns boolean
language plpgsql stable parallel safe
security definer
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

create or replace function app.is_admin() returns boolean
language plpgsql stable parallel safe
security definer
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
  return exists (
    select 1 from private.user_role ur
    where ur.user_id = v_user
      and ur.org_id = v_org
      and ur.role_key = 'ADMIN'
      and ur.revoked_at is null
  );
end;
$$;

create or replace function app.is_platform_admin() returns boolean
language plpgsql stable parallel safe
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return false;
  end if;
  -- Deliberately not "admin of any org": an institute admin must never edit PYQ
  -- content every other tenant reads.
  return exists (
    select 1 from private.user_role ur
    where ur.user_id = v_user
      and ur.org_id = app.platform_org_id()
      and ur.role_key = 'ADMIN'
      and ur.revoked_at is null
  );
end;
$$;

/* ------------------------------------------------------------------ *
 * Identity gates
 *
 * All three read public.profile or public.guardian_link, both of which now
 * carry policies that call back into this set.
 * ------------------------------------------------------------------ */

create or replace function app.processing_allowed() returns boolean
language plpgsql stable parallel safe
security definer
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

create or replace function app.is_minor(p_user_id uuid) returns boolean
language plpgsql stable parallel safe
security definer
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

create or replace function app.is_guardian_of(p_child_user_id uuid) returns boolean
language plpgsql stable parallel safe
security definer
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

-- CREATE OR REPLACE preserves existing grants, but the default-privilege revoke
-- in 0002 applies only to newly created functions. Restating both is cheap and
-- makes the reachable set of a definer function explicit at the point it
-- becomes one.
revoke execute on function app.current_org_id() from public;
revoke execute on function app.has_permission(text) from public;
revoke execute on function app.is_admin() from public;
revoke execute on function app.is_platform_admin() from public;
revoke execute on function app.processing_allowed() from public;
revoke execute on function app.is_minor(uuid) from public;
revoke execute on function app.is_guardian_of(uuid) from public;

grant execute on function app.current_org_id() to authenticated;
grant execute on function app.has_permission(text) to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.is_platform_admin() to authenticated;
grant execute on function app.processing_allowed() to authenticated;
grant execute on function app.is_minor(uuid) to authenticated;
grant execute on function app.is_guardian_of(uuid) to authenticated;

/* ------------------------------------------------------------------ *
 * Access token hook
 *
 * Definer for the reason in (3) above, and extended with the two claims the
 * web client already reads.
 *
 * `is_minor` is projected because the client needs it to choose a notification
 * and telemetry path, and deriving it client-side would mean shipping the date
 * of birth to the browser to compute a boolean. It is a convenience for the
 * client only: the engagement pipeline is blocked at the gateway and again by
 * app.tg_block_minor_engagement, neither of which trusts this claim.
 * ------------------------------------------------------------------ */

create or replace function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_org uuid;
  v_display text;
  v_adult_from date;
  v_roles jsonb;
  v_perms jsonb;
begin
  select p.org_id, p.display_name, p.adult_from
    into v_org, v_display, v_adult_from
  from public.profile p
  where p.user_id = v_user;

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
    || jsonb_build_object('perms', v_perms)
    || jsonb_build_object('display_name', v_display)
    -- Same rule as app.is_minor(): unknown date of birth is a minor.
    || jsonb_build_object('is_minor', v_adult_from is null or v_adult_from > current_date);

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
    revoke execute on function private.custom_access_token_hook(jsonb) from authenticated, anon, public;
  end if;
end;
$$;
