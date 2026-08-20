import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The database file each profile gets under `~/.ptah/state`.
 *
 * `test` has its own file rather than sharing `development`'s: an e2e run
 * migrates and writes whatever it boots, and a developer's dev database is no
 * more disposable than the production one.
 */
const DB_FILE_BY_PROFILE = {
  production: 'ptah.sqlite',
  development: 'ptah-dev.sqlite',
  test: 'ptah-test.sqlite',
} as const;

export type PtahDbProfile = keyof typeof DB_FILE_BY_PROFILE;

/**
 * Which database a process should open.
 *
 * Production is the DEFAULT, deliberately: a packaged Electron build and the
 * VS Code extension host both run with `NODE_ENV` unset, so "unset means
 * production" is what keeps a shipped install pointed at the user's real data.
 * Non-production has to be asked for.
 *
 * `test` is recognised because it is asked for constantly and used to be
 * silently equivalent to production — `NODE_ENV === 'development'` was the only
 * branch, so the e2e launcher's `NODE_ENV=test`, Jest's default `NODE_ENV=test`
 * and any CI job all resolved to `ptah.sqlite`. A working-tree build opened the
 * real database and migrated it forward; the installed build then refused to
 * open its own data ("Refusing to downgrade"). See TASK_2026_291.
 */
export function resolvePtahDbProfile(opts?: {
  isDev?: boolean;
}): PtahDbProfile {
  if (opts?.isDev !== undefined) {
    return opts.isDev ? 'development' : 'production';
  }
  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv === 'development') return 'development';
  if (nodeEnv === 'test') return 'test';
  return 'production';
}

/**
 * Absolute path to the SQLite database for this process.
 *
 * `PTAH_DB_PATH` overrides everything, including an explicit `opts.isDev`. It
 * is the escape hatch for harnesses that need a database of their own without
 * inheriting one profile's file: point it at a temp path and the run cannot
 * reach any database a human cares about. The e2e launcher sets it per launch.
 */
export function resolvePtahDbPath(opts?: { isDev?: boolean }): string {
  const override = process.env['PTAH_DB_PATH'];
  if (override !== undefined && override.trim() !== '') {
    return path.resolve(override.trim());
  }
  return path.join(
    os.homedir(),
    '.ptah',
    'state',
    DB_FILE_BY_PROFILE[resolvePtahDbProfile(opts)],
  );
}
