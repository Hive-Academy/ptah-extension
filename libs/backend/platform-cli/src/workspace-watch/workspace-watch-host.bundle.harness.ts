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

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildSync } from 'esbuild';

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
    // esbuild's JS API, not `node node_modules/esbuild/bin/esbuild`: on Linux
    // and macOS esbuild's install replaces that path with the native binary,
    // which `node` cannot execute. `buildSync` throws on any build error.
    buildSync({
      entryPoints: [path.join(__dirname, 'workspace-watch-host.entry.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      external: ['@parcel/watcher'],
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      tsconfig: path.join(REPO_ROOT, 'tsconfig.base.json'),
      outfile: bundlePath,
      logLevel: 'error',
    });
  } catch (error: unknown) {
    dispose();
    throw error;
  }
  return { dir, bundlePath, dispose };
}
