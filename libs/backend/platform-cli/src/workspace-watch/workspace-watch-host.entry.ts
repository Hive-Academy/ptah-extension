/**
 * Watch host entry — bundled to `workspace-watch-host.mjs` beside `main.mjs`
 * and `tui.mjs`, and forked by `CliWorkspaceWatcher` (TASK_2026_437 C9).
 *
 * The host always runs as a `child_process.fork` child, never as a
 * `worker_threads` Worker: `@parcel/watcher` is not context-aware, so its
 * binding loads into ONE thread per process ("Module did not self-register" on
 * the second Worker), and a restarted host would never load it again.
 *
 * Everything the host does is `bootWorkspaceWatchHost` (platform-core). This
 * file only binds the fork IPC channel and performs the one `require` of
 * `@parcel/watcher` — an esbuild external resolved from the CLI package's own
 * `node_modules`; the ESM bundle gets `require` from its `createRequire`
 * banner. The twin for Electron is `platform-electron`'s entry; the two differ
 * only in transport, and this lib must not import that one.
 *
 * The transport guard runs BEFORE the engine loads, so a bundle gate can run
 * this file bare and see only the guard.
 */

import {
  bootWorkspaceWatchHost,
  toWorkspaceWatchEngine,
} from '@ptah-extension/platform-core';

const WORKSPACE_WATCH_HOST_ENTRY_GUARD =
  'workspace-watch-host.entry.ts must be run by child_process.fork (no IPC channel)';

const sendToParent = process.send?.bind(process);
if (!sendToParent) {
  throw new Error(WORKSPACE_WATCH_HOST_ENTRY_GUARD);
}

// The parent owns this process's life. When the channel closes — the parent
// disposed the watcher, exited or crashed — there is nobody to report to.
process.on('disconnect', () => process.exit(0));

const core = bootWorkspaceWatchHost({
  post: (message) => {
    sendToParent(message);
  },
  loadEngine: () => toWorkspaceWatchEngine(require('@parcel/watcher')),
  env: process.env,
});
if (core) process.on('message', (message) => core.handleMessage(message));
