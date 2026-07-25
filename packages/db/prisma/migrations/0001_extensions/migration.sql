-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0001_extensions.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0001_extensions.sql
--
-- Extensions. Kept out of `public` deliberately: an extension in `public` puts
-- its functions on the default search path, which is exactly the surface a
-- `SECURITY DEFINER` function with a mutable search path gets hijacked through
-- (NFR-SEC-06). Everything here lands in `extensions`, and every definer
-- function in this schema sets `search_path = ''` and fully qualifies.
--
-- Requirements: NFR-SEC-06, NFR-AVL-05, FR-ATT-10, FR-ITM-13, FR-NTS-02.


-- Supabase provisions this schema; a bare Postgres used for migration testing
-- does not. Creating it is a no-op on Supabase.
create schema if not exists extensions;
grant usage on schema extensions to public;

-- gen_random_uuid() is core since PG13, but FR-ATT-10 needs hmac(): the attempt
-- shuffle seed is hmac(server_secret, attempt_id) so that the seed cannot be
-- guessed from the attempt id and cannot be reconstructed by a client.
create extension if not exists pgcrypto with schema extensions;

-- btree_gist lets an exclusion constraint mix an equality column with a range
-- column. Used to stop two overlapping live windows for the same exam shift
-- (FR-PAT-09) and overlapping accommodation grants (FR-A11Y-05).
create extension if not exists btree_gist with schema extensions;

-- Trigram indexing backs near-duplicate item detection on ingest (FR-ITM-13)
-- and note search (FR-NTS-02). Neither is a blocker if the index is absent, but
-- both degrade to sequential scans, so it ships with the schema.
create extension if not exists pg_trgm with schema extensions;

-- pg_stat_statements requires shared_preload_libraries. It is preloaded on
-- Supabase; on a bare Postgres used for schema tests it is not, and the failure
-- must not abort the migration -- observability is an operational requirement
-- (NFR-AVL-05), not a correctness one.
do $$
begin
  create extension if not exists pg_stat_statements with schema extensions;
exception
  when others then
    raise notice 'pg_stat_statements unavailable (%), continuing without it', sqlerrm;
end;
$$;
