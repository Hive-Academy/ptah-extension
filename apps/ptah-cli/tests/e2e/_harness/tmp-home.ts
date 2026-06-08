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

export interface TmpHome {
  readonly path: string;
  readonly ptahDir: string;
  writeFile(rel: string, contents: string | Buffer): Promise<void>;
  readFile(rel: string): Promise<string | null>;
  cleanup(): Promise<void>;
}

export async function createTmpHome(prefix = 'ptah-e2e-'): Promise<TmpHome> {
  const homePath = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const ptahDir = path.join(homePath, '.ptah');
  await fsp.mkdir(ptahDir, { recursive: true });

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
