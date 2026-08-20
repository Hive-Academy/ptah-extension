import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
import { resolve } from 'path';

/**
 * ⚠️ `DATABASE_URL` LIVES IN THE REPO-ROOT `.env`, NOT IN THIS DIRECTORY.
 *
 * `apps/ptah-license-server/.env` does not exist and never has — the only local
 * dotenv file is `.env.example`, and it carries the admin/marketing subset with
 * NO `DATABASE_URL` in it. The canonical value is in the workspace-root `.env`
 * (root `.env.example` documents it). Loading only the local path therefore left
 * `datasource.url` as `''` and every Prisma CLI command died with
 * `Error: Connection url is empty` — a message that reads like a missing
 * database rather than a missing env path, and has cost several people real
 * time. See `.ptah/specs/TASK_2026_189/`.
 *
 * Both paths are loaded, local first. `dotenv` never overwrites a key already
 * present in `process.env`, so precedence is: real injected env (Docker
 * `--env-file`, CI secrets) > local `.env` > repo-root `.env`. A missing file is
 * a silent no-op, which is what makes the container case — where
 * `prisma.config.ts` is copied to `/app` and the env is injected — unaffected.
 */
config({ path: resolve(__dirname, '.env') });
config({ path: resolve(__dirname, '..', '..', '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] || '',
  },
});
