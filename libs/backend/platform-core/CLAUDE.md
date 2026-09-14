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

**Constants/helpers**: `PLATFORM_TOKENS`, `FILE_BASED_SETTINGS_KEYS`, `FILE_BASED_SETTINGS_DEFAULTS`, `isFileBasedSettingKey`, `createEvent`, `isPathWithinRoots`, `planGlobWatch` (+ `GlobWatchPlan`), `EventStormBreaker`, `WorkspaceChangeCoalescer` (+ `WORKSPACE_WATCH_LIMITS`, `isExcludedBySegmentRules`).

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
  Every watcher adapter feeds one per subscription. Exclusions arrive as data
  because this lib cannot import `shared`: `excludeDirNames` (exact,
  case-sensitive — pass `WATCH_IGNORED_DIRS`), `excludeSegmentRules` (ASCII
  case-insensitive — pass `NESTED_WORKSPACE_PATH_RULES`), `excludeGlobs`. The
  matching ALGORITHM is duplicated from shared `isExcludedWorkspacePath`, not
  shared with it: `isExcludedBySegmentRules` must stay behaviourally identical,
  pinned by `workspace-intelligence/src/file-indexing/workspace-exclusion-drift.spec.ts`.
  While storming, an event is one counter (no parsing); one incident → one overflow
- `src/workspace-watch/` — the out-of-process watch host, shared by every
  host-based `IWorkspaceWatcher` adapter (TASK_2026_437 C8). No Electron or
  Node-IPC import; the adapter lib supplies the transport and the engine:
  - `workspace-watch-protocol.ts` — Zod `strictObject` wire schemas both ways
    (main → host `subscribe`/`unsubscribe`; host → main `batch`, `heartbeat`,
    `error`, `notice`, `fatal`, and `subscribed` — the per-subscription ack that
    a native subscribe covering it succeeded), size caps in `WORKSPACE_WATCH_PROTOCOL_LIMITS`,
    `parseWorkspaceWatchHostInbound` / `parseWorkspaceWatchHostOutbound`
  - `workspace-watch-host-core.ts` — `WorkspaceWatchHostCore`: one native
    subscription per root with the intersection of subscriber excludes, one
    `WorkspaceChangeCoalescer` per subscriber, nested `.git` resubscribe, native
    error → overflow + retry, 2 s heartbeat, one `subscribed` ack per
    subscription once a settled native subscribe covers it, invalid inbound
    messages reported at most 10 times
- `src/file-settings-manager.ts` + `file-settings-keys.ts` — `~/.ptah/settings.json` routing (TASK_2025_247)
- `src/content-download.service.ts` — GitHub plugin/template downloader (TASK_2025_248)
- `src/agent-pack-download.service.ts` — Agent pack downloader (TASK_2025_257)
- `src/testing/` — shared mocks and contract test suites for adapter validation

## Key Files

- `src/di/tokens.ts:11` — `PLATFORM_TOKENS` registry (28 tokens, the count of `Symbol.for(` entries in `tokens.ts`)
- `src/interfaces/workspace-watcher.interface.ts` — `IWorkspaceWatcher`: batched, pre-filtered, overflow-signalling recursive change feed (TASK_2026_437 C7). Its doc is the degraded-mode contract every adapter follows: overflow now, then on a fixed 60 s rescan cadence until recovery or dispose
- `src/workspace-watch/workspace-watch-host-core.ts` — `WorkspaceWatchHostCore`, the watch host every host-based adapter runs (Electron `utilityProcess`, CLI); the entry that wires a transport and `@parcel/watcher` to it lives in the adapter lib
- `src/interfaces/platform-abstractions.interface.ts:23` — `IPlatformCommands` (moved here in Wave C8)
- `src/interfaces/workspace-provider.interface.ts` — workspace folders + configuration read API
- `src/interfaces/workspace-lifecycle.interface.ts` — workspace mutation API (add/remove/setActive)
- `src/file-settings-manager.ts` — file-based settings (avoid marketplace scanner trademark rejections)
- `src/content-download.service.ts` — required by all platforms to fetch plugins/templates at runtime
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

`WORKSPACE_WATCHER` (adapters land in TASK_2026_437 Batches 8–9) — `ElectronWorkspaceWatcher` (`platform-electron`,
`utilityProcess` host), `CliWorkspaceWatcher` (`platform-cli`, `child_process.fork`
host — never `worker_threads`: `@parcel/watcher` loads in one thread per process, so a
restarted Worker host fails with "Module did not self-register"), `VscodeWorkspaceWatcher` (`platform-vscode`). Each runs
`runWorkspaceWatcherContract`.

`BOOT_READINESS` — `NullBootReadinessProvider` (`vscode-core`, always ready, the
VS Code and CLI default) / `ElectronBootReadinessProvider` (`ptah-electron`,
delegates to `BootCoordinator`).

## Dependencies

**Internal**: none (this is L0.5)
**External**: minimal — pure type definitions plus the three concrete services use Node `fs`/`https`, and `glob-watch-plan.ts` uses `picomatch`.

## Guidelines

- **Interfaces only** for ports — no concrete adapter classes. Adapters live in `platform-{cli,electron,vscode}`.
- **Never import** other backend libs from here. This must remain a leaf.
- **Symbol.for(...)** convention — every token is global-registry to allow cross-bundle resolution.
- **No `register.ts`** by design (see `src/di/index.ts:1`). Adapters own their registration.
- When adding a new port: define interface in `src/interfaces/`, add token to `tokens.ts`, export type from `src/index.ts`, then provide implementations in all three adapter libs.
- **File-Based Settings**: settings with trademarked names (claude/openai/copilot/codex) MUST live in `FILE_BASED_SETTINGS_KEYS`, not VS Code `package.json contributes.configuration` (marketplace scanner — see root CLAUDE.md).

## Cross-Lib Rules

Everything imports this. This imports nothing from `@ptah-extension/*`.
