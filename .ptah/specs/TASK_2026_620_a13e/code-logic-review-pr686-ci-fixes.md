# Code Logic Review - PR #686 CI / Sonar fixes (TASK_2026_620)

Scope: uncommitted `git diff` (22 files) on `feat/task-620-memory-skills-bench-s3 @ 8fce2f435`, plus `pr686-ci-sonar-fixes-report.md`. Read-only; no tests run (orchestrator ran them).

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 2 |
| Moderate | 3 |

## Per-focus verdicts

### 1. MODEL_DISPATCH_PROVENANCE_TAP no-op registration - OK (minor notes)
- `libs/backend/agent-sdk/src/lib/di/register.ts:148` `registerInstance(TOKEN, noOp)` inside `registerSdkServices`, the single composition entry for VS Code/Electron/CLI. No second registration site in libs/apps (grep: only `register.ts`, the runner's `@inject(..., {isOptional:true})` at `sdk-query-runner.service.ts:292`, and the bench).
- Record mode: `memory-skills-host.ts:338` does `container.register(TOKEN, {useValue: collector})` after boot (tsyringe: last registration wins), and `doubles-override.ts:75-96 attachProvenanceTap` assigns `runner.provenanceTap` on the live singleton. The runner already holds the no-op (constructor param property), `'provenanceTap' in runner` is true either way, so the override still works. No ordering problem. Replay mode now carries the no-op instead of null: harmless.
- Production behaviour change (minor): `scheduleProvenance` (`sdk-query-runner.service.ts:491-527`) used to return at `!tap`; now, for every curator/skill-lane dispatch with a route, it runs `getActiveProviderId(authEnv)` and queues a microtask calling a no-op. Cost is negligible and wrapped in try/catch. Accept; mention in the PR. (Alternative: give di-lint an optional-token allowlist, but the no-op is fine.)

### 2. Spec expectation changes

**liveness.suite.spec.ts - the new expectation is the truth, not a masked 620 regression.**
- Curator on this branch records `failed` and keeps observations: `memory-curator.service.ts:760-766` (`recordError`), `boot-scan-runner.ts:305-335` (failed -> ledger, stop below the item), `curator-window-runner.ts:216`. Introduced by 2521773ad / aae3e441a / a181ab1b2, all ancestors of HEAD; none touched by 620 (the merge diff `9bba84b23..HEAD` for the curator only adds the pause gate).
- The suite's own invariants (`liveness.suite.ts:26-28,253,312,376`) are "failed call must not report `ran`, input stays unprocessed, watermark stays below the failed session". New observed values satisfy exactly those (3 of 3 unprocessed, watermark = first input `< failedMtime`, outcomes `ran, failed` because the scan stops at the first failure). `b-zero-drafts` still fails, which is the genuine remaining gap. The suite is correctly reporting that product defects (a), (c), (d) were fixed upstream.
- Residual (Moderate): stale wording. Test title still says "records fault modes (a)-(d) as failing today" (`liveness.suite.spec.ts:~301`), and the suite header/doc comments describe a/c/d as "expected to fail today". The frozen baseline (`faults.passRate 0, ranPassesWithError 3`) in the plan/ground-truth is now historic; deltas (+0.75 / -3) are correct as "change since freeze" but the freeze record should be annotated, otherwise a reader sees a 620 benchmark claiming a product improvement it did not make. Update title/comment.

**funnel-lifecycle.spec.ts - SERIOUS: the new expectation is a calendar time bomb and the stated reason is wrong.**
- `funnel-backlog.ts:151` adds a weekly tick when `new Date(start).getUTCDay() === 0`; `start` derives from `base = next UTC midnight after clock.now()` (`:113`) and the clock is installed at real `Date.now()` (`funnel-port.ts:35`, comment "starting at the real instant"). Spec uses no fake time (grep: no `setSystemTime`).
- So ticks for a 2-day window = 192 + 2 nightly (+1 weekly iff the window contains a UTC Sunday). CI ran Fri Oct 9 (window Sat, Sun) -> 195. Any run on Fri or Sat gives 195; Sun-Thu gives 194. The old `2*96+2` failed on Fri/Sat; the new `2*96+3` will fail on the other five days of the week. No "end-of-window daily-tier drain" exists in the code; the report's explanation is a guess.
- Not a 620 product regression (bench-only), but the fix replaces one flaky assertion with the mirror-image flaky assertion.

### 3. sample-sessions.ts Linux fix - OK with a small TOCTOU note
- `isWithin` (`:226-242`): when either path is drive-qualified it uses `path.win32` with lower-case folding on every host. On win32 `win32 === path`, so behaviour is identical to before (lowercase + relative). On Linux, non-drive paths take the old POSIX branch unchanged; mixed (drive target vs POSIX root) yields "not within", same as before. Fine.
- mtime: using `stat(source).mtimeMs` for the copy's `modifiedAt` (`:322-332`) matches Windows behaviour (`copyFile` preserves mtime there) and fixes the Linux "everything is after freeze" classification. Moderate: the source is stat'ed after the copy+re-scan, so a source touched between copy and stat shifts the window classification (conservatively to excluded), and size/hash/mtime no longer come from one snapshot. Prefer `utimes` on the copy then re-stat it, or stat before copy.

### 4. S2871 / S4036 - OK
- All 22 swaps are string arrays (`Object.keys`, ids, paths, markers, session ids, lines); `compareCodeUnits` (`utils/compare-code-units.ts`) uses `<`/`>` which is UTF-16 code-unit order, identical to default `.sort()`. No remaining `.sort()` in `memory-skills` non-spec files. No number/object sort was altered.
- S4036: `git` only; `getGitExecutable()` is the existing shared resolver (`utils/git-executable.ts`, honours `GIT_PATH`, validates once with `--version`, cached). No new PATH lookups elsewhere. Args/timeouts unchanged. Behaviour deltas to note (Minor): (a) resolver failure now throws a different message before the first git call; (b) `createGitTreeReader` (`select-rubric-sample.ts:603`) resolves eagerly at construction instead of at first call, so constructing a reader without git available now throws (no call site in the repo besides tests, so low risk); (c) win32 requires a `.exe` on PATH (existing resolver policy). `run-memory-skills.entry.ts:44` line exceeds prettier width (format only).

### 5. Fix 4 (Electron e2e not 620-caused) - NOT SUPPORTED; likely 620-caused (SERIOUS)
- The lane's mechanism ("tab switch calls refresh() on reopen") does not fit this flow: `thoth-shell.component.ts:302-307 selectTab` returns early when `tabId === activeTab()`, and `thothActiveTab` persists in `AppStateManager` across leaving Thoth (`app-state.service.ts:711,1069`), so `ui.openTab('gateway')` re-clicking the already-active tab fetches nothing. The report cited a doc comment, not this path.
- The spec explicitly relies on the first open recording `_hasLoadedOnce` so the second `ngOnInit -> refreshIfNeeded()` is a no-op (spec comment, `message-handlers-eager.spec.ts:~190`). This branch (not main) changed `ThothStatusService.refresh()` to also await `refreshPaused()` before setting `_hasLoadedOnce` (`thoth-status.service.ts:271-290`, diff vs origin/main). `refreshPaused` calls `memory:getTriggers` and `skillSynthesis:getSettings`, which this e2e does NOT mock (only `gateway:*`), so they hit the real backend with `READ_MS` timeouts. If either is slow/pending the first refresh has not set `_hasLoadedOnce` when the test closes and reopens Thoth; the reopen then refetches `gateway:status` (mock baseline `0`) and clobbers the push (`2`) - exactly the observed `Expected "2", Received "0"` at line 240.
- The diff vs origin/main shows `apps/ptah-electron-e2e` untouched, and `thoth-status.service.ts` / `thoth-shell.component.ts` modified by the branch's pause-switch work (155748828), so "outside 620 scope" is unproven. Needs evidence (main CI result for this spec, or a local single-spec run), not inference.

## Findings

| # | Sev | File:line | Issue |
| --- | --- | --- | --- |
| 1 | Serious | `suites/skills/funnel-lifecycle.spec.ts:197`, `funnel-backlog.ts:113,151`, `funnel-port.ts:35` | `195` only holds when the 2-day window includes a UTC Sunday; depends on real run date. Wrong rationale. |
| 2 | Serious | `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:271-290` (+ e2e `message-handlers-eager.spec.ts:240`) | `refresh()` now blocks `_hasLoadedOnce` on two un-mocked RPCs; plausible 620-caused e2e failure; Fix 4 conclusion unverified. |
| 3 | Moderate | `liveness.suite.spec.ts` title / `liveness.suite.ts:26-28` | Stale "failing today" wording; frozen baseline now historic - annotate. |
| 4 | Moderate | `data/sample-sessions.ts:322-332` | mtime from a later separate stat; not a single snapshot. |
| 5 | Moderate | `select-rubric-sample.ts:603`, `run-memory-skills.entry.ts:44` | Eager exe resolution at construction; line over prettier width. |
| 6 | Minor | `agent-sdk/.../register.ts:148` | Production now executes `scheduleProvenance` work for every curator/lane dispatch (no-op). Acceptable; document. |

## Must-fix before accepting
1. Replace the hard-coded `2 * 96 + 3` with a value computed from the simulated window (count UTC Sundays among the days from `base`, or install a fixed start via fake time / `installSimulatedClock(fixedMs)`), and correct the comment. Same for any other backlog assertion that depends on weekday.
2. Resolve Fix 4 with evidence: check whether `message-handlers-eager.spec.ts` passes on origin/main CI and/or run that single e2e spec locally. If this branch is the cause, decouple `refreshPaused()` from the `refresh()` `Promise.all`/`_hasLoadedOnce` gate (fire it independently, keep `generation` guard) or mock `memory:getTriggers` and `skillSynthesis:getSettings` in the spec. Do not mark the e2e "not 620" until then.
3. Update the liveness spec title and suite comments to say (a), (c), (d) now pass because the curator was fixed upstream (2521773ad/aae3e441a/a181ab1b2); annotate the frozen baseline as historic.

Nice to have: take the sample-sessions mtime from a pre-copy stat or `utimes` the copy; run prettier on `run-memory-skills.entry.ts`.

## Five logic questions (brief)
1. Silent failure: funnel tick assertion passes/fails by calendar, not by behaviour; e2e failure attributed to the wrong cause.
2. User action: re-opening Thoth quickly after first open while pause RPCs are pending refetches and overwrites a pushed gateway status.
3. Input data: run date (Sunday in window) flips the tick count.
4. Dependency failure: slow/unmocked `memory:getTriggers` / `skillSynthesis:getSettings` now gate `_hasLoadedOnce`; git missing now fails at resolution.
5. Missing: no Linux run of sample-sessions was evidenced; freeze-baseline annotation.

---

# Round 2

Verdict: **APPROVE** (score 7/10). No must-fix items; two optional notes. Read-only; tests not run (orchestrator ran them).

## (1) Funnel tick count - resolved
- `funnel-port.ts:35` `installFunnelClock(startAt = Date.now())` with a finite check; `funnel.suite.ts` takes an optional `installClock` seam (default `installFunnelClock`), used at both install sites (`:315`, `:383`). Production behaviour unchanged.
- Spec pins Fri 2100-01-01 12:00Z (window Sat+Sun, weekly tick, `2*96+3`=195) and Sun 2100-01-03 12:00Z (window Mon+Tue, `2*96+2`=194). Jan 1 2100 is a Friday; `base` = next UTC midnight, so both expectations are right by the `getUTCDay()===0` rule at `funnel-backlog.ts:151`. Both weekday cases are now covered, not just one.
- Remaining `Date.now()` in `funnel-host-graph.ts:476`, `funnel-host-port.ts:389,549` run under the simulated clock inside the suite, so they follow the pinned start. Per-run unique `runDir` avoids cross-run residue. The far-future start is forward of any pre-existing singleton, so no time going backwards.
- Note (minor): the spec's `clockStartAt` is mutable shared state set in a loop; fine for a serial spec.

## (2) refreshPaused decoupled - OK
- `thoth-status.service.ts:277` `void this.refreshPaused()`, removed from the `Promise.all`. `refreshPaused` (`:317-336`) uses `Promise.allSettled` over two async methods, so no unhandled rejection; the only non-settled path is the early Electron branch, which cannot throw. A failed read keeps the last flag.
- Staleness: `++pausedGeneration` per call, results dropped if not newest, so an older slow call cannot overwrite a newer one. Overlapping `refresh()` calls each start one; the guard covers it. The shell's focus / `onPausedChange` calls share the same counter.
- Badges still update: `refreshPaused` still runs on every `refresh()` and on shell events, only no longer awaited. Trade-off: `await refresh()` can resolve before the badges settle; harmless for UI, but any test asserting `summary().paused` right after `await refresh()` would need to await `refreshPaused` (lead reports 26/26 passing).
- New spec (`thoth-status.service.spec.ts:219-263`) holds both pause RPCs unresolved, awaits `refresh()`, asserts `hasLoadedOnce()` true and gateway available, pushes a status, calls `refreshIfNeeded()`, and asserts `gatewayRpc.status` called once and 2 running adapters kept. That directly proves the primary load and `_hasLoadedOnce` do not wait on the pause reads and that the reopen path does not refetch. This fixes the mechanism I identified for the e2e failure.
- Optional: the spec leaves the deferreds unresolved; resolving them at the end (and asserting `summary().paused`) would also prove the badges still update once the reads settle.
- Caveat: the Electron e2e was not re-run; the causal link is now supported by code and a unit test, not by a green e2e. Confirm on CI.

## (3) Liveness wording - resolved
- `liveness.suite.ts` header and `liveness.suite.spec.ts` header, test titles and comments now say (a), (c), (d) pass via 2521773ad / aae3e441a / a181ab1b2, (b) still fails, baseline is historic, deltas mean change since freeze. No remaining "failing today" text in either file. No known-failures list is coupled to these liveness case ids (grepped).

## Residual from round 1 (unchanged, non-blocking)
- sample-sessions source-mtime stat taken after copy (Moderate); eager git resolution in `createGitTreeReader` and an over-width line in `run-memory-skills.entry.ts:44` (format only).
