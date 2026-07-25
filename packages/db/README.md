# @platform/db

The schema, and the typed way into it.

## The one thing to know first

**The SQL under `migrations/` is the source of truth. Prisma applies it; Prisma
never authors it.**

`prisma/migrations/` is generated from `migrations/` by `pnpm db:sync`. Prisma's
schema language cannot express row-level security policies, `SECURITY DEFINER`
functions, empty search paths, range partitioning, triggers, exclusion
constraints or generated columns — and every one of those is load-bearing here.
Invariant 3 says a table ships with RLS and at least one policy or it does not
ship; there is no `@@rowLevelSecurity` to write that in.

So two commands are forbidden, and `pnpm db:guard` fails the build if the
generated migrations ever drift from the SQL they came from:

| Command | |
|---|---|
| `prisma migrate deploy` | Yes. Applies the generated SQL in order. |
| `prisma db pull` | Yes. Regenerates the models from the live database. |
| `prisma migrate dev` | **No.** Diffs against `schema.prisma` and writes SQL to "correct" the drift. The drift it sees is the security model. |
| `prisma db push` | **No.** The same, without writing the migration down first. |

## First-time setup

```bash
cp packages/db/.env.example packages/db/.env
```

Fill in both URLs from the Supabase dashboard (Project Settings → Database →
Connection string). `.env.example` explains why `DATABASE_URL` must carry
`pgbouncer=true` and why `DIRECT_URL` should be the session-mode pooler rather
than the direct host.

Then, from the repository root:

```bash
pnpm db:deploy
```

That is the whole thing. It re-checks that the generated migrations still match
the SQL, then applies every pending one in order and records it in
`_prisma_migrations`. It is idempotent — running it against an up-to-date
database applies nothing.

To get a typed client for the schema you just applied:

```bash
pnpm db:pull
```

This introspects the live database into `prisma/schema.prisma` and generates the
client into `generated/prisma` (gitignored — it is a build artefact of the
database, not a source file).

## Commands

| From the root | Does |
|---|---|
| `pnpm db:deploy` | Apply pending migrations. Safe to run repeatedly, safe in CI. |
| `pnpm db:status` | What is applied, what is pending, what has drifted. |
| `pnpm db:sync` | Regenerate `prisma/migrations/` after editing or adding a SQL file. |
| `pnpm db:guard` | Fail if the generated migrations no longer match the SQL. Part of `pnpm verify`. |
| `pnpm db:pull` | Introspect the live database and regenerate the client. |

## Adding a migration

Write the SQL, regenerate, verify, deploy:

```bash
pnpm db:sync && pnpm verify && pnpm db:deploy
```

Number it after the highest existing file. Keep the `begin;` / `commit;` wrapper
in your source file — `db:sync` strips it from the generated copy, because
Prisma runs each migration inside its own transaction and a nested `commit`
would end it early.

**Never edit a migration that has already been deployed.** Prisma stores a
checksum per migration and will refuse to deploy against a database whose
history disagrees. Add a new numbered file instead. This is the same rule as
invariant 2, one level up: nothing anyone has already run is edited in place.

## Reading data: the part that will bite you

Prisma connects as `postgres`, which owns every table in this schema. **A table
owner is exempt from its own RLS policies**, and ours are deliberately not
`FORCE`d — the `SECURITY DEFINER` helpers and RPCs have to keep reading rows the
caller cannot.

The consequence is blunt:

```ts
await prisma.attempt.findMany();
// every attempt, every student, every organisation
```

Migration 0013 is not bypassed by a bug there. It is simply not consulted.

That is correct for the migration runner, the scoring worker and the partition
maintenance job. It is wrong for anything acting on behalf of a user. For those,
wrap the work:

```ts
import { withPrincipal } from '@platform/db';

const attempts = await withPrincipal(
  prisma,
  { userId, orgId, roles: ['STUDENT'] },
  (tx) => tx.attempt.findMany(),
);
```

`withPrincipal` opens a transaction, sets `request.jwt.claims` and `SET LOCAL
ROLE authenticated`, so the policies apply exactly as they would to a PostgREST
request. Both settings are transaction-local, which is what makes it safe on a
pooled connection — a plain `SET` would survive the connection being handed to
the next tenant.

Where the elevated view is genuinely intended, say so with `asOwner(prisma, …)`
rather than leaving it implicit.

Note also that the generated client contains no models for the `private` schema,
because introspection only sees `public`. `private.answer_key`,
`private.question_solution` and `private.user_role` are structurally unreachable
from Prisma; they are reached only through the state-checking RPCs in migration
0006, via `$queryRaw`.

## Where Prisma belongs in this system

Not on the student path. The platform keeps student traffic on the HTTP surfaces
(PostgREST, GoTrue, Storage) so that ten thousand concurrent candidates do not
become ten thousand Postgres connections. Prisma is for migrations, for
server-side workers, and for the admin console's queries — all of which are
bounded in number and none of which sit in the exam hot path.
