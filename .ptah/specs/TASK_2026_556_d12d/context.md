# Task Context - TASK_2026_556_d12d

## User Request

Split out of TASK_2026_550_9a28. The Electron e2e suite loses a large share of its runs to a start-up
hang, locally on Windows and intermittently on CI. Find the real cause and fix it.

## Evidence (TASK_2026_540_0940 test-report.md)

- 35 of 44 failures in one local run were launches that never reached `renderer/index.html`.
- The window stays on `assets/preparing-workspace.html`.
- The main-process log stops after `[IpcBridge] IPC listeners initialized`.
- The same spec passes on another launch.

## What the code says about the location (verified 2026-09-24)

The 550 context put the hang inside `wireRuntimePreWindow` / `registerPostWindow`
(`apps/ptah-electron/src/main.ts:235-253`). That is too wide in one direction and misses code in the other:

- `[IpcBridge] IPC listeners initialized` is logged at `apps/ptah-electron/src/ipc/ipc-bridge.ts:144`,
  from `ipcBridge.initialize()` at `apps/ptah-electron/src/activation/bootstrap.ts:335`, inside
  `bootstrapElectron`, BEFORE `wireRuntimePreWindow` runs.
- The next expected line, `[Ptah Electron] IPC bridge, WebviewManager, and RPC methods initialized`, is at
  `apps/ptah-electron/src/activation/wire-runtime.ts:328`, early in `wireRuntimePreWindow`. It never prints,
  so `registerPostWindow` is never reached.
- Between those two lines there is no `await`: the tail of `bootstrapElectron` after line 335,
  `main.ts:164-234`, and `wire-runtime.ts:292-326` (`armDiagnostics`, `registerRpcSurface`,
  `createElectronRpcHostProfile`).
- `preparing-workspace.html` is loaded by `main.ts:106-122` before boot starts, so the page on screen does
  not narrow the location.

So "find the awaited step that does not settle" is the wrong model. Candidates:

1. Synchronous code blocks the main thread (sync fs / sqlite / child_process / busy loop, or a lock wait).
2. A synchronous throw rejects the async `app.whenReady().then(...)` handler and nothing reports it.
3. The window is itself something else — e.g. an earlier `await` in `bootstrapElectron` resolves late and
   stdout is buffered, so the captured log is misleading.

A cheap discriminator during a hang: `electronApp.evaluate(() => 1)`. No answer means the main thread is
blocked (1). An answer means the event loop is alive (2 or 3).

## Acceptance

- Root cause named with evidence (log, stack or repro), not inferred.
- Fix in product code if a user can hit it at start-up, otherwise in the e2e launcher.
- A boot that fails in this window can never again be silent: an error or timeout is logged to stderr.
- A regression test (unit where possible) pins the cause.
- A loop of repeated launches (e.g. 20 x `smoke.spec.ts`) shows no start-up timeout.

## Root-cause analysis (static)

Traced statically, no build/run performed (read-only). Ranked by fit to the evidence.

### H1 — unguarded throw in `registerRpcSurface`, swallowed as a silent unhandled rejection (top hypothesis)

Everything between the two log lines is one unbroken synchronous stretch:
`bootstrap.ts:343-378` (register WEBVIEW_MANAGER, activate session notifier, fire-and-forget
`startAgentAdapterInitialization`) → return to `main.ts:133-234` (all sync: refs assignment,
`coordinator.onReadinessChange`, a guarded `resolve()`, an `app.on('before-quit', …)` registration)
→ `wireRuntimePreWindow` (`wire-runtime.ts:292-330`): `armDiagnostics` (305, sync), two guarded
`resolve()`s (309-321), then **`registerRpcSurface(container, createElectronRpcHostProfile(...))`
at `wire-runtime.ts:323-326` — no try/catch around this call** — then the console.log at 328.

Inside `registerRpcSurface` (`register-rpc-surface.ts:133-166`):
- `registerHandlers` (177-197): for every **lib-owned** handler, line 184-186 is
  `container.resolve(ctor).register()` with **no try/catch** (only host-owned handlers, 189-195,
  are guarded). A constructor or `register()` that throws here propagates straight out.
