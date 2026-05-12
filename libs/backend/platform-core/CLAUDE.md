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
`IFileSystemProvider`, `IStateStorage`, `ISecretStorage`, `IWorkspaceProvider`, `IWorkspaceLifecycleProvider`, `IUserInteraction`, `IOutputChannel`, `ICommandRegistry`, `IEditorProvider`, `ITokenCounter`, `IDiagnosticsProvider`, `IMemoryWriter`, `IHttpServerProvider`, `IPlatformCommands`, `IPlatformAuthProvider`, `ISaveDialogProvider`, `IModelDiscovery`.

**Concrete services**: `PtahFileSettingsManager`, `ContentDownloadService`, `AgentPackDownloadService`.

**Constants/helpers**: `PLATFORM_TOKENS`, `FILE_BASED_SETTINGS_KEYS`, `FILE_BASED_SETTINGS_DEFAULTS`, `isFileBasedSettingKey`, `createEvent`.

## Internal Structure

- `src/interfaces/` — every port interface, one file per port
- `src/types/platform.types.ts` — `FileType`, `PlatformType`, `IDisposable`, `IEvent`, `FileStat`, etc.
- `src/di/tokens.ts` — `PLATFORM_TOKENS` (the canonical DI symbol map)
- `src/di/index.ts` — re-exports `PLATFORM_TOKENS` only (no `register.ts`)
- `src/utils/event-emitter.ts` — `createEvent` helper
- `src/file-settings-manager.ts` + `file-settings-keys.ts` — `~/.ptah/settings.json` routing (TASK_2025_247)
- `src/content-download.service.ts` — GitHub plugin/template downloader (TASK_2025_248)
- `src/agent-pack-download.service.ts` — Agent pack downloader (TASK_2025_257)
- `src/testing/` — shared mocks and contract test suites for adapter validation

## Key Files

- `src/di/tokens.ts:11` — `PLATFORM_TOKENS` registry (16 ports)
- `src/interfaces/platform-abstractions.interface.ts:23` — `IPlatformCommands` (moved here in Wave C8)
- `src/interfaces/workspace-provider.interface.ts` — workspace folders + configuration read API
- `src/interfaces/workspace-lifecycle.interface.ts` — workspace mutation API (add/remove/setActive)
- `src/file-settings-manager.ts` — file-based settings (avoid marketplace scanner trademark rejections)
- `src/content-download.service.ts` — required by all platforms to fetch plugins/templates at runtime
- `src/index.ts` — public barrel (everything in this list is canonical)

## DI Tokens

All under `PLATFORM_TOKENS` (`Symbol.for('Platform*')`):

| Token                          | Port                          |
| ------------------------------ | ----------------------------- |
| `FILE_SYSTEM_PROVIDER`         | `IFileSystemProvider`         |
| `STATE_STORAGE`                | `IStateStorage` (global)      |
| `WORKSPACE_STATE_STORAGE`      | `IStateStorage` (workspace)   |
| `SECRET_STORAGE`               | `ISecretStorage`              |
| `WORKSPACE_PROVIDER`           | `IWorkspaceProvider`          |
| `WORKSPACE_LIFECYCLE_PROVIDER` | `IWorkspaceLifecycleProvider` |
| `USER_INTERACTION`             | `IUserInteraction`            |
| `OUTPUT_CHANNEL`               | `IOutputChannel`              |
| `COMMAND_REGISTRY`             | `ICommandRegistry`            |
| `EDITOR_PROVIDER`              | `IEditorProvider`             |
| `PLATFORM_INFO`                | `IPlatformInfo`               |
| `TOKEN_COUNTER`                | `ITokenCounter`               |
| `DIAGNOSTICS_PROVIDER`         | `IDiagnosticsProvider`        |
| `CONTENT_DOWNLOAD`             | `ContentDownloadService`      |
| `HTTP_SERVER_PROVIDER`         | `IHttpServerProvider`         |
| `MEMORY_WRITER`                | `IMemoryWriter`               |

## Dependencies

**Internal**: none (this is L0.5)
**External**: minimal — pure type definitions plus the three concrete services use Node `fs`/`https`.

## Guidelines

- **Interfaces only** for ports — no concrete adapter classes. Adapters live in `platform-{cli,electron,vscode}`.
- **Never import** other backend libs from here. This must remain a leaf.
- **Symbol.for(...)** convention — every token is global-registry to allow cross-bundle resolution.
- **No `register.ts`** by design (see `src/di/index.ts:1`). Adapters own their registration.
- When adding a new port: define interface in `src/interfaces/`, add token to `tokens.ts`, export type from `src/index.ts`, then provide implementations in all three adapter libs.
- **File-Based Settings**: settings with trademarked names (claude/openai/copilot/codex) MUST live in `FILE_BASED_SETTINGS_KEYS`, not VS Code `package.json contributes.configuration` (marketplace scanner — see root CLAUDE.md).

## Cross-Lib Rules

Everything imports this. This imports nothing from `@ptah-extension/*`.
