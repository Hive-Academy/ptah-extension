# Implementation notes - TASK_2026_556_d12d

## Root cause (see `context.md` → Findings)

`wireRuntimePreWindow` awaited `bringUpSubsystems`, and through it
`CodeExecutionMCP.ensureRegisteredForSubagents()`. That runs a sequential rival-CLI probe
(`CliDetectionService.doDetectAll`) that takes 4-12 s normally and is bounded only by the probe timeouts
(over 30 s). The renderer was loaded only after it finished, so the window sat on
`preparing-workspace.html` until then, and the e2e `waitForURL` (30 s) timed out whenever the probes ran
slow. There was no throw and no blocked thread: `electronApp.evaluate(() => 1)` answered in every stalled
launch.

## Fix

Only the cheap half of MCP bring-up stays in front of the window.

- `libs/backend/vscode-core/src/services/subsystem-bringup.ts`: split into `startCodeExecutionMcp`
  (port bind, about 20 ms) and `registerCodeExecutionMcpForSubagents` (the slow CLI-probing half). Both
  never throw. `bringUpSubsystems` now runs the two in order, so the VS Code host (`post-init.ts`) is
  unchanged.
- `libs/backend/vscode-core/src/index.ts`: exports the two halves.
- `apps/ptah-electron/src/activation/wire-runtime.ts`: pre-window awaits only `startCodeExecutionMcp`,
  which is all the B1 invariant needs (port live before the heavy boot). The registration moved into
  `postWindow()`, still **before** `booter.openWindowGate()`, so it keeps its old position relative to
  the Thoth scans. The wait is wrapped in the new exported `settleOnAbort(work, coordinator.abortSignal)`,
  because the probes can't be cancelled. Without it, a quit during start-up held the post-window promise
  for the whole `will-quit` drain (2 s). The gate still opens after an abort, because the booter's own
  abort path settles the persistence gate.

## A failed boot is never silent

- `apps/ptah-electron/src/activation/boot-trace.ts` (new): `bootStep()` writes timestamped markers with
  `fs.writeSync(2)`, which is synchronous even on Windows pipes. `reportBootFailure()` writes the error,
  its stack and the last step. `armBootGuards(...)` arms a watchdog that reports the last step if `goal`
  is not reached, plus boot-scoped process handlers (see Round 1 revision). They are disarmed
  automatically by `bootStep(goal)`. `RENDERER_LOADED_STEP` names the goal.
- `apps/ptah-electron/src/main.ts`:
  - Boot-scoped `unhandledRejection` and `uncaughtException` handlers via `armBootGuards` (these were
    whole-process in the first version; see Round 1 revision).
  - The `whenReady` chain is held as `bootSequence` with a `.catch` that reports and disarms the watchdog.
    I used a const rather than chaining `.catch` so the body keeps its indentation (a minimal diff).
  - A 20 s watchdog for the renderer load, disarmed on the recovery-shell path.
  - Five step markers at the await boundaries.
- `apps/ptah-electron/src/activation/post-window.ts`: `loadFile(renderer)` is no longer unobserved (it
  used to be an unhandled rejection). `did-finish-load` emits `RENDERER_LOADED_STEP`.
- `apps/ptah-electron/src/activation/bootstrap.ts`: two markers around the awaited
  `restoreWorkspaces` / `whenReady` steps.

In total a boot prints about 10 `[Ptah Boot +Nms] …` lines to stderr. All temporary diagnostics (per-CLI
timings, the event-loop lag probe, quit-path markers) were removed.

## Tests

- `apps/ptah-electron/src/activation/boot-trace.spec.ts` (new, 7): sync stderr write, the watchdog naming
  the last step, goal and explicit disarm, failure with stack, a non-Error reason, stderr gone.
- `apps/ptah-electron/src/activation/wire-runtime.boot-order.spec.ts`: **regression pin.** The registration
  appears exactly once, only inside `postWindow`, and `bringUpSubsystems(` is gone from the file. The
  awaited `settleOnAbort` (with `coordinator.abortSignal`) precedes `booter.openWindowGate()`. The B1
  ordering and listener assertions are retargeted to `await startCodeExecutionMcp(`. The pin fails
  against the old source (`registerCodeExecutionMcpForSubagents({` does not exist there).