- `verifyAndReportRpcRegistration` (150-158) → `verify-and-report.ts:66-118`: when
  `PTAH_E2E === '1'` (the e2e launcher sets exactly this, `electron-launcher.ts:110`) it calls
  `assertRpcRegistration` (108-115). That function (`rpc-verification.ts:159-177`) **throws a plain
  `Error`** whenever `rpcHandler.getRegisteredMethods()` comes up short of `RPC_METHOD_NAMES` —
  i.e. whenever any handler failed to register, including one that failed via the unguarded path
  above.

Either throw unwinds through `registerRpcSurface` → `wireRuntimePreWindow` (async, so it becomes a
rejected promise) → the `await wireRuntimePreWindow(...)` at `main.ts:235`, which sits inside
`app.whenReady().then(async () => { … })` (`main.ts:101-296`). **Verified: there is no `.catch` any
where in that chain** (line 296 closes the `.then(...)` and the very next statement is
`app.on('second-instance', …)`), **and there is no process-level `unhandledRejection` or
`uncaughtException` handler anywhere in `apps/ptah-electron/src`** (grep returned zero matches,
`ripgrep` over the whole subtree; contrast `apps/ptah-extension-vscode/src/main.ts`, which does
install one). Node/Electron's default handling of the rejection therefore decides the outcome, and
nothing in this codebase overrides it for the Electron host.

This matches the evidence exactly: no `await` sits between the two log lines, so "the log stops
right there" needs no stalled promise — a bare throw explains it with zero timing assumptions.
Intermittency point: `assertRpcRegistration`'s throw is deterministic **given** a fixed missing-set,
but *which* handler fails to register is the open question — the two candidates above (an unguarded
lib-owned constructor doing something environment-sensitive, or a capability that resolves
differently launch-to-launch) are exactly where Windows-only intermittency could enter.

**How to confirm:** add a step-logged try/catch around the `registerRpcSurface` call at
`wire-runtime.ts:323-326` (see Plan §a) and rerun the repro loop; a hang should now print the
exact thrown error to stderr instead of vanishing.

### H2 — synchronous block inside DI construction (main thread stalls, doesn't throw)

`registerHandlers` / `wireBridges` (`register-rpc-surface.ts:177-197`, `233-267`) resolve many
handler classes; tsyringe resolves each constructor's whole dependency graph synchronously. Any
class in that graph doing `fs.*Sync`, a synchronous SQLite open/pragma, `execSync`/`spawnSync`, or
an `Atomics.wait`-style lock wait would freeze the event loop for as long as it takes — which also
starves the pending `console.log` write (see H3) of a chance to flush, compounding the "log stops"
symptom without any throw at all. `df2c0e127` ("gate persistence consumers on SQLite open+migrated")
shows this codebase has hit exactly this class of ordering bug before, though it moved the SQLite
consumers to the **post-window** phase (`boot-heavy-services.ts`), which is downstream of this
window — so persistence itself is likely already out of scope for this specific stretch. The
open question is whether any *pre-window* handler still resolves something SQLite/fs-backed
directly; not confirmed statically here (would need per-handler constructor audit under time
budget — flag as an unknown, see below).

**How to confirm:** the task's own discriminator — `electronApp.evaluate(() => 1)` during a hung
launch. No answer ⇒ main thread blocked (H2/H2-adjacent). An answer ⇒ event loop alive, favors H1
or H3.

### H3 — confound, not a cause: Windows pipe buffering makes the "last line" misleading

`electron-launcher.ts:145-150` relays `app.process().stdout`/`stderr` `data` chunks verbatim,
unprefixed by line. Node's own platform docs describe `stdout`/`stderr` as **asynchronous when
connected to a pipe on Windows** (unlike POSIX, where `stderr` is always synchronous) — inferred
platform behavior, not verified against this repo's Node/Electron build. If true here, a
`console.log` issued right before a long synchronous stretch (H2) can sit unflushed while the
main thread is busy, so the captured log's "last line" only proves "last flushed," not "last
executed." This does not create a hang by itself but can misattribute where one starts, and would
equally explain why the *same* code path sometimes shows the line and sometimes doesn't if the
stall length varies run to run.

