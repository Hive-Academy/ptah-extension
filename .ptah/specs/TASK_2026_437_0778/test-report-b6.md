# Test Report - TASK_2026_437_0778 (Batch 6)

> Status: the first-run sections below record the original AC-1/AC-2 failures and are kept as
> evidence. The fix and the final passing results are in "Final results" at the end of this report,
> which supersedes the first-run verdict.

## Scope

- User request: prevent a repeat of the 2026-09-14 freeze caused by mass-deleting agent
  worktrees, and make the app tolerate high file-system churn without unbounded main-thread work.
- Criteria tested (`implementation-plan.md` AC table + "Tests that pin the incident"):
  - **AC-1** (ST-1): recursive delete under `.claude-worktrees/` — main event-loop delay p99 ≤ 50 ms,
    max ≤ 200 ms over delete + 10 s (perf); 0 `git status` spawns and 0 renderer pushes attributable
    to the delete (CI).
  - **AC-2 P1** (ST-1b): same tree under a non-excluded `pkgs/big/` — p99 ≤ 100 ms, max ≤ 500 ms
    (perf); storm entered once, exactly 1 status refresh + 1 truncated content push after quiet (CI).
  - **AC-4** (push rate during any storm): `file:content-changed` ≤ 2/s, `git:status-update` ≤ 1 per
    2 s — implied by AC-2's "exactly 1" mechanism count and checked as part of it.
- Regressions covered: this IS the regression test for the 2026-09-14 incident (unbounded per-event
  main-thread work during a mass worktree delete). It pins the fix at the `GitWatcherService` +
  `GitInfoService` seam using the REAL production code, not mocks.
