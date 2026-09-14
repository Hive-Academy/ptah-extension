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
Implementations: `CliFileSystemProvider`, `CliStateStorage`, `CliTokenCounter`, `CliDiagnosticsProvider`, `CliCommandRegistry`, `CliOutputChannel`, `CliWorkspaceProvider`, `CliUserInteraction`, `CliSecretStorage`, `CliEditorProvider`, `CliHttpServerProvider`, `CliWorkspaceWatcher` (+ `CliWorkspaceWatcherOptions`, `resolveCliWorkspaceWatchHostPath`, `CLI_WORKSPACE_WATCH_HOST_BUNDLE`).

## Internal Structure

- `src/implementations/` — one file per `Cli*` adapter class
  - `cli-workspace-watcher.ts` — `IWorkspaceWatcher` (TASK_2026_437 C9): a facade
    over `WorkspaceWatchSupervisor` (platform-core) plus its `child_process.fork`
    shim (`CliWorkspaceWatchHostProcess` / `CliWorkspaceWatchHostForker`). The
    supervision rules are platform-core's; this file adds only the CLI choices:
    child stdin/stdout ignored (stdout is JSON-RPC, the TUI owns the terminal),
    child stderr piped into a bounded 4 KB tail that is never logged on its own —
    the supervisor appends its end to the one host-failure diagnostic (`readStderrTail`,
    exit reported on 'close' so the tail is complete), child, IPC channel, stderr
    pipe and supervision timers unref'd (a one-shot command still exits; long-lived
    sessions stay alive through their own stdin), `shutdownHostRuntime`
    (cli-engine) disposes the watcher on teardown,
    parent `execArgv` not inherited, and a missing bundle is a failed fork (no
    process spawned) that degrades the watcher instead of the boot
- `src/workspace-watch/workspace-watch-host.entry.ts` — the host entry, bundled to
  `workspace-watch-host.mjs` beside `main.mjs` and `tui.mjs` (one path serves
  both, D7). Fork IPC transport only, one `require('@parcel/watcher')`, then
  `bootWorkspaceWatchHost`; exits when the parent disconnects. The bundle target
  is `apps/ptah-cli`'s (ESM, `createRequire` banner, `@parcel/watcher` external).
  `workspace-watch-host.entry.spec.ts` proves the exit for real: a parent Node
  process forks the bundle, then exits or is killed, and the host pid must be
  gone within 10 s
- `src/workspace-watch/workspace-watch-host.bundle.harness.ts` — test-only: builds
  that bundle into a unique, self-removing dir under the repo's gitignored `tmp/`
  (under the repo so `@parcel/watcher` resolves from its `node_modules`)
- `src/interfaces/oauth-url-opener.interface.ts` — CLI-only (URL → browser)
- `src/registration.ts` — DI registration helper
- `src/types.ts` — `CliPlatformOptions` (`workspaceWatchHost` registers `WORKSPACE_WATCHER`; `cli-engine` supplies it)

## Dependencies

**Internal**: `@ptah-extension/platform-core` (ports + tokens)
**External**: `tsyringe`, Node built-ins (`fs`, `os`, `path`, `child_process`), `@parcel/watcher` (runtime `require` in the watch host entry only; an esbuild external)

## Guidelines

- Implement every `PLATFORM_TOKENS.*` port that the CLI app needs — do not stub via no-ops unless documented (`CliUserInteraction` may use stdin/stdout TTY prompts).
- **Never import** `platform-vscode` or `platform-electron`.
- **`createFileWatcher` must never hand its glob to chokidar** — same rule and
  same reason as the Electron adapter's; the translation lives once, in
  `planGlobWatch` (platform-core). See `platform-electron/CLAUDE.md`.
- **The watch host is a `child_process.fork` child, never a `worker_threads` Worker.** `@parcel/watcher` loads into one thread per process; a restarted Worker host fails with "Module did not self-register". Never load it in `main.mjs` / `tui.mjs`.
- **Never re-implement watch supervision here.** Restart budget, watchdog, degraded mode and recovery live once in `WorkspaceWatchSupervisor` (platform-core), shared with `ElectronWorkspaceWatcher`.
- State storage backs onto `~/.ptah/state/` JSON files (or similar) — keep schema compatible with other platforms.
- `IDiagnosticsProvider`/`IEditorProvider` may be near-no-ops (no editor), but must satisfy the interface.
- `catch (error: unknown)`.

## Cross-Lib Rules

Selected at app composition time by `apps/ptah-cli`. Adapter libs are mutually exclusive — never imported together.
