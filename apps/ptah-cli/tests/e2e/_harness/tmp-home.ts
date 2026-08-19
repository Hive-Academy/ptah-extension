/**
 * Per-test isolated HOME directory for the e2e harness.
 *
 * Every spec creates its own `TmpHome` under `os.tmpdir()`, eagerly
 * `mkdir`s `<home>/.ptah` so `CliStateStorage` can write `global-state.json`,
 * and exposes typed `writeFile` / `readFile` helpers for pre-seeding cache
 * snapshots and reading post-test artifacts.
 *
 * Cleanup uses `fs.rm({ recursive: true, force: true, maxRetries: 3 })`.
 * Windows file-handle-busy errors are tolerated via the retry policy — the
 * tmp dir always lives under `os.tmpdir()` so a leak survives the next OS
 * reboot at worst.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The SQLite database a CLI launched against `homePath` will open.
 *
 * The harness DECLARES this path (the runners export it as `PTAH_DB_PATH`)
 * rather than letting each side guess it, because the two sides used to guess
 * differently. The CLI resolves its database through `resolvePtahDbProfile()`,
 * which maps `NODE_ENV` to a file name; Jest sets `NODE_ENV=test` by default.
 * When `test` became a profile of its own (TASK_2026_291 — a working-tree build
 * had migrated a developer's real `ptah.sqlite` forward and the installed build
 * then refused to open it) the CLI moved to `ptah-test.sqlite`, while the
 * direct-seed specs still opened the `ptah.sqlite` string literal they had
 * hardcoded. better-sqlite3 CREATES a missing file, so the seed silently built
 * a brand-new empty database beside the real one and every spec died on its
 * first `prepare` with `no such table`.
 *
 * `PTAH_DB_PATH` is the escape hatch `db-path.ts` documents for exactly this,
 * and the one the Electron e2e launcher already uses. Setting it per launch
 * makes spec and subprocess agree by construction, and the file name below is
 * the harness's own — no future profile change can separate them again.
 */
export function e2eDbPath(homePath: string): string {
  return path.join(homePath, '.ptah', 'state', 'ptah-e2e.sqlite');
}

export interface TmpHome {
  readonly path: string;
  readonly ptahDir: string;
  /**
   * The database every CLI launched with this home opens. Direct-seed specs
   * MUST use this instead of rebuilding the path from a file-name literal.
   */
  readonly dbPath: string;
  writeFile(rel: string, contents: string | Buffer): Promise<void>;
  readFile(rel: string): Promise<string | null>;
  cleanup(): Promise<void>;
}

export async function createTmpHome(prefix = 'ptah-e2e-'): Promise<TmpHome> {
  const homePath = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const ptahDir = path.join(homePath, '.ptah');
  await fsp.mkdir(ptahDir, { recursive: true });
  const dbPath = e2eDbPath(homePath);
  await fsp.mkdir(path.dirname(dbPath), { recursive: true });

  const resolveSafe = (rel: string): string => {
    const target = path.resolve(homePath, rel);
    if (!target.startsWith(homePath)) {
      throw new Error(
        `TmpHome.write/read: '${rel}' resolves outside the tmp root (${homePath})`,
      );
    }
    return target;
  };

  return {
    path: homePath,
    ptahDir,
    dbPath,
    async writeFile(rel: string, contents: string | Buffer): Promise<void> {
      const target = resolveSafe(rel);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, contents);
    },
    async readFile(rel: string): Promise<string | null> {
      const target = resolveSafe(rel);
      try {
        return await fsp.readFile(target, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async cleanup(): Promise<void> {
      const realTmp = await fsp.realpath(os.tmpdir()).catch(() => os.tmpdir());
      const realTarget = await fsp.realpath(homePath).catch(() => homePath);
      if (!realTarget.startsWith(realTmp)) {
        return;
      }
      try {
        await fsp.rm(homePath, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      } catch (err) {
        // Best-effort: on Windows a freshly-killed CLI child can still hold a
        // native handle (the SQLite db under .ptah) when rmdir runs, yielding
        // EBUSY/EPERM/ENOTEMPTY even after retries. The tmp dir lives under
        // os.tmpdir(), so a leftover is reclaimed on reboot at worst — never
        // fail a test over it. Genuinely unexpected errors still surface.
        const code = (err as NodeJS.ErrnoException).code;
        if (
          code === 'EBUSY' ||
          code === 'EPERM' ||
          code === 'ENOTEMPTY' ||
          code === 'ENOTDIR'
        ) {
          return;
        }
        throw err;
      }
    },
  };
}

/** Synchronous existence helper used by global-setup. */
export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
