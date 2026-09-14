/**
 * Test harness: bundles the CLI watch host entry the way the CLI build bundles
 * it (ESM, `createRequire` banner, `@parcel/watcher` external), for specs that
 * need a REAL forked host (TASK_2026_437 C9). Not imported by production code.
 *
 * The bundle goes under the repository's gitignored `tmp/`, in a directory
 * unique to the caller, so the external `@parcel/watcher` resolves from the
 * repository's `node_modules` (as it resolves beside `main.mjs` in the
 * package) and parallel Jest workers never share a file. `dispose` removes the
 * whole directory.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CliWatchHostBundle {
  /** The directory holding the bundle; specs may put helper scripts in it. */
  readonly dir: string;
  readonly bundlePath: string;
  /** Removes `dir`. Idempotent. */
  dispose(): void;
}

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

/** Throws when esbuild cannot bundle the entry. */
export function buildCliWatchHostBundle(label: string): CliWatchHostBundle {
  const dir = path.join(
    REPO_ROOT,
    'tmp',
    `ptah-cli-${label}-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  const bundlePath = path.join(dir, 'workspace-watch-host.mjs');
  fs.mkdirSync(dir, { recursive: true });
  const dispose = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    execFileSync(
      process.execPath,
      [
        require.resolve('esbuild/bin/esbuild'),
        path.join(__dirname, 'workspace-watch-host.entry.ts'),
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--target=node20',
        '--external:@parcel/watcher',
        "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        `--tsconfig=${path.join(REPO_ROOT, 'tsconfig.base.json')}`,
        `--outfile=${bundlePath}`,
        '--log-level=error',
      ],
      { stdio: 'pipe' },
    );
  } catch (error: unknown) {
    dispose();
    throw error;
  }
  return { dir, bundlePath, dispose };
}
