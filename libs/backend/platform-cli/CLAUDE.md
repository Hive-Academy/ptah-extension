# @ptah-extension/platform-cli

[Back to Main](../../../CLAUDE.md)

## Purpose

CLI/TUI adapter for the platform-core ports. Provides plain-Node implementations of `IFileSystemProvider`, `IStateStorage`, etc., so the same `rpc-handlers` and domain libs run headlessly.

## Boundaries

**Belongs here**:

- One `Cli*` class per `platform-core` port
- `registerPlatformCliServices` registration
- `IOAuthUrlOpener` CLI-specific interface (open URL in user's browser)
- `CliPlatformOptions` constructor config

**Does NOT belong**:

- VS Code or Electron imports
- Business logic (must come from upstream libs)
- Port interfaces (they live in `platform-core`)

## Public API

`registerPlatformCliServices`, `CliPlatformOptions`, `IOAuthUrlOpener`.
Implementations: `CliFileSystemProvider`, `CliStateStorage`, `CliTokenCounter`, `CliDiagnosticsProvider`, `CliCommandRegistry`, `CliOutputChannel`, `CliWorkspaceProvider`, `CliUserInteraction`, `CliSecretStorage`, `CliEditorProvider`, `CliHttpServerProvider`.

## Internal Structure

- `src/implementations/` — one file per `Cli*` adapter class
- `src/interfaces/oauth-url-opener.interface.ts` — CLI-only (URL → browser)
- `src/registration.ts` — DI registration helper
- `src/types.ts` — `CliPlatformOptions`

## Dependencies

**Internal**: `@ptah-extension/platform-core` (ports + tokens)
**External**: `tsyringe`, Node built-ins (`fs`, `os`, `path`, `child_process`)

## Guidelines

- Implement every `PLATFORM_TOKENS.*` port that the CLI app needs — do not stub via no-ops unless documented (`CliUserInteraction` may use stdin/stdout TTY prompts).
- **Never import** `platform-vscode` or `platform-electron`.
- State storage backs onto `~/.ptah/state/` JSON files (or similar) — keep schema compatible with other platforms.
- `IDiagnosticsProvider`/`IEditorProvider` may be near-no-ops (no editor), but must satisfy the interface.
- `catch (error: unknown)`.

## Cross-Lib Rules

Selected at app composition time by `apps/ptah-cli`. Adapter libs are mutually exclusive — never imported together.
