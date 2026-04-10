# Platform CLI Library

## Purpose

Platform abstraction layer for CLI/TUI applications. Implements all 13 `PLATFORM_TOKENS` from `@ptah-extension/platform-core` using pure Node.js APIs, enabling the Ptah agent backend to run headless in a terminal without VS Code or Electron.

## Architecture

This library follows the same pattern as `platform-electron` and `platform-vscode`: it provides concrete implementations of the platform-agnostic interfaces defined in `platform-core`, registered via a single `registerPlatformCliServices()` function.

### Implementation Strategy

- **6 Pure Node.js copies** from `platform-electron` (identical logic, CLI class prefix): FileSystemProvider, StateStorage, TokenCounter, DiagnosticsProvider, CommandRegistry, OutputChannel
- **3 CLI-specific implementations**: WorkspaceProvider (CWD-based), UserInteraction (console-based), EditorProvider (stub)
- **1 Crypto-based implementation**: SecretStorage (AES-256-GCM with PBKDF2 key derivation)
- **Registration function**: Registers all 13 tokens with computed paths and defaults

### Token Registration (13 PLATFORM_TOKENS)

| #   | Token                   | Implementation                    | Notes                                                       |
| --- | ----------------------- | --------------------------------- | ----------------------------------------------------------- |
| 1   | PLATFORM_INFO           | `{ type: PlatformType.CLI, ... }` | Value object                                                |
| 2   | FILE_SYSTEM_PROVIDER    | `CliFileSystemProvider`           | fast-glob + chokidar                                        |
| 3   | STATE_STORAGE           | `CliStateStorage` (global)        | JSON file at ~/.ptah/global-state.json                      |
| 4   | WORKSPACE_STATE_STORAGE | `CliStateStorage` (workspace)     | JSON file at ~/.ptah/workspaces/{hash}/workspace-state.json |
| 5   | SECRET_STORAGE          | `CliSecretStorage`                | AES-256-GCM encrypted file at ~/.ptah/secrets.enc           |
| 6   | WORKSPACE_PROVIDER      | `CliWorkspaceProvider`            | CWD or --workspace arg                                      |
| 7   | USER_INTERACTION        | `CliUserInteraction`              | Console-based (v1), TUI upgrade in Phase 7                  |
| 8   | OUTPUT_CHANNEL          | `CliOutputChannel`                | Log file at ~/.ptah/logs/                                   |
| 9   | COMMAND_REGISTRY        | `CliCommandRegistry`              | In-memory Map                                               |
| 10  | EDITOR_PROVIDER         | `CliEditorProvider`               | Stub (no editor in CLI)                                     |
| 11  | TOKEN_COUNTER           | `CliTokenCounter`                 | gpt-tokenizer BPE                                           |
| 12  | DIAGNOSTICS_PROVIDER    | `CliDiagnosticsProvider`          | Returns empty (no language server)                          |
| 13  | CONTENT_DOWNLOAD        | `ContentDownloadService`          | From platform-core (shared)                                 |

## Key Design Decisions

- **CliSecretStorage** uses Node.js `crypto` (AES-256-GCM + PBKDF2) instead of Electron's safeStorage. Key is derived from machine ID (`hostname:username`). Handles corruption by deleting and starting fresh.
- **CliWorkspaceProvider** defaults workspace to `process.cwd()`. Supports `PtahFileSettingsManager` routing for file-based settings (TASK_2025_247 compatibility).
- **CliUserInteraction** is a v1 console stub. QuickPick returns first item; InputBox returns empty string. Will be upgraded to TUI callbacks in Batch 6.
- **Workspace storage** path uses SHA-256 hash of workspace path (16 hex chars) for filesystem-safe directory names.

## Dependencies

- `@ptah-extension/platform-core` (interfaces, tokens, createEvent, PtahFileSettingsManager, ContentDownloadService)
- `tsyringe` (DI container type for registration function)
- `gpt-tokenizer` (BPE token counting)
- `fast-glob` (file search)
- `chokidar` (file watching)

## Future Plans

- **Batch 6**: Upgrade CliUserInteraction with TUI callback handlers
- **Post-MVP**: Extract shared Node.js implementations into `platform-node` library to eliminate duplication between `platform-electron` and `platform-cli`