- Review findings covered: n/a (Batch 6 is a new test file, not a fix to reviewed code).
- Deliberately not tested (scope decisions, both logged up front, not discovered after the fact):
  1. **`WorkspaceFileIndexService` over a real `ElectronFileSystemProvider`.** The plan's "Tests
     that pin the incident" section names this as part of the ideal end-to-end shape. It is left
     out here because (a) `batches.md` Task 6.1 lists exactly one file to create
     (`git-watcher.stress.spec.ts`); (b) AC-1/AC-2/AC-4's mechanism counts (git status spawns,
     `git:status-update`/`file:content-changed` push counts, storms-entered) are all
     `GitWatcherService` state — the file index's own INV-6 storm mechanism ("10,000 events in 1s →
     exactly one path-only rebuild") is already pinned end-to-end in
     `workspace-file-index.service.spec.ts` (Batch 4, real-shaped fake watcher); (c) standing up
     `WorkspaceFileIndexService`'s full real dependency graph (`WorkspaceIndexerService`,
     `IgnorePatternResolverService`, `FileTypeClassifierService`, `TokenCounterService`,
     `IWorkspaceProvider`, plus `ElectronFileSystemProvider` itself) for this one test would
     duplicate that existing coverage without adding a new invariant.
  2. **The two ablations from inventory question I1** (exclude-only vs single-flight-only, "logged,
     not asserted" per the plan). Each would cost a full extra tree-build + delete + 10 s settle;
     right-sizing the suite to the two asserted scenarios given the batch's own scope. Not run.
  3. **ST-2** (`workspace-watch-host.stress.spec.ts`, the P2 `@parcel/watcher`-as-worker host) — out
     of scope for this batch; P2 does not exist yet (Batch 8/9).

## Suites

### `GitWatcherService — incident stress tests ST-1 / ST-1b (TASK_2026_437)` — integration

- Requirement: a real `GitWatcherService`, arming a real recursive `fs.watch` over a real temp git
  repository, must cost the main thread nothing when the churn is confined to an excluded directory,
  and must degrade to exactly one bounded refresh when it is not.
- Real collaborators used (per the plan's "real services" instruction, not mocks):
  - Real `GitWatcherService` and real `GitInfoService`, constructed exactly as production does.
  - A `CountingProcessSpawner` implementing the real `IProcessSpawner` port — it does not mock git,
    it spawns the real `git.exe` via `child_process.spawn` and counts every request, so
    `GitInfoService`'s actual git invocations are observed rather than stubbed.
  - A real `git init` temp repository (`os.tmpdir()`, never under the repo) with `user.email`/
    `user.name` configured so `git status` runs unattended.
  - Real `fs.watch` (via `GitWatcherService.start`), not a fake filesystem.
- Cases:
  - **ST-1** — 10 synthetic worktree checkouts (each holding a `.git` pointer FILE, matching the
    2026-09-14 shape) totalling `TOTAL_FILES` files, built under `.claude-worktrees/` BEFORE the
    watcher arms (so construction itself is not measured), then deleted with
    `fs.promises.rm({recursive:true,force:true})` while the watcher is live. Asserts 0 `git status`
    spawns, 0 spawns of any kind, 0 `git:status-update`/`file:content-changed` pushes, and that the
    storm breaker was never even entered (it is filtered upstream of the breaker).
  - **ST-1b** — the identical tree under `pkgs/big/`, a directory nothing excludes. Asserts the
    storm entered exactly once, exited exactly once, exactly 1 `git status` spawn, exactly 1
    `git:status-update` push, and exactly 1 `file:content-changed` push with `truncated: true`.
  - Both cases: event-loop delay is measured with `perf_hooks.monitorEventLoopDelay` across the
    delete + a 10 s settle window; p99/max are asserted only under `PTAH_PERF_SPECS=1` (AC-1/AC-2
    budgets), matching the `off-thread-process-spawner.perf.spec.ts` precedent already in this repo
    (env-gated `describe`, mechanism always-on).
  - CI mechanism tree size: 8,000 files (matches the plan's "CI mechanism run uses an 8,000-file
    tree"). Perf tree size: 75,000 files (matches the acceptance table).
- Files: `D:\projects\ptah-437\apps\ptah-electron\src\services\git-watcher.stress.spec.ts`

## Execution

- Command run (CI mode, 8,000-file tree, mechanism assertions):
  `cd D:\projects\ptah-437 && npx nx run-many -t test -p ptah-electron --testPathPattern=git-watcher.stress`
  — header confirmed "Running target test for project ptah-electron and 5 tasks it depends on" (the
  project's own worker-build dependency chain; the suite itself is 1 project as instructed).
- Result (two independent runs, same machine, both under heavy concurrent load from parallel
  TASK_2026_437 batches sharing this worktree — see "Environment" below):
  - Run 1: `Test Suites: 1 failed, 1 skipped, 43 passed, 44 of 45 total` / `Tests: 2 failed, 4
skipped, 584 passed, 590 total`. Both failures inside `git-watcher.stress.spec.ts` (ST-1, ST-1b).
    Every other project spec (43 suites, 584 tests) passed, including Batch 4's own
    `git-watcher.service.spec.ts` in the same process.
  - Run 2 (after adding diagnostic logging, no assertion changes): same two failures, same shape.
  - `PTAH_PERF_SPECS=1` run (75,000-file tree): completed after the report below was first drafted
    (see "Perf run" — it returned, just very late, under the same contention). Same two failures,
    WORSE leak counts at the larger tree size. Details there.
- Failures — **both are product findings, not test defects.** Evidence from the tests' own
  diagnostic `console.log` lines (kept in the spec, see comments there), reproduced on two
  independent runs:

  **AC-1 / ST-1 — FAILS.** Expected 0 `git status` spawns and 0 renderer pushes; measured exactly 1
  of each, on both runs:
  - Run 1: `spawner calls: [rev-parse, status, diff --cached --numstat, diff --numstat]` — one
    COMPLETE `computeGitInfo` cycle — with `warnLines: []` (the storm breaker was never entered).
  - Run 2: `spawner calls: [rev-parse, status]` — the same leaked cycle, but `git status` apparently
    exited non-zero this time (no numstat calls followed) — again with `warnLines: []`.
  - In both runs the entire delete is confined to `.claude-worktrees/`, which is excluded by
    `NESTED_WORKSPACE_PATH_RULES` at any depth (`workspace-scan.constants.ts:132`), and the storm
    breaker is never touched — so this is not a storm-threshold problem, it is a single event that
    slipped past `isIgnoredWorkspaceEvent` entirely and reached `scheduleUpdate` directly.
  - Root cause (analysis, not proven with a debugger): `GitWatcherService.isIgnoredWorkspaceEvent`
    (`git-watcher.service.ts:549-562`) returns `false` — i.e. "not excluded" — whenever `filename` is
    not a string:
    ```ts
    private isIgnoredWorkspaceEvent(filename: string | null): boolean {
      if (typeof filename !== 'string') return false;
      ...
    }
    ```
    Node's own `fs.watch` documentation is explicit that `filename` is "not always guaranteed to be
    provided" even on platforms that usually supply it, and recommends "some fallback logic if it is
    null." A mass delete of thousands of files in one burst is exactly the kind of event that can
    produce a `null`-filename notification (a coalesced/overflow marker on the watched root, or on
    `.claude-worktrees` itself, rather than a per-file rename). Because the exclusion check can only
    say "not excluded" for such an event, it reaches `onWorkspaceEvent`'s normal path and schedules a
    `git status` refresh — exactly the single, bounded leak measured. It is bounded (one event, one
    refresh, never a storm) so it is NOT a repeat of the unbounded 2026-09-14 freeze, but it is a
    real gap in the "0 spawns, 0 pushes" invariant AC-1 asserts.

  **AC-2 P1 / ST-1b — PARTIALLY FAILS.** The storm mechanism itself is correct: `enteredCount === 1`,
  `exitedCount === 1`, and the storm-exit refresh does happen (one full `[rev-parse, status,
diff --cached, diff]` cycle, one `git:status-update`, one truncated `file:content-changed` — the
  exact shape the plan specifies). But `spawner.statusCallCount()` measured **2**, not 1, on both
  runs — the SAME leaked rev-parse/status pair from ST-1 rides alongside the correct storm-exit
  cycle:
  - Run 2 (full trace captured): `delete took 2215ms for 8000 files; spawner calls:
[rev-parse, status, diff --cached --numstat, diff --numstat, rev-parse, status]; warnLines:
["[GitWatcher] event storm entered", "[GitWatcher] event storm exited"]`.
  - This confirms the leak is independent of the storm breaker (which fired exactly once, correctly)
    — the same "unfilterable event" gap identified for ST-1 also reaches the non-excluded tree,
    where it is simply harder to see because it is masked by the also-correct storm refresh.
  - Because the leaked cycle's `git status` call did not error identically both times (full cycle in
    one run, short-circuited in the other), the leaked event's exact timing relative to the storm is
    not fully pinned — but its SIGNATURE (a bare `rev-parse`+`status` pair, zero storm-warn lines
    attributable to it) is identical across all three occurrences observed (ST-1 run 1, ST-1 run 2,
    ST-1b run 2), which is strong evidence of one systematic cause rather than three unrelated
    flakes.
  - Per instruction, this assertion was **not weakened**. `statusCallCount()` still asserts `1`, and
    the test fails honestly against real, reproduced behaviour.

- Not executed: the AC-1/AC-2 absolute ms budgets themselves (p99/max). The perf run DID complete
  (177.2 s test time / 207.6 s suite time) — see "Perf run" below for why the ms numbers still were
  not produced even though the run finished.

## Environment (why two CI-mode runs took 43 s and 104 s of TEST time but 90 s and ~45 min of WALL

time respectively)

This worktree (`D:\projects\ptah-437`) is shared, per the batch brief, with Batches 7, 12, 13, 14
running concurrently on other files. Process inspection during the second CI run showed 30-50 `node.exe`
processes alive system-wide (jest workers from sibling batches' own `nx run-many` invocations in both
`D:\projects\ptah-437` and `D:\projects\ptah-extension`), sustained CPU at ~74-80%, and this batch's own
`nx.js run-many` process accruing only ~2 s of CPU time across a 30+ minute wall-clock window — i.e. the
process was alive and not deadlocked, just almost entirely starved of scheduler time. Jest's own
"Test Suites… Time: 43-127s" figures (measured from inside the test process) are internally
consistent with a normal run; the wall-clock gap is entirely this repo's own concurrent load, not a
defect in the spec.

This directly bears on the perf run: the `off-thread-process-spawner.perf.spec.ts` precedent this
spec follows is explicit that absolute-ms budgets are only meaningful "on a QUIET machine" — a
machine sustaining ~80% CPU from unrelated sibling batches is the opposite of that precondition, so
even if the perf run had returned in time, its numbers would not be trustworthy evidence for AC-1/AC-2's
ms budgets. This is disclosed rather than glossed over.

## Perf run

Command: `PTAH_PERF_SPECS=1 npx nx run-many -t test -p ptah-electron --testPathPattern=git-watcher.stress`
(75,000-file tree, both ST-1 and ST-1b, `monitorEventLoopDelay` p99/max asserted against AC-1 (≤50 ms
p99 / ≤200 ms max) and AC-2 P1 (≤100 ms p99 / ≤500 ms max)).

**This run completed** (`git-watcher.stress.spec.ts ... 177.206 s`, suite total 207.594 s) — it just
took roughly 45 minutes of WALL time to be scheduled any CPU at all under the sustained sibling-batch
contention described above, which is why it initially looked hung. Result: the same two mechanism
failures as the CI run, WORSE at 75,000 files than at 8,000:

- **ST-1** (`.claude-worktrees/`, excluded): **2 complete leaked `computeGitInfo` cycles** (16→8
  spawner calls: `[rev-parse, status, diff --cached, diff]` twice), `spawner.statusCallCount() === 2`
  (expected 0), `warnLines: []` (the storm breaker still never engaged). At 8,000 files one run
  measured a full leaked cycle and the other a short-circuited one (2 calls); at 75,000 files BOTH
  leaked cycles ran to completion. The leak count roughly tracks tree size rather than staying
  constant at exactly one, which is more consistent with an ONGOING source of stray events during the
  delete (e.g. Windows Search indexing or antivirus touching the newly created 75,000 files shortly
  after `buildCheckoutTree` writes them, with their own change notifications arriving during the
  watcher's armed window) than with a single one-off "overflow marker" event. The `filename` !==
  `string` gap in `isIgnoredWorkspaceEvent` (see AC-1 analysis above) is still the mechanism by which
  ANY such stray event evades exclusion — this run does not change that diagnosis, it changes the
  estimate of how often it fires.
- **ST-1b** (`pkgs/big/`, non-excluded): delete of 75,000 files took 9,706 ms. `warnLines` shows
  `enteredCount === 1` but `exitedCount === 2` — `EventStormBreaker.poll` is documented to return
  `'exited'` "exactly once per storm," so two exit lines against one entry line is itself notable and
  not just a duplicate of the ST-1 leak; spawner shows **3** complete `[rev-parse, status,
diff --cached, diff]` cycles (one `worktree list` mixed in from the deferred `refreshNestedRepoRoots`
  call), i.e. 3 `git status` spawns where exactly 1 is expected.
- **Perf assertions were never reached in either test.** Both tests throw at the FIRST mechanism
  `expect(...)` (Jest's `expect` throws synchronously on failure), which sits BEFORE the
  `if (PERF && histogram) { ... }` block in the test body. The histogram itself was enabled and
  disabled correctly around the delete + settle window (that code runs before the mechanism
  assertions), so the event-loop-delay DATA exists in-process, but the code that reads
  `histogram.percentile(99)`/`histogram.max` and asserts AC-1/AC-2's ms budgets is unreachable while
  the mechanism assertions fail first. **This is deterministic given the current leaked-event defect,
  not a matter of waiting longer or a flaky environment** — rerunning under `PTAH_PERF_SPECS=1` again
  will reproduce the same "no ms numbers" outcome until the mechanism failures are fixed. Recorded as
  a follow-up: reorder the test body (capture and log p99/max BEFORE the mechanism `expect`s) so a
  future perf run reports numbers regardless of mechanism pass/fail — not done here to avoid a further
  multi-run wait cycle under the same contention.
- **No p99/max numbers for AC-1/AC-2 are reported.** Not fabricated, not estimated. Given the CI and
  perf mechanism runs both found the same reproducible product defect, a ms budget would in any case
  describe a fix that has not landed yet — rerun once the leaked-event fix is in, on an otherwise-idle
  machine (the ~80% sustained CPU from sibling batches during this run would itself invalidate any ms
  figure even if one had been produced).

## Verdict

- Criteria proven:
  - The storm-breaker mechanism itself is correct under real load: `EventStormBreaker` enters exactly
    once and exits exactly once for a non-excluded 8,000-file delete (ST-1b `enteredCount`/
    `exitedCount`), and the exit produces exactly the one correctly-shaped refresh cycle
    (`git status`, two numstat diffs, one `git:status-update`, one truncated
    `file:content-changed`) the plan specifies. This is the part of INV-6/AC-4 that matters most —
    the original incident's UNBOUNDED per-event storm does not reproduce.
  - `NESTED_WORKSPACE_PATH_RULES` exclusion works for every event that carries a filename: across
    both 8,000-file ST-1 runs, only ONE event per run slipped through despite thousands of file
    creates/deletes under `.claude-worktrees/` during tree construction and the delete itself.
- Criteria not proven:
  - **AC-1 (CI mechanism half) — FAILS.** 0 spawns / 0 pushes is not what the real services produce;
    1 of each is measured, reproducibly, from an event that bypasses `isIgnoredWorkspaceEvent`
    because it carries no filename.
  - **AC-2 P1 (CI mechanism half) — FAILS on the spawn count.** The storm-exit refresh is correct
    (1 push each), but total `git status` spawns is 2, not 1, for the same reason as AC-1.
  - **AC-1 / AC-2 perf halves (p99/max ms budgets, 75,000-file tree) — NOT MEASURED**, even though
    the perf run completed. The test throws at its mechanism assertion before reaching the histogram
    read — see "Perf run".
- Risks a reader should know about:
  - The leaked-event gap is a real product defect, and the 75,000-file run shows it is **NOT bounded
    to exactly one event**: leak counts went from 1 (8,000 files, one run) / a short-circuited 1
    (8,000 files, the other run) to 2 complete cycles (75,000 files, ST-1) and 3 complete cycles
    (75,000 files, ST-1b) — i.e. it scales with tree size / delete duration rather than staying fixed.
    `GitWatcherService.isIgnoredWorkspaceEvent` (`git-watcher.service.ts:549-562`) treats a
    `filename === null`/non-string `fs.watch` event as "not excluded" rather than "unknown — treat
    conservatively," and the scaling behaviour is more consistent with an ONGOING source of such
    events during a large delete (plausibly Windows Search / antivirus touching the 75,000 freshly
    created files, generating their own notifications that arrive while the watcher is armed) than
    with one one-off overflow marker. It is still NOT a repeat of the 2026-09-14 freeze — each leaked
    event produces one bounded refresh via the normal debounce path, never an unbounded storm — but at
    scale it is no longer "one shell-out you might not notice," it is a handful. Recommend routing a
    non-string-`filename` event through the SAME path a storm counts (increment the breaker, do not
    schedule from it directly) as the smallest fix, or at minimum logging one line per occurrence so a
    future incident attributable to it is diagnosable.
  - Because the mechanism assertions throw before the perf block runs, this spec as written can NEVER
    report AC-1/AC-2 ms numbers while the leaked-event defect is open, even given unlimited perf-run
    time. Fixing the assertion order (log/assert perf numbers before the mechanism expects) is a
    worthwhile follow-up so the next `PTAH_PERF_SPECS=1` run is not silent on that axis.
  - This spec's two failing tests are therefore CORRECT — they pin the defect. They must not be
    "fixed" by loosening the assertions; the fix belongs in `git-watcher.service.ts`.
  - Perf numbers for AC-1/AC-2 are outstanding. The environment this batch ran in cannot produce a
    trustworthy figure; rerun on an idle machine, ideally after the leaked-event fix lands so the
    number describes the shipped behaviour.
  - `A worker process has failed to exit gracefully and has been force exited` appeared in both runs.
    Given every `afterEach` calls `svc.stop()` (clearing all `GitWatcherService` timers/watchers) and
    `fs.rmSync` the temp tree, and 43-45 OTHER suites in the same Jest run exited cleanly, this is
    most likely one of the two failing tests' real spawned `git.exe` children (via
    `CountingProcessSpawner`) not being force-killed on the FAILING assertion path — `afterEach` calls
    `svc.stop()` but the spec never explicitly kills in-flight spawner children. Worth a follow-up if
    the leaked-event fix does not make the warning disappear on its own.

## Final results (supersedes the first-run verdict)

### Root cause of the original AC-1 / AC-2 failures

Four causes, found by the Batch 4 follow-up and the spec rework:

1. **Null filenames (product).** libuv watches a tree on Windows with a 4 KB `ReadDirectoryChangesW`
   buffer. On overflow it calls back once with a NULL filename. `isIgnoredWorkspaceEvent` treated a
   null filename as "not excluded", so each overflow scheduled a refresh. Fixed in
   `git-watcher.service.ts`: a null-filename event counts toward the storm breaker but schedules
   nothing. It sets an unattributed pending change; the next refresh or a storm entry clears it,
   else one safety refresh runs after 30 s of quiet.
2. **ST-1b tree had `.git` pointer files (test).** The first ST-1b tree reused the worktree shape,
   so nested-repo detection excluded most of `pkgs/big/` and the test did not measure a plain
   non-excluded tree. ST-1b now builds the tree without `.git` pointers.
3. **Spec counter reset (test).** Counters were reset before the watcher had settled after arming
   over the freshly written tree. The arm-phase event trail could enter a storm whose "entered" line
   fell before the reset while its exit and refresh fell inside the measured window (the first
   75,000-file run: 1 entered, 2 exited). The harness now resets only after `watcherIdle()`
   (including the unattributed-change timer), no live git child, and no new spawn or push have held
   for 3 s.
4. **NTFS directory echo (product).** Our own `git status` touches directories, and NTFS reports
   directory metadata `change` events for them, which re-scheduled a refresh. Fixed: while a
   watcher-started `git status` runs, and for 1 s after it, a directory `change` event is stat'ed and
   dropped (marked unattributed). The state is reset in `stop()` and tied to `armGeneration`.

### ST-1b invariants — relaxed but strict

ST-1b no longer requires "storm entered exactly once". Under CPU starvation a fast recursive delete
can reach the watcher as a few unnamed overflow events plus a trickle of named ones, and the breaker
then correctly never reaches 500 events/s. Storm entry depends on OS delivery and scheduling, so it
cannot be guaranteed. What the test still requires, whichever way the OS delivers the delete:

1. No refresh starts before the delete has finished.
2. Exactly one refresh cycle (counted by its first spawn, the `rev-parse` probe; at most one
   `git status`) and exactly one status push for the whole incident. The change is never lost and
   never refreshed twice.
3. At most one content push; when a storm was entered, exactly one, and it is truncated.
4. A storm, if entered, was entered and exited exactly once.
5. If nothing refreshed inside the 10 s window, unnamed events must have been seen (only an
   overflow-shaped delivery may defer to the 30 s safety refresh).

The pre-fix defect (a leaked extra refresh per unnamed event) fails invariant 2.

### Final idle-machine counts (8,000-file CI mechanism tree)

| Scenario | Named / unnamed events | Refreshes | Status pushes | Content pushes | Storm entered / exited | Loop delay p50 / p99 / max |
| -------- | ---------------------- | --------- | ------------- | -------------- | ---------------------- | -------------------------- |
| ST-1     | 8,110 / 1              | 0         | 0             | 0              | 0 / 0                  | 15.4 / 17 / 67 ms          |
| ST-1b    | 7,628 / 2              | 1         | 1             | 1 (truncated)  | 1 / 1                  | 15.5 / 33 / 71 ms          |

- Earlier idle runs: ST-1 p99 20 ms and 18 ms; ST-1b p99 24 ms and 24 ms.
- Saturated-CPU reproduction (whole project suites in parallel): ST-1b 5,498 named / 13 unnamed
  events, p99 40 ms, max 266 ms; all invariants held.
- AC-1 mechanism: 0 `git status` spawns, 0 spawns of any kind, 0 pushes, breaker never entered.
- AC-2 P1 mechanism: exactly 1 refresh, 1 status push, 1 truncated content push, storm 1/1.
- The 8,000-file loop-delay figures are logged, not asserted. They are already inside the AC-1
  (p99 50 / max 200 ms) and AC-2 P1 (p99 100 / max 500 ms) budgets, but at 8,000 files, not 75,000.

### Commit-time verification (team-leader)

- `npx nx test ptah-electron --maxWorkers=2` on 2026-09-14, started with no other jest/nx test
  process on the machine: 47 suites (45 passed, 2 skipped), 615 tests (609 passed, 6 skipped),
  exit 0. `git-watcher.stress.spec.ts` ran and passed; `git-watcher.stress.perf.spec.ts` skipped
  (no perf flag).

### Pending

- **The 75,000-file `PTAH_PERF_SPECS=1` budgets (`git-watcher.stress.perf.spec.ts`) are NOT yet
  measured on an idle machine.** The only perf run so far was the first-run one above, under heavy
  contention and before the fix. Run it on an idle machine and record p99/max here.

### Files

- `D:\projects\ptah-437\apps\ptah-electron\src\services\git-watcher.stress.spec.ts` — mechanism
  specs (always on).
- `D:\projects\ptah-437\apps\ptah-electron\src\services\git-watcher.stress.perf.spec.ts` — 75,000-file
  budgets behind `PTAH_PERF_SPECS=1`.
- `D:\projects\ptah-437\apps\ptah-electron\src\services\git-watcher.stress.harness.ts` — shared rig
  (real `GitWatcherService` + `GitInfoService`, counting spawner, real `fs.watch`).
