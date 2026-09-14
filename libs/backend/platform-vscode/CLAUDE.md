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
Implementations: `VscodeFileSystemProvider`, `VscodeStateStorage`, `VscodeDiskStateStorage`, `VscodeSecretStorage`, `VscodeWorkspaceProvider`, `VscodeUserInteraction`, `VscodeOutputChannel`, `VscodeCommandRegistry`, `VscodeEditorProvider`, `VscodeDiagnosticsProvider`, `VscodeWorkspaceWatcher` (+ `VscodeWorkspaceWatcherOptions`).

## Internal Structure

- `src/implementations/` — one file per `Vscode*` adapter
  - `vscode-workspace-watcher.ts` — `IWorkspaceWatcher` (TASK_2026_437 C9): one
    `createFileSystemWatcher(new RelativePattern(root, '**/*'))` per subscription
    feeding one `WorkspaceChangeCoalescer` (platform-core), which applies the
    subscriber's exclusions, nested repo detection and the storm breaker. VS Code
    already watches in its own watcher process, so there is no host and no native
    dependency in the VSIX. A `FileSystemWatcher` reports no errors once created;
    a create that throws gives `overflow` now and on a 60 s retry cadence, and one
    more `overflow` when a retry succeeds. Diagnostics go to the platform output
    channel; the instance is on `context.subscriptions`.
    **Exclusion is two layers:** VS Code's watcher applies the user's
    `files.watcherExclude` natively (this adapter never reads or writes that
    setting); the port's own rules run in the coalescer inside the extension host
    process, per event, before consumer work — so a path only the port excludes
    still costs VS Code's native watch, one event into the extension host, and the
    coalescer's path normalization (the Electron/CLI hosts ignore it natively).
    **Roots outside every `workspace.workspaceFolders` entry:** recursive watching
    there depends on VS Code's watcher and may be partial with no error to see; the
    adapter logs one warning per root and watches anyway (not a degraded state).
- `src/registration.ts` — DI registration

## Dependencies

**Internal**: `@ptah-extension/platform-core`
**External**: `@types/vscode`, `tsyringe`

## Guidelines

- Wrap `vscode` API surfaces only — do not add domain logic.
- `VscodeStateStorage` (Memento) and `VscodeDiskStateStorage` (file-backed) both implement `IStateStorage`; the app chooses which one to register under each token.
- `VscodeWorkspaceProvider` routes `getConfiguration` keys in `FILE_BASED_SETTINGS_KEYS` to `PtahFileSettingsManager` (TASK_2025_247).
- **Never import** other adapter libs.
- Never add `@parcel/watcher` (or any native watcher) here: the VSIX ships no native module for watching.
- `catch (error: unknown)`.

## Cross-Lib Rules

Selected by `apps/ptah-extension-vscode`. Mutually exclusive with `platform-electron`/`platform-cli`.