- `apps/ptah-electron/src/activation/wire-runtime.spec.ts`: 5 new `settleOnAbort` cases (settles, abort
  while pending, already aborted, a rejecting work, a late rejection after abort left unhandled-free).
- `libs/backend/vscode-core/src/services/subsystem-bringup.spec.ts` (new, 7): **behavioural pin.**
  `startCodeExecutionMcp` resolves while `ensureRegisteredForSubagents` would never settle, and never
  calls it. Also covers already running, start failure, no service, registration outcome and rejection
  logging, and `bringUpSubsystems` order.

## Verification

- `npx nx run-many -t test -p ptah-electron vscode-core -- --maxWorkers=2`: header "Running target test
  for 2 projects". ptah-electron passed. vscode-core: 669/670, and the single failure is
  `git-info.service.review.spec.ts` (5 s timeout on real `git` subprocesses plus an EPERM on Windows temp
  cleanup). It also fails when run alone, imports only `GitInfoService` (untouched), and is environmental.
  `main-loop-watchdog.spec.ts` failed once under load in an earlier run and passed on the rerun.
- `npx nx run-many -t lint -p ptah-electron ptah-electron-e2e vscode-core`: "Successfully ran target lint
  for 3 projects".
- `npx tsc -p apps/ptah-electron/tsconfig.app.json --noEmit`: exit 0.

## Repro numbers

| Scenario | Before | After |
| --- | --- | --- |
| Slow CLIs on PATH (throwaway loop) | **0/3** reach renderer; stuck on preparing shell at 39-49 s | **3/3**, renderer at 10.6-12.4 s |
| Slow CLIs on PATH, real `smoke.spec.ts` | (not run; loop above is the same launch path) | **4/4** |
| `bringUpSubsystems` / pre-window MCP step | 7-11 s | ~20 ms (`MCP server started` right after `RPC surface registered`) |
| `smoke.spec.ts --repeat-each=3` (12 launches) | 12/12, 20.2-35.8 s per test, 5.2 min | 12/12, 10.3-15.4 s per test, 2.5 min |
| Further after-batches, 12 launches each | — | 12/12 (earlier build); 11/12 with 1 pre-existing Playwright worker crash `0xC0000409` (same as TASK_2026_453/523, not a boot timeout) |
| Start-up diagnostics in after-runs (`WATCHDOG`, `UNHANDLED_REJECTION`, `Start-up failed`, `Renderer did not load`, `waitForURL`) | — | 0 |

The user's 3-of-4 failures were not reproduced as-is on this machine: its unloaded margin was 20-36 s
against a 30 s budget. The slow-CLI shim makes the same mechanism fail deterministically, and the fix
removes it from the window path entirely.

## Open concerns

1. **Orphaned CLI probes on quit (pre-existing, now more visible).** A quit during detection leaves the
   probe grandchild running. On Windows it inherits Electron's stdio pipe handles, so Playwright's
   `close()` waits for it (about 28 s with slow CLIs, about 1-2 s extra normally). Electron itself exits
   in 1.5-2.4 s, so users are unaffected. The fix belongs in `probeCliVersion` / the spawner (kill
   in-flight probes on dispose, or don't let them inherit the parent's std handles). That is out of
   scope here.
2. **Registration now overlaps the first seconds of the renderer.** Session starters already await
   `ensureRegisteredForSubagents` themselves (same queue, deduped detection), so a chat started in that
   window waits on the probe as it always did. It just no longer blocks the window.
3. ~~Process handlers log only~~: resolved in the Round 1 revision below (the handlers are boot-scoped
   and exit on an uncaught exception).
4. **Possible e2e isolation gap (read from code, not checked on disk).** With no workspace open, the
   home-scoped antigravity slot is still planned against the real home directory (`homeDir` is not
   overridden, and only `PTAH_DB_PATH` / `--user-data-dir` are isolated). So an e2e launch on a machine
   with `agy` installed can write the developer's `~/.gemini/config/mcp_config.json`.

## Round 1 revision (judge-round-1.json)

**D1 (major), fixed.** The process-level handlers were installed at module load and never removed, so
they replaced Electron's default crash outcome for the whole session. With our listener present,
Sentry's `OnUncaughtException` (`exitEvenIfOtherHandlersAreRegistered: false`) would not exit either.
They are now scoped to the boot window:

- `boot-trace.ts`: `armBootWatchdog`/`disarmBootWatchdog` are replaced by
  `armBootGuards({ goal, timeoutMs, exit, processEvents? })` / `disarmBootGuards()`. One arm installs
  the watchdog and both process handlers; one dispose removes all three. `bootStep(goal)` disarms them,
  and `disarmBootGuards()` covers boots that end another way.
  - `uncaughtException` during boot: `reportBootFailure('UNCAUGHT_EXCEPTION during boot', …)` in a `try`,
    then `exit(1)` in a `finally`. The default outcome (the process ends) is preserved, and the log line
    is the only addition. `exit` is a required option, with no default that could keep running.
  - `unhandledRejection` during boot: logged only.
  - Watchdog timer: `unref`'d, and cleared by the same dispose.
  - `writeStderr`: `fs.writeSync` reports EBADF (packaged Windows GUI build, no console) and EPIPE
    (harness gone) as synchronous throws, which the existing `try/catch` swallows. The comment now names
    both, and a spec pins that the exception handler still exits when stderr throws.
- `main.ts`: the module-level `process.on(...)` block is gone. `armBootGuards({ goal:
  RENDERER_LOADED_STEP, timeoutMs: 20_000, exit: (code) => app.exit(code) })` runs at the start of the
  `whenReady` callback. `disarmBootGuards()` runs on the recovery-shell path and in the `whenReady`
  `.catch`, which stays as the primary never-silent guarantee. After `renderer did-finish-load` the
  process has no extra listeners, and Electron's and Sentry's defaults apply again.

**D2 (minor)**: left as is, per the coordinator; it matches the file's source-assertion convention.

**Tests** (`boot-trace.spec.ts`, behavioural, 14 total, 7 new): uses a real `EventEmitter` as
`processEvents`.
- A boot-window uncaught exception logs the step and error and calls `exit(1)`, and still exits when
  stderr throws EBADF.
- A rejection logs without exiting.
- Both listeners are removed at `bootStep(RENDERER_LOADED_STEP)` (emit afterwards reaches nothing and
  does not exit) and at `disarmBootGuards()`.
- Against the real `process`, `listenerCount` returns to its pre-boot value after the renderer step.
- The watchdog timer count drops to 0 when the boot finishes.

**Verification**
- `npx nx run-many -t test -p ptah-electron`: "Successfully ran target test for project ptah-electron".
  Jest totals: 52 suites passed (1 skipped), 852 tests passed, 3 skipped.
- `npx nx run-many -t lint -p ptah-electron`: "Successfully ran target lint for project ptah-electron".
- `npx tsc -p apps/ptah-electron/tsconfig.app.json --noEmit`: exit 0.
- After `build-dev`, `smoke.spec.ts` once: **4/4 passed** (14.0 s, 12.4 s, 12.2 s, 15.2 s; 54.8 s total).
  All 4 boots logged `renderer did-finish-load`, with 0 `WATCHDOG` / `during boot` / `Start-up failed` /
  `Renderer did not load` lines.

## Round 2 resolution (orchestrator, after the 2-round judge cap)

Judge round 2 raised two defects; both fixed by the orchestrator, not re-judged.

- **D1 — boot guard pre-empted Sentry.** The `uncaughtException` guard is armed before Sentry
  initializes, so it runs first; calling `exit(1)` synchronously killed the process before Sentry's
  listener captured the crash. The guard now defers the exit with `setImmediate`, so every later
  listener runs first, and `main.ts`'s `exit` callback flushes Sentry (bounded, 2 s, same as
  `before-quit`) before `app.exit`. Pinned by `boot-trace.spec.ts` "lets a later listener (Sentry)
  run before it exits".
- **D2 — renderer load failure left the guards armed.** `post-window.ts`'s `loadFile().catch`
  now calls `disarmBootGuards()`. Pinned by a source-text check in
  `wire-runtime.boot-order.spec.ts` (post-window.ts has no behavioural spec harness).

Verification: `nx run-many -t test -p ptah-electron` 854 passed / 3 skipped; lint 0 errors;
`tsc --noEmit` exit 0; `smoke.spec.ts` 4/4 passed (1.8 min).
