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
Degradation: `DegradationReporter`, `MAX_TRACKED_DEGRADATION_CODES`, and the types `DegradationReport`, `DegradationCount`, `DegradationSnapshot` — see "Counting a degradation".
Services: `SubagentRegistryService`, `WebviewMessageHandlerService`, `AuthSecretsService`, `LicenseService`.
Git: `GitInfoService`, `execGit`, `DEFAULT_GIT_TIMEOUT_MS`, `WORKTREE_GIT_TIMEOUT_MS`, `DEFAULT_GIT_MAX_OUTPUT_BYTES`, `GIT_STATUS_MAX_OUTPUT_BYTES`, `DEFAULT_GIT_MAX_CONCURRENT`, `MIN_GIT_MAX_CONCURRENT`, `GitOutputLimitError` (`code: 'GIT_OUTPUT_LIMIT'`), `configureGitProcessGate` (+ `GitProcessGateConfig`), and the types `ExecGitOptions`, `ExecGitResult`, `GitGateLane`. Every git child waits in one process-wide gate (TASK_2026_437 C11): at most `PTAH_GIT_MAX_CONCURRENT` live, background-priority and >60 s calls capped at max-1 so interactive reads always have a slot, and a slot is held until the child exits. The gate is a module instance, not DI — `execGit` is a free function called without a container; `registerVsCodeCorePlatformAgnostic` hands it the host logger in all three hosts (first configuration wins).
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

| Variable                    | Default | Effect                                                                       |
| --------------------------- | ------- | ---------------------------------------------------------------------------- |
| `PTAH_LOOP_LAG_WARN_MS`     | `250`   | Warn `[event-loop] lag` when a 2 s window's worst delay hits this.           |
| `PTAH_RPC_SLOW_WARN_MS`     | `2000`  | Warn `[RPC] slow handler` with the method name and duration.                 |
| `PTAH_MCP_SLOW_WARN_MS`     | `2000`  | Warn `[MCP] slow tool` with the tool name and duration.                      |
| `PTAH_SQLITE_SLOW_WARN_MS`  | `50`    | Warn `[SQLite] slow statement` with SQL, op, rows and duration.              |
| `PTAH_HISTORY_SLOW_WARN_MS` | `250`   | Warn `[SessionHistoryReader] slow history read` with the phase split.        |
| `PTAH_PROFILE_ON_LAG_MS`    | unset   | When set, lag above it auto-captures a 10 s CPU profile (max one per 5 min). |
| `PTAH_PROFILE_DIR`          | unset   | Override where `.cpuprofile` files are written.                              |
| `PTAH_GIT_MAX_CONCURRENT`   | `4`     | Live git children process-wide (`exec-git` gate); minimum 2 (lower is raised, logged once); background lane gets max-1. |

A malformed or non-positive value is ignored and the default applies — a typo in
an env var must never stop the app booting. Note `0` counts as unset: it reads
like "disable" but would in fact warn on every call.

The two main-thread cost lines exist to measure before moving synchronous work
off the host thread (TASK_2026_437 C13). `[SQLite] slow statement` comes from
`persistence-sqlite`'s `slow-statement-timing.ts`, which wraps the one shared
connection: `run/get/all/iterate`, `exec`, `pragma` and transaction functions
(BEGIN to COMMIT). It logs the first 120 chars of SQL, at most one line per SQL
text per minute, with repeats counted in `suppressedSinceLastLog`.
`[SessionHistoryReader] slow history read` splits a resume into `readMs` (I/O +
JSONL parse), `projectMs` (synchronous replay, stats and projection) and
`pricingMs`, with message, agent-session and event counts — at most one line
per session per minute.

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

### The hang log (`ptah-hang.log`)

`[event-loop] lag` is written by a timer on the very loop it measures, so a
block that ends in a force-quit or a crash never reaches the log. The hang log
exists for that case (TASK_2026_437, INV-8). It lives beside the other logs in
`logsPath` and holds one JSON object per line.

- **`MainLoopWatchdog`** (`src/diagnostics/main-loop-watchdog.ts`, token
  `TOKENS.MAIN_LOOP_WATCHDOG`). `armDiagnostics` starts it only when the host
  passes `logsPath`, which all three hosts do. The CLI arms diagnostics only
  under `--verbose`, so the CLI has the watchdog only under `--verbose` too.
  Main posts a heartbeat every 1 s. An eval'd `worker_threads` worker
  (`main-loop-watchdog-source.ts`) appends `{"event":"hang"}` after 5 s with no
  heartbeat. It writes that line WHILE main is still blocked. When heartbeats
  come back, it appends `{"event":"recovered","blockedForMs":…}`. Each line
  carries `breadcrumbs`. `setBreadcrumb(key, value)` sets them, with at most 16
  keys and 200 characters per value. `armDiagnostics` records `lastLag` from
  every lag warning. The RPC method in flight is not recorded yet: `RpcHandler`
  has no breadcrumb hook (plan defect D6). A watchdog that fails to start logs
  `[diagnostics] main-loop watchdog not armed` and leaves the lag monitor
  running. The worker swallows a failed append. It ignores a gap when its own
  timer was late too, because that means the machine slept. A worker that dies
  on its own logs `[watchdog] worker died — restarting` and is respawned, at
  most 3 times per 10 min. After that it logs one `[watchdog] degraded` error
  and stays down.
