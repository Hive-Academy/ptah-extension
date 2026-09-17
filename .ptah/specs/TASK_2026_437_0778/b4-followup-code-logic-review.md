# Code Logic Review — `TASK_2026_437_0778` Batch 4 follow-up (Batch 6 stress-failure fix)

Scope: `apps/ptah-electron/src/services/git-watcher.service.ts` (diff vs HEAD),
`apps/ptah-electron/src/services/git-watcher.service.spec.ts` (diff vs HEAD),
`apps/ptah-electron/src/services/git-watcher.stress.spec.ts` (untracked, read whole).
Reviewed against `implementation-plan.md` components 3/5, INV-1/INV-2/INV-5/INV-6, AC-1/AC-2,
`test-report-b6.md` (the failures this follow-up claims to fix), `b4-code-logic-review.md`
(base + delta), and `apps/ptah-electron/CLAUDE.md`.

Executed `npx nx test ptah-electron --testPathPattern=git-watcher` from `D:\projects\ptah-437`
(shared worktree, Batches 7/12/13/14 running concurrently on other files, per the brief) TWICE:

- **Run 1**: `594/599 passed, 1 failed`. Every deterministic unit spec in
  `git-watcher.service.spec.ts` (including all new null-filename and own-refresh-echo cases) is
  green, but `git-watcher.stress.spec.ts › ST-1b … (AC-2 P1)` **failed**: `enteredCount` expected
  `1`, received `0` — the storm was never entered at all for a real, non-excluded 8,000-file
  delete, so `exitedCount`/`statusCallCount`/pushes never fired either.
- **Run 2** (isolated re-run, `--testPathPattern=git-watcher.stress` alone, ~110 s later):
  `595/599 passed, 0 failed` — ST-1 and ST-1b both green.

So this is **not a deterministic failure of the mechanism the fix is supposed to prove** — it
flaked once and passed once. That is consistent with `test-report-b6.md`'s own documented finding
that this exact worktree/timeframe carries heavy, CPU-starving contention from sibling batches
(30-50 concurrent `node.exe` processes, ~74-80% sustained CPU from unrelated work), which can
plausibly suppress or delay the real `fs.watch` event delivery ST-1b depends on to cross the storm
threshold. It does **not** rule out a genuine, load-sensitive interaction either — the null-event/
storm-breaker changes in this diff (Failure modes 2-3 below) give a real mechanism by which heavy
concurrent load could make the real events arrive too sparsely, or too coupled with unrelated
excluded-directory noise, to reliably trip the breaker. **This is downgraded from a blocking
"the fix doesn't work" finding to a serious "the fix's own proof is flaky under the load this
worktree is known to carry, and the diff has independently-identified mechanisms that could explain
why" finding** — see Serious issues.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 3              |
| Moderate issues     | 3              |
| Failure modes found | 5              |

## Five logic questions

### 1. How does this fail silently?

- A real directory-level `change` event that lands inside the 1 s own-refresh echo window
  (`ownRefreshEchoUntil`, `git-watcher.service.ts:717-720,742-758`) is dropped with **no**
  compensating signal — no `pendingCauses` entry, no unattributed-change fallback, nothing. Compare
  this to the null-filename path, which is _also_ "might be noise, might be real" but gets a 30 s
  safety net (`noteUnattributedChange`, `:770-799`). The directory-echo path gets none. A decoration
  can go stale with zero trace that anything was suppressed.
- A `git status` run for a just-torn-down workspace that resolves _after_ `switchWorkspace`/`stop()`
  still executes its `finally` block (`:1174-1182`) and writes `ownRefreshEchoUntil = Date.now() +
1000` on the (reused) `GitWatcherService` instance — see Failure mode 4. The next real directory
  event for the **new** workspace, arriving within that stray second, is silently treated as an echo
  of a status run that has nothing to do with it.

### 2. What user action produces unexpected behaviour?

