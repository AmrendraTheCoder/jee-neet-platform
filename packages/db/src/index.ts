/**
 * Database access for the platform.
 *
 * The SQL under `migrations/` is the schema's source of truth. This module is
 * the typed way into it from server-side TypeScript, and nothing more: it does
 * not define tables, and Prisma is never allowed to.
 *
 * Read `README.md` in this package before using any of it, in particular the
 * part about `prisma.attempt.findMany()` returning every student's attempts
 * unless it is wrapped in `withPrincipal`.
 */

export { createPrismaClient, assertPoolerSafe } from './client.js';
export type { PrismaConnectionOptions } from './client.js';

export { withPrincipal, asOwner } from './rls.js';
export type { Principal, RawExecutor, TransactionCapable } from './rls.js';
