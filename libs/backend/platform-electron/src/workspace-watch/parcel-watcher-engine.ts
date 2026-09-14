/**
 * Loads `@parcel/watcher` as a {@link WorkspaceWatchEngine} (TASK_2026_437 C8).
 *
 * One loader for both places the engine runs: the `workspace-watch-host.mjs`
 * utilityProcess entry, and the in-process `PTAH_WATCH_HOST=0` recovery hatch.
 *
 * `require`, not a static import, for two reasons:
 * - `@parcel/watcher` is an esbuild EXTERNAL. It is resolved from the host's
 *   own `node_modules` at runtime (from `app.asar.unpacked` in a packaged app —
 *   `electron-builder.yml` must unpack it together with `picomatch`, `is-glob`,
 *   `is-extglob` and `detect-libc`, which its `wrapper.js` requires; Batch 1
 *   spike). The ESM bundles get `require` from their `createRequire` banner.
 * - A static import would load the native binding the moment
 *   `@ptah-extension/platform-electron` is imported by `main.mjs`, i.e. on every
 *   boot, in the main process — the exact place this port exists to keep the
 *   engine out of. Deferring it means main loads it only in the hatch.
 */

import type {
  WorkspaceWatchEngine,
  WorkspaceWatchEngineCallback,
  WorkspaceWatchEngineSubscription,
} from '@ptah-extension/platform-core';

/** The one function this file uses from `@parcel/watcher`. */
interface ParcelWatcherModule {
  subscribe(
    dir: string,
    callback: WorkspaceWatchEngineCallback,
    options?: { ignore?: string[] },
  ): Promise<WorkspaceWatchEngineSubscription>;
}

/** Throws when the module or its native binding cannot be loaded. */
export function loadParcelWatcherEngine(): WorkspaceWatchEngine {
  const watcher = require('@parcel/watcher') as ParcelWatcherModule;
  if (typeof watcher.subscribe !== 'function') {
    throw new Error('@parcel/watcher did not export subscribe()');
  }
  return {
    subscribe: (dir, callback, options) =>
      watcher.subscribe(dir, callback, options),
  };
}
