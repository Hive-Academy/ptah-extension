/**
 * Watch host entry — bundled to `workspace-watch-host.mjs` and forked by the
 * Electron app as a `utilityProcess` (TASK_2026_437 C8).
 *
 * Everything the host does lives in `WorkspaceWatchHostCore` (platform-core),
 * started by `bootWorkspaceWatchHost`. This file only:
 *   1. detects its transport — `process.parentPort` (Electron utilityProcess,
 *      whose 'message' events wrap the payload as `{ data }`), or a
 *      `child_process.fork` IPC channel (raw payload; the entry spec's host);
 *   2. loads `@parcel/watcher` (an esbuild external; see
 *      `parcel-watcher-engine.ts`);
 *   3. hands the host's own environment (which a utilityProcess inherits from
 *      main) to the boot for the storm breaker tunables, and on Linux the
 *      directory listing that reconciles created directories.
 *
 * There is no `worker_threads` transport, on purpose. `@parcel/watcher` keeps
 * its backends and watchers in process-global singletons: terminating a Worker
 * whose subscription is live aborts the whole process on Linux (SIGABRT, exit
 * 134, measured), and a second Worker fails with "Module did not self-register".
 * The host always owns its process.
 *
 * The transport guard runs BEFORE the engine loads, so the ESM bundle gate can
 * run this bundle bare and see only the guard.
 *
 * An engine that fails to load is reported as `fatal` and the host stays up
 * doing nothing; the adapter restarts it within its budget and then degrades.
 */

import {
  bootWorkspaceWatchHost,
  workspaceWatchListDirectoryFor,
  type WorkspaceWatchHostOutbound,
} from '@ptah-extension/platform-core';

import { loadParcelWatcherEngine } from './parcel-watcher-engine';

/** Electron utilityProcess `process.parentPort`, typed structurally (no `electron` import). */
interface ElectronParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/** Mirrored in the app's ESM bundle gate (`WORKER_ENTRY_GUARDS`). */
const WORKSPACE_WATCH_HOST_ENTRY_GUARD =
  'workspace-watch-host.entry.ts must be run as a worker (no Electron parentPort and no IPC channel)';

const electronParentPort = (
  process as unknown as { parentPort?: ElectronParentPortLike }
).parentPort;

let post: (message: WorkspaceWatchHostOutbound) => void;
let listen: (handler: (message: unknown) => void) => void;

const sendToParent = process.send?.bind(process);

if (electronParentPort) {
  const port = electronParentPort;
  post = (message) => port.postMessage(message);
  listen = (handler) => port.on('message', (event) => handler(event.data));
} else if (sendToParent) {
  // `child_process.fork` IPC. The parent owns this process's life; when the
  // channel closes there is nobody to report to.
  post = (message) => {
    sendToParent(message);
  };
  listen = (handler) => process.on('message', (message) => handler(message));
  process.on('disconnect', () => process.exit(0));
} else {
  throw new Error(WORKSPACE_WATCH_HOST_ENTRY_GUARD);
}

const core = bootWorkspaceWatchHost({
  post,
  loadEngine: loadParcelWatcherEngine,
  env: process.env,
  listDirectory: workspaceWatchListDirectoryFor(process.platform),
});
if (core) listen((message) => core.handleMessage(message));
