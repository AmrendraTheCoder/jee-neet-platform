/**
 * Prisma client construction for Supabase.
 *
 * This module deliberately does not import the generated client. `prisma
 * generate` has nothing to generate until someone has run `pnpm db:deploy` and
 * `pnpm db:pull` against a real database, and a package that cannot typecheck
 * until a network resource exists is a package that breaks CI on a fresh
 * checkout. The factory below takes the constructor instead.
 *
 * Usage, once the client has been generated:
 *
 *   import { PrismaClient } from '@platform/db/generated/prisma/client.js';
 *   import { createPrismaClient } from '@platform/db';
 *
 *   export const prisma = createPrismaClient(PrismaClient);
 */

export interface PrismaConnectionOptions {
  /**
   * Supavisor transaction mode, port 6543, with `pgbouncer=true`.
   * Defaults to `process.env.DATABASE_URL`.
   */
  readonly connectionString?: string;
  /**
   * Ceiling on this process's own pool. Total processes x this must stay under
   * the project's Pool Size; exceeding it does not queue, it errors.
   */
  readonly maxConnections?: number;
}

interface AdapterConstructor {
  new (config: { connectionString: string; max?: number }): unknown;
}

interface ClientConstructor<TClient> {
  new (options: { adapter: unknown }): TClient;
}

/**
 * Build a client against the transaction pooler.
 *
 * Two properties of the connection string are load-bearing and are checked here
 * rather than discovered under load:
 *
 * - `pgbouncer=true` on port 6543. Transaction mode does not support prepared
 *   statements. Without the flag Prisma issues them anyway and the connection
 *   fails with `prepared statement "s0" already exists` — but only once
 *   concurrency exceeds the pool size, so it passes every test and fails during
 *   an exam.
 *
 * - Not the direct port. Ten thousand concurrent students must never map to ten
 *   thousand Postgres connections; that is what the pooler is for, and what the
 *   HTTP surfaces are for beyond it.
 */
export function createPrismaClient<TClient>(
  Client: ClientConstructor<TClient>,
  Adapter: AdapterConstructor,
  options: PrismaConnectionOptions = {},
): TClient {
  const connectionString = options.connectionString ?? process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set. Copy packages/db/.env.example to .env.');
  }

  assertPoolerSafe(connectionString);

  const adapter =
    options.maxConnections === undefined
      ? new Adapter({ connectionString })
      : new Adapter({ connectionString, max: options.maxConnections });

  return new Client({ adapter });
}

/**
 * Fail fast on a connection string that will work in development and break in
 * production. Exported so a deployment healthcheck can assert it too.
 */
export function assertPoolerSafe(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL');
  }

  const isTransactionPooler = url.port === '6543';
  const declaresPgBouncer = url.searchParams.get('pgbouncer') === 'true';

  if (isTransactionPooler && !declaresPgBouncer) {
    throw new Error(
      'DATABASE_URL points at the transaction pooler (port 6543) without `pgbouncer=true`. ' +
        'Prisma will issue prepared statements the pooler cannot honour, and the failure ' +
        'surfaces only above pool size. Append `?pgbouncer=true` to the connection string.',
    );
  }

  if (!isTransactionPooler && declaresPgBouncer) {
    throw new Error(
      'DATABASE_URL declares `pgbouncer=true` but is not on the transaction pooler port. ' +
        'Disabling prepared statements against a session connection costs performance for no reason.',
    );
  }
}