- An agent or user editing a file inside a subdirectory _while_ `git status` is running (which, on
  an active workspace, is close to "most of the time" under churn, since `OWN_REFRESH_ECHO_MS`
  extends the window every time a refresh completes) can have that edit's directory-level `change`
  notification dropped outright if no _other_ signal (a `rename`, a different file's `change`)
  happens to also fire in the same window. See Failure mode 1.
- Deleting a large, non-excluded tree (the ST-1b shape) apparently now produces **zero** refreshes
  in the run performed for this review — see the test result above and Failure mode 5. If this
  reproduces outside the loaded worktree, a real, user-visible mass edit under a non-excluded
  directory could leave the git decorations stale indefinitely (until an unrelated event happens to
  push a debounce/max-wait through).

### 3. What input data produces a wrong answer?

- A `null`-filename event and a directory-level `change` event are both "the watcher cannot prove
  this is real," but they are scored oppositely: null counts toward the **shared, global**
  `stormBreaker` (`:684-696`) even when it originates from inside an **excluded** directory (the
  breaker has no concept of "this burst is confined to `.claude-worktrees`"); a same-uncertainty
  directory echo is scored as **definitely not real** and dropped. Neither choice is unreasonable in
  isolation, but sharing one global breaker between "definitely-excluded-directory noise" and
  "definitely-not-excluded real churn" means a burst of unattributable null events from an excluded
  mass delete can push the _same_ counter that gates real, non-excluded work into `storming`,
  delaying or coalescing legitimate refreshes elsewhere in the workspace for the storm's duration.
  Bounded (one refresh, not unbounded), but it is a correctness compromise the plan/executor notes
  do not mention.

### 4. What happens when a dependency fails?

- `fs.promises.stat` throwing inside `scheduleUnlessDirectoryEcho` (`:746-753`) is caught and treated
  as "not provably an echo," so the event is scheduled — the conservative, correct choice.
  Confirmed the `stat` never runs synchronously and never runs outside the echo window (the storm
  breaker gates `scheduleUnlessDirectoryEcho` before it can be reached — see Data flow step 4) —
  hunt point 1's INV-1 concern does **not** reproduce; this part is sound.
- `GitInfoService.refreshGitInfo` rejecting inside `fetchAndPush`'s unchanged outer `try/catch`
  (`:1166-1194`) still logs and returns — but the `finally` around the _inner_ try (`:1175-1182`)
  runs regardless, so `ownRefreshesInFlight`/`ownRefreshEchoUntil` bookkeeping stays correct even on
  a failed run. Good.

### 5. What is missing that the requirements never mentioned?

- No lifecycle reset of `ownRefreshesInFlight`/`ownRefreshEchoUntil` in `stop()` (unlike
  `gitMarkerSeenDuringStorm` and the new `clearUnattributedChange()`, both of which _are_ reset
  there, `:487-490`). See Failure mode 4.
- No fallback/logging when a directory-echo event is dropped (`scheduleUnlessDirectoryEcho`
  returns silently at `:755`) — no counter, no debug line, nothing a future incident investigation
  could use to attribute a stale decoration to this path. Contrast with the null-filename path's own
  module-doc-level care about exactly this kind of gap.
- No test — unit or stress — exercises "a storm is active when the 30 s unattributed-change safety
  timer fires," which per the code as written (`enterStorm` at `:892-903` does not call
  `clearUnattributedChange()`) can fire an _extra_ `fetchAndPush` independent of the storm's own
  exit refresh. See Failure mode 3.

## Failure modes

### 1. Directory-level echo drop has no fallback, unlike the structurally identical null-filename case

- Trigger: a real file change inside a subdirectory lands as a directory-level `change` event (the
  documented Windows/NTFS behaviour cited in the module doc, `:179-184`) while `mayBeOwnRefreshEcho()`
  is true (a `git status` run is in flight, or finished < 1 s ago).
- Symptom: `scheduleUnlessDirectoryEcho` (`:742-758`) `stat`s the path, finds a directory, and
  returns — no `scheduleUpdate`, no `scheduleContentChange`, no `noteUnattributedChange`, no log.
  The decoration for that change is not scheduled by this event at all.
- Evidence: `git-watcher.service.ts:717-720` (routing into the echo path), `:754-755` (silent drop).
- Current handling: none. The design intentionally treats "directory change" as proof-of-echo
  because "adding, removing or renaming a child reports a `rename` for the child itself" (comment at
  `:736-740`) — true for a _create/delete/rename_, but the review brief's own hunt point 2 names the
  gap this claim does not cover: a rapid burst under load can coalesce a child's own notification away
  while the parent's `change` survives, and `git status` itself running (which is precisely when this
  path activates) is exactly the kind of I/O-heavy, high-latency moment where notification coalescing
  is most likely.
- Recommendation: give this path the same treatment as the null-filename path — on a dropped
  directory echo, call `noteUnattributedChange(now)` instead of a bare `return`, so a genuinely lost
  signal is still covered by the existing 30 s safety net instead of being covered by nothing.

### 2. Shared global storm breaker lets excluded-directory noise gate non-excluded work

- Trigger: a mass delete under an excluded directory (the actual 09-14 shape) produces enough
  `null`-filename events to cross `enterEventsPerWindow` on `this.stormBreaker` (shared with every
  other, non-excluded event), while real, non-excluded churn is also happening elsewhere in the
  workspace.
- Symptom: the non-excluded churn's events, arriving while the breaker is `storming` because of the
  excluded-directory noise, are suppressed exactly like real storm events — `record()` returns
  `'storming'` and the per-event path does nothing (`:707-715`) — even though nothing about the
  non-excluded churn itself was excessive.
- Evidence: `git-watcher.service.ts:684-696` (null events recorded on the same `this.stormBreaker`
  used for named events at `:707`); `EventStormBreaker` (`event-storm-breaker.ts`) has one counter
  per instance, no per-source partitioning.
- Current handling: none — this is a direct consequence of routing null events into the same
  breaker as named events, which is new in this diff (previously null events bypassed the breaker
  entirely and scheduled directly, which was the Batch 6 defect).
