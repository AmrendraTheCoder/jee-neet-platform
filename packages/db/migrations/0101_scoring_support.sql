-- =====================================================================
-- 0101_scoring_support.sql
--
-- State and helpers the scoring, ranking and attempt-lifecycle functions
-- need: the durable scoring queue (FR-SCR-01), the score-revision ledger
-- (FR-SCR-15), the server shuffle secret (FR-ATT-10), the deterministic
-- PRNG port, and the small number of functions that encapsulate every
-- assumption this package makes about the schema in migrations 00xx.
--
-- ---------------------------------------------------------------------
-- SCHEMA COUPLING -- READ THIS BEFORE CHANGING ANYTHING BELOW
-- ---------------------------------------------------------------------
-- migrations 00xx are owned by another workstream. Rather than scatter
-- assumptions through eight files, every uncertain coupling is isolated
-- into one of the resolver functions in this file:
--
--   private.principal_org_id()        - org claim in the JWT (FR-TEN-03)
--   private.has_capability()          - role/capability lookup (FR-IDN-08/10)
--   private.test_tie_break_chain()    - where the tie-break chain lives
--   private.cohort_attempt_ids()      - which attempts are rank-eligible
--
-- Two defensive techniques are used deliberately and are not cargo cult:
--
--   1. `to_jsonb(row) ->> 'col'` instead of `row.col` for OPTIONAL columns.
--      It yields NULL when the column does not exist instead of failing to
--      parse, so a schema that omits, say, `attempt.shortened` degrades to
--      a documented default rather than breaking every scoring run.
--
--   2. `status::text = 'submitted'` instead of `status = 'submitted'`.
--      Works identically whether the column is text or an enum, and cannot
--      raise "invalid input value for enum" while merely READING.
--      (Writes still require the label to exist; see the note on
--      finalize_attempt in 0104.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Principal accessors
-- ---------------------------------------------------------------------

create or replace function private.principal_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- FR-TEN-03 / invariant 5. Reads the TOP-LEVEL org_id claim written by the
  -- server-owned custom access token hook. It deliberately does NOT read
  -- `user_metadata`, which the user can write -- doing so would make AC-TEN-02
  -- fail and every tenancy policy in the system decorative.
  select nullif(
           pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'org_id',
           '')::uuid
$$;

comment on function private.principal_org_id() is
  'FR-TEN-03. Org from the server-issued top-level JWT claim. Never from user_metadata.';

-- has_capability is created by the DO block below so that it can bind to
-- whichever schema migrations 00xx placed the role tables in. Invariant 3
-- says role assignments belong in the non-exposed schema; the 00xx plan
-- lists `user_roles` without a schema prefix. Rather than guess, resolve it
-- at migration time and fail CLOSED (deny everything, loudly) if neither
-- location exists.
do $do$
declare
  v_roles regclass := coalesce(
    pg_catalog.to_regclass('private.user_roles'),
    pg_catalog.to_regclass('public.user_roles'));
  v_perms regclass := coalesce(
    pg_catalog.to_regclass('private.role_permissions'),
    pg_catalog.to_regclass('public.role_permissions'));
  v_body text;
begin
  if v_roles is null then
    raise warning
      'private.has_capability(): no user_roles table found in private or public. '
      'Creating a deny-all stub. Every capability check will fail until the role '
      'tables ship (FR-IDN-08).';
    v_body := 'select false';
  elsif v_perms is null then
    -- No capability vocabulary yet (FR-IDN-09 ships it). Degrade to role
    -- membership rather than to "allow", which would be the wrong default.
    v_body := pg_catalog.format(
      'select exists (select 1 from %s ur where ur.user_id = $1 '
      '  and pg_catalog.upper(ur.role::text) in (''ADMIN'', ''SUPER_ADMIN''))',
      v_roles);
  else
    v_body := pg_catalog.format(
      'select exists (select 1 from %s ur join %s rp on rp.role = ur.role '
      '  where ur.user_id = $1 and rp.capability = $2)',
      v_roles, v_perms);
  end if;

  execute pg_catalog.format($fmt$
    create or replace function private.has_capability(p_user_id uuid, p_capability text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as %L
  $fmt$, v_body);
end;
$do$;

comment on function private.has_capability(uuid, text) is
  'FR-IDN-08 / FR-IDN-10. Re-verifies a capability against the live database, '
  'never against a cached JWT claim. Fails closed.';

-- ---------------------------------------------------------------------
-- The server shuffle secret (FR-ATT-10)
-- ---------------------------------------------------------------------
-- Lives in the non-exposed schema with zero grants. It is never returned by
-- any RPC and never reaches a client. Rotating it changes the seed of FUTURE
-- attempts only, because question_order and option_order are materialised
-- onto the attempt row at start and read thereafter -- so rotation cannot
-- reorder a paper a student is already sitting.

create table if not exists private.server_secret (
  name        text primary key,
  value       bytea not null,
  created_at  timestamptz not null default pg_catalog.now()
);

alter table private.server_secret enable row level security;

-- Invariant 3: a table ships with RLS enabled and at least one policy. This
-- one exists to make the intent explicit and auditable -- it grants nothing
-- to anyone, which is the correct policy for a secret store. Access is via
-- SECURITY DEFINER functions only.
drop policy if exists server_secret_no_access on private.server_secret;
create policy server_secret_no_access on private.server_secret
  for all to public using (false) with check (false);

-- Seeded from core primitives only (gen_random_bytes is pgcrypto, and this
-- package deliberately takes no extension dependency). Operations should
-- replace this with a secret from the platform's own key management before
-- the first live test; the default exists so that no environment can ever
-- start an attempt with a NULL seed.
insert into private.server_secret (name, value)
select 'attempt_shuffle',
       pg_catalog.sha256(pg_catalog.convert_to(
         pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, 'UTF8'))
where not exists (select 1 from private.server_secret where name = 'attempt_shuffle');

create or replace function private.server_secret_value(p_name text)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v bytea;
begin
  select s.value into v from private.server_secret s where s.name = p_name;
  if v is null then
    raise exception 'server secret % is not configured', p_name
      using errcode = 'invalid_parameter_value';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- HMAC-SHA256 (FR-ATT-10)
-- ---------------------------------------------------------------------
-- Built on core pg_catalog.sha256 rather than pgcrypto's hmac(), because the
-- scoring path must not depend on which schema an extension happened to be
-- installed into -- `search_path = ''` turns that into a hard failure at the
-- worst possible moment.

create or replace function private.hmac_sha256(p_key bytea, p_message bytea)
returns bytea
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_block constant integer := 64;
  v_key   bytea;
  v_ipad  bytea := pg_catalog.decode(pg_catalog.repeat('36', 64), 'hex');
  v_opad  bytea := pg_catalog.decode(pg_catalog.repeat('5c', 64), 'hex');
  i       integer;
  kb      integer;
begin
  v_key := case
    when pg_catalog.length(p_key) > v_block then pg_catalog.sha256(p_key)
    else p_key
  end;

  for i in 0 .. v_block - 1 loop
    kb := case when i < pg_catalog.length(v_key) then pg_catalog.get_byte(v_key, i) else 0 end;
    v_ipad := pg_catalog.set_byte(v_ipad, i, kb # 54);   -- 0x36
    v_opad := pg_catalog.set_byte(v_opad, i, kb # 92);   -- 0x5c
  end loop;

  return pg_catalog.sha256(v_opad || pg_catalog.sha256(v_ipad || p_message));
end;
$$;

-- ---------------------------------------------------------------------
-- Deterministic PRNG and seeded shuffle (FR-ATT-10, FR-ATT-11, EC-RAND-01)
-- ---------------------------------------------------------------------
-- Bit-for-bit port of mulberry32 + FNV-1a from
-- packages/domain/src/attempt/shuffle.ts. The port matters: an attempt's
-- order must be reproducible for dispute resolution months later, from
-- either side of the stack, and `random()` is not reproducible at all.
--
-- All arithmetic is unsigned 32-bit modular arithmetic in bigint. JavaScript
-- performs these operations on signed int32 values, but every operator used
-- (xor, shift, or, Math.imul, and the final >>> 0) preserves the bit pattern,
-- so the unsigned representation gives identical results.

create or replace function private.imul32(a bigint, b bigint)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Math.imul: the low 32 bits of a 32x32 product. Computed as two 16-bit
  -- halves because a full bigint product of two 32-bit values overflows
  -- int8 (2^64 > 9.22e18).
  select ((a & 65535) * b + (((a >> 16) * b) & 65535) * 65536) & 4294967295
$$;

create or replace function private.seeded_shuffle(p_items uuid[], p_seed text)
returns uuid[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_mask constant bigint := 4294967295;
  v_out  uuid[] := p_items;
  v_n    integer := coalesce(pg_catalog.array_length(p_items, 1), 0);
  h      bigint := 2166136261;   -- 0x811c9dc5, FNV-1a 32-bit offset basis
  a      bigint;
  t      bigint;
  r      numeric;
  i      integer;
  j      integer;
  tmp    uuid;
begin
  -- FNV-1a fold of the seed string. Seeds produced by this package are
  -- lowercase hex, so a per-character ascii() is exactly JavaScript's
  -- charCodeAt() over the same string.
  for i in 1 .. pg_catalog.length(coalesce(p_seed, '')) loop
    h := (h # pg_catalog.ascii(pg_catalog.substr(p_seed, i, 1))) & v_mask;
    h := private.imul32(h, 16777619);
  end loop;

  a := h;

  -- Fisher-Yates over a copy, descending, identical to seededShuffle().
  i := v_n - 1;
  while i > 0 loop
    a := (a + 1831565813) & v_mask;         -- 0x6d2b79f5
    t := a;
    t := private.imul32(t # (t >> 15), t | 1);
    t := (t # ((t + private.imul32(t # (t >> 7), t | 61)) & v_mask)) & v_mask;
    r := ((t # (t >> 14)) & v_mask)::numeric / 4294967296::numeric;

    j := pg_catalog.floor(r * (i + 1))::integer;

    tmp := v_out[i + 1];
    v_out[i + 1] := v_out[j + 1];
    v_out[j + 1] := tmp;

    i := i - 1;
  end loop;

  return v_out;
end;
$$;

comment on function private.seeded_shuffle(uuid[], text) is
  'FR-ATT-10 / EC-RAND-01. Bit-identical to seededShuffle() in @platform/domain, '
  'so an attempt order can be re-derived from either side of the stack years later.';

-- ---------------------------------------------------------------------
-- Durable scoring queue (FR-SCR-01, FR-SCR-03, EC-DATA-02, EC-HERD-08)
-- ---------------------------------------------------------------------
-- Submission is decoupled from scoring: finalize_attempt does an O(1) status
-- flip and enqueues here. At T+180min, 10,000 submissions arrive in about a
-- minute; grading inline would blow every per-request CPU budget there is and
-- the student would see "submission failed" on the highest-stakes action in
-- the product.
--
-- Durable Postgres rows rather than an external broker, so the enqueue is in
-- the same transaction as the status flip and cannot be lost between them.

create table if not exists private.scoring_queue (
  id           bigint generated always as identity primary key,
  attempt_id   uuid not null,
  org_id       uuid,
  enqueued_at  timestamptz not null default pg_catalog.now(),
  visible_at   timestamptz not null default pg_catalog.now(),
  read_ct      integer not null default 0,
  last_error   text,
  archived_at  timestamptz,
  dead_lettered boolean not null default false
);

-- One live message per attempt. A retried finalize, a sweeper pass and the
-- reconciler can all try to enqueue the same attempt; this makes that a no-op
-- instead of N duplicate scoring runs.
create unique index if not exists scoring_queue_live_attempt_idx
  on private.scoring_queue (attempt_id) where archived_at is null;

create index if not exists scoring_queue_visible_idx
  on private.scoring_queue (visible_at) where archived_at is null;

alter table private.scoring_queue enable row level security;
drop policy if exists scoring_queue_no_access on private.scoring_queue;
create policy scoring_queue_no_access on private.scoring_queue
  for all to public using (false) with check (false);

-- ---------------------------------------------------------------------
-- Rescore run ledger
-- ---------------------------------------------------------------------
-- Makes rescore_test idempotent at the level of the whole operation, not just
-- at the level of each row it writes. A redelivered rescore job finds the run
-- already recorded and returns the SAME snapshot id instead of emitting a
-- second identical leaderboard (AC-SCR-01).

create table if not exists private.rescore_run (
  test_id             uuid not null,
  answer_key_version  integer not null,
  snapshot_id         uuid,
  reason              text not null,
  attempts_rescored   integer not null default 0,
  attempts_changed    integer not null default 0,
  coins_topped_up     integer not null default 0,
  created_at          timestamptz not null default pg_catalog.now(),
  primary key (test_id, answer_key_version)
);

alter table private.rescore_run enable row level security;
drop policy if exists rescore_run_no_access on private.rescore_run;
create policy rescore_run_no_access on private.rescore_run
  for all to public using (false) with check (false);

-- ---------------------------------------------------------------------
-- Score revision ledger (FR-SCR-15, EC-DATA-03)
-- ---------------------------------------------------------------------
-- A rescore notification that says only "your score has been updated" is
-- worse than none: it moves the one number the candidate cares about most
-- without telling them why. This table is the durable before/after record
-- behind that notification, and the evidence in FR-ADM-20's "explain this
-- decision" export.
--
-- This table IS exposed (students must be able to read their own revisions),
-- so it carries org_id and ships with RLS and policies -- invariants 3 and 4.

create table if not exists public.score_revision (
  id                     uuid primary key default pg_catalog.gen_random_uuid(),
  org_id                 uuid not null,
  test_id                uuid not null,
  attempt_id             uuid not null,
  user_id                uuid not null,
  answer_key_version     integer not null,
  raw_score_before       numeric not null,
  raw_score_after        numeric not null,
  positive_marks_before  numeric not null,
  positive_marks_after   numeric not null,
  changes                jsonb not null default '[]'::jsonb,
  reason                 text not null,
  coin_top_up            integer not null default 0,
  created_at             timestamptz not null default pg_catalog.now(),
  constraint score_revision_once unique (attempt_id, answer_key_version),
  -- FR-SCR-16: clawback is prohibited, so a negative top-up must be
  -- unrepresentable rather than merely unwritten.
  constraint score_revision_top_up_non_negative check (coin_top_up >= 0)
);

create index if not exists score_revision_user_idx on public.score_revision (user_id, org_id);
create index if not exists score_revision_test_idx on public.score_revision (test_id, org_id);

alter table public.score_revision enable row level security;

drop policy if exists score_revision_own_read on public.score_revision;
create policy score_revision_own_read on public.score_revision
  for select to authenticated
  using (
    -- (select auth.uid()) rather than a bare auth.uid(): the bare form is
    -- re-evaluated once per row and the difference is orders of magnitude at
    -- cohort scale, invisible against a thousand development rows.
    user_id = (select auth.uid())
    and org_id = (select private.principal_org_id())   -- FR-TEN-02
  );

drop policy if exists score_revision_admin_read on public.score_revision;
create policy score_revision_admin_read on public.score_revision
  for select to authenticated
  using (
    org_id = (select private.principal_org_id())
    and (select private.has_capability((select auth.uid()), 'keys.revise'))
  );

-- Deliberately no INSERT/UPDATE/DELETE policy: revisions are written only by
-- rescore_test, which is SECURITY DEFINER. An append-only ledger nobody can
-- append to from the client is the point.

-- ---------------------------------------------------------------------
-- Tie-break chain resolver (FR-SCR-09)
-- ---------------------------------------------------------------------
-- The chain is DATA (invariant 1). It lives on the exam pattern, or on the
-- test when a test overrides it. Which of those the 00xx schema provides is
-- resolved here, once.

do $do$
declare
  v_test_has_chain boolean := exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = pg_catalog.to_regclass('public.test')
      and attname = 'tie_break' and attnum > 0 and not attisdropped);
  v_pattern regclass := pg_catalog.to_regclass('public.exam_pattern');
  v_pattern_has_chain boolean := v_pattern is not null and exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = v_pattern and attname = 'tie_break' and attnum > 0 and not attisdropped);
  v_body text;
begin
  if v_test_has_chain and v_pattern_has_chain then
    v_body := 'select coalesce(t.tie_break, p.tie_break) '
           || 'from public.test t left join public.exam_pattern p on p.id = t.exam_pattern_id '
           || 'where t.id = $1';
  elsif v_pattern_has_chain then
    v_body := 'select p.tie_break '
           || 'from public.test t join public.exam_pattern p on p.id = t.exam_pattern_id '
           || 'where t.id = $1';
  elsif v_test_has_chain then
    v_body := 'select t.tie_break from public.test t where t.id = $1';
  else
    raise warning
      'private.test_tie_break_chain(): no tie_break column on public.test or '
      'public.exam_pattern. rank_test will refuse to rank until one exists '
      '(FR-SCR-09, invariant 1).';
    v_body := 'select null::jsonb where $1 is not null';
  end if;

  execute pg_catalog.format($fmt$
    create or replace function private.test_tie_break_chain(p_test_id uuid)
    returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as %L
  $fmt$, v_body);
end;
$do$;

-- ---------------------------------------------------------------------
-- Rank-eligible cohort (FR-TST-06, FR-TST-07, FR-ANL-05, FR-ATT-18)
-- ---------------------------------------------------------------------
-- One definition, used by compute_percentiles, rank_test and rescore_test,
-- so a percentile and a rank can never disagree about who was in the cohort.

create or replace function private.cohort_attempt_ids(p_test_id uuid)
returns table (attempt_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.attempt a
  where a.test_id = p_test_id
    -- FR-ATT-18: an abandoned attempt is excluded from scores, averages,
    -- analytics and the leaderboard, and does not consume the ranked slot.
    and a.status::text = 'submitted'
    -- FR-TST-07: only one attempt per student per test is rank-eligible.
    -- Optional-column form: absent `ranked` means every submitted attempt
    -- counts, which is the correct behaviour for a single-attempt test.
    and coalesce((pg_catalog.to_jsonb(a) ->> 'ranked')::boolean, true)
    -- FR-TST-06: a late joiner on a truncated paper is not ranked against
    -- full-length attempts.
    and not coalesce((pg_catalog.to_jsonb(a) ->> 'shortened')::boolean, false)
$$;

revoke all on function private.principal_org_id() from public;
revoke all on function private.has_capability(uuid, text) from public;
revoke all on function private.server_secret_value(text) from public;
revoke all on function private.hmac_sha256(bytea, bytea) from public;
revoke all on function private.imul32(bigint, bigint) from public;
revoke all on function private.seeded_shuffle(uuid[], text) from public;
revoke all on function private.test_tie_break_chain(uuid) from public;
revoke all on function private.cohort_attempt_ids(uuid) from public;
