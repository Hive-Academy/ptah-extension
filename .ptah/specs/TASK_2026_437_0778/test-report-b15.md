# Test Report - TASK_2026_437_0778 (Batch 15)

> This report was revised four times after the first submission: once to rule out the test rig as
> the cause of an apparent AC-2 (P2) perf miss (see "Rig attribution follow-up"), again after the
> logic and style reviews (`b15-code-logic-review.md`, `b15-code-style-review.md`, both
> NEEDS_REVISION) found real gaps in the rig's structure, assertions and honesty, a third time after
> CI run 34922130353 failed `git-watcher.stress.spec.ts` ST-1b on a loaded Linux runner (which in
> turn surfaced a genuine, reproducible AC-2 mechanism gap at the 75,000-file perf tree size, left
> failing and reported rather than silently resolved), and a fourth time to act on the orchestrator's
> decision for that gap: split the strict "exactly one" AC-2 form to the 8,000-file tree Batch 11
> actually measured, and add a bounded form (≤ 3 overflow batches) for the 75,000-file tree, with the
> root cause confirmed from log evidence — see "CI evidence and the third revision", section 2, for
> the full resolution and FU-15b. This version supersedes all four earlier ones. Commit `82c7b30f1`
> (Sonar S4822 fix in `workspace-watch-host-core.ts`) landed in the worktree during this batch; it
> only shifted line numbers in that file by a few lines and changes nothing this report or the spec
> relies on.

## Scope

- User request: prove ST-2 (mass file-system storm against the real out-of-process watch host)
  and AC-7 (watch host killed mid-session) hold on the real `@parcel/watcher` engine, not a fake,
  and measure the 75,000-file mass-delete cost.
- Criteria tested (`implementation-plan.md` acceptance table, `:791-820`):
  - **A1** — does the native subscription survive a Windows `ReadDirectoryChangesW` buffer
    overflow, or does it need the rebuild path? Resolved by design inspection
    (`workspace-watch-host-core.ts`); NOT independently confirmed against a real observed overflow
    — see "A1 resolution, restated for honesty" below (review item 12a).
  - **AC-2 (P2)** — ST-2 mechanism: subscription survives or is rebuilt; bounded batches; overflow
    delivered; no per-event message reaches the calling process; delivery resumes; storm was
    OBSERVED (not merely "at least one event survived"). Perf half (p99 ≤ 30 ms, max ≤ 100 ms) is
    a separate, perf-gated file.
  - **AC-7** — host killed: supervisor restart happens (CI: generous timeout; perf: the actual
    ≤ 3,000 ms budget); consumers receive `overflow` and rescan exactly once per incident for a
    BARE kill (the composite native-loss-plus-kill case is an open risk, not proven — review item
    12b); main event-loop p99 unchanged vs AC-2 (perf-gated); degraded path past the restart
    budget: `isDegraded`, one `DegradationReporter`/`onDegraded` call, rescan cadence, then
    recovery.
  - **R-P10** — host RSS before / peak / after the mass delete, recorded; `null`/"not sampled" when
    the monitor never produced a reading, never a silent fallback to another number.
  - **R-P11** — mechanism assertions always run in a `*.stress.spec.ts` file; ms budgets only in a
    separate `*.stress.perf.spec.ts` file under `PTAH_PERF_SPECS=1`, matching
    `git-watcher.stress.spec.ts` / `git-watcher.stress.perf.spec.ts`.
- Regressions covered: none new. The rig-attribution fix (out-of-process delete, persistent RSS
  monitor) was backported to `apps/ptah-electron/src/services/git-watcher.stress.harness.ts` /
  `git-watcher.stress.perf.spec.ts` (coordinator item 5) so that spec cannot fail for the same rig
  reason this batch found here.
- Review findings covered: every serious and moderate item in `b15-code-logic-review.md` and
  `b15-code-style-review.md` — see "Review findings addressed" below, one row per item with the
  file:line of the fix.