- Recommendation: acceptable for P1 as a bounded (one coalesced refresh, not unbounded) trade-off,
  but worth a one-line doc note next to `stormBreaker`'s declaration — a future reader tuning
  `PTAH_WATCH_STORM_*` should know the breaker mixes excluded-origin noise with real churn.

### 3. An unattributed-change safety refresh can fire independently of, and in addition to, an active storm's own exit refresh

- Trigger: a null-filename event arrives outside a storm, arming the 30 s
  `unattributedChangeTimer`; before that timer fires, enough events (of any kind) push the breaker
  into `storming`; the storm is still active when the 30 s timer elapses (plausible since
  `UNATTRIBUTED_QUIET_MS` and the breaker's default `maxStormMs` are both 30 s — coincidentally the
  same order of magnitude).
- Symptom: `armUnattributedChangeTimer`'s callback (`:776-790`) checks only `isDisposed` and
  `unattributedChangeAt === null`, not `this.stormBreaker.isStorming`. If the storm hasn't exited
  yet, this fires `pendingCauses.add('workspace'); void this.fetchAndPush();` as a _second_,
  independent refresh, ahead of and in addition to the storm's own eventual exit refresh — violating
  the "exactly one refresh per incident" invariant AC-2/AC-4 assert.
- Evidence: `git-watcher.service.ts:776-790` (no storm check), `enterStorm()` (`:892-903`, no call
  to `clearUnattributedChange()`).
- Current handling: none; untested (grepped both specs — no test drives a storm concurrently with a
  pending unattributed-change timer).
- Recommendation: have `enterStorm()` call `clearUnattributedChange()` (a storm's own exit refresh
  will cover whatever the unattributed change was pointing at), or have the 30 s timer callback defer
  to the breaker when storming.

### 4. `ownRefreshEchoUntil`/`ownRefreshesInFlight` are not reset on `stop()`, unlike every sibling flag this diff touches

- Trigger: `switchWorkspace`/`stop()` while a `git status` run started by the OLD workspace is still
  in flight; that run resolves after the switch.
- Symptom: `fetchAndPush`'s `finally` (`:1175-1182`) still runs unconditionally and sets
  `ownRefreshEchoUntil = Date.now() + 1000` on the shared instance — opening an echo window that now
  applies to the NEW workspace's events, for up to 1 s, attributing them to a status run for a
  workspace that no longer exists.
- Evidence: `git-watcher.service.ts:483-503` (`stop()` resets `gitMarkerSeenDuringStorm` and calls
  the new `clearUnattributedChange()`, but never touches `ownRefreshesInFlight`/`ownRefreshEchoUntil`);
  `:1159-1194` (`fetchAndPush`'s workspace-mismatch check at `:1183` runs AFTER the `finally` that
  mutates these fields, so the mismatch check cannot prevent the mutation).
- Current handling: none; the resulting behaviour is at worst a 1 s window of spuriously-stat'd or
  spuriously-dropped directory events on the new workspace — narrow, but exactly the same class of
  bug (cross-context leakage through a field the lifecycle forgot) this diff itself fixes for
  `gitMarkerSeenDuringStorm`/`unattributedChangeAt` a few lines above.
- Recommendation: reset both fields in `stop()`, or gate the `finally` block's writes on
  `this.workspacePath === workspaceRoot`.

### 5. AC-2/ST-1b flaked once (0 for 1) on this run, in a worktree already known to carry misleading contention

- Trigger: `npx nx test ptah-electron --testPathPattern=git-watcher` (run 1) against the current
  working tree, in the shared worktree the team-leader assigned for this review.
- Symptom: `enteredCount` (expected 1) was 0 — the storm breaker was never entered for a real,
  8,000-file, non-excluded delete, so none of `exitedCount`/`statusCallCount`/`statusPushes`/
  `contentPushes` fired either. This is not the AC-2 defect `test-report-b6.md` described (which had
  the storm correctly entering/exiting once, plus one extra leaked spawn) — it is a different,
  more severe _shape_: no refresh mechanism engaged at all. **A second, isolated re-run
  (`--testPathPattern=git-watcher.stress` alone) ~110 s later passed cleanly** (both ST-1 and
  ST-1b green).
- Evidence: raw Jest output from both runs, `git-watcher.stress.spec.ts:475-477` (the failing
  `expect`s in run 1).
