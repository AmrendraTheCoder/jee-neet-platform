import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Everything the CLI does here is DDL or introspection, so the URL below is the
 * DIRECT (session-mode) connection, never the transaction pooler. Two reasons,
 * both of which fail confusingly rather than loudly:
 *
 * - Prisma serialises concurrent deploys with a Postgres advisory lock held
 *   across statements. A transaction-pooled connection may be handed to another
 *   client between statements, so the lock is released early and two CI jobs can
 *   apply the same migration at once.
 *
 * - Some of this schema's DDL cannot run in transaction mode at all.
 *
 * The runtime connection is unrelated and lives in `src/client.ts`, over the
 * pooler, with `pgbouncer=true`.
 */

// Node 22 reads .env without a dependency. CI sets real environment variables
// and has no .env file, so a missing file is expected rather than an error.
try {
  process.loadEnvFile(path.join(import.meta.dirname, '.env'));
} catch {
  // No local .env. The variables are either already in the environment or the
  // CLI is about to say so more clearly than we could here.
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  migrations: {
    // Generated from `migrations/*.sql` by `pnpm db:sync`. Never hand-edited:
    // Prisma stores a checksum per migration and refuses to deploy one whose
    // content changed after it was applied.
    path: path.join('prisma', 'migrations'),
  },

  datasource: {
    url: process.env['DIRECT_URL'] ?? '',
  },
});
