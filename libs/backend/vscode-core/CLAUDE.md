# @ptah-extension/vscode-core

[Back to Main](../../../CLAUDE.md)

## Purpose

Core infrastructure layer for the VS Code host and shared backend services: logging, error handling, config, validation, RPC transport, license/feature gating, and a small set of VS Code API wrappers. Owns the canonical `TOKENS` DI registry for the extension.

## Boundaries

**Belongs here**:

- VS Code API wrappers (`CommandManager`, `WebviewManager`, `OutputManager`, `StatusBarManager`, `FileSystemManager`)
- Cross-cutting services: `Logger`, `ErrorHandler`, `ConfigManager`, `MessageValidatorService`
- RPC transport: `RpcHandler`, `RpcUserError`, RPC verification helpers
- Membership identity: `LicenseService`, `AuthSecretsService`
- Webview message handler and subagent registry
- The `TOKENS` DI namespace

**Does NOT belong**:

- Domain logic (memory, skills, workspace analysis)
- Platform abstraction ports (those live in `platform-core`)
- Concrete adapters (in `platform-{cli,electron,vscode}`)
- Direct `vscode.*` consumption by anyone other than API wrappers

## Public API

DI: `TOKENS`, `registerVsCodeCoreServices`, `registerVsCodeCorePlatformAgnostic` (+ `PlatformAgnosticRegistrationOptions`).
Core: `Logger`, `ErrorHandler`, `ConfigManager`, `MessageValidatorService`, `ValidationError`, `MessageValidationError`, `PtahError`.
API wrappers: `CommandManager`, `WebviewManager`, `OutputManager`, `StatusBarManager`, `FileSystemManager`.
Messaging: `RpcHandler`, `RpcUserError`, `verifyRpcRegistration`, `assertRpcRegistration`.
Diagnostics: `armDiagnostics` (+ `DiagnosticsHandle`), `EventLoopMonitor`, `CpuProfileCapture`, `readMsEnv`, `roundMs` — see "Diagnosing a hang".
Services: `SubagentRegistryService`, `WebviewMessageHandlerService`, `AuthSecretsService`, `LicenseService`.
Subsystem bring-up: `bringUpSubsystems` (+ `SubsystemBringUpDeps`) — unconditional MCP server start at activation (no license gate). The CLI skill/agent sync callbacks it used to drive were removed in TASK_2026_278 Batch 2; harness propagation is `HarnessReconciler.reconcile`, called from each host's activation path.

## Diagnosing a hang