- Current handling: n/a — this is the acceptance test itself, not a gap in product handling.
  `test-report-b6.md`'s own "Environment" section documents this exact worktree producing wall-clock
  times 30-40x normal under sibling-batch load, which is consistent with run 1's slower, contended
  window (~197 s vs run 2's ~107 s) starving the real `fs.watch` delivery this test depends on.
- Recommendation: given it is not reproducible 2-for-2, treat as a flake **provisionally** — but do
  not close it out without at least one more clean run on an idle machine, and note that Failure
  modes 2 and 3 (shared breaker, unattributed-timer/storm race) are plausible mechanisms by which
  real contention specifically (not just "slow machine" generically) could suppress the storm entry
  this test needs, which is a different risk profile than ordinary CI flake.

## Blocking issues

None. (AC-2/ST-1b's run-1 failure did not reproduce on an isolated run-2 — see Serious issues below
for why this is downgraded from blocking rather than dismissed.)

## Serious issues

### AC-2/ST-1b (the fix's own regression test) flaked on one of two runs, and the executor's notes do not mention it

- File: `apps/ptah-electron/src/services/git-watcher.stress.spec.ts:440-488`
- Scenario: run `npx nx test ptah-electron --testPathPattern=git-watcher` in this shared worktree.
- Impact: this follow-up's entire purpose is "prevent a repeat of the 2026-09-14 freeze" by making
  AC-1/AC-2 pass; the one test built specifically to prove that failed 1 of 2 times during this
  review, with an isolated re-run passing cleanly. `test-report-b6.md` already flagged this exact
  worktree as producing misleading timing under sibling-batch contention, so a single flake is not
  strong evidence of a product defect on its own — but the executor's findings summary presents the
  fix as proven without mentioning that the suite is not reliably green here, and does not report
  having run it more than once. A reviewer (or the team-leader) accepting this batch should know the
  proof is probabilistic in this environment, not deterministic.
- Fix: before merge, either (a) get two consecutive clean runs and record both in the test report, or
  (b) run once on a genuinely idle machine outside this shared worktree and record that. If a future
  clean run reproduces `enteredCount === 0`, escalate immediately — that specific failure shape (no
  refresh at all, not merely an extra one) is worse than the defect this batch set out to fix.

### Directory-echo drop has no safety net (asymmetric with the null-filename path)

- File: `apps/ptah-electron/src/services/git-watcher.service.ts:742-758`
- Scenario: a real edit inside a subdirectory lands as a directory `change` event during the ≤1 s
  own-refresh echo window, with no other event in the same debounce window to independently trigger
  a refresh.
- Impact: the decoration/content-change signal for that edit is lost with no compensating mechanism
  and no observability — see Failure mode 1.
- Fix: route a dropped directory echo through `noteUnattributedChange` instead of a bare `return`.

### `ownRefreshEchoUntil`/`ownRefreshesInFlight` omitted from `stop()`'s reset list

- File: `apps/ptah-electron/src/services/git-watcher.service.ts:483-503`, `:1159-1194`
- Scenario: workspace switch while a `git status` run for the old workspace is still in flight.
- Impact: up to 1 s of the new workspace's directory-change events can be mis-treated as an echo of
  a stale run — see Failure mode 4.
- Fix: reset both fields in `stop()`, matching the treatment already given to
  `gitMarkerSeenDuringStorm` and `unattributedChangeAt` in the same method.

## Moderate and minor issues

- **Moderate** — shared global `stormBreaker` mixes excluded-directory noise (via null events) with
  real, non-excluded churn, so a large excluded-directory delete can transiently gate unrelated work
  (Failure mode 2). Acceptable for P1, undocumented.
- **Moderate** — the unattributed-change safety timer does not defer to an in-progress storm, so a
  30 s-old null event can fire an extra refresh alongside a storm's own exit refresh (Failure mode 3).
  Untested either way.
- **Minor** — the module doc's claim that a directory `change` "carries nothing git status needs"
  (`:736-737`) is stated as certain when it is a heuristic; nothing in the diff or its tests
  quantifies how often a real signal is directory-only under load (the review brief explicitly asked
  for this quantification — it is not attempted anywhere in the executor's notes or the new tests).

## Data flow

1. `fs.watch` (recursive, workspace root) fires → `onWorkspaceEvent(root, eventType, filename)`. OK.
2. `filename === null` → recorded on the shared `stormBreaker` directly (bypasses exclusion, which
   needs a path); `'storming'` → drop; `'entered'` → `enterStorm()`; `'normal'` →
   `noteUnattributedChange`. OK mechanically; see Failure mode 2 for the shared-breaker concern and
   Failure mode 3 for the storm/timer interaction gap.
3. `filename` (string) `.git`-substring gate → `noteGitMarker`/storm-safe skip (unchanged from Batch
   4's fix, still correct per the delta review). OK.
4. `isIgnoredWorkspaceEvent(filename)` → excluded events return, never touching the breaker. OK.
5. `stormBreaker.record()` for named events → `'storming'`/`'entered'`/`'normal'` as before. OK — this
   gates the echo `stat` too (step 6 only reached on `'normal'`), so hunt point 1's "is the stat
   bounded by the storm breaker" is answered yes.
6. `eventType === 'change' && mayBeOwnRefreshEcho()` → `scheduleUnlessDirectoryEcho` (async `stat`,
   drop on directory, schedule on file/ENOENT). Directory-drop branch has no fallback — gap, Failure
   mode 1.
7. Otherwise (or after a non-directory echo check) → `scheduleUpdate` + (on `change`)
   `scheduleContentChange`, as before this diff. OK.
8. `fetchAndPush` → `clearUnattributedChange()`, then the single-flight `refreshGitInfo`, with
   `ownRefreshesInFlight`/`ownRefreshEchoUntil` bookkeeping in a `finally` that runs regardless of
   workspace match — gap, Failure mode 4.

## Requirements fulfilment

| Requirement                                                                                                                    | Status                 | Gap                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Null-filename events counted toward the breaker, scheduling nothing directly (fixes the Batch 6 AC-1 leak)                     | COMPLETE (unit-tested) | Shared breaker couples excluded-origin noise to non-excluded gating (Failure mode 2)                                             |
| One safety refresh after 30 s quiet for unattributed changes, never more often                                                 | COMPLETE (unit-tested) | Does not defer to an active storm (Failure mode 3)                                                                               |
| Echo filter drops own-`git status`-induced directory `change` events, stats only inside the window, never on the ordinary path | PARTIAL                | `stat` is correctly bounded/async (confirmed); the drop branch has no fallback for a genuinely-lost real signal (Failure mode 1) |
| Exit/enter pairing bug fixed (ST-1b tree, `.git` pointer removal, 3 s idle baseline)                                           | COMPLETE (unit-tested) | none found in the unit spec                                                                                                      |
| AC-1 (ST-1, 0 spawns/pushes)                                                                                                   | COMPLETE (2/2 runs)    | none found across both runs                                                                                                      |
| AC-2 (ST-1b, storm entered once, 1 refresh, 1 truncated push)                                                                  | PARTIAL (1/2 runs)     | Failed once (`enteredCount` 0, not 1), passed once isolated — see Serious issues                                                 |

Implicit requirements not addressed: symmetry between the two "ambiguous event" paths (null-filename
vs directory-echo) in how much benefit of the doubt they're given; lifecycle parity for the new
own-refresh-echo fields with the storm/unattributed fields already reset in `stop()`.

## Edge cases

| Case                                             | Handled               | How                                                    | Concern                                                                                                        |
| ------------------------------------------------ | --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Null event alone, no follow-up                   | YES                   | 30 s safety refresh                                    | Fires even if it's noise from an excluded dir sharing the breaker                                              |
| Null event folded into a real refresh            | YES                   | `clearUnattributedChange()` in `fetchAndPush`          | none                                                                                                           |
| Continuous null trickle faster than 30 s         | YES (never refreshes) | Timer keeps re-arming to the newest deadline           | By design; also means a real accompanying change with only null signals never surfaces without another channel |
| Directory `change` inside echo window, real edit | NO                    | Dropped, no fallback                                   | Failure mode 1                                                                                                 |
| File `change`/missing path inside echo window    | YES                   | Scheduled as usual                                     | none                                                                                                           |
| `git status` in flight during workspace switch   | PARTIAL               | Single-flight/trailing-rerun still correct (unchanged) | Echo-window fields leak past the switch (Failure mode 4)                                                       |
| Storm active when unattributed timer elapses     | NO TEST               | No storm check in the timer callback                   | Failure mode 3                                                                                                 |
| Real, non-excluded 8,000-file delete (ST-1b)     | FLAKY                 | Storm mechanism as designed                            | Failed 1 of 2 runs (`enteredCount === 0`); passed isolated re-run                                              |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on the code-level findings (all have direct `file:line` evidence and are
  independent of environment); MEDIUM on whether the ST-1b flake is pure worktree contention or a
  load-sensitive product interaction, since it did not reproduce 2-for-2.
- Top risk: the two asymmetric "ambiguous event" paths this diff introduces — null-filename (gets a
  30 s safety net, counts toward a breaker shared with unrelated churn) and directory-echo (gets
  nothing) — leave a real gap where a genuine edit can be silently dropped with no compensating
  signal (Failure mode 1), and the fix's own proof test is not reliably green in the environment it
  was tested in, with no clean-run evidence recorded by the executor.
- What a robust implementation would add: (1) a fallback for dropped directory-echo events
  symmetric with the null-filename path's 30 s safety net (Serious/Failure mode 1); (2) a storm-aware
  guard on the unattributed-change timer so it cannot fire a second refresh alongside a storm's own
  exit (Failure mode 3); (3) reset `ownRefreshesInFlight`/`ownRefreshEchoUntil` in `stop()` (Serious/
  Failure mode 4); (4) two consecutive clean runs of `git-watcher.stress.spec.ts` on an idle machine,
  recorded in the test report, before this is called APPROVED.

---

## Delta review (review fixes)

Scope: the executor's response to Failure modes 1/3/4 and the ST-1b test-shape finding above, plus
the new `git-watcher.stress.harness.ts` / `.stress.perf.spec.ts` split. Diffed
`git-watcher.service.ts` and `.service.spec.ts` against the versions this review's base pass read
(`git diff` in the shared worktree); read `git-watcher.stress.harness.ts` and
`.stress.perf.spec.ts` whole (both untracked, new this round). Ran only
`npx nx test ptah-electron --maxWorkers=2 --testPathPattern=git-watcher.service.spec` (pattern did
not filter — Nx ran the full project, 46 suites — but it finished in 44 s and was fully green: 597
passed, 0 failed, including every new test named below), per the resource rules; the stress/perf
specs were not run.

### Claim 1 — directory echo drop now marked unattributed: CONFIRMED FIXED

`scheduleUnlessDirectoryEcho` (`git-watcher.service.ts:758-776`) no longer bare-`return`s on a
directory hit; it now calls `this.noteUnattributedChange(Date.now())` (`:772-774`) before
returning, so a dropped echo is covered by the same 30 s safety net as a null-filename event. This
closes Failure mode 1 exactly as recommended. Unit-tested with real timers and a real temp dir:
`git-watcher.service.spec.ts:187-203` ("inside the window a directory change is dropped, a file
change still schedules") asserts `unattributedChangeAt !== null` and a live
`unattributedChangeTimer` after the drop, then a second, non-directory event still schedules the
debounce timer. Confirmed green in the run above.

### Claim 2 — `stop()` reset + `armGeneration` guard on the stat callback: CONFIRMED FIXED, doubly guarded

`stop()` now zeroes `ownRefreshesInFlight`/`ownRefreshEchoUntil` directly (`:501-502`) in addition
to incrementing `armGeneration` (`:470`); `start()` also increments `armGeneration` again after
calling `stop()` (`:326`, `:331`), so any in-flight `git status` run captured a strictly older
generation number. Both the `scheduleUnlessDirectoryEcho` stat callback (`:770`,
`this.armGeneration !== generation`) and `fetchAndPush`'s `finally` (`:1216`,
`this.armGeneration === generation`) gate their writes on this check, so a stale run from before a
`stop()`/`switchWorkspace()` cannot open or extend an echo window for the new workspace even if the
explicit zeroing in `stop()` were somehow bypassed — belt-and-suspenders, correctly layered. Closes
Failure mode 4. Unit-tested with a controllable promise:
`git-watcher.service.spec.ts:225-249` ("stop() closes the window, and a run from before the stop
cannot reopen it") starts a `fetchAndPush`, calls `stop()` mid-flight, resolves the stale run, and
asserts both fields stay `0` and a subsequent directory-change event schedules normally (i.e., is
not treated as an echo). Confirmed green.

### Claim 4 — storm entry clears the pending unattributed change: CONFIRMED FIXED

`enterStorm()` now calls `this.clearUnattributedChange()` (`:930`) before its existing debounce
clears, with a comment explaining why ("the exit refresh covers a pending unattributed change
too"). The 30 s timer callback itself also independently re-checks `this.stormBreaker.isStorming`
and clears rather than firing if a storm is somehow still active when it elapses
(`armUnattributedChangeTimer`, `:812-816`) — this second check is defensive/redundant given
`enterStorm()`'s proactive clear and the fact `noteUnattributedChange` itself never arms while
`isStorming` is true (`:795`), but it does not weaken anything and covers a hypothetical ordering
this reviewer cannot construct from the current code. Closes Failure mode 3. Unit-tested with fake
timers directly exercising the race the base review named:
`git-watcher.service.spec.ts:72-93` ("a pending unattributed change is absorbed by a storm: one
refresh, no safety refresh mid-storm or after") arms a null-filename event, advances 2 s, then
drives 29 s of storm-triggering events so the storm's lifetime spans the null event's would-be 30 s
deadline, and asserts exactly one `refreshGitInfo` call and `unattributedChangeTimer === null`
afterward. This is precisely the scenario Failure mode 3 described and the test would have failed
against the pre-fix code (the old `enterStorm()` had no `clearUnattributedChange()` call, so the
30 s timer would have fired independently once its deadline passed, mid-storm, producing a second
`refreshGitInfo` call before the storm's own exit refresh — this reviewer traced the pre-fix
`armUnattributedChangeTimer` callback, which only checked `isDisposed`/`unattributedChangeAt`, to
confirm it had no storm awareness at all). Confirmed green in the run above.

### Claim 3 — ST-1b libuv rationale and relaxed assertions

The libuv claim (4 KB `ReadDirectoryChangesW` buffer per watched tree on Windows, overflow →
one callback with a NULL filename, `src/win/fs-event.c`,
`uv_directory_watcher_buffer_size`/`uv__fs_event_start`) matches the documented behaviour of
libuv's Windows backend for `fs.watch(..., { recursive: true })`; this reviewer did not fetch the
libuv source itself (no web tool used this pass) but the mechanism is consistent with well-known,
widely-documented Node.js `fs.watch` Windows overflow behavior and with this diff's own prior
`null`-filename handling, which already assumed exactly this cause (`git-watcher.service.ts:697-701`
docstring, unchanged this round). Treat as plausible, not independently re-verified against libuv
source.

The rewritten `ST-1b` assertions (`git-watcher.stress.spec.ts:109-148`) are a real loosening from
the base review's `enteredCount === 1` expectation to: no refresh before delete-end (`:130`),
exactly one refresh cycle (`:131`), at most one `status` spawn (`:132`), exactly one status push
(`:133`), at most one content push (`:134`), `entered <= 1` and `exited === entered` (`:135-136`),
and — only when nothing refreshed inside the window — a requirement that unnamed events were
actually seen (`:144-147`). Reasoning through what the pre-fix code (as read in the base review,
before this round's changes) would have done against these specific assertions: the pre-fix defect
was that every `null`-filename event scheduled a refresh directly (the AC-1 leak) and, per
`test-report-b6.md`, a storm's own exit refresh raced with a stray extra spawn from leftover null
events. Against the current ST-1b assertions, that shape would most plausibly manifest as
`refreshCycles().length > 1` (a leaked extra `rev-parse` probe alongside the storm's own cycle),
failing `expect(cycles).toHaveLength(1)` (`:131`) — so the loosened test still has a mechanism by
which the original defect fails it. This is inference from reading the diff and the incident
report, not a rerun of the pre-fix code (resource rules block running the stress spec at all, let
alone twice against two revisions) — confidence MEDIUM, not HIGH, on this specific counterfactual.

The "deferred only when unnamed events were seen" branch (`:144-147`) is a stress-rig diagnostic
assertion, not a distinct product code branch — the underlying product mechanism it depends on (the
30 s unattributed-change safety refresh, armed once per quiet window) is exercised directly and
deterministically with fake timers in the unit spec (`git-watcher.service.spec.ts:46-70`, "null-only
changes get exactly one safety refresh after 30 s of quiet, never more often"), which is green.
What is not unit-tested is the specific claim that the stress rig's `unnamedEvents` counter and the
product's `noteUnattributedChange` path are the same event stream end-to-end — that linkage is only
exercised by the (unrun, real-`fs.watch`) stress spec itself.

### New finding: `armAndSettleBaseline` / `watcherIdle()` does not account for a pending unattributed-change timer — undermines exactly the flake this round is trying to close

- File: `apps/ptah-electron/src/services/git-watcher.stress.harness.ts:208-216` (`WatcherInternals`
  interface — no `unattributedChangeTimer`/`unattributedChangeAt` field), `:384-394`
  (`watcherIdle()` — checks `stormBreaker.isStorming`, `debounceTimer`, `gitOpsDebounceTimer`,
  `contentChangeTimer`, `stormTimer`, `initialFetchTimer`, but not the new unattributed-change
  timer), `:275-309` (`armAndSettleBaseline` — resets `pushes`/`spawner.calls`/`warnLines`/
  `namedEvents`/`unnamedEvents` once `watcherIdle()` + no new spawn/push has held for
  `QUIET_BASELINE_MS` (3 s), but never reads or resets the watcher's own
  `unattributedChangeAt`/`unattributedChangeTimer` state).
- Trigger: the initial `svc.start()` inside `armAndSettleBaseline` (`:276`) triggers an initial
  `fetchAndPush` (an `ownRefreshesInFlight`/`ownRefreshEchoUntil` window, per Claim 2 above) while
  `fs.watch` is already armed over an 8,000- or 75,000-file tree that was just built
  (`buildCheckoutTree` runs before `armAndSettleBaseline` is called, so the tree exists but is not
  yet watched when written — the risk is the _initial status scan itself_ touching thousands of
  directories while the watcher is live, which is exactly the own-echo shape this diff's
  `mayBeOwnRefreshEcho`/`scheduleUnlessDirectoryEcho` path exists to catch). A directory-level
  `change` event landing in that window is now (correctly, per Claim 1) turned into an unattributed
  change and arms a 30 s `unattributedChangeTimer` on `svc` — a piece of state `watcherIdle()` does
  not see.
- Symptom: `armAndSettleBaseline` can declare the rig "quiet" and reset its counters while a 30 s
  safety-refresh timer from the pre-test baseline arm is still live on the real `GitWatcherService`
  instance (the rig does not construct a fresh instance per test-relevant window; the same `svc`
  carries state from arm through delete-and-settle). If that stale timer elapses during or shortly
  after the test's own measurement window — plausible, since `ST-1b` waits up to
  `UNATTRIBUTED_REFRESH_DEADLINE_MS` (35 s) past the delete when nothing refreshed in-window
  (`git-watcher.stress.spec.ts:115-121`) — it fires an extra, spurious `fetchAndPush` that the test
  attributes to the delete under test, pushing `refreshCycles().length` to 2 and failing
  `expect(cycles).toHaveLength(1)` (`:131`) for a reason that has nothing to do with whether the
  production fix under test is correct.
- Evidence: `git-watcher.stress.harness.ts:208-216,275-309,384-394`; the mechanism this depends on
  (an initial-scan directory echo arming the 30 s timer) is the same one Claim 1's own unit test
  confirms is live (`git-watcher.service.spec.ts:187-203`).
- Current handling: none — `watcherIdle()` was not updated when `unattributedChangeTimer` was added
  to the product this round, unlike every other new-or-existing product timer, all of which the
  idle check does track.
- Recommendation: add `unattributedChangeTimer: unknown` (and ideally `unattributedChangeAt: number
| null`) to `WatcherInternals` and to `watcherIdle()`'s conjunction, so `armAndSettleBaseline`
  cannot declare quiet while a safety-refresh timer from the arm phase is still pending. This is a
  test-harness-only fix (no product change) and is exactly the kind of infrastructure gap that could
  reproduce the base review's "`enteredCount` 0, unexplained" run-1 flake under a different guise
  (an unrelated stray refresh from before the measured window, rather than event starvation) —
  worth ruling out before calling the ST-1b flake "environment-only."
- Severity: Serious for the stress-spec's reliability (it can produce a false mechanism failure
  attributable to the harness, not the product, in the exact test this round exists to make
  trustworthy); no production impact (this file ships to no bundle, per its own header comment).

### Product finding (report only): `GitInfoService.isGitRepo` conflates a transient exec failure with "not a repository," which can blank git decorations for a cycle under load

- File: `libs/backend/vscode-core/src/services/git-info.service.ts:2510-2528` (`isGitRepo`),
  `:520-531` (`computeGitInfo`, which returns `isGitRepo: false` with empty branch/files whenever
  `isGitRepo()` returns `false`, for any reason).
- Mechanism: `isGitRepo` runs `git rev-parse --is-inside-work-tree` and returns `exitCode === 0 &&
stdout.trim() === 'true'`; any thrown error (spawn failure, timeout, the process being killed
  under load, `execGit`'s own internal errors) is caught and unconditionally mapped to `false`
  (`:2521-2527`), with a `degradation-audit: optional-capability` comment that treats "git is
  unusable here" and "this really is not a git repository" as the same outcome. `computeGitInfo`
  then short-circuits to `{ isGitRepo: false, branch: {...empty}, files: [] }` (`:525-531`) without
  attempting the actual `git status` call. `git-watcher.stress.spec.ts:101-104`'s own comment
  independently documents seeing this in practice: "under load the probe can fail and end the cycle
  before `git status` is spawned (reproduced with the CPU saturated: 1 push, 1 spawn, 0 `status`)."
- Impact: on a CPU-starved machine (the exact condition this whole task exists to survive — mass
  file-tree deletes and the sibling-batch contention this review's own worktree carries), a
  transient `rev-parse` failure produces a `git:status-update` push claiming `isGitRepo: false` for
  a workspace that is, in fact, still a git repository. The renderer has no way to distinguish "this
  folder really isn't a repo" from "the probe glitched once" — git decorations (branch name, ahead/
  behind, file status badges) blank out for one cycle and only recover on the next successful
  refresh. Not data loss and self-healing, but a visible, misleading UI state during exactly the
  high-load incidents (`TASK_2026_437`) this task is about.
- Where to fix (not in scope for this diff — flagged for the owning lib): `isGitRepo` should
  distinguish "git ran and said no" (exit code non-zero with the expected stderr shape, e.g. "not a
  git repository") from "the probe itself failed to execute or was killed" — the latter should
  either retry once, or `computeGitInfo` should treat a probe _exception_ differently from a probe
  _negative result_ (e.g., skip the push / keep the last-known `isGitRepo` state rather than
  asserting `false`). `git-info.service.ts:2510-2528` and `:520-531` are the two sites to change.
- Severity: Moderate. Load-dependent, self-correcting on the next refresh, no data corruption — but
  user-visible and directly tied to the load conditions this task's whole incident is about, so
  worth a follow-up task rather than silent acceptance.

### Delta verdict

- Recommendation: **APPROVE_WITH_FIXES**
- Confidence: HIGH on Claims 1/2/4 (each has direct `file:line` evidence, a matching unit test using
  fake timers or a controlled promise, and this reviewer independently traced the pre-fix code path
  to confirm each test would have failed against it) and on the new harness finding (traced from the
  diff, not run). MEDIUM on Claim 3's counterfactual (pre-fix-vs-current-assertions reasoning, not an
  executed comparison — resource rules block running the stress spec).
- What changed since the base review: all three Serious findings this document raised against the
  product code (Failure modes 1/3/4) are fixed and each has a fake-timer or controlled-promise unit
  test pinning the exact race described; the base review's third Serious finding (ST-1b flakiness)
  is addressed by loosening the test to what the mechanism actually guarantees, with a documented,
  plausible root cause (libuv overflow) — not by hiding the flake.
- Remaining risk before this can be called clean APPROVE: the harness's `watcherIdle()` gap (new
  finding above) is a plausible, previously-unconsidered source of exactly the kind of stray extra
  refresh that would make `ST-1b` fail unpredictably, and it was not covered by this round's fixes
  because the round was scoped to the product's Failure modes 1/3/4, not the harness extracted
  alongside them. The `GitInfoService.isGitRepo` finding is real but out of this diff's scope and
  does not block this batch.
- Top risk: none of the product-code fixes are in question; the residual risk is entirely in whether
  `ST-1b` can be trusted as a regression gate, and the harness gap identified here is a concrete,
  fixable reason it might still flake for a cause unrelated to the product.
- Required before APPROVE: add `unattributedChangeTimer` (and `unattributedChangeAt`) to
  `WatcherInternals`/`watcherIdle()` in `git-watcher.stress.harness.ts` so the baseline gate cannot
  declare quiet with a safety-refresh timer still pending, then get one clean stress-spec run with
  that fix in place.
