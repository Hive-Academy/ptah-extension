# @ptah-extension/platform-core

[Back to Main](../../../CLAUDE.md)

## Purpose

L0.5 interface/contract library defining the **ports** of the hexagonal architecture. Owns the `PLATFORM_TOKENS` symbol registry and the I-prefixed platform abstraction interfaces that `platform-{cli,electron,vscode}` adapters implement.

## Boundaries

**Belongs here**:

- Port interfaces (`I*` types) describing platform capabilities
- `PLATFORM_TOKENS` symbol registry
- Platform-agnostic value types (`FileStat`, `PlatformType`, `IDisposable`, etc.)
- A few tiny "logic-light" services that need to be platform-shared: `PtahFileSettingsManager`, `ContentDownloadService`, `AgentPackDownloadService`

**Does NOT belong**:

- Platform-specific implementations (live in `platform-cli/electron/vscode`)
- DI container registration (no `register.ts` — see `src/di/index.ts:1`)
- VS Code, Electron, or Node-IPC imports
- Business/domain logic

## Public API

**Interfaces (all `I`-prefixed, exported as `type`)**:
`IFileSystemProvider`, `IStateStorage`, `ISecretStorage`, `IWorkspaceProvider`, `IWorkspaceLifecycleProvider`, `IUserInteraction`, `IOutputChannel`, `ICommandRegistry`, `IEditorProvider`, `ITokenCounter`, `IDiagnosticsProvider`, `IMemoryWriter`, `IHttpServerProvider`, `IPlatformCommands`, `IPlatformAuthProvider`, `ISaveDialogProvider`, `IModelDiscovery`, `IBootReadinessProvider`, `IWorkspaceWatcher` (+ `WorkspaceChangeBatch`, `WorkspaceWatchOptions`).

**Concrete services**: `PtahFileSettingsManager`, `ContentDownloadService`, `AgentPackDownloadService`.

**Constants/helpers**: `PLATFORM_TOKENS`, `FILE_BASED_SETTINGS_KEYS`, `FILE_BASED_SETTINGS_DEFAULTS`, `isFileBasedSettingKey`, `createEvent`, `isPathWithinRoots`, `planGlobWatch` (+ `GlobWatchPlan`), `EventStormBreaker`, `WorkspaceChangeCoalescer` (+ `WORKSPACE_WATCH_LIMITS`, `isExcludedBySegmentRules`), `WorkspaceWatchHostCore`, `bootWorkspaceWatchHost` (+ `toWorkspaceWatchEngine`), `WorkspaceWatchSupervisor` (+ `WORKSPACE_WATCH_SUPERVISION_DEFAULTS`, `WorkspaceWatchHostForker`, `WorkspaceWatchHostProcess`, `WorkspaceWatcherDiagnostic`, `WorkspaceWatcherDegradation`).

**Contract runners** (`@ptah-extension/platform-core/testing`): one `run*Contract` per port, including `runWorkspaceWatcherContract` which every `IWorkspaceWatcher` adapter runs.

## Internal Structure

- `src/interfaces/` — every port interface, one file per port
- `src/types/platform.types.ts` — `FileType`, `PlatformType`, `IDisposable`, `IEvent`, `FileStat`, etc.
- `src/di/tokens.ts` — `PLATFORM_TOKENS` (the canonical DI symbol map)
- `src/di/index.ts` — re-exports `PLATFORM_TOKENS` only (no `register.ts`)
- `src/utils/event-emitter.ts` — `createEvent` helper
- `src/utils/glob-watch-plan.ts` — `planGlobWatch`: glob → watchable directory +
  match/prune predicates, shared by the two chokidar-backed adapters. Not a
  port, same category as `path-containment.ts`
- `src/utils/event-storm-breaker.ts` — `EventStormBreaker`: pure rate breaker,
  "stop per-event work, one refresh after quiet" (TASK_2026_437 INV-6)
- `src/utils/workspace-change-coalescer.ts` — `WorkspaceChangeCoalescer`: the
  one implementation of the `IWorkspaceWatcher` guarantees (exclusion, nested
  repo detection, storm breaker, ≤ 1 batch per 250 ms, ≤ 500 paths, overflow).
  The first batch after a quiet period is HELD for `minBatchIntervalMs`
  (leading-edge hold, TASK_2026_437 Batch 11): `@parcel/watcher` reports a
  burst's first event alone and the rest up to 500 ms later, and without the
  hold that lone event became a normal batch ahead of the storm's overflow —
  two consumer refreshes for one incident.
  Every watcher adapter feeds one per subscription. Exclusions arrive as data
  because this lib cannot import `shared`: `excludeDirNames` (exact,
  case-sensitive — pass `WATCH_IGNORED_DIRS`), `excludeSegmentRules` (ASCII
  case-insensitive — pass `NESTED_WORKSPACE_PATH_RULES`), `excludeGlobs`. The
  matching ALGORITHM is duplicated from shared `isExcludedWorkspacePath`, not
  shared with it: `isExcludedBySegmentRules` must stay behaviourally identical,
  pinned by `workspace-intelligence/src/file-indexing/workspace-exclusion-drift.spec.ts`.
  While storming, an event is one counter (no parsing); one incident → one overflow
