/**
 * The seed's Prisma client factory — TASK_2026_177 Task 8.2.
 *
 * ⚠️ `new PrismaClient()` WITH NO ARGUMENTS DOES NOT CONNECT IN THIS WORKSPACE.
 * `schema.prisma` declares no `datasource.url`; the URL lives in
 * `apps/ptah-license-server/prisma.config.ts` and the `PrismaPg` driver adapter
 * is supplied at runtime. Prisma 7's driver-adapter mode means the client has no
 * built-in connection string to fall back on, so a bare constructor fails at the
 * first query with an error that reads like a schema problem rather than a
 * configuration one. This file mirrors
 * `libs/api/core/src/lib/prisma/prisma.service.ts`, which is the one place in
 * this repo that gets it right.
 *
 * ⚠️ THE DOTENV LOOKUP IS DELIBERATELY TWO-STAGE. `prisma.config.ts` loads
 * `apps/ptah-license-server/.env`, which DOES NOT EXIST in this workspace — the
 * real `DATABASE_URL` is in the workspace-root `.env`. Loading only the app-local
 * file would leave `DATABASE_URL` undefined for every developer here, so both are
 * tried, app-local first (it is the more specific one and should win). `dotenv`
 * never overwrites an already-set variable, so an explicit
 * `DATABASE_URL=... npx nx run ...` still takes precedence over both files.
 *
 * ⚠️ THE RELATIVE IMPORT OF THE GENERATED CLIENT IS NOT AN OVERSIGHT. The client
 * is generated into `libs/api/core/src/lib/generated-prisma-client/` (see
 * `generator client.output` in `schema.prisma`) and re-exported by
 * `@ptah-api/core`. Importing the barrel would drag `@nestjs/common`,
 * `@sentry/nestjs` and the DTO validation pipe into a standalone `ts-node`
 * script that needs none of them, and would additionally require
 * `tsconfig-paths` — which is NOT a direct dependency of this workspace, only a
 * transitive one. See this file's entry in `batch-8-report.md`.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
// eslint-disable-next-line @nx/enforce-module-boundaries -- see the docblock above.
import { PrismaClient } from '../../../../libs/api/core/src/lib/generated-prisma-client/client';

/** Where a `DATABASE_URL` may live, most specific first. */
const ENV_CANDIDATES = [
  resolve(__dirname, '../../.env'), // apps/ptah-license-server/.env — what prisma.config.ts reads
  resolve(__dirname, '../../../../.env'), // the workspace root — where it actually is
];

/**
 * Thrown when `DATABASE_URL` cannot be resolved.
 *
 * ⚠️ A NAMED ERROR, NOT A BARE `Error`. Task 8.2 requires the seed to abort
 * before a single file is read when the database is unconfigured, and the caller
 * distinguishes this from a validation failure so the two get different exit
 * messages. An operator who sees "export invalid" when the real problem is a
 * missing env var will go and edit the export.
 */
export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      'DATABASE_URL is not set. The community seed needs it to reach Postgres.\n' +
        `Looked in: ${ENV_CANDIDATES.join(', ')}\n` +
        'Either create one of those files or run the target with it inline:\n' +
        '  DATABASE_URL="postgresql://ptah:...@localhost:5432/ptah_db" npx nx run ptah-license-server:seed-community',
    );
    this.name = 'MissingDatabaseUrlError';
  }
}

/**
 * Resolve `DATABASE_URL` from the environment or the two candidate `.env` files.
 *
 * Exported separately from {@link createSeedPrismaClient} so the abort can be
 * asserted without constructing a client or opening a socket.
 */
export function resolveDatabaseUrl(): string {
  for (const path of ENV_CANDIDATES) {
    if (existsSync(path)) config({ path, quiet: true });
  }

  const url = process.env['DATABASE_URL'];
  if (!url || url.trim().length === 0) throw new MissingDatabaseUrlError();
  return url;
}

/**
 * Build the client the seed writes through.
 *
 * The caller owns `$disconnect()`: a `ts-node` process with an open `pg` pool
 * does not exit, and a seed that appears to hang after printing its summary is
 * indistinguishable from one that is still writing.
 */
export function createSeedPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: resolveDatabaseUrl() });
  return new PrismaClient({ adapter });
}
