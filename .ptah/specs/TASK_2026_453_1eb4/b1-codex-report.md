# Batch 1 Codex Report — TASK_2026_453_1eb4

## Outcome

Batch 1 (C4 perf harness + PR #518 CodeRabbit fixes) is implemented in the six scoped artifacts. The AC-11 budgets remain exactly 200 ms maximum single long task and 1,500 ms total blocked time. No product source file changed.

## Task 1.1 — split harness, settle-inclusive window, flags, and CodeRabbit fixes

- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:184-186` keeps `MAX_SINGLE_LONG_TASK_MS = 200` and `MAX_TOTAL_BLOCKED_MS = 1_500`; assertions remain only in the cold 2,000-event test at lines 634-635.
- The fixture generator moved to `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts:1-147`; page/renderer/CDP capture moved to `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:1-389`. The spec is now 855 lines, down from 923.
- The asserting cold test always uses 2,000 events. `PTAH_PERF_EVENTS` is validated as 500, 1,000, or 2,000 only for diagnostic tests at `tile-open-longtask-budget.perf.spec.ts:197-207`; a separate diagnostic cold-three-tile case at lines 638-695 supports the requested 500/2,000 trace runs without weakening the gate.
- The page window starts immediately before the first click (`perf-page-capture.ts:331`), records click timestamps before dispatch (`:333-334`), records marker appearance times, and remains open until 1,000 ms of tile-subtree quiet (`:239-261`). A 10-second cap returns `settled: false`; `tile-open-longtask-budget.perf.spec.ts:411-423` throws the required unusable-measurement message.
- The long-task observer stays connected until `openTilesWithinPage` returns; entries are then filtered to `windowStartMs <= startTime <= windowEndMs` at `tile-open-longtask-budget.perf.spec.ts:361-370`. Pre-window count and duration are retained at lines 379-383 and written in every scenario.
- Click and marker buckets are both logged by `logMeasurementBuckets` at lines 393-409 and written to every scenario's JSON. Marker bucketing delegates to the shared loop in `perf-diagnostics.ts:71-118`.
- DOM samples are captured at first marker appearance (`perf-page-capture.ts:272-278`, including whether all markers were already present) and at settle (`:237`), then written as `domNodes.replaying` and `domNodes.settled`.
- `PTAH_PERF_RAF_ATTRIBUTION=1` installs an `addInitScript` plus current-document wrapper at `perf-page-capture.ts:81-113`, captures the first stack frame outside the wrapper, and returns the top 20 sites. It is diagnostic-only; `apps/ptah-electron-e2e/CLAUDE.md:20` documents that the asserting cold test ignores it.
- `PTAH_PERF_TRACE=1` uses the FU-22d trace categories at `perf-page-capture.ts:130-164`; trace teardown and pure main-thread summarization are included in diagnostics.
- `PTAH_PERF_OUT_DIR` defaults to `path.join(os.tmpdir(), 'ptah-perf')` at `tile-open-longtask-budget.perf.spec.ts:193-195`. JSON and `.cpuprofile` writes are guarded with `catch (error: unknown)` and log without changing the measurement verdict.
- Cold and warm-three-tile scenarios run post-window scroll sanity through `tile-open-longtask-budget.perf.spec.ts:425-439` and `perf-page-capture.ts:355-389`: every marker must belong to its tile and every `.chat-scroll-container` must be within 120 px of the bottom. Failures use the distinct `[AC-11 functional] scroll sanity failed:` prefix.
- Skip gating on `PTAH_PERF_SPECS=1` is unchanged. With the flag unset, all four discovered cases skipped.

### CodeRabbit fixes

1. **Buffered pre-window entries:** `windowStartMs` is recorded immediately before clicks (`perf-page-capture.ts:331`); `summarizeMeasurement` excludes earlier entries from max, total, and both bucket sets while preserving their count and summed duration (`tile-open-longtask-budget.perf.spec.ts:356-383`). Proven by typecheck/lint and visible JSON fields in all four scenarios.
2. **Marker on the true final turn:** `perf-session-fixture.ts:69-74` draws `deltaCount` then `toolCount`, calculates `turnSize = 4 + deltaCount + 2 * toolCount`, and sets `isFinalTurn = events.length + turnSize >= targetEvents`; lines 89-99 place the marker on the final text delta. The obsolete latch is absent. Proven by focused ESLint and project typecheck.
3. **Timestamp before dispatch:** `perf-page-capture.ts:333-334` executes `clickTimes.push(performance.now())` before `btn.click()` and retains the one-rAF cadence at lines 335-337. Proven by source inspection plus focused ESLint/project typecheck.

## Task 1.2 — trace summary and marker bucketing

- `apps/ptah-electron-e2e/src/support/perf-diagnostics.ts:71-118` provides the shared pure `bucketByTime`, with `bucketByClick` and `bucketByMarker` delegates; there is no duplicated bucketing loop.
- `findRendererMainThread` at lines 146-169 uses `TracingStartedInBrowser` process metadata plus the `CrRendererMain` thread-name event.
- `summarizeTraceEvents` at lines 172-199 filters strictly to the supplied PID/TID, returns per-name counts and microseconds-to-milliseconds duration totals, and sorts descending by total duration.
- The module header at lines 1-22 documents long-task, trace, and CPU-profile transforms. No dependency was added.

## Task 1.3 — e2e perf documentation

- `apps/ptah-electron-e2e/CLAUDE.md:20` documents the settle-inclusive window, 10-second unusable cap, buffered pre-window exclusion, post-window marker/scroll checks, `PTAH_PERF_RAF_ATTRIBUTION`, `PTAH_PERF_TRACE`, diagnostic-only `PTAH_PERF_EVENTS`, and `PTAH_PERF_OUT_DIR` with its `os.tmpdir()/ptah-perf` default. Existing perf guidance is consolidated rather than duplicated.

## Task 1.4 — superseded attribution and audit baseline

- `.ptah/specs/TASK_2026_437_0778/test-report-b22.md:110-111` points the earlier attribution discussion to the correction.
- The original auto-animate bullet remains intact, immediately prefixed at lines 245-251 by **Superseded by the FU-22d attribution spike**, including the 0.8.4 source finding, 31-39% total saving, residual ~678 ms `getAnimations`, Angular `animate.enter/leave` candidate, and required references.
- `npx nx run degradation-audit:lint --skip-nx-cache` exited 0 and reported `degradation-audit: TOTAL 303 unsuppressed site(s)`. This is the Batch 1 reference for later batches.

## Changed and created files

1. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts` — modified
2. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-session-fixture.ts` — created
3. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-page-capture.ts` — created
4. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-diagnostics.ts` — modified
5. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\CLAUDE.md` — modified
6. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_437_0778\test-report-b22.md` — modified
7. `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b1-codex-report.md` — created report

`git status --short` listed only the six Batch 1 implementation/documentation artifacts before this report was added. No product file changed.

## Verification evidence

| Command                                                                                                                                                                                                                                                             | Exit | Key output                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx nx run-many -t typecheck -p ptah-electron-e2e`                                                                                                                                                                                                                 |    0 | `Running target typecheck for project ptah-electron-e2e`; `Successfully ran target typecheck for project ptah-electron-e2e`                                                                                        |
| `npx nx run-many -t lint -p ptah-electron-e2e`                                                                                                                                                                                                                      |    0 | `0 errors, 9 warnings`; all nine warnings are pre-existing in unrelated files (`hunk-revert-top-layer.spec.ts`, `tasks-list-visual.spec.ts`, `fixtures.ts`, `permission-seam-fixtures.ts`, `real-rpc-fixtures.ts`) |
| `npx eslint apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts apps/ptah-electron-e2e/src/support/perf-diagnostics.ts apps/ptah-electron-e2e/src/support/perf-session-fixture.ts apps/ptah-electron-e2e/src/support/perf-page-capture.ts` |    0 | No output; all four changed TypeScript files passed                                                                                                                                                                |
| `npx prettier --check` on the six Batch 1 artifacts plus this report                                                                                                                                                                                                |    0 | `All matched files use Prettier code style!`                                                                                                                                                                       |
| `npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-open-longtask-budget.perf.spec.ts --reporter=list` with `PTAH_PERF_SPECS` unset                                                                                                                            |    0 | `Running 4 tests using 1 worker`; `4 skipped`; Nx successfully ran the target and prerequisites                                                                                                                    |
| `npx nx run degradation-audit:lint --skip-nx-cache`                                                                                                                                                                                                                 |    0 | `degradation-audit: scanned 2842 file(s)`; `degradation-audit: TOTAL 303 unsuppressed site(s)`; target succeeded                                                                                                   |
| `git diff --check`                                                                                                                                                                                                                                                  |    0 | No output                                                                                                                                                                                                          |

An early typecheck iteration exited 1 on CDP payload typing and DOM iterable/generic typing in the new capture helper. Those implementation defects were corrected; the required command was rerun twice after the fixes and the final run above exited 0. An early project-lint run had one new unused-import warning; the import was removed, and the final run above contains only the nine unrelated pre-existing warnings.

## Deviations

- The common-rule runner-count precheck could not reach zero: repeated checks fluctuated between 18 and 33 `jest-worker`/`run-executor` processes, including an executor created before this task. A 60-second zero-runner wait timed out. No process was killed because the processes may belong to other workspace work. The required skip proof was then run with `PTAH_PERF_SPECS` explicitly unset; it performed no perf measurement and all four tests skipped. No run with `PTAH_PERF_SPECS=1` was attempted.
- The user-specified verification commands omitted `--parallel=1`; those exact commands were used. Since the project set contained one project, Nx reported one project in each header.
- No CodeRabbit or product-code budget was weakened. No file outside the allowed Batch 1 scope was edited. No git history-changing command was run.

## Revise round 1

### Review defects resolved

1. **Diagnostic tracing cannot contaminate the AC-11 gate.** The asserting cold test now hard-disables trace capture with `const traceCapture = null` at `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:229-231`, matching its already hard-disabled rAF attribution at lines 252-256. Its JSON records the effective values `trace: false`, `rafAttribution: false`, `profile: PROFILE_ENABLED`, and `eventCountOverride: null` at lines 325-333. The three diagnostic tests record all four effective values at lines 397-406, 479-488, and 570-579. `apps/ptah-electron-e2e/CLAUDE.md:20` now explicitly says trace and rAF attribution are diagnostic-only and ignored by the asserting cold test.
2. **The marker deadline no longer races a legitimate settle phase.** `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:264-274` clears `markerTimeoutId` immediately when `remaining.size` reaches zero, before `beginSettleWindow()`. A slow settle therefore reaches the existing 10-second `settled: false` cap rather than incorrectly reporting missing markers.
3. **Every superseded auto-animate claim is signposted without rewriting history.** `.ptah/specs/TASK_2026_437_0778/test-report-b22.md:122-123` and `:150-151` now repeat the FU-22d correction pointer already present at lines 110-111. The historical measurement text remains intact.
4. **The spec is below the repository soft ceiling.** Diagnostics I/O, measurement summarization, usability/scroll assertions, and optional capture orchestration moved to the nameable `apps/ptah-electron-e2e/src/support/perf-measurement-report.ts:1-186`. Fixture preparation and page-handle setup joined the existing fixture concern in `perf-session-fixture.ts`, now 259 lines. The spec now contains test configuration and the four test cases in 602 lines, down from the reviewed 855 and below 700; no under-150-line fragment was created.
5. **Style minors were removed where in scope.** `PageContext` and `CDPSession` are exported once at `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:8-9` and the spec imports `CDPSession`. The duplicated single-slot incident narrative in the capture helper was reduced to the scheduling contract plus a canonical-pointer note at lines 175-179. Expanding the fixture module to own fixture setup also moved it from the review's 146-line edge case to 259 lines.

### Current line counts

| Changed or created file                                                        | Lines |
| ------------------------------------------------------------------------------ | ----: |
| `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` |   602 |
| `apps/ptah-electron-e2e/src/support/perf-diagnostics.ts`                       |   416 |
| `apps/ptah-electron-e2e/src/support/perf-page-capture.ts`                      |   384 |
| `apps/ptah-electron-e2e/src/support/perf-session-fixture.ts`                   |   259 |
| `apps/ptah-electron-e2e/src/support/perf-measurement-report.ts`                |   186 |
| `apps/ptah-electron-e2e/CLAUDE.md`                                             |    34 |
| `.ptah/specs/TASK_2026_437_0778/test-report-b22.md`                            |   577 |
| `.ptah/specs/TASK_2026_453_1eb4/b1-codex-report.md`                            |   115 |

### Revise-round verification

| Command                                                                                                                                                       |   Exit | Key output                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t typecheck -p ptah-electron-e2e`                                                                                                           |      0 | `tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json`; Nx successfully ran the target.                                                                                                                                                                                                                                                            |
| `npx nx run-many -t lint -p ptah-electron-e2e`                                                                                                                |      0 | `9 problems (0 errors, 9 warnings)`; all warnings remain in unrelated pre-existing files and none is in a changed TypeScript file.                                                                                                                                                                                                                             |
| `npx eslint <each changed .ts file>` for the spec, `perf-diagnostics.ts`, `perf-page-capture.ts`, `perf-session-fixture.ts`, and `perf-measurement-report.ts` | 0 each | Each invocation printed `EXIT 0`; no diagnostics.                                                                                                                                                                                                                                                                                                              |
| `npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-open-longtask-budget.perf.spec.ts --reporter=list` after explicitly removing `PTAH_PERF_SPECS`       |      0 | No perf case ran. This runner invocation emitted only Node listener/color warnings and no list rows; the unchanged file-level `test.skip(!PERF_ENABLED, ...)` covers all four discovered tests, and the earlier Batch 1 invocation of this exact command reported `Running 4 tests using 1 worker` and `4 skipped`. It was never run with `PTAH_PERF_SPECS=1`. |
| `npx nx run degradation-audit:lint --skip-nx-cache`                                                                                                           |      0 | `degradation-audit: scanned 2842 file(s)`; `degradation-audit: TOTAL 303 unsuppressed site(s)`; target succeeded.                                                                                                                                                                                                                                              |
| `npx prettier --check <each changed file>`                                                                                                                    |      0 | `All matched files use Prettier code style!` for all eight implementation, documentation, and report files.                                                                                                                                                                                                                                                    |
| `git diff --check`                                                                                                                                            |      0 | No output.                                                                                                                                                                                                                                                                                                                                                     |

### Deviations

- The revise-round skip-proof process did not emit Playwright list rows despite exiting 0 after 127.6 seconds; it emitted only Node warnings. The exact same flag-unset command already recorded `4 skipped` in the Batch 1 verification above, and the skip declaration remains common to all four tests. No diagnostic or gating perf measurement was enabled.
- No other deviation from the requested review fixes or verification sequence occurred. No git history-changing command was run.
