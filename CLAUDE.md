# Project context

Part A of [docs/agent.md](docs/agent.md), which is the source of truth. Update
that file and this one together.

## What this is

A multi-tenant assessment platform for Indian JEE and NEET aspirants. Students
practise and sit timed mock tests; administrators author versioned questions and
operate the platform. Two clients, one API: **web** for full-length ranked mocks
and the admin console, **React Native (Expo)** for practice, spaced-repetition
review, notes, analytics and notifications.

Full requirements: `docs/requirement.md`. Operating procedures: `docs/skill.md`.
Research corpus and 139 catalogued edge cases: `docs/research/`.

## The nine invariants

Violating any of these is a defect regardless of what the ticket says.

1. **Exam mechanics are data, not code.** Marking schemes, patterns, paper
   composition and answer keys are versioned rows. A pattern change for a new
   exam year is an INSERT, never a release. If you find yourself writing a year
   constant or a per-exam `if` branch in scoring, the schema is wrong — fix that
   instead.

2. **Nothing a student has seen is ever edited in place.** Items, keys and papers
   fork new versions. Attempts pin the versions they used. Retirement is a
   status, never a delete.

3. **A table ships with row-level security enabled and at least one policy, or it
   does not ship.** Enforced in CI. Answer keys, solutions, role assignments and
   licence evidence live in a non-exposed schema with zero grants to the
   authenticated role, reachable only through state-checking RPCs — because RLS
   controls rows, never columns.

4. **Every org-scoped table carries `org_id`, and every policy constrains on it.**
   Tenancy is never enforced in application code alone.

5. **Roles come from a server-owned table projected into the JWT.** Never from
   `user_metadata`, which the user can write. Destructive capabilities are
   re-verified server-side against the live database, not against a cached claim.

6. **Answers are `{question_version_id, option_id}`.** Never positional indices,
   never letters. The server asserts membership in the attempt's persisted
   question order.

7. **The deadline is server-authoritative and immovable.** The client counts down
   from a monotonic offset, never from wall-clock time. No client action can
   extend an attempt. Heartbeat and answer-sync are one request.

8. **Realtime messaging is never load-bearing.** The exam must be fully correct
   with realtime disabled entirely.

9. **Coins are earn-only and never purchasable.** There is no enum value for a
   purchase-origin credit. This single invariant is what keeps the platform
   outside the 2025 online-gaming legislation, outside app-store virtual-currency
   rules, and outside the GST actionable-claim analysis.

## Traps specific to this codebase

- **Views default to definer semantics and bypass RLS.** Exposed-schema views
  must be invoker-security. Admin reporting views go in the private schema.
- **A policy helper that reads a table the caller cannot must be `SECURITY
  DEFINER`.** The helpers in `app.*` read `private.user_role` and
  `public.profile`; as invoker they raise instead of answering, and
  `app.current_org_id()` additionally recurses through the `profile` policy that
  calls it. Migration `0015` exists because this was got wrong once already.
- **`auth.uid()` unwrapped in a policy is orders of magnitude slower** than
  `(select auth.uid())`, and the difference is invisible with a thousand
  development rows.
- **A WebView per list row will kill the app.** One WebView per screen with a
  locally bundled renderer; native text for non-mathematical prose. In the mobile
  client the single host lives in the root layout, above the navigator.
- **Per-user signed URLs for shared assets eliminate CDN caching entirely.** One
  URL per object, identical for every student.
- **A missing time partition on the response tables fails every insert
  simultaneously,** for everyone, mid-exam. `app.ensure_time_partitions` must run
  on a schedule; `app.partition_coverage()` is what alerts on it.
- **`marked_for_review` must never reach the scoring function.** There is a test
  asserting this; keep it passing.
- **Option shuffling breaks "all of the above" semantically** even though the key
  stays correct, because the key is an option UUID. The authoring linter is the
  control, not scoring.

## Users are legally children

Most students are 16–18. Verifiable parental consent is the default path, not an
edge case. Behavioural profiling, per-user optimised notification timing, churn
nudges and engagement experiments on minors are unlawful, not merely inadvisable.
There are two physically separate telemetry pipelines and the engagement one is
blocked at the gateway for under-18 principals. Before shipping anything that
touches personal data, run the `privacy-review` skill.

Where age is unknown, treat the principal as a minor. That default is encoded in
`app.is_minor()`, in the access-token hook and in the web client's session
decoder; if you add a fourth place, encode it there too.

## Conventions

- Requirement IDs (`FR-*`, `NFR-*`) are stable. Cite them in commit messages and
  PR descriptions for anything implementing or changing a requirement.
- Edge case IDs (`EC-*`) resolve to `docs/research/agent_edge-*.json`. Read the
  referenced case before implementing a requirement that traces to one — the
  mitigation there is more specific than the requirement statement.
- No emoji anywhere in the product or in code comments.
- Deploy freezes are derived automatically from the test calendar. Check before
  merging anything that ships.

## Commands

Node 22 and pnpm 11 are required; the repo will not install on Node 20.

```bash
pnpm install
```

```bash
pnpm verify
```

`verify` runs the typecheck across every workspace, the domain test suite, and
the three static gates. Run the gates individually while iterating:

```bash
pnpm lint:sql
```

```bash
pnpm lint:rls
```

```bash
pnpm scan:secrets
```

Each gate self-tests. A gate whose rules have stopped firing is worse than no
gate, so CI proves them first:

```bash
pnpm gates:self-test
```

The secret scanner deliberately includes build output — run `pnpm --filter
@platform/web build` before it if you want the bundle covered.

## The database

Schema changes are SQL files in `packages/db/migrations/`. Prisma applies them
and never authors them — `prisma/migrations/` is generated from that directory,
and `pnpm db:guard` (part of `verify`) fails if the two disagree.

```bash
pnpm db:deploy
```

`prisma migrate dev` and `prisma db push` are forbidden. Both diff the database
against `schema.prisma` and write SQL to remove what they see as drift; what
they see as drift is the RLS policies, the definer functions and the partitions.
Add a numbered SQL file and run `pnpm db:sync` instead. Full rationale in
[packages/db/README.md](packages/db/README.md).

**Prisma connects as the table owner, so RLS does not apply to it.**
`prisma.attempt.findMany()` returns every student's attempts in every org. That
is correct for a worker and wrong for anything serving a user; wrap those in
`withPrincipal(prisma, { userId, orgId }, …)`, which sets the JWT claims and
role transaction-locally so the policies apply as they would to a PostgREST
request.