- `src/workspace-watch/` — the out-of-process watch host AND its main-side
  supervisor, shared by every host-based `IWorkspaceWatcher` adapter
  (TASK_2026_437 C8, C9). No Electron or Node-IPC import, and no
  `require('@parcel/watcher')` (it would be bundled into every host, the VS Code
  extension included); the adapter lib supplies the transport, the fork shim and
  the engine `require`:
  - `workspace-watch-protocol.ts` — Zod `strictObject` wire schemas both ways
    (main → host `subscribe`/`unsubscribe`; host → main `batch`, `heartbeat`,
    `error`, `notice`, `fatal`, and `subscribed` — the per-subscription ack that
    a native subscribe covering it succeeded), size caps in `WORKSPACE_WATCH_PROTOCOL_LIMITS`,
    `parseWorkspaceWatchHostInbound` / `parseWorkspaceWatchHostOutbound`
  - `workspace-watch-host-core.ts` — `WorkspaceWatchHostCore`: one native
    subscription per root with the intersection of subscriber excludes, one
    `WorkspaceChangeCoalescer` per subscriber, nested `.git` resubscribe (with
    overlap), native error → overflow + REBUILD with back-off, 2 s heartbeat,
    one `subscribed` ack per subscription once a settled native subscribe
    covers it, invalid inbound messages reported at most 10 times.
    **Re-subscribe vs rebuild**: only an ignore-set change may subscribe the
    replacement before releasing the old one. Every recovery (native error,
    refused subscribe, lost watch, creates during a storm) releases the live
    subscription, awaits it, then subscribes, and signals `overflow` once the
    new one is live — and every loss is ALSO signalled when detected (native
    error, refused subscribe, lost watch, reconcile limit, storm end with
    unreconciled creates), so no consumer trusts a stale view while the
    rebuild waits. An overlapping re-subscribe repairs nothing:
    `@parcel/watcher` keeps a root's cached tree and watches while any
    subscription holds them (measured on Linux, 16 of 800 writes under lost
    watches still lost after an overlap, 0 after a rebuild). Notice
    `native-rebuilt` carries the reason.
    **Native call queue** (`serializeNative`): every native subscribe and
    unsubscribe, for every root, runs one at a time. `@parcel/watcher` keeps one
    backend per process; a subscribe in flight while an unsubscribe removes the
    backend's last subscription resolves into a DEAD subscription (Linux, 2.5.6:
    100/100 overlapping unsubscribe(A)+subscribe(B) pairs dead idle, 94/100 under
    load, 0/100 serialized) — a workspace-folder switch. Each call is bounded:
    `nativeUnsubscribeTimeoutMs` 10 s (an unsubscribe walks nothing, so a slow one
    is the hang being guarded), `nativeSubscribeTimeoutMs` 120 s (a subscribe
    walks the whole root first; the 238k-file load-test workspace on a slow disk
    must not trip it, because each trip restarts the host and repeated restarts
    end in degraded mode). A miss posts `fatal` (the supervisor restarts the
    host), rejects so the queue moves on, and a late subscription is released.
    `dispose` waits for queued releases for at most 10 s so an app quit is never
    held longer; a subscribe still walking then is abandoned, and its late
    subscription is released the same way. Calls made after `dispose` (releases
    queued behind an abandoned call, late releases) still run, but untimed:
    nothing is posted after dispose and no fresh timer is armed. The core's
    default clock unrefs every timer (host timers never keep a quitting process
    alive; the IPC channel or hosting process does). Never call
    `engine.subscribe` or `subscription.unsubscribe` outside the queue
  - `native-ignore-set-planner.ts` — `planNativeIgnoreSet` (internal): the
    native `ignore` list for one root — the intersection of subscriber
    excludes in subtree-only glob form, nested roots under the root, never
    `.git`. Pure; the core calls it before each native subscribe
  - `created-directory-reconciler.ts` — `CreatedDirectoryReconciler` (internal),
    one per root when the core has a `listDirectory` (the Linux entries only).
    The inotify backend reports a created directory and watches it only
    afterwards, never listing it (parcel-bundler/watcher#243): children created
    in that window are never reported and child directories are never watched.
    It lists each created path one level after 100 ms (ENOTDIR/ENOENT →
    nothing; EACCES/EPERM → nothing plus one `directory-unreadable` notice per
    root per minute), emits unreported children as `create`, skips children the
    native ignore set covers, lists unreported child directories too, and treats
    a child directory still unreported after 1 s as a lost watch →
    `onIncomplete` → the core's immediate `overflow` plus debounced (1 s),
    gap-limited (10 s) rebuild. More than 2 000 tracked paths or 5 000 listed
    entries in a pass → the same. Suspended while any subscriber storms (one
    comparison per event); a create seen meanwhile → the same after the storm
  - `workspace-watch-host-boot.ts` — `bootWorkspaceWatchHost`: what every host
    entry does once its transport is bound (engine load → one clipped `fatal`
    on failure, core construction with env storm tunables and the optional
    `listDirectory`, `start`); `toWorkspaceWatchEngine`, the shape check over a
    loaded `@parcel/watcher`; and `workspaceWatchListDirectoryFor(platform)`,
    the `readdir` listing for `linux` and `undefined` elsewhere (FSEvents and
    ReadDirectoryChangesW watch whole trees). Used by the Electron entry, the
    Electron in-process hatch and the CLI entry
  - `workspace-watch-supervisor.ts` — `WorkspaceWatchSupervisor` (an `IWorkspaceWatcher`): lazy fork through an injected `WorkspaceWatchHostForker`,
    heartbeat watchdog (3 missed × 2 s, stall-aware), restart after 250 ms with
    resubscribe and one `overflow`, budget 5 per 10 min, degraded mode (one
    `onDegraded` per episode, `overflow` now and every 60 s), recovery after
    10 min confirmed only by `subscribed` acks, idle stop 30 s after the last
    unsubscribe, and an optional `readStderrTail()` on the host process whose end
    rides on that host's one failure diagnostic. `ElectronWorkspaceWatcher` and `CliWorkspaceWatcher` are thin
    facades over it that differ only in the fork shim; never re-implement
    supervision in an adapter lib
  - `workspace-watch-batch-relay.ts` — `WorkspaceWatchBatchRelay` (internal):
    per-subscription pacing and path containment of host batches
- `src/file-settings-manager.ts` + `file-settings-keys.ts` — `~/.ptah/settings.json` routing (TASK_2025_247)
- `src/content-download.service.ts` — GitHub plugin/template downloader (TASK_2025_248)
- `src/agent-pack-download.service.ts` — Agent pack downloader (TASK_2025_257)
- `src/testing/` — shared mocks and contract test suites for adapter validation

## Key Files

- `src/di/tokens.ts:11` — `PLATFORM_TOKENS` registry (28 tokens, the count of `Symbol.for(` entries in `tokens.ts`)
- `src/interfaces/workspace-watcher.interface.ts` — `IWorkspaceWatcher`: batched, pre-filtered, overflow-signalling recursive change feed (TASK_2026_437 C7). Its doc is the degraded-mode contract every adapter follows: overflow now, then on a fixed 60 s rescan cadence until recovery or dispose
- `src/workspace-watch/workspace-watch-host-core.ts` — `WorkspaceWatchHostCore`, the watch host every host-based adapter runs (Electron `utilityProcess`, CLI `child_process.fork`); the entry that wires a transport and `@parcel/watcher` to it lives in the adapter lib
- `src/workspace-watch/workspace-watch-supervisor.ts` — `WorkspaceWatchSupervisor`, the one supervision state machine behind every host-based adapter
- `src/interfaces/platform-abstractions.interface.ts:23` — `IPlatformCommands` (moved here in Wave C8)
- `src/interfaces/workspace-provider.interface.ts` — workspace folders + configuration read API
- `src/interfaces/workspace-lifecycle.interface.ts` — workspace mutation API (add/remove/setActive)
- `src/file-settings-manager.ts` — file-based settings (avoid marketplace scanner trademark rejections)
- `src/content-download.service.ts` — required by all platforms to fetch plugins/templates at runtime
- `src/utils/editor-launcher-detection.ts` — `detectEditorTargets` behind every host's `IEditorLauncher.detect` (`editor:detectTargets`). PATH and install-location probes run at most `EDITOR_PROBE_CONCURRENCY` (8) stats at once, still picking the FIRST match in PATH order. Results are cached in `EditorTargetCache`, keyed by `PATH` + `PATHEXT` + platform + the definitions: the process-lifetime cache when `stat` is not injected, `options.cache` when given, nothing for `cache: null`. Only a successful, CONCLUSIVE detection is kept — a rejection, or a probe that failed with anything but `ENOENT`/`ENOTDIR` ahead of the chosen match, is served and then dropped so the next call probes again (TASK_2026_437 C14 e). An editor installed while the process runs is not seen until restart unless PATH changes.
- `src/index.ts` — public barrel (everything in this list is canonical)

## DI Tokens

All under `PLATFORM_TOKENS`, mostly `Symbol.for('Platform*')` (`TRACER` and
`FILE_DIALOG` predate the prefix). 28 tokens — the count of `Symbol.for(`
entries in `src/di/tokens.ts`:

| Token                          | Port                           |
| ------------------------------ | ------------------------------ |
| `FILE_SYSTEM_PROVIDER`         | `IFileSystemProvider`          |
| `STATE_STORAGE`                | `IStateStorage` (global)       |
| `WORKSPACE_STATE_STORAGE`      | `IStateStorage` (workspace)    |
| `SECRET_STORAGE`               | `ISecretStorage`               |
| `WORKSPACE_PROVIDER`           | `IWorkspaceProvider`           |
| `WORKSPACE_LIFECYCLE_PROVIDER` | `IWorkspaceLifecycleProvider`  |
| `USER_INTERACTION`             | `IUserInteraction`             |
| `OUTPUT_CHANNEL`               | `IOutputChannel`               |
| `COMMAND_REGISTRY`             | `ICommandRegistry`             |
| `EDITOR_PROVIDER`              | `IEditorProvider`              |
| `EDITOR_LAUNCHER`              | `IEditorLauncher`              |
| `PLATFORM_INFO`                | `IPlatformInfo`                |
| `TOKEN_COUNTER`                | `ITokenCounter`                |
| `DIAGNOSTICS_PROVIDER`         | `IDiagnosticsProvider`         |
| `CONTENT_DOWNLOAD`             | `ContentDownloadService`       |
| `HTTP_SERVER_PROVIDER`         | `IHttpServerProvider`          |
| `MEMORY_WRITER`                | `IMemoryWriter`                |
| `MASTER_KEY_PROVIDER`          | `IMasterKeyProvider`           |
| `DI_CONTAINER`                 | tsyringe `DependencyContainer` |
| `MCP_SERVER_STATUS`            | `IMcpServerStatus`             |
| `TRACER`                       | `ITracer`                      |
| `SESSION_ATTACHMENT_GUARD`     | `ISessionAttachmentGuard`      |
| `OAUTH_CALLBACK_LISTENER`      | `IOAuthCallbackListener`       |
| `FILE_DIALOG`                  | `IFileDialog`                  |
| `APP_UPDATER`                  | `IAppUpdater`                  |
| `CALLER_WORKSPACE_RESOLVER`    | `ICallerWorkspaceResolver`     |
| `BOOT_READINESS`               | `IBootReadinessProvider`       |
| `WORKSPACE_WATCHER`            | `IWorkspaceWatcher`            |

`WORKSPACE_WATCHER` (TASK_2026_437 Batches 8–9) — `ElectronWorkspaceWatcher` (`platform-electron`,
`utilityProcess` host), `CliWorkspaceWatcher` (`platform-cli`, `child_process.fork`
host — never `worker_threads`: `@parcel/watcher` keeps process-global state, so a
second Worker fails with "Module did not self-register" and terminating a Worker with a
live subscription aborts the process on Linux), `VscodeWorkspaceWatcher` (`platform-vscode`, `createFileSystemWatcher` → coalescer). The first two
are facades over `WorkspaceWatchSupervisor`. Each runs `runWorkspaceWatcherContract`.

`BOOT_READINESS` — `NullBootReadinessProvider` (`vscode-core`, always ready, the
VS Code and CLI default) / `ElectronBootReadinessProvider` (`ptah-electron`,
delegates to `BootCoordinator`).

## Dependencies

**Internal**: none (this is L0.5)
**External**: minimal — pure type definitions plus the three concrete services use Node `fs`/`https`, and `glob-watch-plan.ts` uses `picomatch`.

## Guidelines

- **Interfaces only** for ports — no concrete adapter classes. Adapters live in `platform-{cli,electron,vscode}`. Transport-agnostic logic two or more adapters share (the coalescer, the watch host core, the watch supervisor) belongs here with its I/O injected, not copied into each adapter lib.
- **Never import** other backend libs from here. This must remain a leaf.
- **Symbol.for(...)** convention — every token is global-registry to allow cross-bundle resolution.
- **No `register.ts`** by design (see `src/di/index.ts:1`). Adapters own their registration.
- When adding a new port: define interface in `src/interfaces/`, add token to `tokens.ts`, export type from `src/index.ts`, then provide implementations in all three adapter libs.
- **File-Based Settings**: settings with trademarked names (claude/openai/copilot/codex) MUST live in `FILE_BASED_SETTINGS_KEYS`, not VS Code `package.json contributes.configuration` (marketplace scanner — see root CLAUDE.md).

## Cross-Lib Rules

Everything imports this. This imports nothing from `@ptah-extension/*`.
