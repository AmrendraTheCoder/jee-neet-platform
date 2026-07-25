/**
 * Running a Prisma query as a student instead of as the owner.
 *
 * THE PROBLEM THIS SOLVES.
 *
 * Prisma connects to Supabase as `postgres`. That role owns every table in this
 * schema, and a table owner is exempt from its own row-level security policies
 * unless the table is FORCEd — which ours deliberately are not, because the
 * SECURITY DEFINER helpers and RPCs have to keep reading rows the caller
 * cannot. The consequence is blunt: a plain `prisma.attempt.findMany()` returns
 * every attempt belonging to every student in every organisation. Migration
 * 0013 is not bypassed by a bug; it is simply not consulted.
 *
 * That is the correct behaviour for a migration runner and for a background
 * worker that is meant to see everything. It is catastrophic for anything
 * serving a request on behalf of a user, which is why the platform's own design
 * keeps student traffic on PostgREST, where the caller's JWT selects the role
 * and the policies apply on their own.
 *
 * Where a server-side path genuinely does need Prisma while still being bound
 * by the policies, this is the wrapper for it.
 *
 * WHY IT IS SHAPED THIS WAY.
 *
 * Everything happens inside one explicit transaction, and every setting is
 * transaction-local. `SET LOCAL` and `set_config(..., true)` are reverted when
 * the transaction ends, which is what makes this safe on a pooled connection:
 * Supavisor in transaction mode hands the same backend to a different tenant
 * the instant we commit. A plain `SET` would survive that handover and leak one
 * student's identity into the next student's queries — a cross-tenant read with
 * no bug anywhere in the policies.
 *
 * The claims are written to `request.jwt.claims` because that is exactly where
 * `app.jwt_claim()` reads from, so `app.current_org_id()`, `app.is_admin()` and
 * every policy that calls them behave identically to a PostgREST request.
 */

/** The subset of a Prisma transaction client this module needs. */
export interface RawExecutor {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/** The subset of a Prisma client this module needs. */
export interface TransactionCapable<TTx extends RawExecutor> {
  $transaction<R>(fn: (tx: TTx) => Promise<R>): Promise<R>;
}

export interface Principal {
  /** `auth.users.id`. Becomes the `sub` claim, which is what `auth.uid()` reads. */
  readonly userId: string;
  /** Tenant. Becomes the `org_id` claim that every policy constrains on. */
  readonly orgId: string;
  /** Server-owned role keys, as the access-token hook projects them. */
  readonly roles?: readonly string[];
  /** Server-owned capability keys. */
  readonly permissions?: readonly string[];
  /** Unknown age is a minor. Same default as `app.is_minor()`. */
  readonly isMinor?: boolean;
}

/**
 * The database role a request-scoped query runs as.
 *
 * `authenticated` is the same role PostgREST uses for a signed-in caller, so a
 * query issued here is subject to exactly the policies a client request would
 * be. It has no privileges on the `private` schema, which is what keeps answer
 * keys unreachable from this path regardless of what the caller asks for.
 */
const REQUEST_ROLE = 'authenticated';

function claimsFor(principal: Principal): string {
  return JSON.stringify({
    sub: principal.userId,
    role: REQUEST_ROLE,
    org_id: principal.orgId,
    roles: principal.roles ?? [],
    perms: principal.permissions ?? [],
    // Absent means minor, matching app.is_minor() and the web session decoder.
    // A caller that omits the flag gets the restrictive answer.
    is_minor: principal.isMinor ?? true,
  });
}

/**
 * Run `work` with row-level security applied as `principal`.
 *
 * Anything `work` reads is what that principal could have read through the API.
 * Anything it writes must satisfy the same WITH CHECK clauses.
 *
 * Note that the role reverts on commit AND on rollback, so a thrown error
 * cannot leave a connection sitting in the pool still wearing a student's
 * identity.
 */
export async function withPrincipal<TTx extends RawExecutor, R>(
  client: TransactionCapable<TTx>,
  principal: Principal,
  work: (tx: TTx) => Promise<R>,
): Promise<R> {
  if (principal.userId === '' || principal.orgId === '') {
    // A blank principal would produce a null `auth.uid()`, which most policies
    // read as "not the owner" and a few read as "no rows" — the difference
    // between a denial and an empty result is not one to leave to chance.
    throw new Error('withPrincipal requires a non-empty userId and orgId');
  }

  return client.$transaction(async (tx) => {
    // Parameterised: the claims are a JSON string built from caller input, and
    // interpolating it into the statement would be a SQL injection with the
    // whole security model downstream of it. `true` is the is_local flag.
    await tx.$executeRawUnsafe(
      'select set_config($1, $2, true)',
      'request.jwt.claims',
      claimsFor(principal),
    );

    // Not parameterisable — SET ROLE takes an identifier, not a value. Safe
    // because REQUEST_ROLE is a module constant and never caller input.
    await tx.$executeRawUnsafe(`set local role ${REQUEST_ROLE}`);

    return work(tx);
  });
}

/**
 * Run `work` with the owner's privileges, RLS not applied.
 *
 * Exists so that the intent is written down at the call site. A migration
 * runner, the scoring worker and the partition maintenance job all legitimately
 * need this; a request handler does not. If you are reaching for it inside
 * something that has a `userId` in scope, reach for `withPrincipal` instead.
 */
export async function asOwner<TTx extends RawExecutor, R>(
  client: TransactionCapable<TTx>,
  work: (tx: TTx) => Promise<R>,
): Promise<R> {
  return client.$transaction(work);
}
