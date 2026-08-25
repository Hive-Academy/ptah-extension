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
Implementations: `ElectronFileSystemProvider`, `ElectronStateStorage`, `ElectronSecretStorage` (+ `SafeStorageApi`), `ElectronWorkspaceProvider`, `ElectronUserInteraction` (+ `ElectronDialogApi`, `ElectronBrowserWindowApi`, `ElectronShellApi`), `ElectronOutputChannel`, `ElectronCommandRegistry`, `ElectronEditorProvider`, `ElectronDiagnosticsProvider`.

## Internal Structure

- `src/implementations/` — one file per `Electron*` adapter
- `src/registration.ts` — `registerPlatformElectronServices`

## Dependencies

**Internal**: `@ptah-extension/platform-core`
**External**: `electron` (peer; types only at compile time), `tsyringe`

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
- `ElectronSecretStorage` uses `safeStorage.encryptString` — fall back to plain storage only if `safeStorage.isEncryptionAvailable()` is false (document any fallback).
- `ElectronUserInteraction` routes prompts through dialog APIs; shell links open via `ElectronShellApi.openExternal`.
- `catch (error: unknown)`.

## Cross-Lib Rules

Selected at composition time by `apps/ptah-electron`. Mutually exclusive with other `platform-*` libs.