- Deliberately not tested (scope decisions):
  1. **VS Code adapter.** ST-2/AC-7 are P2, Electron/CLI-host-specific per the plan (`:818-820`);
     the VS Code adapter has no host process to kill and is already covered by
     `runWorkspaceWatcherContract`.
  2. **The CLI's own forked host.** Same protocol, same `WorkspaceWatchSupervisor`; a second
     ST-2/AC-7 pass over `platform-cli` would duplicate this file's assertions against the same
     production code. Not run.
  3. **Multi-root recovery interaction (FU-8b).** Out of scope for this batch.
  4. **Forcing a literal Windows `ReadDirectoryChangesW` overflow.** Not reproduced at up to 75,000
     files on this machine — see "A1 resolution, restated for honesty".
  5. **The composite native-loss + process-kill overflow path (review serious #3).** Named as an
     open risk, not exercised — see "AC-7 composite path — open risk" below.

## Structure (Batch 15 style review, serious #1 and #2)

The rig now lives in three files instead of one, matching the precedent
`libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.bundle.harness.ts` and
`apps/ptah-electron/src/services/git-watcher.stress.harness.ts` / `.spec.ts` / `.perf.spec.ts`
already set:

| File                                                                                                                      | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.harness.ts` (NEW)                         | Reusable rig: `ensureHostBundleExists`, `sleep`/`waitFor`, `readHostRssKb`, `RssPeakMonitor`, `deleteInChildProcess`, `WatchHostChildProcess`, `makeTempRoot`/`writeFile`/`buildTree`, `measureEventLoopDelay`, `BatchRecorder` (now with `nativeErrorDiagnosed()`/`hostRestartedDuringRun()` as two separate methods), `makeWatcher`, and the three scenario runners `runMassDeleteStorm`, `runSingleKillScenario`, `runDegradedPastBudgetScenario` — each tears itself down in a `finally` block, dispose-before-delete, every step isolated by a `safely()` wrapper. |
| `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host-rss-sampler.js` (NEW)                            | ONE plain, linted, CommonJS implementation of "read a PID's RSS on this platform" (`sampleRssKb`), `require`d directly by `readHostRssKb` for a single synchronous sample, and run directly (`node ...rss-sampler.js <pid> <intervalMs>`) as the body of the persistent monitor child `RssPeakMonitor` spawns. Errors are reported over IPC (`{ type: 'error', message }`), never swallowed.                                                                                                                                                                            |
| `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts` (REWRITTEN, mechanism only)      | 3 always-on tests: ST-2 8,000-file mechanism, AC-7 single-kill mechanism (no ms budget), AC-7 degraded path.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.perf.spec.ts` (NEW, `PERF_ENABLED`-gated) | 2 tests: ST-2 75,000-file perf (AC-2 P2 budget), AC-7 single-kill perf (restart ≤ 3,000 ms + p99 ≤ 30 ms).                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `libs/backend/platform-electron/tsconfig.spec.json` (MODIFIED)                                                            | Added `"allowJs": true` so `ts-jest` transforms the `.js` sampler fixture without the "allowJs option is not set" warning on every run; the project's own `"include"` list is unchanged (no `.ts` file gains type-checking it did not have).                                                                                                                                                                                                                                                                                                                            |

### Shared-helper decision (coordinator item 4)

`git-watcher.stress.harness.ts` (`apps/ptah-electron`) and `workspace-watch-host.entry.spec.ts`
(same lib as the new harness) each still carry their own forked-host wrapper / tree builder /
event-loop-delay measurement. A single shared implementation across `apps/ptah-electron` and
`libs/backend/platform-electron` would need either a new cross-cutting test-utility package (none
exists for platform-electron-specific rigs) or a deep relative import crossing the app/lib
boundary, which this repo's own `@nx/enforce-module-boundaries` config and project-alias convention
both treat as a violation. **Decision: keep `workspace-watch-host.stress.harness.ts` as the
CANONICAL copy for `platform-electron`; record the duplication with `git-watcher.stress.harness.ts`
as a follow-up (FU-15a), not resolved this batch.** The one thing that WAS ported across the
boundary is the FIX (out-of-process delete), not the code — see item 5 below — because a stale
rig producing a false perf reading was the actual risk the coordinator was tracking, not the
duplication itself.

## Review findings addressed

| #                  | Review item                                                                      | File:line                                                                                                                                                                                                | What changed                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style serious 1    | Rig lives inside the spec instead of a peer `.stress.harness.ts`                 | `workspace-watch-host.stress.harness.ts` (new, 400+ lines)                                                                                                                                               | Extracted per the `platform-cli` bundle-harness precedent.                                                                                                                                                                                                    |
| Style serious 2    | Perf case embedded in the always-run file instead of a separate perf spec        | `workspace-watch-host.stress.perf.spec.ts` (new)                                                                                                                                                         | Split, `PERF_ENABLED`-gated `describe`, matching `git-watcher.stress.perf.spec.ts`.                                                                                                                                                                           |
| Style serious 3    | RSS sampler re-implements existing logic as an inline, unlinted string           | `workspace-watch-host-rss-sampler.js` (new); harness `:139-146` (`readHostRssKb` delegates to it), `:165-222` (`RssPeakMonitor` spawns the file directly, errors reported via `errors()`)                | One real, linted, typed-by-JSDoc file; both the sync single-sample path and the persistent monitor child use it.                                                                                                                                              |
| Style minor 1      | Perf flag named `PERF` vs sibling's `PERF_ENABLED`                               | `workspace-watch-host.stress.perf.spec.ts:29`                                                                                                                                                            | Renamed to `PERF_ENABLED`.                                                                                                                                                                                                                                    |
| Style minor 2      | `ForkedWatchHostProcess` name collides with git-watcher's own class              | harness `:225`                                                                                                                                                                                           | Renamed to `WatchHostChildProcess`.                                                                                                                                                                                                                           |
| Logic serious 1    | Storm-observed assertion doesn't check what its own comment claims               | `workspace-watch-host.stress.spec.ts:116-118`                                                                                                                                                            | `toBeGreaterThan(0)` → `toBeGreaterThanOrEqual(result.fileCount)`.                                                                                                                                                                                            |
| Logic serious 2    | ST-2 cleanup order can leak the forked host process and RSS monitor              | harness `runMassDeleteStorm` `finally` block, `runSingleKillScenario` `finally`, `runDegradedPastBudgetScenario` `finally`                                                                               | Every scenario now tears down in a `finally`: monitor → subscription(s) → watcher (kills the host process) → temp directory, each step wrapped in `safely()` so one failure cannot skip the rest.                                                             |
| Logic serious 3    | Composite native-loss + process-kill overflow path is neither tested nor flagged | `workspace-watch-host.stress.spec.ts:53-66` (header doc), this report's "AC-7 composite path" section                                                                                                    | Documented explicitly as an open, unexercised risk; not fixed with a new test this batch.                                                                                                                                                                     |
| Logic moderate 1   | `nativeErrorSeen` conflates native-error diagnostics with any supervisor restart | harness `BatchRecorder.nativeErrorDiagnosed()` / `.hostRestartedDuringRun()`                                                                                                                             | Split into two named methods/fields; both logged separately in every test.                                                                                                                                                                                    |
| Logic moderate 2   | Ms budget (restart ≤ 3 s) asserted unconditionally in CI, against R-P11          | `workspace-watch-host.stress.spec.ts:124-127` (mechanism: generous 30 s timeout, no numeric assert) vs `workspace-watch-host.stress.perf.spec.ts:86-100` (perf: 3,000 ms timeout AND explicit assertion) | Numeric budget moved to the perf file only.                                                                                                                                                                                                                   |
| Logic moderate 3   | Comment says "well under 100" but assertion is `< 200`                           | `workspace-watch-host.stress.spec.ts:107`                                                                                                                                                                | Assertion tightened to `toBeLessThan(100)`, matching the comment.                                                                                                                                                                                             |
| Logic moderate 4   | `rssPeak` silently falls back to `rssBefore` if the monitor never sampled        | harness `runMassDeleteStorm` (`rssPeakKb: monitor?.peakKb() ?? null`)                                                                                                                                    | Returns `null` ("not sampled"); every log line prints `?? 'not sampled'` instead of a number that could be misread as "no growth".                                                                                                                            |
| Logic honesty (a)  | A1 report language overclaims relative to what was observed                      | `workspace-watch-host.stress.spec.ts:13-41` (header), this report's "A1 resolution, restated for honesty"                                                                                                | Spec header and report now BOTH state plainly: no real Windows buffer overflow was observed; the native-error→rebuild path is covered by fake-engine unit specs and by AC-7's host-level kill, not by a real overflow; lists concrete ways to force it later. |
| Logic honesty (b)  | AC-7 "exactly one overflow" is proven for a bare kill only                       | `workspace-watch-host.stress.spec.ts:53-66` (header), this report's "AC-7 composite path" section                                                                                                        | Documented as a caveat/follow-up, not silently generalized.                                                                                                                                                                                                   |
| Coordinator item 5 | Backport the rig fix to `git-watcher.stress.harness.ts`                          | `apps/ptah-electron/src/services/git-watcher.stress.harness.ts` (`deleteInChildProcess` added, `deleteAndSettle` now calls it)                                                                           | See "git-watcher backport" below for before/after numbers.                                                                                                                                                                                                    |

## Suites

### `ST-2 — mass delete storm against the real watch host` — integration

- Requirement: `ElectronWorkspaceWatcher` supervising the REAL
  `dist/apps/ptah-electron/workspace-watch-host.mjs` over the REAL `@parcel/watcher` native engine
  must turn a mass file-system storm into a small, bounded number of batches, never crash the host,
  keep delivering after the storm, and demonstrably OBSERVE the storm (not merely register one
  stray event).
- Cases:
  - **CI mechanism (8,000 files, `workspace-watch-host.stress.spec.ts`).** Builds a tree under
    `root/churn/` (root itself never deleted), subscribes, settles, deletes `churn` in a CHILD
    process, waits 10 s, writes a probe file under the still-watched root. Asserts: `batches < 100`;
    `hostExitedUnexpectedly === false`; `changedPaths + droppedTotal >= fileCount` (strengthened
    per logic serious #1).
  - **Perf (75,000 files, `workspace-watch-host.stress.perf.spec.ts`, `PTAH_PERF_SPECS=1`).** Same
    shape via the same harness function, asserts `p99 <= 30ms`, `max <= 100ms` (AC-2 P2), plus
    `hostExitedUnexpectedly === false`.
- Files: `D:\projects\ptah-437\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host.stress.spec.ts`,
  `...\workspace-watch-host.stress.perf.spec.ts`,
  `...\workspace-watch-host.stress.harness.ts`,
  `...\workspace-watch-host-rss-sampler.js`.

### `AC-7 — real host-kill while subscriptions are active` — integration

- Requirement: killing the REAL forked host process (`process.kill(pid, 'SIGKILL')`) while
  subscriptions are live must trigger a supervised restart, exactly one `overflow` per subscriber
  for a BARE-kill incident, automatic resubscription, and resumed delivery — and, once the restart
  budget is spent, the degraded path: `isDegraded`, one degradation report, a fixed overflow-rescan
  cadence, then recovery.
- Cases:
  - **Single real kill, two subscribers, mechanism (`workspace-watch-host.stress.spec.ts`).**
    `runSingleKillScenario(30_000)` — 30 s generous restart timeout, no numeric ms assertion.
    Asserts `overflowA === 1`, `overflowB === 1`, `isDegraded === false`.
  - **Single real kill, two subscribers, perf (`workspace-watch-host.stress.perf.spec.ts`).**
    `runSingleKillScenario(3_000)` — the restart-wait timeout IS the 3,000 ms budget, so a slow
    restart fails the `waitFor` itself; ALSO explicitly asserts `restartMs <= 3000` and
    `p99 <= 30ms` (AC-2 P2's own budget, "main p99 unchanged vs AC-2").
  - **Repeated kills past the restart budget (degraded path, mechanism only).** Uses shortened
    `supervision` timers (`restartBudget: 2`, `restartWindowMs: 5_000`, `restartDelayMs: 50`,
    `heartbeatIntervalMs: 200`, `missedHeartbeatsBeforeRestart: 2`, `degradedRescanIntervalMs: 300`,
    `degradedRecoveryDelayMs: 700`) — a real constructor option, not a mock. Asserts
    `degradations === 1`.
- Files: same three harness/spec/perf files as ST-2.

## Execution

Rule followed before every run: `(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? {
$_.CommandLine -match 'jest-worker|run-executor' }).Count` was 0.

### Mechanism (`--runInBand`, twice)

`npx jest --config libs/backend/platform-electron/jest.config.ts --runInBand --testPathPatterns workspace-watch-host.stress.spec.ts`

| Run | Result   | ST-2 batches/overflow/changed/dropped | ST-2 loop p50/p99/max (ms) | AC-7 kill restartMs / overflowA / overflowB | AC-7 kill loop p50/p99/max (ms) | AC-7 degraded restarts/degradations/overflowTotal |
| --- | -------- | ------------------------------------- | -------------------------- | ------------------------------------------- | ------------------------------- | ------------------------------------------------- |
| 1   | 3 passed | 3 / 1 / 2 / 8,800                     | 15.88 / 19.48 / 35.36      | 892 / 1 / 1                                 | 15.88 / 20.87 / 645.40          | 3 / 1 / 7                                         |
| 2   | 3 passed | 3 / 1 / 2 / 8,800                     | 15.88 / 24.13 / 32.78      | 948 / 1 / 1                                 | 15.84 / 16.35 / 683.15          | 3 / 1 / 7                                         |

Logs: `D:\projects\ptah-437-backup\b15r-mechanism-final1.log`, `b15r-mechanism-final2.log`.

### Perf (`PTAH_PERF_SPECS=1`, `--runInBand`, twice)

`PTAH_PERF_SPECS=1 npx jest --config libs/backend/platform-electron/jest.config.ts --runInBand --testPathPatterns workspace-watch-host.stress.perf.spec.ts`

| Run | Result   | ST-2 (75k) delete ms / batches / dropped | ST-2 loop p50/p99/max (ms) vs budget (≤30/≤100) | AC-7 restartMs vs budget (≤3,000) | AC-7 loop p99 (ms) vs budget (≤30) |
| --- | -------- | ---------------------------------------- | ----------------------------------------------- | --------------------------------- | ---------------------------------- |
| 1   | 2 passed | 20,493 / 3 / 82,500                      | 15.86 / **18.55** / **26.56** — PASS            | 902 — PASS                        | **20.07** — PASS                   |
| 2   | 2 passed | 21,544 / 3 / 82,500                      | 15.84 / **19.58** / **36.14** — PASS            | 905 — PASS                        | **17.68** — PASS                   |

Logs: `D:\projects\ptah-437-backup\b15r-perf-final1.log`, `b15r-perf-final2.log`. (Two earlier
identical-shape perf runs, `b15r-perf-run1.log`/`run2.log`, were taken before the prettier pass
relabeled line numbers; numbers were unchanged, p99 19.28-19.32 ms, max 22.13-23.20 ms.)

RSS (KB) across all 4 perf/mechanism ST-2 runs, before/peak/after: 64,768-65,136 / 69,540-71,976 /
60,632-71,664 — never `null`/"not sampled" (`rssMonitorErrors` was 0 in every run).

### git-watcher backport verification (coordinator item 5)

- Command (mechanism, unaffected by the fix — no in-process delete change to what it measures
  besides the same event-loop metric): `npx jest --config apps/ptah-electron/jest.config.ts --runInBand --testPathPatterns git-watcher.stress.spec.ts` → 2 passed, ST-1 p99/max 16.88/39.45 ms, ST-1b
  p99/max 17.02/30.87 ms — unaffected, confirming the backport did not change mechanism behaviour.
- Command (perf, `PTAH_PERF_SPECS=1 npx jest --config apps/ptah-electron/jest.config.ts --runInBand --testPathPatterns git-watcher.stress.perf.spec.ts`), twice:

| Run | Result   | ST-1 loop p50/p99/max (ms) vs AC-1 (≤50/≤200) | ST-1b loop p50/p99/max (ms) vs AC-2 P1 (≤100/≤500) |
| --- | -------- | --------------------------------------------- | -------------------------------------------------- |
| 1   | 2 passed | 15.93 / **16.64** / **24.76** — PASS          | 15.91 / **16.72** / **34.24** — PASS               |
| 2   | 2 passed | 15.95 / **16.57** / **24.18** — PASS          | 15.93 / **16.67** / **32.95** — PASS               |

This is the first time this task's own `test-report-b6.md` "Pending" note ("the 75,000-file
`PTAH_PERF_SPECS=1` budgets are NOT yet measured on an idle machine") is closed with numbers: both
AC-1 and AC-2 (P1) pass comfortably on this machine, out-of-process-delete rig included. Logs:
`D:\projects\ptah-437-backup\b15r-gitwatcher-perf-run1.log`, `b15r-gitwatcher-perf-run2.log`.

### Batch verification

- `npx nx run-many -t test -p @ptah-extension/platform-electron ptah-electron --parallel=1 -- --maxWorkers=2` — header confirmed "2 projects" (+ 6 build-dependency tasks). platform-electron: 36
  of 38 suites passed (2 skipped — the perf spec without the flag, plus one pre-existing skip),
  616 passed / 4 skipped / 3 todo of 623. ptah-electron: 45 of 47 suites passed (2 pre-existing
  skips), 603 passed / 6 skipped of 609. Exit 0. Log: `b15r-batch-test-final.log`.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-electron ptah-electron --parallel=1` — exit 0, 0 errors (12 pre-existing warnings across both projects, none introduced by this
  batch — verified individually below). Log: `b15r-batch-typecheck-lint.log`.
- `npx eslint` run individually on every touched file
  (`workspace-watch-host.stress.spec.ts`, `.stress.perf.spec.ts`, `.stress.harness.ts`,
  `workspace-watch-host-rss-sampler.js`, `git-watcher.stress.harness.ts`) — 0 errors, 0 warnings on
  all five.
- `npx prettier --check`/`--write` on every touched file (the two spec files, the harness, the JS
  fixture, this report) — all now prettier-clean.
- Failures across every run in this batch (both submissions): none.

## A1 resolution, restated for honesty (review item 12a)

**Design-level answer**, unchanged from the first submission: the native subscription does not need
to survive a Windows buffer overflow, because `WorkspaceWatchHostCore` never tries to keep one that
reported an error — every native error sets `rebuildRequested`/`overflowOnSettle`, releases the
subscription, awaits the release, subscribes again, and signals `overflow` twice.

**What is and is not confirmed, stated without hedging this time:**

- **NOT confirmed:** a real Windows `ReadDirectoryChangesW` buffer overflow. No run of this suite —
  not the 8,000-file mechanism runs, not the 75,000-file perf runs, across BOTH submissions of this
  batch — has ever produced a `nativeErrorDiagnosed: true` reading. `@parcel/watcher`'s Windows
  backend simply has not been observed to hit that specific native failure at these volumes on this
  machine.
- **Confirmed, but at a different layer:** the native-error → rebuild path IS exercised —
  by `workspace-watch-host-core.spec.ts`'s fake-engine unit tests (which inject the error
  deterministically) and by THIS batch's AC-7 tests (a killed host process is a different, but
  consumer-equivalent, total loss of the native subscription: the supervisor's own overflow +
  restart path, not the host-internal rebuild path, but observably the same "one overflow, then
  resumed delivery" contract from a subscriber's point of view).
- **The parallel this batch's own codebase already lived through:** on Linux, `@parcel/watcher` was
  found to silently under-report — new directories listed without ever invoking the `error`
  callback (`parcel-bundler/watcher#243`, fixed by the `CreatedDirectoryReconciler`). The Windows
  design answer here assumes the OPPOSITE failure mode is impossible — that Windows always raises a
  catchable error on overflow — and that assumption has not been independently tested.
- **How to force it later (follow-up, not attempted this batch):** (1) shrink `@parcel/watcher`'s
  internal native buffer via a build-time flag, if the library exposes one; (2) inject a fake at the
  native-binding boundary that simulates the OS-level overflow condition directly, rather than
  relying on file-count volume to trigger it probabilistically; (3) run the mass-delete at a much
  higher file count / faster delete rate on a machine known to reproduce the OS condition (Windows
  Server, different antivirus posture) and see if `nativeErrorDiagnosed` ever flips true.

## AC-7 composite path — open risk (review item 12b)

`workspace-watch-host-core.ts`'s own documented design sends TWO `overflow` signals for an in-host
rebuild (native error, refused subscribe, storm-end with unreconciled creates): one when the loss is
detected, one once the rebuilt subscription is live. If a real native-level loss is ALREADY mid-
rebuild at the exact moment the whole host PROCESS is killed, the supervisor's own process-failure
path (`onHostFailure`) signals a FURTHER, independent overflow on top. `WorkspaceWatchBatchRelay`'s
`overflowOwed` flag is a boolean, not a counter, so two overflows only collapse into one delivered
batch if they land in the SAME 250 ms coalescer flush window — two overflows in different flush
windows would deliver as two separate `overflow: true` batches for what a consumer would call "one
incident".

This batch's AC-7 tests never exercise this composite case: their temp trees are small and the kill
is a clean external `SIGKILL` with no native-level loss in flight. **"Exactly one overflow" is
proven for a bare kill only.** Recommended follow-up: a spec that forces a fake native error inside
the host core (using the same fake-engine seam `workspace-watch-host-core.spec.ts` already has)
immediately before killing the whole host process, to pin whether the "exactly one overflow"
contract holds under the composite case or needs a documented exception in the port's own doc
comment.

## AC-2 (P2) and AC-7 status

- **AC-2 (P2) mechanism — PROVEN**, and now to the STRENGTH the comment always claimed: bounded
  batches (3, not thousands, `< 100`), one `overflow`, delivery resumed, and `changedPaths +
droppedTotal >= fileCount` on every run (8,802 ≥ 8,000; 82,502 ≥ 75,000).
- **AC-2 (P2) perf (p99 ≤ 30 ms, max ≤ 100 ms) — MET.** p99 18.55-19.58 ms, max 26.56-36.14 ms
  across 2 perf runs (this revision) plus 2 earlier runs at 19.28-19.32 ms / 22.13-23.20 ms — 4
  consecutive passing runs total.
- **AC-7 mechanism — PROVEN, for a bare kill.** Restart happens well inside a generous timeout
  (892-948 ms observed, no numeric assertion in CI per R-P11), exactly one overflow per subscriber
  for a bare-kill incident, resubscription and resumed delivery confirmed, degraded path (budget
  exhausted → `isDegraded` → one degradation report → rescan cadence → recovery) confirmed with
  real kills and shortened timers. The composite native-loss+kill case is NOT proven — see above.
- **AC-7 perf — MET.** Restart 902-905 ms (≤ 3,000 ms budget), p99 17.68-20.07 ms (≤ 30 ms budget),
  across 2 perf runs.
- **git-watcher.stress.perf.spec.ts (backported fix) — NOW PASSES on an idle machine, both AC-1 and
  AC-2 (P1),** closing `test-report-b6.md`'s long-standing "Pending" item for that spec.

## Not executed

- Linux CI run of any of these files (environment is win32 this session). No Windows-only
  assumption is asserted as a MUST: RSS reading branches on `process.platform` in the ONE shared
  `workspace-watch-host-rss-sampler.js`, and every mechanism assertion is the platform-neutral
  `IWorkspaceWatcher` contract every adapter already runs through `runWorkspaceWatcherContract`.
- The composite native-loss + process-kill overflow scenario (see above) — a follow-up, not run.
- Forcing a genuine Windows `ReadDirectoryChangesW` overflow — see "A1 resolution" above.

## Verdict

- Criteria proven: A1 (design-level, explicitly NOT claimed beyond that), AC-2 (P2) mechanism AND
  perf, AC-7 mechanism AND perf for a bare kill, R-P10 (RSS recorded, `null` when not sampled,
  never a misleading fallback), R-P11 (mechanism-always/perf-gated as separate FILES, matching the
  sibling convention).
- Criteria not proven / open:
  - The literal Windows `ReadDirectoryChangesW` native overflow path — still unconfirmed by direct
    observation, explicitly stated as such in both the spec header and this report.
  - AC-7's "exactly one overflow" under the composite native-loss+kill case — untested, documented
    as an open risk with a concrete follow-up spec idea.
  - Linux has not run any of these files yet.
- Risks a reader should know about:
  - The recurring ~600-680 ms event-loop-delay MAX spike on every AC-7 host restart (present in
    every run, both submissions) is attributable to `child_process.fork`/`spawn` creating the
    replacement host process (`uv_spawn` doing real synchronous work on the calling loop thread on
    Windows) — it is INSIDE AC-7's measured window by design (the restart itself is what is being
    proven), never shown by ST-2 (which forks its one host BEFORE the measured window opens). It
    never affected p99 in any of the 8 AC-7 runs across both submissions (16.35-24.89 ms observed,
    always ≤ 30 ms).
  - A follow-up (FU-15a) is now open: `git-watcher.stress.harness.ts` and
    `workspace-watch-host.entry.spec.ts` still duplicate the forked-host-wrapper/tree-builder shape
    this harness also has; see "Shared-helper decision" above for why this batch did not merge them.
  - `libs/backend/platform-electron/tsconfig.spec.json` gained `"allowJs": true` — a small,
    project-scoped change (not `project.json`/`package.json`) needed so `ts-jest` can transform the
    new `.js` RSS-sampler fixture without a warning; it adds no newly-type-checked file, since the
    project's own `"include"` list still has no `.js` glob.

## CI evidence and the third revision

CI run 34922130353 (`main`, ubuntu, `nx run ptah-electron:test --coverage --maxWorkers=2`) failed
`git-watcher.stress.spec.ts` ST-1b:

```
expect(rig.batchLog).toHaveLength(1)  — received 2:
[{"at":...,"overflow":false,"paths":29,"truncated":false},{"at":...,"overflow":true,"paths":0,"truncated":false}]
```

Orchestrator diagnosis (correct product behaviour, not a defect): on a loaded Linux runner the
recursive delete can start below the storm threshold, so the first ~29 paths legitimately leave as
a normal (non-overflow) batch before the flood pushes the coalescer into the storm — the 1 s
leading hold only absorbs a LONE leading event on a fast machine, not a small batch on a slow one
(FU-11h residual: "timed 1 s hold residual risk on very slow machines").

### 1. `git-watcher.stress.spec.ts` — relaxed to the bounded mechanism (CI, always-on)

`apps/ptah-electron/src/services/git-watcher.stress.spec.ts:82-146` (ST-1b). Replaced the strict
`toHaveLength(1)`/`toMatchObject`/`cycles.every(... >= deleteEndedAt)`/`toHaveLength(1)` shape with:

1. At most ONE non-overflow batch before the overflow.
2. Exactly ONE overflow batch.
3. No batch after the overflow.
4. At most one refresh cycle before the overflow; exactly one at-or-after it.
5. Exactly one truncated content push (unchanged).
6. `directoryUpdates === 0` (unchanged).

The header comment cites CI run 34922130353 and FU-11h directly. Verified idle-machine, twice,
`--runInBand`:

| Run | Result   | ST-1 (unaffected)                 | ST-1b batches/overflow/cycles           | ST-1b loop p50/p99/max (ms) |
| --- | -------- | --------------------------------- | --------------------------------------- | --------------------------- |
| 1   | 2 passed | 0 batches, loop 16.06/19.15/42.40 | 1 batch (overflow, at +5999ms), 1 cycle | 16.11/17.01/37.95           |
| 2   | 2 passed | 0 batches, loop 16.09/16.66/38.24 | 1 batch (overflow, at +5976ms), 1 cycle | 16.06/16.79/33.39           |

On this idle machine both runs still produced the "ideal" 1-batch/1-cycle shape (the relaxed bounds
were not exercised at the edge here), which is expected and consistent with the diagnosis: the
CI failure was a LOADED-machine timing effect, not something an idle local run reproduces on
demand. The new assertions still pass this shape (a single overflow batch trivially satisfies
"at most one non-overflow batch before it" with zero, and "exactly one refresh at-or-after it").

### 2. `git-watcher.stress.perf.spec.ts` — resolved: strict form scoped to 8,000 files, bounded form added for 75,000 (FU-15b)

The first attempt at this item added the strict AC-2 assertion to the EXISTING 75,000-file ST-1b
test and it failed reproducibly (documented in the previous revision of this section, kept below as
history). Orchestrator decision, now implemented:

1. **Strict AC-2 mechanism, scoped to 8,000 files** — a NEW test,
   `apps/ptah-electron/src/services/git-watcher.stress.perf.spec.ts:75-95` ("ST-1b (8,000 files):
   strict AC-2 mechanism"), builds the SAME tree size Batch 11 actually measured and asserts exactly
   what Batch 11 proved: `expect(rig.batchLog).toHaveLength(1)`,
   `toMatchObject({ overflow: true, paths: 0 })`, `expect(rig.refreshCycles()).toHaveLength(1)`.
2. **Bounded AC-2 mechanism, at the acceptance table's own 75,000-file tree** —
   `apps/ptah-electron/src/services/git-watcher.stress.perf.spec.ts:97-149` (ST-1b, FU-15b):
   `overflowBatches.length <= 3`, `nonOverflowBatches.length <= 1` (the CI rule's own pre-storm
   tolerance), `cycles.length <= overflowBatches.length + 1`, `batches.length < 10`,
   `truncatedContentPushes.length <= overflowBatches.length` — plus the existing ms budgets
   (unchanged). The measured numbers (3 and 2 overflow batches from the investigation, 1 in both of
   this revision's confirmation runs) and the cause are recorded in the test's own comment
   (`:126-136`).

**Root cause, confirmed from these runs' own logs (not assumed):** `rig.warnLines` — populated from
every non-`info` `WorkspaceWatcher` diagnostic the adapter emits, including `native-error` and any
`host restarted`/rebuild notice — was `[]` (empty) in ALL FOUR 75,000-file perf runs across both
this revision and the investigation revision. That rules out a native-engine error and a
supervisor-level host restart as the cause. `maxStormMs` (30,000 ms default,
`event-storm-breaker.ts:51,87`) is also ruled out: the measured window is the delete (~8.3-8.7 s)
plus the 10 s settle, ~18-19 s total, never reaching 30 s. What remains, and what the timestamps in
the investigation revision's `batchLog` directly show, is the coalescer's storm `quietMs` (2,000 ms
default, `event-storm-breaker.ts:49,86`): the investigation run's three overflow batches landed at
+9,131 / +13,710 / +16,782 ms — gaps of 4,579 ms and 3,072 ms, both well over the 2 s quiet window —
and the two-batch run's gap was 8,760 ms. A 75,000-file delete's OS-level event delivery is
apparently bursty enough, over the ~8+ second delete plus the 10 s settle, to leave a quiet gap
longer than 2 s between bursts often enough that the breaker exits and re-enters one or two more
times before the window closes — `EventStormBreaker`'s own doc comment (`:25-30`) states plainly
that a storm exits "after `quietMs` without events," which is exactly what a multi-second gap inside
one long delete triggers. This revision's own two confirmation runs got only 1 overflow batch each
(no re-entry), consistent with the cause being gap-timing-dependent rather than a fixed count — the
bounded assertion (`<= 3`) is sized from the worst case actually observed (3), not a guess.

**FU-15b (recorded, not resolved this batch):** storm re-entry during a very long delete can produce
2-3 refreshes at 75,000 files instead of the "exactly one" the design intends for a single incident.
Possible later tuning: scale the storm's `quietMs` with how long the storm has already run (a
longer-running storm tolerates a longer quiet gap before concluding the incident is over), or expose
`quietMs` as a per-subscription option so a consumer expecting very large deletes can raise it. Not
in scope for this batch.

Verified, idle machine, `--runInBand`, twice:

| Run | Result   | ST-1b (8k) strict       | ST-1b (75k) bounded — batches/overflow/cycles                                                    | ST-1b (75k) loop p50/p99/max (ms) vs budget (≤100/≤500) |
| --- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 1   | 3 passed | 1 batch, 1 cycle (PASS) | 1 batch / 1 overflow / 1 cycle, 0 non-overflow, warnLines=[] (PASS, within ≤3/≤10/≤1/≤+1 bounds) | 15.93 / 16.76 / 30.13 — PASS                            |
| 2   | 3 passed | 1 batch, 1 cycle (PASS) | 1 batch / 1 overflow / 1 cycle, 0 non-overflow, warnLines=[] (PASS)                              | 15.93 / 16.68 / 34.54 — PASS                            |

Logs: `D:\projects\ptah-437-backup\b15r3-gitwatcher-perf-run1.log`, `b15r3-gitwatcher-perf-run2.log`.
(Investigation-revision logs, showing the 3-batch and 2-batch cases the bounds are sized from:
`b15r2-gitwatcher-perf-run1.log`, `b15r2-gitwatcher-perf-run2.log`.)

### 3. `workspace-watch-host.stress.spec.ts` — checked for the same speed dependence; NOT changed

Reviewed every exact-equality assertion in the Batch 15 mechanism/perf specs for the same "leading
batch escapes before the storm enters" hazard:

- ST-2 (`runMassDeleteStorm`, both mechanism and perf): already tolerant — `batches < 100` and
  `changedPaths + droppedTotal >= fileCount` are bounds/floors, not exact-length assertions on
  `batchLog`. A leading non-overflow batch splitting off under load would not fail either check.
- AC-7 single-kill (`runSingleKillScenario`, both files): `overflowA === 1` / `overflowB === 1` are
  exact, but this scenario has NO mass file storm in flight — the two temp roots are empty, and the
  one overflow is the supervisor's own process-failure signal after a real `SIGKILL`, not a
  coalescer racing a delete's arrival speed. This is the same mechanism AC-7's own header already
  documents as "proven for a bare kill" (a different axis from the git-watcher timing issue).
- AC-7 degraded path (`runDegradedPastBudgetScenario`): uses a `>` (strictly-more) comparison for
  the rescan-cadence check, already load-tolerant by construction (more overflows under load only
  makes the inequality MORE true, never less).

**Conclusion: no split was needed here.** Re-verified with a fresh mechanism run (below) after the
two coordinator follow-ups.

### 4. Two additional review follow-ups (delta review: APPROVE HIGH, with these follow-ups)

- **Harness `runDegradedPastBudgetScenario` hand-rolled `throw`** — `workspace-watch-host.stress.harness.ts` (the rescan-cadence check). Replaced the `if (!(recorder.overflowBatches() > overflowAtDegraded)) throw ...` with two new
  `DegradedPathResult` fields, `overflowAtDegraded` and `overflowAfterCadenceWait`, returned instead
  of asserted; the spec now does `expect(result.overflowAfterCadenceWait).toBeGreaterThan(result.overflowAtDegraded)`
  in `workspace-watch-host.stress.spec.ts` (the degraded-path `it`), matching every other check.
- **Coverage: exclude the `.js` fixture** — `libs/backend/platform-electron/jest.config.ts` gained
  `coveragePathIgnorePatterns: ['/node_modules/', 'workspace-watch-host-rss-sampler\\.js']`,
  following the precedent in `libs/frontend/core/jest.config.ts`. Verified with a full coverage run
  (`npx jest --config libs/backend/platform-electron/jest.config.ts --coverage --maxWorkers=2`):
  exit 0, `Branches: 87.2% (1261/1446)` — well above the 75% gate. A separate scoped run confirmed
  `workspace-watch-host-rss-sampler.js` no longer appears as a row in the per-file coverage table at
  all. Log: `b15r2-coverage-run.log` / `b15r2-coverage-run2.log` (text-summary reporter).

### Verification for the third revision (CI evidence + review follow-ups)

- `git-watcher.stress.spec.ts` ×2 (idle, `--runInBand`) — both passed (table above).
- `git-watcher.stress.perf.spec.ts` ×2 (`PTAH_PERF_SPECS=1`, idle, `--runInBand`) — both FAILED on
  the new strict mechanism assertion only; ms budgets still passed both times (table above). This
  was the open finding, resolved in the fourth revision below.
- `workspace-watch-host.stress.spec.ts` ×1 (idle, `--runInBand`) — 3 passed, including the new
  `overflowAfterCadenceWait > overflowAtDegraded` assertion (`overflowAtDegraded=3`,
  `overflowAfterCadenceWait=5`). Log: `b15r2-wwh-mechanism-run1.log`.
- `npx nx run-many -t test -p @ptah-extension/platform-electron ptah-electron --parallel=1 -- --maxWorkers=2` — header "2 projects" (+ 6 build deps). platform-electron 36/38 suites (2
  skipped: perf spec without flag, one pre-existing), 616/623 passed. ptah-electron 45/47 suites (2
  pre-existing skips), 603/609 passed. Exit 0 — the perf spec's new failure does NOT affect this
  gate (it only runs under `PTAH_PERF_SPECS=1`, which this command does not set). Log:
  `b15r2-batch-test.log`.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-electron ptah-electron --parallel=1` — exit 0, 0 errors (same pre-existing warnings as before, none new). Log:
  `b15r2-batch-typecheck-lint.log`.
- `npx prettier --check`/`--write` on every file touched this revision — clean.
- `npx eslint` on every file touched this revision — 0 errors, 0 warnings.

### Verification for the fourth revision (git-watcher perf split + FU-15b resolution)

- `git-watcher.stress.perf.spec.ts` ×2 (`PTAH_PERF_SPECS=1`, idle, `--runInBand`) — BOTH runs now
  3 passed, 0 failed (ST-1, ST-1b strict 8k, ST-1b bounded 75k). Both 75,000-file runs this time
  produced 1 overflow batch / 1 cycle / 0 non-overflow / `warnLines=[]` — comfortably inside the new
  bounds. Logs: `b15r3-gitwatcher-perf-run1.log`, `b15r3-gitwatcher-perf-run2.log`.
- `git-watcher.stress.spec.ts` ×1 (idle, `--runInBand`) — 2 passed (ST-1, ST-1b), unaffected by the
  perf-file-only change. Log: `b15r3-gitwatcher-mech-run1.log`.
- `npx nx run-many -t typecheck,lint -p ptah-electron --parallel=1` — exit 0, 0 errors (same 4
  pre-existing warnings, none new). Log: `b15r3-typecheck-lint.log`.
- `npx prettier --check`/`--write` and `npx eslint` on `git-watcher.stress.perf.spec.ts` — clean.

## Files

- `D:\projects\ptah-437\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host.stress.harness.ts` — NEW, the rig.
- `D:\projects\ptah-437\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host-rss-sampler.js` — NEW, the one RSS-reading implementation.
- `D:\projects\ptah-437\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host.stress.spec.ts` — REWRITTEN, mechanism only.
- `D:\projects\ptah-437\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host.stress.perf.spec.ts` — NEW, perf only, `PERF_ENABLED`-gated.
- `D:\projects\ptah-437\libs\backend\platform-electron\tsconfig.spec.json` — MODIFIED, `allowJs: true`.
- `D:\projects\ptah-437\libs\backend\platform-electron\jest.config.ts` — MODIFIED (this revision), `coveragePathIgnorePatterns` excludes the `.js` fixture.
- `D:\projects\ptah-437\apps\ptah-electron\src\services\git-watcher.stress.harness.ts` — MODIFIED, `deleteInChildProcess` added and used by `deleteAndSettle` (coordinator item 5 backport).
- `D:\projects\ptah-437\apps\ptah-electron\src\services\git-watcher.stress.spec.ts` — MODIFIED (third revision), ST-1b relaxed to the bounded mechanism (CI evidence, FU-11h).
- `D:\projects\ptah-437\apps\ptah-electron\src\services\git-watcher.stress.perf.spec.ts` — MODIFIED
  (third revision, then fourth): ST-1b's strict AC-2 assertion moved to a NEW 8,000-file test; the
  original 75,000-file ST-1b test gained a bounded overflow/refresh assertion instead (FU-15b) — see
  "CI evidence and the third revision", section 2.
- Logs: `D:\projects\ptah-437-backup\b15r-mechanism-final1.log`, `b15r-mechanism-final2.log`,
  `b15r-perf-final1.log`, `b15r-perf-final2.log`, `b15r-gitwatcher-perf-run1.log`,
  `b15r-gitwatcher-perf-run2.log`, `b15r-batch-test-final.log`, `b15r-batch-typecheck-lint.log`
  (first revision); `b15r2-gitwatcher-mech-run1.log`/`run2.log`, `b15r2-gitwatcher-perf-run1.log`/
  `run2.log` (the investigation that found the 75,000-file gap: 3 and 2 overflow batches),
  `b15r2-wwh-mechanism-run1.log`, `b15r2-coverage-run.log`/`run2.log`, `b15r2-batch-test.log`,
  `b15r2-batch-typecheck-lint.log` (third revision); `b15r3-gitwatcher-perf-run1.log`/`run2.log`,
  `b15r3-gitwatcher-mech-run1.log`, `b15r3-typecheck-lint.log` (fourth revision, the resolution —
  both perf runs 3/3 passed). Earlier logs from the first submission (`b15-*.log`,
  `b15r-mechanism-run1.log`/`run2.log`, `b15r-perf-run1.log`/`run2.log`) are kept for history; the
  `b15r3-*` logs are the ones this final revision's numbers are drawn from.
