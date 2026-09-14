/**
 * Watch host entry — bundled to `workspace-watch-host.mjs` and forked by the
 * Electron app as a `utilityProcess` (TASK_2026_437 C8).
 *
 * Everything the host does lives in `WorkspaceWatchHostCore` (platform-core).
 * This file only:
 *   1. detects its transport — `process.parentPort` (Electron utilityProcess,
 *      whose 'message' events wrap the payload as `{ data }`),
 *      `node:worker_threads`' `parentPort` (raw payload), or a
 *      `child_process.fork` IPC channel (raw payload) — the first two copied
 *      from `persistence-sqlite`'s `integrity-worker.ts`. Only ONE host per
 *      process may use the worker_threads transport: `@parcel/watcher` is not
 *      context-aware, so a second worker in the same process cannot load it;
 *      a restartable host in a plain Node parent must be a child process;
 *   2. loads `@parcel/watcher` (an esbuild external; see
 *      `parcel-watcher-engine.ts`);
 *   3. reads the storm breaker tunables from the host's own environment, which
 *      a utilityProcess inherits from main.
 *
 * The transport guard runs BEFORE the engine loads, so the ESM bundle gate can
 * run this bundle bare and see only the guard.
 *
 * An engine that fails to load is reported as `fatal` and the host stays up
 * doing nothing; the adapter restarts it within its budget and then degrades.
 */

import { parentPort as workerThreadsParentPort } from 'node:worker_threads';

import {
  WorkspaceWatchHostCore,
  readEventStormBreakerOptionsFromEnv,
  type WorkspaceWatchEngine,
  type WorkspaceWatchHostOutbound,
} from '@ptah-extension/platform-core';

import { loadParcelWatcherEngine } from './parcel-watcher-engine';

/** Electron utilityProcess `process.parentPort`, typed structurally (no `electron` import). */
interface ElectronParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/** Mirrored in the app's ESM bundle gate (`WORKER_ENTRY_GUARDS`) once Batch 10 adds the target. */
const WORKSPACE_WATCH_HOST_ENTRY_GUARD =
  'workspace-watch-host.entry.ts must be run as a worker (no Electron parentPort, no worker_threads parentPort and no IPC channel)';

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
} else if (workerThreadsParentPort) {
  const port = workerThreadsParentPort;
  post = (message) => port.postMessage(message);
  listen = (handler) =>
    port.on('message', (message: unknown) => handler(message));
} else if (sendToParent) {
  // `child_process.fork` IPC. `@parcel/watcher` is not context-aware: its
  // binding loads into ONE thread per process ("Module did not self-register"
  // on the second worker), so a host that must survive a restart inside a
  // plain Node parent needs its own process. The parent owns this process's
  // life; when the channel closes there is nobody to report to.
  post = (message) => {
    sendToParent(message);
  };
  listen = (handler) => process.on('message', (message) => handler(message));
  process.on('disconnect', () => process.exit(0));
} else {
  throw new Error(WORKSPACE_WATCH_HOST_ENTRY_GUARD);
}

let engine: WorkspaceWatchEngine | undefined;
try {
  engine = loadParcelWatcherEngine();
} catch (error: unknown) {
  post({
    type: 'fatal',
    message: `@parcel/watcher failed to load: ${
      error instanceof Error ? error.message : String(error)
    }`.slice(0, 2048),
  });
}

if (engine) {
  const core = new WorkspaceWatchHostCore({
    engine,
    post,
    stormBreakerOptions: readEventStormBreakerOptionsFromEnv(process.env),
  });
  listen((message) => core.handleMessage(message));
  core.start();
}
