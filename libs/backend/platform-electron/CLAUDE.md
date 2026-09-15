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
Implementations: `ElectronFileSystemProvider`, `ElectronStateStorage`, `ElectronSecretStorage` (+ `SafeStorageApi`), `ElectronWorkspaceProvider`, `ElectronUserInteraction` (+ `ElectronDialogApi`, `ElectronBrowserWindowApi`, `ElectronShellApi`), `ElectronOutputChannel`, `ElectronCommandRegistry`, `ElectronEditorProvider`, `ElectronDiagnosticsProvider`, `ElectronWorkspaceWatcher` (+ `ElectronWorkspaceWatcherOptions`, `createInProcessWorkspaceWatchHostForker`; the forker/process/diagnostic types come from `platform-core`).

## Internal Structure

- `src/implementations/` — one file per `Electron*` adapter
- `src/workspace-watch/` — `IWorkspaceWatcher` (TASK_2026_437 C8):
  - `workspace-watch-host.entry.ts` — the host process entry, bundled by the app to
    `workspace-watch-host.mjs`. Detects its transport (Electron `parentPort` in
    the app, `child_process` IPC in its spec), then hands `post`,
    `loadParcelWatcherEngine` and `workspaceWatchListDirectoryFor(process.platform)`
    (Linux created-directory reconciliation) to `bootWorkspaceWatchHost`
    (platform-core). No logic of its own. Its CLI twin is `platform-cli`'s entry
    (fork IPC only).
  - `electron-workspace-watcher.ts` — a facade over `WorkspaceWatchSupervisor`
    (platform-core, TASK_2026_437 Batch 9): same class name, DI token and
    `watch` / `dispose` / `isDegraded`. Every supervision rule — lazy fork,
    stall-aware heartbeat watchdog, restart budget 5 per 10 min, degraded 60 s
    rescans, ack-confirmed recovery after 10 min, pacing and containment — is
    specified in `platform-core/CLAUDE.md` and `workspace-watch-supervisor.spec.ts`.
    Do not add supervision here; `CliWorkspaceWatcher` shares it.
  - `in-process-workspace-watch-host.ts` — the `PTAH_WATCH_HOST=0` recovery hatch:
    same core (via `bootWorkspaceWatchHost`), same protocol, in the calling process.
  - `parcel-watcher-engine.ts` — the one lazy `require('@parcel/watcher')`
    (shape check: `toWorkspaceWatchEngine`).
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
- **`@parcel/watcher` never runs in a `worker_threads` Worker.** It keeps its
  backends and watchers in process-global singletons: a second Worker in the same
  process fails with "Module did not self-register" (measured, TASK_2026_437
  Batch 8), and terminating a Worker whose subscription is live aborts the WHOLE
  process on Linux (SIGABRT, exit 134 — measured; it killed the entry spec's Jest
  worker in CI). The watch host entry therefore has no `worker_threads`
  transport. A host needs its own process — the Electron `utilityProcess`, or a
  `child_process.fork` in plain Node. Never load it statically: the main bundle
  would pay the native load on every boot.
- **One native watcher call at a time, per process.** Overlapping a subscribe with
  another root's last unsubscribe yields a dead `@parcel/watcher` subscription;
  `WorkspaceWatchHostCore` queues every call (unsubscribe 10 s, subscribe 120 s →
  `fatal`). Code here
  that talks to the engine goes through the core, never around it.
- `ElectronWorkspaceWatcher` never imports `vscode-core`: logging and
  `DegradationReporter` arrive as the `onDiagnostic` / `onDegraded` callbacks the
  app binds (`apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts`).
- `ElectronSecretStorage` uses `safeStorage.encryptString` — fall back to plain storage only if `safeStorage.isEncryptionAvailable()` is false (document any fallback).
- `ElectronUserInteraction` routes prompts through dialog APIs; shell links open via `ElectronShellApi.openExternal`.
- `catch (error: unknown)`.

## Cross-Lib Rules

Selected at composition time by `apps/ptah-electron`. Mutually exclusive with other `platform-*` libs.
