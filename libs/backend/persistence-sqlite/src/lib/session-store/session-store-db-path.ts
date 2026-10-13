import * as os from 'node:os';
import * as path from 'node:path';
import { resolvePtahDbProfile, type PtahDbProfile } from '../db-path';

/**
 * The session store is a file of its own, not a table in ptah.sqlite.
 *
 * The migration runner refuses to open a database whose schema is newer than
 * the build (migration-runner.ts, "Refusing to downgrade"). A session table in
 * ptah.sqlite would stop any older build from opening memory, skills and cron,
 * so rolling back would cost all of them. A separate file is never opened by
 * an older build, which keeps rollback to "run the previous build" (PTAH-35).
 */
const SESSION_DB_FILE_BY_PROFILE: Record<PtahDbProfile, string> = {
  production: 'sessions.sqlite',
  development: 'sessions-dev.sqlite',
  test: 'sessions-test.sqlite',
};

/** `PTAH_SESSIONS_DB_PATH` overrides the profile, like `PTAH_DB_PATH` does for ptah.sqlite. */
export function resolveSessionStoreDbPath(opts?: { isDev?: boolean }): string {
  const override = process.env['PTAH_SESSIONS_DB_PATH'];
  if (override !== undefined && override.trim() !== '') {
    return path.resolve(override.trim());
  }
  return path.join(
    os.homedir(),
    '.ptah',
    'state',
    SESSION_DB_FILE_BY_PROFILE[resolvePtahDbProfile(opts)],
  );
}

/** Per-session bulk files live next to the database, in `sessions/`. */
export function resolveSessionBlobRoot(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'sessions');
}
