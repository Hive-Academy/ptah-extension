# @ptah-extension/platform-electron

[Back to Main](../../../CLAUDE.md)

## Purpose

Electron-process adapter for the `platform-core` ports. Bridges Electron main-process APIs (`safeStorage`, `dialog`, `BrowserWindow`, `shell`) onto Ptah's port interfaces.

## Boundaries

**Belongs here**:

- One `Electron*` class per `platform-core` port
- Electron-API-shaped types (`SafeStorageApi`, `ElectronDialogApi`, `ElectronBrowserWindowApi`, `ElectronShellApi`) injected for testability
- `registerPlatformElectronServices` + `ElectronPlatformOptions`

**Does NOT belong**:

- VS Code or CLI imports
- Renderer-process code (this is main-process)
- Domain/business logic

## Public API

`registerPlatformElectronServices`, `ElectronPlatformOptions`.
Implementations: `ElectronFileSystemProvider`, `ElectronStateStorage`, `ElectronSecretStorage` (+ `SafeStorageApi`), `ElectronWorkspaceProvider`, `ElectronUserInteraction` (+ `ElectronDialogApi`, `ElectronBrowserWindowApi`, `ElectronShellApi`), `ElectronOutputChannel`, `ElectronCommandRegistry`, `ElectronEditorProvider`, `ElectronDiagnosticsProvider`, `ElectronWorkspaceWatcher` (+ `WorkspaceWatchHostForker`, `WorkspaceWatchHostProcess`, `createInProcessWorkspaceWatchHostForker`).

## Internal Structure

- `src/implementations/` — one file per `Electron*` adapter
- `src/workspace-watch/` — `IWorkspaceWatcher` (TASK_2026_437 C8):
  - `workspace-watch-host.entry.ts` — the host process entry, bundled by the app to
    `workspace-watch-host.mjs`. Detects its transport (Electron `parentPort`,
    `worker_threads`, `child_process` IPC), loads `@parcel/watcher`, runs
    `WorkspaceWatchHostCore` (platform-core). No logic of its own.
  - `electron-workspace-watcher.ts` — the main-side adapter: lazy fork, heartbeat
    supervision (3 missed × 2 s; a watchdog tick that ran late means MAIN stalled,
    so it waits one loop turn for queued heartbeats before it kills), restart
    budget 5 per 10 min then degraded (one `onDegraded` per episode, then an
    `overflow` rescan every 60 s), resubscribe after restart, per-subscription
    pacing and containment of host batches.
    Degraded recovery: after 10 min degraded the budget resets and ONE host is
    forked. The episode ends only when that host has sent a `subscribed` ack for
    EVERY subscription re-sent to it (one info line, one rescan `overflow`, the
    60 s rescans stop). Heartbeats and errors never confirm. A
    `native-subscribe-failed` / `subscribe-rejected` error, any host failure, or
    acks still missing after 6 s go back to degraded for another 10 min with a
    warn line and no second `onDegraded`. The normal restart path does not wait
    for acks: a native subscribe failure in a live host is the host's own per-root
    overflow + retry, not a process failure to charge to the restart budget.
  - `in-process-workspace-watch-host.ts` — the `PTAH_WATCH_HOST=0` recovery hatch:
    same core, same protocol, in the calling process.
  - `parcel-watcher-engine.ts` — the one lazy `require('@parcel/watcher')`.
- `src/registration.ts` — `registerPlatformElectronServices`

## Dependencies

**Internal**: `@ptah-extension/platform-core`
**External**: `electron` (peer; types only at compile time), `tsyringe`, `zod`, `@parcel/watcher` (runtime `require` in the watch host only; an esbuild external)

## Guidelines

- Constructors accept **injected API shims** (e.g. `SafeStorageApi`), not the global `electron` import, so unit tests stub them.
- **Never import** `vscode` or other adapter libs.
- **`createFileWatcher` must never hand its glob to chokidar.** chokidar removed
  glob support in v4 (this repo is on 5.x), so a pattern reaches it as a literal
  path: `getWatched()` returns `{}` and the watcher silently never fires — no
  throw, no warning. Translate through `planGlobWatch` (platform-core), which
  yields a real directory plus match/prune predicates. The same rule applies to
  `ignored`: pass the plan's FUNCTION, not the caller's exclude globs, or
  `node_modules` gets walked instead of pruned. `CliFileSystemProvider` is the
  twin of this method — fix both, and keep the shared logic in `planGlobWatch`.
- **`@parcel/watcher` is not context-aware.** Its binding loads into ONE thread per
  process; a second `worker_threads` Worker in the same process fails with
  "Module did not self-register" (measured, TASK_2026_437 Batch 8). A host that
  must restart needs its own process — the Electron `utilityProcess`, or a
  `child_process.fork` in plain Node. Never load it statically: the main bundle
  would pay the native load on every boot.
- `ElectronWorkspaceWatcher` never imports `vscode-core`: logging and
  `DegradationReporter` arrive as the `onDiagnostic` / `onDegraded` callbacks the
  app binds (`apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts`).
- `ElectronSecretStorage` uses `safeStorage.encryptString` — fall back to plain storage only if `safeStorage.isEncryptionAvailable()` is false (document any fallback).
- `ElectronUserInteraction` routes prompts through dialog APIs; shell links open via `ElectronShellApi.openExternal`.
- `catch (error: unknown)`.

## Cross-Lib Rules

Selected at composition time by `apps/ptah-electron`. Mutually exclusive with other `platform-*` libs.