`src/diagnostics/` exists because TASK_2026_323 ("Ptah hangs with 3 sessions
open") had **no** stall signal to work from. The only one that existed was the
renderer's 30 s RPC timeout, which fires long after the fact and names whichever
call happened to be in flight rather than the code that blocked. In Electron the
backend shares its event loop with `BrowserWindow` management, so any
synchronous burst in the backend freezes the entire app — and every cause looks
identical from outside.

**Everything below is on by default and costs one timer wakeup every 2 s.** The
env vars only change thresholds; the CPU profiler stays dormant unless asked.

### Environment variables

| Variable                 | Default | Effect                                                                       |
| ------------------------ | ------- | ---------------------------------------------------------------------------- |
| `PTAH_LOOP_LAG_WARN_MS`  | `250`   | Warn `[event-loop] lag` when a 2 s window's worst delay hits this.           |
| `PTAH_RPC_SLOW_WARN_MS`  | `2000`  | Warn `[RPC] slow handler` with the method name and duration.                 |
| `PTAH_MCP_SLOW_WARN_MS`  | `2000`  | Warn `[MCP] slow tool` with the tool name and duration.                      |
| `PTAH_PROFILE_ON_LAG_MS` | unset   | When set, lag above it auto-captures a 10 s CPU profile (max one per 5 min). |
| `PTAH_PROFILE_DIR`       | unset   | Override where `.cpuprofile` files are written.                              |

A malformed or non-positive value is ignored and the default applies — a typo in
an env var must never stop the app booting. Note `0` counts as unset: it reads
like "disable" but would in fact warn on every call.

### Reading the log

One `[event-loop] lag` line is a spike (a GC pause, a big paint). A **run** of
consecutive lines is a stall, and its `maxMs` is how long the app was frozen.
Cross-reference against `[RPC] slow handler` / `[MCP] slow tool` in the same
window — those name the culprit directly when the block came in through a
request. When the lag has no matching slow-handler line, the cause is
background work (memory curator, skill synthesis, harness hashing) and the CPU
profile is the way to find it.

### Capturing a CPU profile

- **Electron**: `window.ptahDiag.captureCpuProfile(10000)` from the DevTools
  console. This is a **direct** `ipcMain.handle('diag:cpu-profile')` channel and
  not an RPC method, deliberately — RPC is what gets wedged.
- **VS Code**: the `Ptah: Capture CPU Profile` command. Shows the path when done.
- **CLI**: set `PTAH_PROFILE_ON_LAG_MS` and run with `--verbose`; lag is also
  republished as the `debug.perf.lag` JSON-RPC notification.

Profiles land in the host's log directory: `app.getPath('logs')` on Electron,
`context.logUri.fsPath` on VS Code, `~/.ptah/logs` on the CLI, falling back to
the OS temp directory. Filenames are `ptah-<ISO timestamp>.cpuprofile`.

### Opening a `.cpuprofile`

- **VS Code**: just open the file — it renders a flame chart natively.
- **Chrome DevTools**: F12 → Performance → the upload arrow → pick the file. Sort
  by Total Time; the blocking frame is the widest bar.

The capture is single-flight: a second request while one is running returns the
same promise rather than starting a second `Profiler.start`, which would be a
protocol error. Since a stall produces a burst of triggers, this matters.

### Arming

Each host calls `armDiagnostics({ container, logsPath })` once, at the point it
wants coverage to begin — Electron before the heavy wiring (that wiring is
itself a suspect), VS Code as soon as the logger exists, the CLI only under
`--verbose`. Registration alone never starts sampling. Every timer involved is
`unref()`-ed: a hang detector that keeps the process alive would be a poor
outcome (see commit `5dc525f02` for that defect class).

## Internal Structure

- `src/diagnostics/` — `EventLoopMonitor`, `CpuProfileCapture`, `armDiagnostics`
- `src/api-wrappers/` — VS Code API wrappers
- `src/logging/` — `Logger`
- `src/error-handling/` — `ErrorHandler`
- `src/config/` — `ConfigManager`, file-settings store interface
- `src/validation/` — `MessageValidatorService` + error types
- `src/messaging/` — `rpc-handler.ts` (transport), `rpc-verification.ts`
- `src/services/` — license, auth secrets, subagent registry, webview message handler
- `src/services/subsystem-bringup.ts` — `bringUpSubsystems` (unconditional MCP start)
- `src/di/tokens.ts` — `TOKENS` namespace; `di/index.ts` — registration; `di/register-platform-agnostic.ts` — non-VS-Code hosts

## Key Files

- `src/messaging/rpc-handler.ts:44` — **`ALLOWED_METHOD_PREFIXES`** (runtime RPC namespace allowlist — must be kept in sync with `RpcMethodName` in `libs/shared`)
- `src/di/tokens.ts` — canonical `TOKENS`
- `src/services/license.service.ts` — tier values + license verification/cache coordinator
- `src/di/register-platform-agnostic.ts` — used by Electron/CLI hosts

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`
**External**: `@types/vscode`, `tsyringe`, `eventemitter3`, `axios`, `cross-spawn`, `zod`, `@sentry/node`

## Guidelines

- **Adding a new RPC namespace** requires updating BOTH `ALLOWED_METHOD_PREFIXES` here AND the `RpcMethodName` union in `libs/shared/.../rpc.types.ts`. Missing the runtime allowlist update produces a silent crash.
- Only export `TOKENS` namespace — never expose individual token symbols (the C8/refactor history avoided importing tokens directly).
- DI registration happens in app layer (`apps/ptah-extension-vscode/.../container.ts`); this lib only registers its own services via the provided helpers.
- Always use constructor injection (`@inject(TOKENS.X)`).
- `catch (error: unknown)`.
- API wrapper managers handle disposable cleanup — never bypass with raw `vscode.commands.registerCommand`.

## Cross-Lib Rules

Imported by virtually every backend lib. Should import only `platform-core` and `shared` from the monorepo.
