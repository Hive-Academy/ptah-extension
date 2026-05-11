# @ptah-extension/platform-vscode

[Back to Main](../../../CLAUDE.md)

## Purpose

VS Code adapter for the `platform-core` ports. Bridges `vscode.*` APIs onto Ptah's port interfaces so domain libs and `rpc-handlers` run inside the extension host.

## Boundaries

**Belongs here**:

- One `Vscode*` class per `platform-core` port
- `registerPlatformVscodeServices`

**Does NOT belong**:

- Electron or CLI imports
- Business logic
- Port interfaces (live in `platform-core`)

## Public API

`registerPlatformVscodeServices`.
Implementations: `VscodeFileSystemProvider`, `VscodeStateStorage`, `VscodeDiskStateStorage`, `VscodeSecretStorage`, `VscodeWorkspaceProvider`, `VscodeUserInteraction`, `VscodeOutputChannel`, `VscodeCommandRegistry`, `VscodeEditorProvider`, `VscodeDiagnosticsProvider`.

## Internal Structure

- `src/implementations/` — one file per `Vscode*` adapter
- `src/registration.ts` — DI registration

## Dependencies

**Internal**: `@ptah-extension/platform-core`
**External**: `@types/vscode`, `tsyringe`

## Guidelines

- Wrap `vscode` API surfaces only — do not add domain logic.
- `VscodeStateStorage` (Memento) and `VscodeDiskStateStorage` (file-backed) both implement `IStateStorage`; the app chooses which one to register under each token.
- `VscodeWorkspaceProvider` routes `getConfiguration` keys in `FILE_BASED_SETTINGS_KEYS` to `PtahFileSettingsManager` (TASK_2025_247).
- **Never import** other adapter libs.
- `catch (error: unknown)`.

## Cross-Lib Rules

Selected by `apps/ptah-extension-vscode`. Mutually exclusive with `platform-electron`/`platform-cli`.