**How to confirm:** swap the two log statements bracketing the gap (or add new ones) to
`fs.writeSync(2, …)` directly (synchronous on every platform, pipes included, per Node docs) and
compare against the existing `console.log`/`console.error` output in the same hung run.

## Plan

**(a) Minimal instrumentation** (add unconditionally, not just for the repro):
1. Wrap `bootstrap.ts:335` `ipcBridge.initialize()` through `wire-runtime.ts:328` in named,
   timestamped `fs.writeSync(2, ...)` step markers (bypasses H3's buffering) — at minimum before/after
   `registerRpcSurface` (`wire-runtime.ts:323-326`) and before/after `bringUpSubsystems`
   (`wire-runtime.ts:396-411`).
2. Wrap the `registerRpcSurface` call itself in try/catch that logs the caught error to stderr with
   `fs.writeSync` before rethrowing — turns H1 from silent to loud without changing behavior.
3. Add `.catch((err) => { fs.writeSync(2, ...); app.exit(1); })` to the `app.whenReady().then(async () => {...})`
   chain at `main.ts:296`, and `process.on('unhandledRejection', ...)` /
   `process.on('uncaughtException', ...)` near the top of `main.ts` (mirror
   `apps/ptah-extension-vscode/src/main.ts`'s existing handler) that logs and exits non-zero rather
   than hanging.
4. Boot watchdog: a `setTimeout` armed in `main.ts` right before the `wireRuntimePreWindow` await
   (e.g. 15s) that, if pre-window wiring hasn't resolved, writes the last-seen step marker from (1)
   to stderr — turns any future H2-style stall into a named, located timeout instead of a silent one.

**(b) Repro loop:** run the existing `smoke.spec.ts` (or equivalent minimal launch spec) 20-50x back
to back locally on Windows via a small script (`for /l` or a Node loop) that calls `launchPtah()` and
closes it each iteration, capturing stderr per run; count launches that pass `waitForPtahRenderer`
within timeout vs. that time out. With (a) in place, every timeout should now carry either a caught
error (H1), a "still on step X after 15s" watchdog line (H2), or nothing new (rules in H3 for a
closer look at buffering).

**(c) Likely fix per hypothesis:**
- H1: give the unguarded `container.resolve(ctor).register()` (register-rpc-surface.ts:184-186) the
  same try/catch treatment as the host-owned path, OR make the `assertRpcRegistration` throw
  recoverable at the `wireRuntimePreWindow` call site (log + fail the boot into the existing
  recovery-shell path, rather than an unhandled rejection) — plus the `.catch`/global-handler
  instrumentation from (a.3) as a backstop regardless of which specific throw caused it.
- H2: once the stalling constructor is identified via the watchdog, move its sync I/O off the
  critical pre-window path (pattern already established by `df2c0e127`) or make it truly async.
- H3: switch the two bracketing logs (and any other boot-critical log) to a synchronous write
  primitive so Windows pipe capture can't misattribute the stall point again.

**(d) Regression tests:**
- Unit: a `wire-runtime.spec.ts` case where `registerRpcSurface` (mocked) throws — assert
  `wireRuntimePreWindow`'s rejection is caught/reported rather than propagating unhandled, and that
  the boot lands in a named failure state.
- Unit: a `main.ts`-equivalent test (following the existing `main.quit-path.spec.ts` pattern of
  testing extracted, non-`import.meta` helpers) asserting the `whenReady` chain's rejection handler
  logs and exits rather than hanging.
- E2E: keep the 20x repeated-launch loop from (b) as a standing smoke/perf spec (or CI job) so a
  regression shows up as a flaky-rate regression, not a one-off report.
