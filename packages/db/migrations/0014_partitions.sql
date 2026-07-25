-- 0014_partitions.sql
--
-- Partition maintenance for every range-partitioned table in the schema
-- (NFR-SCL-08). This is the migration that 0008 refers to.
--
-- Eight tables are declared `partition by range` across 0008, 0009, 0010 and
-- 0012, and until this file runs not one of them has a single partition. A
-- range-partitioned table with no partition covering the incoming key does not
-- degrade, does not spill and does not warn: every INSERT raises
--
--   no partition of relation "attempt_response" found for row
--
-- simultaneously, for every student in every org, mid-exam. It is the most
-- consequential single line of DDL in the package and it is the one that is
-- easiest to leave until later, because an empty development database never
-- notices.
--
-- Three decisions, recorded because none is self-evident:
--
-- 1. The table list is derived from `pg_catalog.pg_partitioned_table` rather
--    than hard-coded. A hard-coded list is a list that silently stops covering
--    the ninth partitioned table somebody adds in 0015, and the failure mode of
--    that omission is the outage described above.
--
-- 2. Every partitioned table gets a DEFAULT partition. The design note in 0008
--    treats a missing partition as fail-fast, and fail-fast is the correct
--    instinct for a scoring bug -- but not here, where the blast radius is
--    every in-flight attempt on the platform and the cause is a cron job that
--    did not run. The default turns a total write outage into a row landing in
--    the wrong file, which is recoverable. It is a net, not a substitute: the
--    coverage assertion at the foot of this file still requires three future
--    months, so the default stays empty in normal operation. When it is empty,
--    attaching the next month's partition scans nothing and costs nothing.
--
-- 3. Partitions get RLS enabled and no grants. Access is routed through the
--    parent, where the policies in 0013 apply; a partition addressed directly
--    by name has no grant to reach it and no policy to satisfy if it somehow
--    did. Belt and braces, in the one place where a naming convention is
--    guessable from the outside.
--
-- Requirements: NFR-SCL-08, NFR-AVL-03.

begin;

/* ------------------------------------------------------------------ *
 * Maintenance
 * ------------------------------------------------------------------ */

