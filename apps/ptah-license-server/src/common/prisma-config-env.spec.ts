import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { parse } from 'dotenv';

/**
 * THE PRISMA ENV PATH AS AN EXECUTABLE ARTEFACT (TASK_2026_189).
 *
 * ⚠️ WHY THIS TEST EXISTS.
 * `prisma.config.ts` used to load exactly one dotenv path — `<app>/.env` — and
 * that file DOES NOT EXIST and never has. The only local dotenv file is
 * `.env.example`, which carries the admin/marketing subset and contains no
 * `DATABASE_URL` at all, so "copy `.env.example` to `.env`" does not fix it
 * either. `DATABASE_URL` lives in the REPO-ROOT `.env`.
 *
 * `dotenv` does not throw on a missing file — it returns `{ error }` and moves
 * on. So `process.env['DATABASE_URL']` stayed undefined, `|| ''` swallowed it,
 * and every Prisma CLI command died with:
 *
 *     Error: Connection url is empty. See https://pris.ly/d/config-url
 *
 * That message reads like a missing database — is the container up, is the port
 * right, was the password rotated — when the container was up and all
 * migrations were applied the entire time. Multiple agents and one human each
 * burned real time on it. Commit 4898d2601 added the repo-root load.
 *
 * A comment cannot fail a build. This can.
 *
 * Deliberately dependency-free — no Postgres, no Prisma CLI, no Nest bootstrap,
 * and NO import of `prisma.config.ts` itself. Importing it would execute
 * `dotenv.config()` and mutate this worker's `process.env` for every spec file
 * that follows. Instead the config source is read as text and the dotenv files
 * are read with `parse()`, which returns an object and touches nothing.
 *
 * WHAT IS NOT ASSERTED, AND WHY. Making `datasource.url` throw on an unset
 * `DATABASE_URL` was considered and REJECTED: CI's `prisma:generate` runs with
 * no `DATABASE_URL` (generation never connects) and must keep passing on the
 * empty string. RI-3 is therefore conditional on a root `.env` being present.
 */

const APP_DIR = resolve(__dirname, '..', '..');
const REPO_ROOT = resolve(APP_DIR, '..', '..');
const CONFIG_PATH = resolve(APP_DIR, 'prisma.config.ts');
const ROOT_ENV = resolve(REPO_ROOT, '.env');

const SOURCE = readFileSync(CONFIG_PATH, 'utf8');

/**
 * Every `config({ path: resolve(__dirname, ...) })` call in the config source,
 * resolved to an absolute path. Matching the source text rather than running it
 * is what keeps this spec free of the env mutation described above.
 */
function loadedEnvPaths(source: string): string[] {
  const call = /config\(\s*\{\s*path:\s*resolve\(([^)]*)\)\s*,?\s*\}\s*\)/g;
  const paths: string[] = [];

  for (const match of source.matchAll(call)) {
    const segments = match[1]
      .split(',')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .map((segment) =>
        segment === '__dirname'
          ? APP_DIR
          : segment.replace(/^['"`]|['"`]$/g, ''),
      );

    paths.push(resolve(...segments));
  }

  return paths;
}

describe('prisma.config.ts env resolution', () => {
  const envPaths = loadedEnvPaths(SOURCE);

  // Anti-vacuity: if the matcher silently stops matching, every RI below would
  // pass against an empty array. This is the assertion that makes them mean
  // something.
  it('anti-vacuity: the config loads at least one dotenv path', () => {
    expect(envPaths.length).toBeGreaterThan(0);
  });

  // RI-1 — THE REGRESSION. Loading only the app-local path is the exact bug.
  it('RI-1: loads the repo-root .env, not just the app-local one', () => {
    expect(envPaths).toContain(ROOT_ENV);
  });

  // RI-2 — a load that happens after `defineConfig` has already read
  // `process.env` is a load that does nothing.
  it('RI-2: every dotenv load happens before defineConfig reads process.env', () => {
    const lastLoad = SOURCE.lastIndexOf('config({');
    const define = SOURCE.indexOf('defineConfig(');

    expect(define).toBeGreaterThan(-1);
    expect(lastLoad).toBeGreaterThan(-1);
    expect(lastLoad).toBeLessThan(define);
  });

  // RI-3 — the behavioural half, conditional by design (see header). On a
  // machine that has a root `.env`, that file must be the one that actually
  // carries `DATABASE_URL`.
  it('RI-3: a present repo-root .env supplies a non-empty DATABASE_URL', () => {
    if (!existsSync(ROOT_ENV)) {
      // CI and fresh clones: nothing to check, and nothing is broken.
      return;
    }

    const parsed = parse(readFileSync(ROOT_ENV, 'utf8'));

    expect(parsed['DATABASE_URL'] ?? '').not.toBe('');
  });

  // RI-4 — the app-local `.env.example` must never look like it carries the
  // database config, because the obvious `cp .env.example .env` is precisely
  // what does not work here.
  it('RI-4: the app .env.example does not claim to carry DATABASE_URL', () => {
    const example = resolve(APP_DIR, '.env.example');

    if (!existsSync(example)) {
      return;
    }

    expect(
      parse(readFileSync(example, 'utf8'))['DATABASE_URL'],
    ).toBeUndefined();
  });
});
