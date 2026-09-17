# Code Logic Review — `TASK_2026_437_0778` (Batch 5)

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 8/10                                  |
| Assessment           | APPROVE_WITH_FIXES                    |
| Blocking issues      | 0                                     |
| Serious issues       | 0                                     |
| Moderate issues      | 4                                     |
| Failure modes found  | 3                                     |

Scope: `libs/backend/vscode-core/src/diagnostics/{main-loop-watchdog.ts,main-loop-watchdog-source.ts,main-loop-watchdog.spec.ts,index.ts,arm-diagnostics.ts}`, `di/{tokens.ts,register-platform-agnostic.ts}`, `libs/backend/vscode-core/CLAUDE.md`, `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts(+.spec.ts)`, `apps/ptah-electron/src/main.ts`, `apps/ptah-electron/esbuild.config.cjs`, three hosts' `container.smoke.spec.ts`. Verified with `git -C D:\projects\ptah-437 diff main -- <file>` for every modified file and a full read of every created file. Ran `npx nx test @ptah-extension/vscode-core` (554/554 green, includes `main-loop-watchdog.spec.ts`) and `npx nx test ptah-electron -- --testPathPattern=process-lifecycle-recorder` (569/573 green, 4 pre-existing skips, includes `process-lifecycle-recorder.spec.ts`), and `npx nx run degradation-audit:lint` (0 new unsuppressed sites; `apps/ptah-electron: 4 ok (baseline 4)`, unchanged).

## Five logic questions

### 1. How does this fail silently?