create function app.ensure_time_partitions(p_months_ahead integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_rel     record;
  v_i       integer;
  v_start   timestamptz;
  v_end     timestamptz;
  v_child   text;
  v_created integer := 0;
begin
  -- NFR-SCL-08 names three as the floor. Refusing a smaller argument matters
  -- because the obvious way to make a slow maintenance job faster is to shrink
  -- the horizon, and the cost of that shows up a month later as an outage.
  if p_months_ahead is null or p_months_ahead < 3 then
    raise exception 'NFR-SCL-08 requires at least three future partitions, got %', p_months_ahead
      using hint = 'Call app.ensure_time_partitions(3) or higher.';
  end if;

  for v_rel in
    select n.nspname::text as schema_name,
           c.relname::text as table_name
    from pg_catalog.pg_partitioned_table pt
    join pg_catalog.pg_class c on c.oid = pt.partrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where pt.partstrat = 'r'      -- range only; a list-partitioned table is not time-keyed
      and pt.partnatts = 1
      and n.nspname in ('public', 'private')
    order by n.nspname, c.relname
  loop
    -- The default first, so that a table created between two runs of this
    -- function is never briefly without any partition at all.
    v_child := v_rel.table_name || '_pdefault';
    if pg_catalog.to_regclass(pg_catalog.format('%I.%I', v_rel.schema_name, v_child)) is null then
      execute pg_catalog.format(
        'create table %I.%I partition of %I.%I default',
        v_rel.schema_name, v_child, v_rel.schema_name, v_rel.table_name);
      execute pg_catalog.format(
        'alter table %I.%I enable row level security', v_rel.schema_name, v_child);
      v_created := v_created + 1;
    end if;

    -- The current month through p_months_ahead inclusive.
    for v_i in 0 .. p_months_ahead loop
      v_start := pg_catalog.date_trunc('month', pg_catalog.now())
                 + (v_i::text || ' months')::interval;
      v_end := v_start + '1 month'::interval;
      v_child := v_rel.table_name || '_p' || pg_catalog.to_char(v_start, 'YYYY_MM');

      if pg_catalog.to_regclass(pg_catalog.format('%I.%I', v_rel.schema_name, v_child)) is null then
        execute pg_catalog.format(
          'create table %I.%I partition of %I.%I for values from (%L) to (%L)',
          v_rel.schema_name, v_child, v_rel.schema_name, v_rel.table_name, v_start, v_end);
        execute pg_catalog.format(
          'alter table %I.%I enable row level security', v_rel.schema_name, v_child);
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;

  return v_created;
end;
$fn$;

comment on function app.ensure_time_partitions(integer) is
  'Creates the current month plus p_months_ahead future monthly partitions, and a DEFAULT partition, for every range-partitioned table in public and private (NFR-SCL-08). Idempotent: existing partitions are left alone, so it is safe to run from cron every day. Derives its table list from the catalogue so a newly partitioned table is covered without editing this function.';

-- Scheduled maintenance runs as service_role. `authenticated` is deliberately
-- absent: this function creates tables.
revoke execute on function app.ensure_time_partitions(integer) from public;
grant execute on function app.ensure_time_partitions(integer) to service_role;

/* ------------------------------------------------------------------ *
 * Coverage, for monitoring
 *
 * The maintenance job failing silently is the realistic failure, not the DDL
 * being wrong. This is the query an alert runs: anything below three is a page,
 * not a ticket, because the deadline is a month away and immovable.
 * ------------------------------------------------------------------ */

create function app.partition_coverage()
returns table (partitioned_table text, months_ahead integer, has_default boolean)
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    (n.nspname || '.' || c.relname)::text,
    (
      select pg_catalog.count(*)::integer
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class ch on ch.oid = i.inhrelid
      where i.inhparent = c.oid
        -- The naming convention is owned by ensure_time_partitions above, which
        -- makes a suffix comparison exact rather than a heuristic.
        and pg_catalog.right(ch.relname::text, 7)
            > pg_catalog.to_char(pg_catalog.now(), 'YYYY_MM')
    ),
    exists (
      select 1
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class ch on ch.oid = i.inhrelid
      where i.inhparent = c.oid
        and ch.relname::text = c.relname::text || '_pdefault'
    )
  from pg_catalog.pg_partitioned_table pt
  join pg_catalog.pg_class c on c.oid = pt.partrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where pt.partstrat = 'r'
    and pt.partnatts = 1
    and n.nspname in ('public', 'private')
  order by 1;
$fn$;

comment on function app.partition_coverage() is
  'Months of forward partition coverage per range-partitioned table. Fewer than three violates NFR-SCL-08; zero means the next month rolls over into the DEFAULT partition and the maintenance job has been failing unnoticed.';

revoke execute on function app.partition_coverage() from public;
grant execute on function app.partition_coverage() to service_role;

/* ------------------------------------------------------------------ *
 * Initial build, and the assertion that it worked
 * ------------------------------------------------------------------ */

do $$
declare
  v_created integer;
begin
  v_created := app.ensure_time_partitions(3);
  raise notice 'ensure_time_partitions created % partition(s)', v_created;
end;
$$;

-- A migration that claims to have fixed the outage and did not is worse than
-- one that never ran, because the alert is now green. Fail the migration here
-- rather than discovering it from a support queue during a live window.
do $$
declare
  v_bad text;
begin
  select pg_catalog.string_agg(
           pc.partitioned_table || ' (' || pc.months_ahead || ' month(s) ahead)', ', ')
    into v_bad
  from app.partition_coverage() pc
  where pc.months_ahead < 3 or not pc.has_default;

  if v_bad is not null then
    raise exception 'NFR-SCL-08 not satisfied after partition build: %', v_bad;
  end if;
end;
$$;

commit;