- **Size bound**: both writers use `appendHangLogLine`. Before an append, a file
  at or past 1 MiB (`HANG_LOG_MAX_BYTES`) is renamed to `ptah-hang.log.1`,
  which replaces the older one. The worker runs a string copy of it
  (`HANG_LOG_APPEND_SOURCE`). `main-loop-watchdog.spec.ts` checks that the copy
  and the TS function write the same files. Change both together.
- **Electron lifecycle lines**
  (`apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts`)
  go to the same file with
  `"source":"process-lifecycle"`. They cover `child-process-gone`,
  `render-process-gone` and `window-unresponsive` / `window-responsive` (with
  `unresponsiveForMs`). Each one also goes to the logger. Renderer
  `console.warn` / `console.error` go to the logger only, as
  `[renderer] console.*`. At most 20 lines are kept per 10 s, then one
  `suppressed` line, with 2 KB per message.
- **Crash dumps**: Electron starts `crashReporter` with `uploadToServer: false`.
  Minidumps stay under `app.getPath('crashDumps')`, and each start keeps only the
  newest 5.

Reading it: a `hang` with no matching `recovered` means the process died while
it was frozen. A `hang` whose `blockedForMs` matches a `window-unresponsive` →
`window-responsive` pair means main blocked the window. A `window-unresponsive`
with no watchdog `hang` points at the renderer, or at a main-loop block shorter
than 5 s — check `[event-loop] lag` for the same minute.

## Counting a degradation

`src/logging/degradation-reporter.ts` (TASK_2026_383) is the one way a site that
fell back to a default says so, and the one place the per-boot counts live. Bound
to `TOKENS.DEGRADATION_REPORTER` in `src/di/register-platform-agnostic.ts`, not in
`register.ts` — the VS Code entry delegates to the platform-agnostic file, so one
binding reaches all three hosts; binding in `register.ts` would hide the reporter
from Electron and the CLI.

It is **not** a logger and **not** a policy engine. A call site that already writes
`logger.warn` keeps writing it; the reporter never logs on the reporting path and
never decides severity, because only the call site knows what was lost. It never
throws: no webview manager, a rejected broadcast, a container that resolves to
nothing — all swallowed, and the count is taken regardless. `TOKENS.WEBVIEW_MANAGER`
is resolved lazily per report behind `isRegistered`. The code map is bounded at
`MAX_TRACKED_DEGRADATION_CODES` (64); past the cap, sites are dropped with one
latched `logger.error`.

**`code` MUST be a string literal written at the call site.** A code interpolated
from an error message mints a fresh bucket per failure and makes the count
meaningless — the exact failure this contract exists to prevent. Varying detail
goes in `detail`, prose in `summary`. The wire shape is `DegradationEventPayload`
in `@ptah-extension/shared` (`rpc-degradation.types.ts`); the only consumer today
is Electron's one-per-boot summary line.

### When a `catch` may degrade

A `catch` may fall back to a default only if **both** hold:

1. the **positive** path is tested against the real dependency (not only the
   fallback), and
2. the **negative** path emits a `DegradationEvent` through the reporter.

A catch that satisfies neither is a defect, not an optional capability.

### The `// degradation-audit:` marker

`tools/degradation-audit/check-degradation.ts` walks every backend and app source
file with an AST pass and ratchets a per-directory baseline in CI. A flagged site
is suppressed with a comment carrying a **kind and a reason**:

```ts
// degradation-audit: optional-capability — keytar is absent on a Linux box with
// no libsecret; the fallback is the file-backed key store.
// degradation-audit: reported — database.backup.no-worker-factory
```

The separator may be `-`, `–` or `—`. A marker with no reason, an unrecognised
kind or a malformed separator is itself a violation (`bare-suppression`), and a
marker that attaches to nothing is an `orphaned-suppression` — a misplaced comment
is not silently honoured. A wrapped marker must carry at least one word of reason
on its **own** line. Run it with `npx nx run degradation-audit:lint`.

## Internal Structure

- `src/diagnostics/` — `EventLoopMonitor`, `CpuProfileCapture`, `MainLoopWatchdog`, `armDiagnostics`
- `src/api-wrappers/` — VS Code API wrappers
- `src/logging/` — `Logger`, `DegradationReporter`
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