- `main-loop-watchdog.ts:143-158` — if the worker errors or exits, `MainLoopWatchdog` logs a warning and clears `this.worker`, but nothing re-arms it and nothing tells a caller the hang detector is now dead for the rest of the process's life. From that point every subsequent freeze — including a repeat of the 09-14 incident — produces **zero** lines in `ptah-hang.log`, silently, for the remaining process lifetime. This is a real gap, but note it is bounded: `worker.on('error'/'exit')` only fires for a worker crash, not for the case this task exists to catch (a *main-thread* block), so it does not defeat INV-8's primary scenario. Not tested (`main-loop-watchdog.spec.ts` has no case for `worker.on('error')`/`'exit'`).
- `apps/ptah-electron/src/main.ts:91-99` — `new ProcessLifecycleRecorder(...).install(app)` is fire-and-forget: the instance is never stored, so `recorder.dispose()` is never called anywhere (confirmed — `dispose` has zero call sites outside the spec). `dispose()` only flushes a pending "suppressed N" console line; because the flush timer is `unref()`-ed the process can still exit cleanly, but a suppression count accumulated in the final rate-limit window before quit is silently dropped rather than flushed. Low impact (it's a count of suppressed *info-level* forwarding, not a lifecycle event), but it is data that quietly disappears.
- `process-lifecycle-recorder.ts:280-297` and `main-loop-watchdog-source.ts:60-74` — both writers swallow a failed `appendFileSync`/`appendFileSync`-to-hang-log (by design, documented and defensible: a read-only log directory must not turn a recorded crash into a thrown one). The cost: if the log directory becomes unwritable (disk full, permissions), every future *-gone/unresponsive/hang record silently stops landing in `ptah-hang.log` with only a `console.warn` (which itself may not be captured anywhere once the app is packaged) as the only trace. There is no periodic re-check or one-time escalated log line once the failure clears.

### 2. What user action produces unexpected behaviour?

- Running the CLI without `--verbose` never arms `MainLoopWatchdog` at all (`cli-engine/src/lib/container.ts:393-396`, `if (verbose) { armDiagnostics(...) }`). This is pre-existing `armDiagnostics` gating this batch inherited rather than introduced, and it is explicitly documented in the new CLAUDE.md section (`libs/backend/vscode-core/CLAUDE.md`: "The CLI arms diagnostics only under `--verbose`, so the CLI has the watchdog only under `--verbose` too"), so it is not a silent gap — but a user hitting a CLI hang in normal (non-verbose) operation gets no hang record, which partially undercuts INV-8's "every hang leaves a durable record" guarantee for one of the three hosts.
- A user who leaves the app open for weeks accumulates an unbounded `ptah-hang.log` — there is no rotation, size cap, or truncation anywhere in either writer (`main-loop-watchdog-source.ts`, `process-lifecycle-recorder.ts`). Contrast with the console-forwarding path, which is carefully rate-limited and 2 KB-truncated per line. A workspace with recurring watcher storms (the exact scenario this task's P1 phase targets) could write one `hang`/`recovered` pair per storm cycle indefinitely.

### 3. What input data produces a wrong answer?

- `main-loop-watchdog-source.ts:96-99` (suspend guard): if the OS scheduler simply deprioritizes the worker thread under heavy CPU contention (not a true sleep/suspend) for >= `hangThresholdMs` (5 s default), the guard treats it exactly like a suspend and **resets** `lastBeatAt` without ever reporting a hang — even though the main thread may have been genuinely and simultaneously blocked. Under extreme load (e.g. a 75k-file mass-delete or the git-worktree-remove storm this task was born from, both of which are CPU/IO heavy on the whole process), the very conditions likely to also starve the worker's own timer can cause a real hang to be masked as "machine slept." This is the one place the design trades a false negative for avoiding a false positive, and it is untested — no spec exercises "both threads starved simultaneously."
- `arm-diagnostics.ts:94-98` breadcrumb text — `lastLag` is written as `max=${sample.maxMs}ms p99=${sample.p99Ms}ms at ${...}`, i.e. a *formatted string* built fresh on every lag sample and stored under a single breadcrumb key. Fine for its purpose, but if `EventLoopMonitor`'s lag-sampling cadence is slower than `hangThresholdMs` (5 s), a hang line can carry a `lastLag` timestamp that is stale by more than the block itself, understating how bad the last-known state was. Minor; readable as designed via the CLAUDE.md "reading it" guidance, but worth knowing during a real incident triage.

### 4. What happens when a dependency fails?

- Worker spawn failure (`new Worker(MAIN_LOOP_WATCHDOG_WORKER_SOURCE, { eval: true })` under a packaged, asar'd Electron main process) is not itself try/caught inside `MainLoopWatchdog.start()` — a synchronous throw from the `Worker` constructor would propagate up through `armWatchdog`'s own `try/catch` (`arm-diagnostics.ts:137-153`), which *is* correctly guarded, so the failure degrades to "lag monitor still runs, watchdog does not" with a logged warning. Good: the failure boundary the module doc promises is real and correctly scoped one level up, not inside `start()` itself.
- `TOKENS.MAIN_LOOP_WATCHDOG` container resolution failure (e.g. `LOGGER` not registered) is caught by the same `armWatchdog` try/catch and degrades identically. Confirmed by the three `container.smoke.spec.ts` additions, which prove the token resolves cleanly across all three hosts' real registration paths — this is the one place D2's "pin via smoke spec, not expected-resolvable.ts" decision gets exercised, and it holds.
- `crashReporter.start()` failure (`process-lifecycle-recorder.ts:308-323`) is caught and returns `false`; `main.ts:88-90` correctly gates the (fire-and-forget) `pruneCrashDumps` call behind that boolean, so a Crashpad-start failure does not leave a dangling prune of a directory that was never created for this run. Good.
- `pruneCrashDumps` (`process-lifecycle-recorder.ts:334-356`) is invoked with `void` in `main.ts:89`, i.e. genuinely fire-and-forget with no completion signal. Its own error handling is thorough (missing directory treated as normal, per-file failures logged and skipped, nothing rejects), so the "fire and forget" here is safe — there is no success signal being told to a user that masks a real failure, since nothing downstream depends on the prune completing.

### 5. What is missing that the requirements never mentioned?

- No rotation or size bound on `ptah-hang.log` itself (only the *console-forwarding* path got a bound). The plan's Q5/D9 note only "keep newest 5 dumps" for Crashpad minidumps; the analogous unboundedness of the hang-log text file was never asked about.
- No integration-level test for `armDiagnostics`' new watchdog wiring (`armWatchdog`'s try/catch branch, the `lastLag` breadcrumb subscription, dispose-ordering with the lag monitor) — there is no `arm-diagnostics.spec.ts` in the repo before or after this batch. `MainLoopWatchdog` itself is well tested in isolation; the orchestration code added around it in this batch (17 new lines in `arm-diagnostics.ts`) is exercised only indirectly through the three DI smoke specs, which assert resolution/singleton identity but never call `armDiagnostics` end-to-end with a fake container to prove the breadcrumb wiring or the fallback-on-resolve-failure path.
- No shutdown-time flush for `ProcessLifecycleRecorder` (see Q1) — not required by the plan's `MainLoopWatchdog`-focused failure-behaviour note, but the recorder shares the same "everything must survive an abrupt exit" motivation and its own suppression counter can be lost at quit.

## Failure modes

### Watchdog worker dies and is never revived

- Trigger: the eval'd worker throws asynchronously (e.g. an unexpected exception inside the `setInterval` callback, OOM, or the host forbidding `worker_threads`) after a successful `start()`.
- Symptom: `[watchdog] worker failed — hang records stopped` is logged once; every subsequent real hang for the rest of the process's life produces nothing in `ptah-hang.log`.
- Evidence: `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.ts:143-158` (`worker.on('error'/'exit')` clears `this.worker` with no retry).
- Current handling: one warning log, no restart, no external signal.
- Recommendation: either a bounded auto-restart (mirroring the Electron watch-host adapter's restart-budget pattern used elsewhere in this same task, e.g. Batch 8's `ElectronWorkspaceWatcher`), or at minimum surface `running` transitioning to `false` through a DegradationReporter event so a boot-summary or telemetry surface can show "hang detection is currently off," instead of only a log line nobody watches live.

### Simultaneous main + worker starvation masks a real hang

- Trigger: extreme CPU/IO contention (mass file delete, watcher storm) starves both the main event loop and the watchdog worker's own 250 ms check timer for >= 5 s.
- Symptom: no `hang` line is written even though the main loop was genuinely blocked; the suspend guard (correctly, for the sleep/wake case) treats the gap as "machine slept" and silently resets.
- Evidence: `main-loop-watchdog-source.ts:94-99`.
- Current handling: none — this is a known, accepted trade-off per the module's own doc comment, but it is untested and its false-negative window overlaps exactly with the load patterns (P1's watcher storms, the 75k-file stress scenario) this task is designed around.
- Recommendation: at minimum, add a spec that starves both threads together (e.g. block the worker's own timer briefly via a synchronous sleep inside a controlled test harness) to pin the accepted trade-off as a documented, verified behaviour rather than an unverified comment.

### Unbounded `ptah-hang.log` growth

- Trigger: long-running app instance with repeated hangs, storms, or `*-gone`/`unresponsive` events over weeks.
- Symptom: the hang log grows without limit; no consumer trims or rotates it.
- Evidence: `main-loop-watchdog-source.ts:60-74` (`appendFileSync`, no cap), `process-lifecycle-recorder.ts:280-298` (`appendHangLog`, no cap) — contrast with the deliberate 2 KB truncation and 20-lines/10 s rate limit the same batch applies to console forwarding, and with the explicit newest-5 retention policy applied to crash dumps.
- Current handling: none.
- Recommendation: apply the same "keep it bounded" discipline already used elsewhere in this batch — e.g. a size-based rotation (rename-and-truncate past N MB) checked opportunistically on write, or prune-on-startup analogous to `pruneCrashDumps`.

## Blocking issues

None.

## Serious issues

None. (The duplicated `HANG_LOG_FILE_NAME` literal and the undocumented `post-window.ts` file-list deviation are real and already correctly raised as Serious #1/#2 in `b5-code-style-review.md`; both are structural/consistency findings, not behavioural-correctness findings, so they are not re-litigated here. Their logic-facing consequence — two independent literals that could silently fork the hang log into two files on a future rename — is the basis for the "Unbounded `ptah-hang.log` growth"-adjacent Moderate item below, but the fix itself is a style fix.)

## Moderate and minor issues

- Worker death/exit leaves the watchdog permanently disarmed with no restart or degradation signal — `main-loop-watchdog.ts:143-158` (see Failure modes).
- No `armDiagnostics`-level integration test for the watchdog wiring (breadcrumb subscription, dispose ordering, resolve-failure fallback) — no `arm-diagnostics.spec.ts` exists.
- `ptah-hang.log` has no rotation or size bound, inconsistent with the bounding discipline applied to console forwarding and crash-dump retention in the same batch.
- `main-loop-watchdog.spec.ts:85-117` (`AC-5` case) runs a real worker, a real 6 s `Atomics.wait` block on the Jest test thread, and asserts a tight upper bound (`recovered.blockedForMs < 10_000`) with a 20 s Jest timeout. This is the right test to prove the claim (correctly justified in the file's own comment), but it is the kind of real-timing test the repository elsewhere gates behind `PTAH_PERF_SPECS=1` for CI-load reasons (`git-watcher.stress.spec.ts` precedent named in `batches.md`); under a loaded CI runner the worker thread's own scheduling could push `blockedForMs` past 10 s and flake the suite. Not a logic defect in the code under test, but a CI-reliability risk worth flagging per the review brief's explicit hunt-list item.
- `ProcessLifecycleRecorder` constructed in `main.ts:91-99` is never assigned to a variable, so `dispose()` has no call site; the only consequence is a possibly-dropped final "suppressed N" console-forwarding count at quit (see Q1) — low impact, but easy to close by storing it on `coordinator.refs` alongside the other boot handles the same file already tracks that way.

## Data flow

1. Boot (Electron): `app.setName`/`app.setPath('userData', …)` → `startLocalCrashReporter(crashReporter)` → (if started) `void pruneCrashDumps(...)` → `new ProcessLifecycleRecorder(...).install(app)`, all before `app.whenReady()`. OK — ordering is correct and verified against Electron's own requirement that `crashReporter.start` precede readiness, and against the userData path being set first so dumps land under the right per-channel folder (`main.ts:41-99`).
2. `ProcessLifecycleRecorder.install(app)` subscribes `child-process-gone`, `render-process-gone` (once, from `app`, not per-`webContents` — avoids double-counting a renderer death) and `browser-window-created` → `attachWindow` for every window including re-activated/macOS windows. OK.
3. Each lifecycle event → `record()` → synchronous `appendHangLog` (best-effort) + `log()` (logger-or-console). OK, both paths independently fail-safe.
4. Console messages (warning/error only) → rate-limited, truncated, forwarded to the logger only (not the hang log) — correct per the plan's "console lines are not lifecycle events."
5. `armDiagnostics` (all three hosts, when `logsPath` is supplied): resolves `EventLoopMonitor`/`CpuProfileCapture`, starts the monitor, then `armWatchdog` resolves + starts `MainLoopWatchdog` inside its own try/catch. OK — correctly isolated failure boundary (verified: a watchdog-specific failure cannot take down the lag monitor).
6. `MainLoopWatchdog.start()` spawns the eval'd worker (`unref`-ed) and a 1 s heartbeat (`unref`-ed) carrying breadcrumbs, including `lastLag` fed from `monitor.onLag`. OK.
7. Worker: on each heartbeat, updates `lastBeatAt` and, if previously hung, emits `recovered`; on its own 250 ms check tick, detects silence >= `hangThresholdMs` (with the suspend guard) and emits `hang`. OK for the primary scenario; gap noted in Failure modes for the worker-death and simultaneous-starvation cases.
8. Teardown: `armDiagnostics`'s returned handle disposes the monitor and (fire-and-forget) the watchdog. `ProcessLifecycleRecorder` has no disposal path wired (gap noted above, low impact).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| INV-8: every process death and hang leaves a durable record | PARTIAL | Holds for the incident scenario (main-thread block, renderer/utility death, window unresponsive) with real tests proving it; does not hold once the watchdog worker itself has died, and is CLI-non-verbose-only for the CLI host (documented, inherited gating). |
| C6: `ProcessLifecycleRecorder` events + `crashReporter` local-only | COMPLETE | `uploadToServer: false` verified; no `submitURL` set; userData/app name set before `crashReporter.start`, so dumps land in the correct per-channel folder. |
| D9: keep newest 5 crash dumps | COMPLETE | `pruneCrashDumps` walks 2 levels, sorts by mtime, keeps newest 5, tested against multiple Crashpad subdirectories and a non-`.dmp` sibling file. |
| D6: `setBreadcrumb` API, RPC-method breadcrumb deferred | COMPLETE (as scoped) | `setBreadcrumb` implemented with the documented bounds; RPC-method breadcrumb explicitly deferred per plan defect D6, only `lastLag` wired — matches plan. |
| D2: pin new tokens via `container.smoke.spec.ts`, not `expected-resolvable.ts` | COMPLETE | All three hosts updated; each asserts singleton identity and `running === false`, a real behavioural assertion, not a bare resolve. |
| A8: `armDiagnostics` receives `logsPath` in all three hosts | COMPLETE | Confirmed at `wire-runtime.ts:305` (Electron), `bootstrap.ts:143` (VS Code), `cli-engine/src/lib/container.ts:394-396` (CLI, verbose-gated). |
| Quality: heartbeat cost bounded, console forwarding bounded | COMPLETE | 1 `postMessage`/s; 20 lines/10 s + 2 KB truncation, both tested. |

Implicit requirements not addressed: hang-log rotation/size bound; a restart or degradation signal when the watchdog worker itself dies; `arm-diagnostics.ts`-level integration test coverage.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Main loop blocked 6 s | YES | Real worker + real `Atomics.wait` spec, `main-loop-watchdog.spec.ts:85-117` | Tight upper-bound assertion is a CI-load flake risk (see Moderate issues) |
| Machine sleep/wake | YES | Suspend guard resets clock instead of reporting | Same code path also masks a genuine simultaneous main+worker starvation (Failure modes) |
| Worker crashes mid-run | PARTIAL | Logged, cleared | No restart, no degradation signal |
| Renderer destroyed before `getURL()` readable | YES | `safeUrl` catches and records the error text | — |
| Console flood | YES | Rate-limited 20/10s + suppressed-count flush, tested including the fresh-window-after-flush case | Flush on process exit is not guaranteed (recorder never disposed) |
| Unwritable log directory | YES | Both writers catch and `console.warn`, tested for both `MainLoopWatchdog` and `ProcessLifecycleRecorder` | Once writable again, no explicit "recovered" acknowledgement that logging resumed |
| Crash dumps directory missing (first run) | YES | `collectDumps` treats `ENOENT` as normal, resolves 0 | — |
| DI resolution/registration failure for the watchdog | YES | `armWatchdog`'s own try/catch, isolated from the lag monitor's | No integration spec exercises this branch directly (only unit-level plausibility) |
| Repeated storms over long uptime | NO | — | Unbounded hang-log growth (Moderate issue) |
| CLI without `--verbose` | Documented, not "handled" | Watchdog never arms | INV-8 partially unmet for that host by design, but disclosed in CLAUDE.md |

## Verdict

- Recommendation: APPROVE (with the fixes below folded in before or shortly after commit — none are blocking)
- Confidence: HIGH
- Top risk: a watchdog-worker death (rare, but the one failure this design cannot self-heal from) silently disables hang detection for the remainder of the process's life, with only a single log line as the trace — for a feature whose entire purpose is to survive silent failures, that is the one gap worth closing before calling INV-8 fully satisfied.
- What a robust implementation would add: a bounded restart (or at least a `DegradationReporter` signal) on watchdog worker death; a size/rotation bound on `ptah-hang.log` matching the discipline already applied to console forwarding and crash-dump retention; an `arm-diagnostics.spec.ts` proving the watchdog wiring and its failure-isolation from the lag monitor end-to-end; and either gating the AC-5 real-timing spec behind the repo's existing CI-load convention (`PTAH_PERF_SPECS=1`) or widening its upper-bound tolerance.

## Delta review (review fixes)

Scope: exactly the five fixes listed for this delta pass. Read current (uncommitted) code directly — `git diff main` is not meaningful mid-batch. Verified against `libs/backend/vscode-core/src/index.ts`, `main-loop-watchdog.ts`, `main-loop-watchdog-source.ts`, `arm-diagnostics.ts`, `arm-diagnostics.spec.ts`, `main-loop-watchdog.spec.ts`, and `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts`. Ran `npx nx run-many -t test -p @ptah-extension/vscode-core` (37 suites, 566/566 green) and `npx nx test ptah-electron --testPathPattern=process-lifecycle-recorder` (583/587 green, 4 pre-existing skips). Batch 4 files untouched and ignored per instructions.

### 1. Barrel export + duplicate-literal removal

`libs/backend/vscode-core/src/index.ts:115-147` now re-exports `MainLoopWatchdog`, `appendHangLogLine`, `HANG_LOG_FILE_NAME`, `HANG_LOG_MAX_BYTES`, all four interval/threshold defaults, the two breadcrumb bounds, `MAX_WORKER_RESTARTS`, `WORKER_RESTART_WINDOW_MS`, and the `MainLoopWatchdogOptions` type — closes the style review's Serious #1 exactly as its own recommendation specified. `process-lifecycle-recorder.ts:51-55` now imports `HANG_LOG_FILE_NAME`, `HANG_LOG_MAX_BYTES`, `appendHangLogLine` from `@ptah-extension/vscode-core`; the local `export const HANG_LOG_FILE_NAME = 'ptah-hang.log'` and the "Twin of..." comment are both gone (confirmed by reading the file — no second declaration exists). Two independent writers now share one literal; the drift risk the style review flagged is closed.

`grep -r "@ptah-extension/vscode-core" libs/frontend` returns nothing — no frontend lib imports this barrel, so promoting `MainLoopWatchdog` (which pulls in `node:worker_threads` and `node:fs` at module scope) to the root export carries no webview-boundary risk; `vscode-core` is backend-only per the module index and this holds in practice, not just by policy.

### 2. Restart budget

`main-loop-watchdog.ts:265-325` implements the budget cleanly:

- `worker.on('error', ...)` (`:275-277`) only records `failure` (a string), never triggers a restart directly — restart logic lives solely in the `exit` handler (`:278-282`), so an error-then-exit pair (the documented normal sequence) cannot double-count. Confirmed no restart-counting code runs from the `error` handler.
- `dispose()` (`:249-263`) sets `this.worker = undefined` **before** calling `worker.terminate()`, and `spawnWorker`'s `exit` handler guards with `if (this.worker !== worker) return;` (`:279`) — a dispose-caused exit is recognised (the reference no longer matches) and produces no restart, no log line. Pinned by the `'start is idempotent and dispose is safe to repeat'` spec (`main-loop-watchdog.spec.ts:224-241`), which explicitly asserts `logger.warn` was never called after a double dispose.
- Everything in `handleUnexpectedExit` (`:286-325`) runs synchronously — no `await` between the `exit` event firing, the restart-budget check, and `spawnWorker` re-assigning `this.worker`. Since Node's event loop cannot interleave synchronous code, there is no window where `beat()` (itself synchronous, gated on `worker !== undefined`, `:327-335`) can observe a torn state between "old worker gone" and "new worker armed" — the restart-vs-heartbeat race the review brief asked about does not exist given this implementation shape.
- A worker that dies immediately at startup takes the same code path as one that dies after running: `restartTimes` fills within the 10-minute window regardless of how fast the deaths arrive, so `MAX_WORKER_RESTARTS` (3) is still hit and degrade still fires — no infinite respawn loop. Not separately spec'd (the two worker-death tests kill a running worker via `terminate()`, not simulate an immediate eval failure), but the code path is identical either way, so this is a coverage gap, not a logic gap.
- Timers/listeners per restart: `spawnWorker` attaches exactly `error`+`exit` per worker instance and nothing else recurring; no listener accumulates across restarts since each worker is a fresh `Worker` object with its own listener set, and the old worker is discarded (not `unref`-tracked elsewhere). No leak found.

Both restart tests (`main-loop-watchdog.spec.ts:256-308`) assert real behaviour — one warning per death with `restart`/`budget` fields, the replacement worker still detects a real hang, and after the budget is spent: `running === false`, `isDegraded === true`, exactly one `logger.error` call, and the heartbeat interval cleared (`heartbeat` internal is `undefined`). This closes last review's "Watchdog worker dies and is never revived" failure mode and its associated Moderate issue.

### 3. Hang log rotation

`appendHangLogLine` (`main-loop-watchdog.ts:116-135`) and `HANG_LOG_APPEND_SOURCE` (`main-loop-watchdog-source.ts:58-76`) are algorithmically identical (mkdir → stat → rotate-if-≥cap → append, all swallowed on failure), and `main-loop-watchdog.spec.ts:366-396` evals the exact worker source text via `new Function(...)` and asserts both writers produce byte-identical output across 25 successive writes including a rotation boundary — a real parity proof, not an assertion of intent.

Two-writer-concurrent-rotation risk (the review brief's specific hunt item): both `MainLoopWatchdog`'s worker and `ProcessLifecycleRecorder` on the main thread call the same rotate-then-append sequence against the same `<logsPath>/ptah-hang.log` path, from two different OS threads/processes-in-effect (worker thread vs. main thread). `rotateHangLog` (`main-loop-watchdog.ts:144-153`) and its worker twin both catch a failed `renameSync` and fall through to appending anyway — so the documented failure mode (an EPERM rename race on Windows, or one writer winning the rotate) degrades to "oversized file, append still lands" rather than a lost line. This is a real, tested design choice (`rotateHangLog`'s doc comment at `:137-143` states the trade-off explicitly) and is consistent with the concern raised in the base review. It is not perfect — under the exact interleaving where writer A renames the file to `.1` and writer B's `statSync` ran just before that (so B still thinks the live file is oversized and also attempts to rotate, silently clobbering A's freshly-created `.1` with B's own pre-rotation content, since `renameSync` overwrites destinations on both POSIX and Windows) — a `.1` snapshot can be overwritten rather than lost outright; the **live** file (the one still being appended to) is never at risk in that interleaving, only the historical `.1` archive. This is a narrow, low-severity edge case (worth one line in the class doc, not a blocking defect) since the current-file append always succeeds or is skipped consistently.

`statSync` cost on main per append: one extra syscall per lifecycle event write (`main-loop-watchdog.ts:123`) — these are lifecycle events (process death, hang, unresponsive), not a hot path; no realistic call volume makes this a bottleneck. Not a finding.

Failures are not swallowed silently past the point of visibility: `process-lifecycle-recorder.ts:291-296` logs a `console.warn` when `appendHangLogLine` returns `false`; the worker-side twin swallows unconditionally by design (no logger reachable from an eval'd worker, documented at `main-loop-watchdog-source.ts:99-101`). Both match the base review's already-accepted trade-off; nothing new here.

### 4. `arm-diagnostics.spec.ts` (6 tests)

Real assertions, not smoke tests. Each case exercises a specific behavioural claim:

- Watchdog started with the resolved `logsPath` (`:68-75`) — asserts the exact call args, not just "was called."
- No watchdog needed/started when `logsPath` is absent, and `dispose()` doesn't throw despite no watchdog being registered (`:77-87`).
- Watchdog `start()` throwing is caught at the `armWatchdog` boundary, logs the specific warning message and reason, but the lag monitor and `captureCpuProfile` keep working — and critically, `handle.dispose()` afterward does **not** call `watchdog.dispose` (`:89-115`), proving the failed watchdog is genuinely excluded from the handle's teardown list rather than silently retained.
- Unresolvable watchdog token (DI registration absent) degrades the same way (`:117-129`).
- The `lastLag` breadcrumb value is asserted against the exact formatted string pattern the production code produces (`:131-142`), not just "was called."
- Dispose ordering: asserts `watchdog.dispose` called once, `monitor.dispose` called once, and the internal lag-listener `Set` drops to 0 after `handle.dispose()` (`:144-157`) — proves the unsubscribe functions actually ran, not merely that dispose didn't throw.

This closes the base review's Moderate item "No `armDiagnostics`-level integration test for the watchdog wiring" cleanly. One small gap: no case asserts the *order* of operations in `dispose()` (unsubscribe → monitor.dispose → watchdog.dispose per `arm-diagnostics.ts:104-110`) — only that each eventually happened once. Low value to add given the fakes have no way to observe ordering violations causing an actual defect here (the real dependents are decoupled), so not a blocking gap.

### 5. AC-5 de-flake

`main-loop-watchdog.spec.ts:90-133`. The mechanism assertions (lines land during the block, event sequence, `blockedForMs >= 5_000`/`>= 5_900`, breadcrumb content) run unconditionally; only the tight upper bound (`< 7_500`, line 131) is gated behind `PTAH_PERF_SPECS=1`. This matches the repository's existing convention cited in the base review (`git-watcher.stress.spec.ts`) and directly closes that review's Moderate item and the "give it a look" ask in item 5 above.

Robustness on a loaded runner: the pre-block `beat()` call (`:103`) is synchronous and enqueues the heartbeat message before the thread blocks, which fixes the "last beat could be stale by up to a full interval" problem the comment describes — but it does not fully protect against a **slow worker boot**. `await waitFor(() => watchdog.running, 1_000)` (`:95`) only proves the `Worker` object exists (`this.worker !== undefined`, set synchronously in `spawnWorker`), not that the worker thread has finished initializing and is listening on `parentPort.on('message', ...)`. The subsequent `1_200`ms sleep (`:96`) is presumably meant to cover worker boot + first heartbeat round-trip, and it is unconditional (not gated behind `PTAH_PERF_SPECS`), so on an extremely loaded CI runner where V8 isolate startup for the eval'd worker exceeds 1.2 s, the pre-block `beat()` could still be enqueued before the worker's `message` listener is attached, silently dropped (Node buffers messages sent before the listener attaches only via the underlying MessagePort's internal queue — messages posted before `on('message')` is registered are NOT lost, since `postMessage` before any listener is added still queues at the `MessagePort` level in Node's `worker_threads` implementation). This is worth double-checking empirically rather than asserting from the code alone, but Node's documented behavior is that `postMessage` calls are queued until a `message` listener is registered, so no heartbeat should be dropped even in this scenario — the 1.2 s sleep is therefore a safety margin, not a correctness requirement. Given that, this is not a de-flake regression; the mechanism assertions remain sound at any host speed, and only the gated upper-bound line is CI-load-sensitive, exactly as intended.

### Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- All five fixes verified against current code, not just described: the barrel/duplicate-literal fix is confirmed with a grep showing zero frontend boundary risk; the restart budget is confirmed synchronous and race-free by code inspection plus two passing specs that assert the exact log-call shapes; the rotation parity is confirmed by a real eval'd-twin diff test; the six new `arm-diagnostics.spec.ts` cases assert real behavioural properties (call args, exclusion from teardown, listener-count-to-zero) rather than bare resolution; the AC-5 de-flake correctly gates only the CI-load-sensitive assertion.
- Remaining low-severity items, none blocking: (a) a `.1` archive file can be clobbered (not lost-outright; the live file is never at risk) under a narrow two-writer interleaving during rotation — worth one doc-comment line, not a code change; (b) no dedicated spec for "worker crashes immediately at startup" versus "worker crashes while running," though the code path is provably identical; (c) no ordering assertion in `arm-diagnostics.spec.ts`'s dispose test, only call-count assertions.
- Top risk: none blocking. The former Moderate/Failure-mode findings from the base review (worker death never revived, no `arm-diagnostics.spec.ts`, AC-5 flake risk) are all closed by these fixes.
