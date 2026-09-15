/**
 * Watch host boot — what every watch host entry does once its transport is
 * known (TASK_2026_437 C8, C9).
 *
 * The entries (`platform-electron`'s utilityProcess entry and in-process hatch,
 * `platform-cli`'s `child_process.fork` entry) differ only in how they talk to
 * their parent and where `require('@parcel/watcher')` runs. Both stay in the
 * adapter libs: this lib takes no Node-IPC import, and a literal `require` of
 * the native module here would be bundled into every host, the VS Code
 * extension included. Everything after that — engine shape check, `fatal` on a
 * load failure, core construction, storm breaker tunables — lives here once.
 */

import { readdir } from 'node:fs/promises';

import { readEventStormBreakerOptionsFromEnv } from '../utils/event-storm-breaker';
import type { WorkspaceWatchListDirectory } from './created-directory-reconciler';
import {
  WorkspaceWatchHostCore,
  type WorkspaceWatchEngine,
  type WorkspaceWatchEngineCallback,
  type WorkspaceWatchEngineSubscription,
} from './workspace-watch-host-core';
import {
  clipWorkspaceWatchText,
  type WorkspaceWatchHostOutbound,
} from './workspace-watch-protocol';

/** The one function the host uses from `@parcel/watcher`. */
interface ParcelWatcherLike {
  subscribe(
    dir: string,
    callback: WorkspaceWatchEngineCallback,
    options?: { ignore?: string[] },
  ): Promise<WorkspaceWatchEngineSubscription>;
}

/**
 * Adapts a loaded `@parcel/watcher` module to {@link WorkspaceWatchEngine}.
 * Throws when it does not export `subscribe`.
 */
export function toWorkspaceWatchEngine(module: unknown): WorkspaceWatchEngine {
  const watcher = module as Partial<ParcelWatcherLike> | null | undefined;
  if (typeof watcher?.subscribe !== 'function') {
    throw new Error('@parcel/watcher did not export subscribe()');
  }
  const subscribe = watcher.subscribe.bind(watcher);
  return {
    subscribe: (dir, callback, options) => subscribe(dir, callback, options),
  };
}

/**
 * The directory listing that turns on created-directory reconciliation, for
 * the platforms whose `@parcel/watcher` backend needs it: `linux` only.
 *
 * The inotify backend adds a watch per created directory AFTER reporting it
 * and never lists it, so children created in that window are never reported
 * and child directories are never watched (parcel-bundler/watcher#243; see
 * `created-directory-reconciler.ts`). FSEvents (macOS) and
 * ReadDirectoryChangesW (Windows) watch the whole tree from one handle, so
 * they have no such window, and returning `undefined` there costs nothing.
 */
export function workspaceWatchListDirectoryFor(
  platform: string,
): WorkspaceWatchListDirectory | undefined {
  if (platform !== 'linux') return undefined;
  return async (dir) =>
    (await readdir(dir, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
}

export interface WorkspaceWatchHostBootOptions {
  /** Sends one message to the supervisor. */
  readonly post: (message: WorkspaceWatchHostOutbound) => void;
  /** Loads the engine. A throw becomes one `fatal` message. */
  readonly loadEngine: () => WorkspaceWatchEngine;
  /** Storm breaker tunables source — the host's own environment. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Normally `workspaceWatchListDirectoryFor(process.platform)`. */
  readonly listDirectory?: WorkspaceWatchListDirectory;
}

/**
 * Loads the engine and starts a {@link WorkspaceWatchHostCore}. Returns
 * `undefined` after posting `fatal` when the engine cannot load: the host then
 * stays up doing nothing, and the supervisor restarts it within its budget and
 * then degrades. The caller routes inbound messages to `handleMessage`.
 */
export function bootWorkspaceWatchHost(
  options: WorkspaceWatchHostBootOptions,
): WorkspaceWatchHostCore | undefined {
  let engine: WorkspaceWatchEngine;
  try {
    engine = options.loadEngine();
  } catch (error: unknown) {
    // degradation-audit: reported — posted to the supervisor as `fatal`, which
    // counts against its restart budget and degrades when that is spent.
    options.post({
      type: 'fatal',
      message: clipWorkspaceWatchText(
        `watch engine failed to load: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    });
    return undefined;
  }
  const core = new WorkspaceWatchHostCore({
    engine,
    post: options.post,
    stormBreakerOptions: readEventStormBreakerOptionsFromEnv(options.env),
    listDirectory: options.listDirectory,
  });
  core.start();
  return core;
}
