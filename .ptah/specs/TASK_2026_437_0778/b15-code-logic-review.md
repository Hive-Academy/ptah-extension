# Code Logic Review — `TASK_2026_437_0778` Batch 15

Scope: `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts` (new,
776 lines) and `.ptah/specs/TASK_2026_437_0778/test-report-b15.md`. Read in full, alongside
`workspace-watch-supervisor.ts`, `workspace-watch-host-core.ts`, `workspace-change-coalescer.ts`,
`workspace-watch-batch-relay.ts`, `implementation-plan.md:785-820`, `batches.md` Batch 6/8/11/15 and
the PR #510 Linux CI fix sections, and `test-report-b6.md`. Did not run the spec (instructed not to,
and it is heavy); relied on the four logs referenced by the report existing in
`D:\projects\ptah-437-backup\` per the report's own execution section — logs themselves were not
opened (not in the readable-document set and not needed to evaluate the code under review).

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 3              |
| Moderate issues     | 4              |
| Failure modes found | 5              |

## Five logic questions

### 1. How does this fail silently?

- `workspace-watch-host.stress.spec.ts:567` — the ST-2 mechanism test's own comment
  (`:564-567`, "the run generated at least as many recorded/dropped changes as files deleted") states
  an invariant the assertion does not check. The code is `expect(result.changedPaths +
result.droppedTotal).toBeGreaterThan(0)` — true the moment a single event of the 8,000-file delete
  is observed. A regression that dropped 7,990 of 8,000 delete notifications on the floor (e.g. a
  coalescer counter reset in the wrong place, or `droppedCount` under-incrementing) would still pass
  this test as long as one path or one dropped-count tick survived. This is exactly the "storm was
  observed, not silently swallowed" claim the comment makes, and exactly the claim the assertion does
  not enforce.
- `workspace-watch-host.stress.spec.ts:424-431` vs `:457,469,492` — `ST-2`'s `afterEach` runs
  `cleanups.splice(0)` cleanups **in push order**, and `fs.rmSync(root, ...)` is pushed FIRST
  (`:431`), before `watcher.dispose()` (`:457`), `subscription.dispose()` (`:469`) and
  `monitor.stop()` (`:492`). The loop at `:425-427` has no per-callback try/catch, so if the FIRST
  cleanup throws, every cleanup after it — including the one that kills the forked host process and
  the one that stops the persistent RSS-monitor child — never runs. On Windows, deleting a directory
  tree that a still-live native watch subscription (in a still-running host process, not yet disposed)
  holds open file/directory handles on is a documented source of `EBUSY`/`EPERM`, which `{force:
true}` does not suppress (it only swallows `ENOENT`). A test failure on this exact path leaks both
  the forked watch-host child process and the `RssPeakMonitor`'s persistent sampler child for the
  rest of the Jest run — the opposite of what the file's own extensive disposal commentary
  (`:151-166`, `:488-492`) claims to guarantee. Compare `AC-7`'s `makeWatcher` (`:598-617`), which
  pushes `watcher.dispose()` FIRST and the temp-dir removal after — the correct order — showing this
  is an inconsistency within the same file, not a deliberate choice.
- `test-report-b15.md:519-521,225-236` — `nativeErrorSeen` is computed as
  `diagnostics.some(d => d.message.includes('native-error') || d.message.includes('host restarted'))`.
  `'[WorkspaceWatcher] host restarted'` (`workspace-watch-supervisor.ts:528`) is emitted for **every**
  supervisor-level restart reason (`fork-failed`, `post-failed`, `heartbeat-missed`, `exited`, not only
  a genuine native buffer overflow). In the runs recorded, `hostRestarts` was 0 for ST-2, so the two
  disjuncts never diverged — but the boolean's name asserts more precision than its definition
  provides: a restart caused by an unrelated fork hiccup would report `nativeErrorSeen: true` in a
  future run, silently misattributing the cause in exactly the field the report leans on for A1's
  "no native overflow observed" conclusion.

### 2. What user action produces unexpected behaviour?

- A caller who disposes a workspace-watch subscription/watcher for a root and then immediately
  deletes that root from disk (e.g. closing a workspace before a worktree cleanup script runs) hits
  the same ordering risk item 1 identifies, just in production: if disposal is not first, the host may
  still be holding native watch handles when the filesystem delete runs. The product code path itself
  is not shown to have this bug (only the test's cleanup order does) — but the test, being the one
  place the two are deliberately raced (rig teardown vs. a live host), is exactly where this hazard
  would first surface, and it surfaces as a resource leak, not a red test.

### 3. What input data produces a wrong answer?

- `readHostRssKb`/`RssPeakMonitor` (`:118-222`) return `undefined` on any parse failure (e.g., a
  locale where `Get-Process` prints a decimal separator this code's `Number(...)` cannot parse, or a
  minimal container image lacking `powershell`/`ps`). The report acknowledges this is best-effort and
  "recorded, not asserted" (`test-report-b15.md:328-331`), which is honest — but note it applies
  equally to `rssPeak` (`monitor?.peakKb() ?? rssBefore`, `:506`): if the monitor child fails to spawn
  or its first sample errors, `rssPeak` silently falls back to `rssBefore`, which would read as "no
  RSS growth during the storm" rather than "RSS wasn't measured." Not asserted, so not a test failure,
  but a reader skimming the numbers table could misread a monitoring gap as a clean result.
- `buildTree` (`:328-343`) creates exactly `files/10` directories at 10 files/dir; the 75,000-file
  case yields 7,500 directories, so `droppedTotal = 82,500` for a full-storm delete (75,000 file
  unlinks + 7,500 directory removals) is internally consistent and plausible — this number holds up
  under inspection, unlike item 1's assertion.

### 4. What happens when a dependency fails?

- The AC-7 "exactly one overflow per subscriber" assertions (`:675-676`) are proven true for a clean
  external `SIGKILL` with no native-engine-level loss in flight. They are not proven, and the review
  question specifically anticipated, for the composite case the codebase's own design already
  documents as producing TWO overflows per incident: `workspace-watch-host-core.ts:44-47` states every
  in-host rebuild (native error, refused subscribe, storm-end-with-unreconciled-creates) signals
  `overflow` **twice** — once on detection, once after the rebuild is live — and `batches.md:829-831`
  ("Accepted decisions") confirms this was a deliberate design choice for the Linux reconciler fix:
  "`overflow` is signalled after the rebuild is live; two overflows per incident." If a real
  `ReadDirectoryChangesW`/inotify-class native loss is already mid-rebuild (one overflow already
  flushed to the relay, `overflowOwed` reset false) at the moment the whole host process is killed,
  the supervisor's own `onHostFailure` (`workspace-watch-supervisor.ts:477-479`) will call
  `signalOverflow()` again on top of that, and — per `workspace-watch-batch-relay.ts:37,111,150` —
  `overflowOwed` is a boolean, not a counter, so two overflows only collapse into one batch if they
  land in the SAME flush cycle. Two overflows separated by even one 250 ms coalescer flush produce two
  separate `overflow: true` batches for the same incident. Neither the AC-7 spec (which never triggers
  a real native-level loss; its temp trees are trivially small) nor the report exercises or
  acknowledges this composite path — the report's "exactly one overflow" claim is true for the tested
  scenario (bare process kill) and should not be read as a general guarantee.

### 5. What is missing that the requirements never mentioned?

- A1's own resolution leans entirely on the assumption that `@parcel/watcher`'s Windows backend always
  raises a catchable `error` on a native buffer overflow (`onEngineEvents`'s `error` branch,
  `workspace-watch-host-core.ts:775-786`, is the only path that sets `overflowOnSettle` for a genuine
  engine-level loss). This codebase has ALREADY found and fixed one instance of the sibling failure
  mode on Linux — `@parcel/watcher` silently under-reporting without ever invoking the error callback
  (`batches.md:795-798`, `parcel-bundler/watcher#243`: created directories not listed, no error
  raised). The spec's header comment (`:17-32`) states "the answer is 'it does not need to survive —
  the host always rebuilds it'" as though this were settled; the test report is more careful ("A1 is
  answered by design... the specific native `ReadDirectoryChangesW` overflow path was not reproduced
  here and remains unconfirmed", `test-report-b15.md:233-236`), but the spec's own in-file doc comment
  overclaims relative to the report's own hedge, and neither document raises the specific parallel to
  the Linux bug already found in this same codebase — that the design answer is unverified for exactly
  the reason a documented instance of the same class of silent loss exists one platform over.

## Failure modes

### Weak "storm observed" assertion

- Trigger: any regression that drops far more delete events than the coalescer/storm-breaker design
  intends, but leaves at least one path or one dropped-count increment.
- Symptom: `expect(result.changedPaths + result.droppedTotal).toBeGreaterThan(0)` still passes; CI is
  green.
- Evidence: `workspace-watch-host.stress.spec.ts:564-567`.
- Current handling: assertion checks `> 0`, comment claims "at least as many ... as files deleted."
- Recommendation: assert `toBeGreaterThanOrEqual(fileCount)` (or close to it, allowing for the couple
  of pre-storm events the design already expects to be double-counted) to match the stated intent.

### Cleanup order leaks the host process and RSS monitor on ST-2 teardown failure

- Trigger: `fs.rmSync(root, ...)` (first cleanup) throws — plausible on Windows when the host's live
  native watch subscription still holds handles under `root` because the host has not been disposed
  yet.
- Symptom: the forked watch-host child process and the persistent `RssPeakMonitor` sampler child are
  never killed; they continue running for the rest of the Jest process (and, if Jest itself does not
  force-exit, indefinitely).
- Evidence: `workspace-watch-host.stress.spec.ts:424-431` (push order), `:457,469,492` (dispose/stop
  pushed after), `:425-427` (no per-callback try/catch).
- Current handling: none — first-cleanup failure aborts every later cleanup silently (no `afterEach`
  failure is even guaranteed, since a thrown cleanup callback surfaces as an unhandled test hook error
  which Jest reports, but by then the leak has already happened).
- Recommendation: dispose the watcher/host BEFORE removing the temp directory (matching AC-7's own
  `makeWatcher`/`cleanups` ordering, `:615` before `:629-630`), and wrap each cleanup callback in
  its own try/catch (log-and-continue) so one failure cannot cascade into skipping the rest.

### Two-overflow composite path untested

- Trigger: a real native-level event loss (buffer overflow, refused subscribe, storm-end
  unreconciled-creates) in-flight inside the host at the same moment the whole host process dies
  (crash, external kill, OOM).
- Symptom: a subscriber could receive two separate `overflow: true` batches for one incident instead
  of the one AC-7 asserts, if the two signals land in different 250 ms coalescer flush windows.
- Evidence: `workspace-watch-host-core.ts:44-47` (host-internal rebuild sends overflow twice by
  design), `batches.md:829-831` ("two overflows per incident" accepted for the Linux reconciler fix),
  `workspace-watch-supervisor.ts:477-479` (process-failure path sends a further, independent overflow),
  `workspace-watch-batch-relay.ts:37,111,150` (`overflowOwed` is a boolean, collapses only within one
  flush).
- Current handling: not exercised by this batch's spec (AC-7's temp trees never generate a genuine
  native-level loss); not mentioned in the report as an open question.
- Recommendation: name this explicitly as an open risk in the report (it currently is not), and
  consider a follow-up integration test that fires a fake/forced native error just before killing the
  host, to pin whether the "exactly one overflow" contract holds under the composite case or needs a
  documented exception.

### `nativeErrorSeen` conflates two different signals

- Trigger: any host restart NOT caused by a native engine error (fork failure, IPC post failure, a
  slow-but-alive host missing its heartbeat window).
- Symptom: `nativeErrorSeen` reports `true` even though no native buffer overflow occurred, because the
  OR includes the generic `'[WorkspaceWatcher] host restarted'` diagnostic text.
- Evidence: `workspace-watch-host.stress.spec.ts:519-521`; `workspace-watch-supervisor.ts:526-528`
  emits identical restart text for `fork-failed`/`post-failed`/`heartbeat-missed`/`exited` alike.
- Current handling: did not diverge in the recorded runs (`hostRestarts: 0` throughout ST-2), so the
  imprecision has not yet produced a wrong reading, but the field name promises more than the
  definition delivers.
- Recommendation: split into two counters (`nativeErrorDiagnosed` vs. `hostRestarted`), or drop the
  `'host restarted'` disjunct and rely on the `'native-error'` substring alone.

### Mechanism/perf ms budget asserted unconditionally in the exact way R-P11 says to avoid

- Trigger: CI runner under load (this task's own `test-report-b6.md:149-167` documents a shared
  worktree stretching a 90 s test run to ~45 minutes of wall time under sibling batch contention).
- Symptom: `expect(restartMs).toBeLessThanOrEqual(3_000)` (`workspace-watch-host.stress.spec.ts:674`)
  runs unconditionally in CI mode (not gated behind `PTAH_PERF_SPECS`), asserting an absolute
  wall-clock bound on a process-fork-based restart.
- Evidence: `batches.md:80` (risk register R-P11: "CI asserts mechanism counts on an 8,000-file tree;
  ms budgets only under `PTAH_PERF_SPECS=1`") vs. `implementation-plan.md:799` (AC-7's own table marks
  the ≤3 s restart bound "(asserted, CI)", not "(perf)") vs. the actual code, which does assert it
  unconditionally. The plan and the risk register disagree with each other on whether this should be
  CI-always or perf-gated; the code follows the plan's literal wording, but that is exactly the
  wall-clock-bound-in-CI pattern R-P11 was written to prevent, and this task's own Batch 6 evidence
  shows the failure mode (extreme wall-time stretch under contention) is not hypothetical in this
  worktree.
- Current handling: asserted every CI run, no flag gate.
- Recommendation: either reconcile the plan/risk-register disagreement explicitly (document why AC-7's
  3 s bound is exempted from R-P11), or move the numeric assertion behind `PERF` and keep only "a
  restart happened" as the CI-always mechanism check, consistent with how every other ms figure in this
  file is treated.

## Blocking issues

None. Every issue found is a gap in assertion strength, documentation precision, or teardown ordering
in test code — none corrupts data, misleads a production caller, or blocks the batch outright.

## Serious issues

### Storm-observed assertion does not check what its own comment claims

- File: `workspace-watch-host.stress.spec.ts:564-567`
- Scenario: a future regression suppresses the vast majority of a delete storm's events.
- Impact: CI stays green on a real regression to the exact invariant (AC-2 P2 "storm was observed, not
  silently swallowed") this test exists to pin.
- Fix: strengthen to `toBeGreaterThanOrEqual(fileCount)` or a close, justified lower bound.

### ST-2 cleanup order can leak the forked host process and RSS monitor child

- File: `workspace-watch-host.stress.spec.ts:424-431,457,469,492`
- Scenario: `fs.rmSync` throws before the watcher is disposed (plausible on Windows: a live native
  watch subscription holding handles under the directory being removed).
- Impact: leaked child processes accumulate across a Jest run (and possibly beyond it); silent, no test
  failure signal beyond a hook-error report that does not describe the leak.
- Fix: dispose watcher/host before removing the directory; wrap each cleanup in its own try/catch.

### Composite native-loss + process-kill overflow path is neither tested nor flagged as an open risk

- File: `workspace-watch-host.stress.spec.ts` (whole AC-7 section, `:592-776`);
  `workspace-watch-host-core.ts:44-47`; `batches.md:829-831`.
- Scenario: a real native-level loss in flight at the moment the host process dies.
- Impact: AC-7's "exactly one overflow per subscriber" claim could be violated in production without
  any test coverage or documented caveat.
- Fix: add the caveat to the report at minimum; ideally a follow-up spec that forces this composite
  case.

## Moderate and minor issues

- `workspace-watch-host.stress.spec.ts:519-521` — `nativeErrorSeen` conflates native-error diagnostics
  with any supervisor restart; rename or narrow.
- `workspace-watch-host.stress.spec.ts:674` vs. `batches.md:80` — ms-based restart-budget assertion
  runs unconditionally in CI, in tension with R-P11's stated mitigation; reconcile or gate.
- `workspace-watch-host.stress.spec.ts:554-557` — comment claims the bound is "well under 100" but the
  code asserts `< 200`, a 2x gap between documented intent and enforced bound.
- `test-report-b15.md:506` — `rssPeak = monitor?.peakKb() ?? rssBefore` silently reads as "no RSS
  growth" if the monitor child never produced a sample; worth a distinguishable sentinel in a future
  iteration (not urgent, since it is recorded not asserted).

## Data flow

1. Build 8,000/75,000-file tree under `root/churn/` before the watcher arms — OK, matches ST-1/ST-1b's
   own lesson (never delete the watched root itself, `:432-440`).
2. Fork real host over built bundle, subscribe, settle 2 s, reset recorder — OK, keeps the initial
   walk out of the measured window.
3. Spawn `RssPeakMonitor` before the window opens, `deleteInChildProcess` inside the measured window —
   OK; this is the fix the report documents finding and correcting (rig cost bleeding into the
   product's own event-loop-delay measurement).
4. Delete completes, 10 s settle inside the same measured window, event-loop delay captured — OK.
5. Overflow/coalescer state resolves inside the host (native error or storm exit) and the supervisor
   relays batches to the test process — OK for the tested case; the composite in-host-rebuild +
   process-kill case is untested (see Serious issue above).
6. Probe write under the still-watched root, `waitFor(hasPath, ..., 20_000)` — OK; timing margin is
   generous relative to the observed ~11-20 s settle windows.
7. `afterEach` cleanup — GAP for ST-2 (wrong order, no isolation between callbacks); OK for AC-7.

## Requirements fulfilment

| Requirement                                                                  | Status   | Gap                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 (native subscription survives or rebuilds)                                | PARTIAL  | Design-level answer sound; native win32 overflow path itself unconfirmed, and the spec's own header comment states this more strongly than the report does.                                                                                 |
| AC-2 (P2) mechanism: bounded batches, no per-event message, delivery resumes | PARTIAL  | Bounded-batches and delivery-resumes hold; "storm observed" assertion is far weaker than its own comment claims.                                                                                                                            |
| AC-2 (P2) perf (p99 ≤ 30 ms, max ≤ 100 ms)                                   | COMPLETE | Recorded and gated correctly behind `PTAH_PERF_SPECS`.                                                                                                                                                                                      |
| AC-7 mechanism: restart ≤ 3 s, one overflow/subscriber, resubscribe, resume  | PARTIAL  | Proven for a bare kill; the documented two-overflow rebuild path (`batches.md:829-831`) is not exercised in combination with a process kill, and is not flagged as untested.                                                                |
| AC-7 degraded path: budget exhaustion, one report, cadence, recovery         | COMPLETE | Real code paths exercised with shortened but real timers; assertions on ordering, not fragile ms values (except the `sleep(900)` cadence-count window, which is a real-timer risk under contention but not asserted against a tight bound). |
| R-P10 (RSS recorded)                                                         | COMPLETE | Recorded before/peak/after on both tree sizes, best-effort documented.                                                                                                                                                                      |
| R-P11 (mechanism always-on, ms budgets perf-gated)                           | PARTIAL  | Followed for ST-2 and for AC-7's p99 perf assertion; the AC-7 restart-ms bound is asserted unconditionally in CI, which the risk register's own wording (`batches.md:80`) says to avoid.                                                    |

Implicit requirements not addressed: cleanup ordering safety under a mid-teardown exception (found
during this review, not called out anywhere in the plan or report); the two-overflow composite case
the codebase's own design already accounts for elsewhere in the same feature.

## Edge cases

| Case                                                                  | Handled | How                                                               | Concern                                                                                                                                  |
| --------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Root deleted instead of subtree (breaks re-subscribe)                 | YES     | Fixed in this batch; documented in the header comment.            | None.                                                                                                                                    |
| RSS-sampling/delete work polluting the measured event loop            | YES     | `deleteInChildProcess` + `RssPeakMonitor`, documented in detail.  | None.                                                                                                                                    |
| Host process crash mid-storm (unforced)                               | YES     | `hostExitedUnexpectedly` asserted false.                          | None.                                                                                                                                    |
| Real SIGKILL, two subscribers, one host                               | YES     | Single-kill AC-7 test.                                            | None beyond the composite case above.                                                                                                    |
| Restart budget exhaustion → degraded → recovery                       | YES     | Real code paths, shortened timers.                                | `sleep(900)` fixed-wait rescan-count check is a real-timer risk under heavy CI contention (not a tight ms budget, but still time-based). |
| Composite native-loss + process-kill (two overflows for one incident) | NO      | Not exercised.                                                    | Serious issue above.                                                                                                                     |
| Teardown failure mid-cleanup                                          | NO      | Wrong order + no isolation for ST-2.                              | Serious issue above.                                                                                                                     |
| RSS read failure (missing tool, locale mismatch)                      | YES     | Falls back to `undefined`/`rssBefore`, documented as best-effort. | Silent fallback to `rssBefore` reads as "no growth"; minor.                                                                              |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the ST-2 cleanup-order defect (delete-before-dispose, no per-callback isolation) can leak
  a forked native-watcher process and a persistent RSS-sampler child on any teardown failure — a
  correctness gap in the test rig itself, not just a weak assertion, and it sits right next to a
  documented, deliberate "two overflows per incident" design (`batches.md:829-831`) that this same
  batch's AC-7 tests do not exercise in combination with a process kill.
- What a robust implementation would add: (1) strengthen the ST-2 "storm observed" assertion to match
  its own comment; (2) reorder ST-2's cleanups to dispose-before-delete and isolate each cleanup
  callback; (3) either a follow-up spec or an explicit documented caveat for the composite
  native-loss-plus-kill overflow count; (4) resolve the plan-vs-risk-register disagreement on whether
  AC-7's 3 s restart bound belongs behind `PTAH_PERF_SPECS`; (5) rename or split `nativeErrorSeen` so it
  does not read as more precise than its definition.

---

## Delta review (review fixes)

Re-read the current state of every file the fix touched: the new
`workspace-watch-host.stress.harness.ts` (748 lines), `workspace-watch-host-rss-sampler.js`,
the rewritten `workspace-watch-host.stress.spec.ts` (149 lines, mechanism-only) and new
`workspace-watch-host.stress.perf.spec.ts`, `tsconfig.spec.json`, the backport in
`apps/ptah-electron/src/services/git-watcher.stress.harness.ts`, and the revised
`test-report-b15.md`. Did not run the stress/perf specs or `nx`; the report's own execution
section names `D:\projects\ptah-437-backup\b15r-*.log` as the run evidence, consistent with what
was asked of me.

### The 7 prior findings

| #   | Prior finding                                                         | Verified fix                                                                                                                                                                                           | Location                                                                                          |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Storm-observed assertion weaker than its comment                      | FIXED — `expect(result.changedPaths + result.droppedTotal).toBeGreaterThanOrEqual(result.fileCount)`                                                                                                   | `workspace-watch-host.stress.spec.ts:116-118`                                                     |
| 2   | ST-2 cleanup order could leak the host process + RSS monitor          | FIXED — every scenario runner now tears down in a `finally`, dispose-before-delete (monitor → subscription(s) → watcher → temp dir), each step wrapped in `safely()` so one throw cannot skip the rest | `workspace-watch-host.stress.harness.ts:574-579,657-663,738-742`                                  |
| 3   | Composite native-loss + process-kill overflow path untested/unflagged | DOCUMENTED (not fixed with a new test, which is the honest option) — spelled out in the spec header and in the report's own "AC-7 composite path — open risk" section                                  | `workspace-watch-host.stress.spec.ts:53-66`; `test-report-b15.md:248-258`                         |
| 4   | `nativeErrorSeen` conflated two signals                               | FIXED — split into `nativeErrorDiagnosed()` (only the `native-error` diagnostic) and `hostRestartedDuringRun()` (any restart reason), both logged separately                                           | `workspace-watch-host.stress.harness.ts:405-421`                                                  |
| 5   | Restart-ms budget asserted unconditionally in CI (against R-P11)      | FIXED — mechanism spec now waits on a generous 30 s timeout with no numeric assertion; the 3,000 ms budget lives only in the `PERF_ENABLED`-gated perf spec                                            | `workspace-watch-host.stress.spec.ts:123-127` vs `workspace-watch-host.stress.perf.spec.ts:85-97` |
| 6   | Comment ("well under 100") vs. assertion (`< 200`) mismatch           | FIXED — assertion tightened to `toBeLessThan(100)`                                                                                                                                                     | `workspace-watch-host.stress.spec.ts:107`                                                         |
| 7   | `rssPeak` silently fell back to `rssBefore`                           | FIXED — returns `null` ("not sampled") instead of a number that reads as "no growth"; `rssPeakKb` is typed `number                                                                                     | null`                                                                                             | `workspace-watch-host.stress.harness.ts:466,543` |

All 7 confirmed fixed by direct code inspection, not by trusting the report's own claim. Item 3
is a documentation fix by design (an honest "not resolved" is the correct response to that finding,
not a forced test), and is written into both the spec header and the report without hedging.

### New finding: the degraded-path overflow-cadence check moved OUT of the spec, into the harness

The coordinator's own question ("does the harness keep assertions in the spec?") catches something
real. `runDegradedPastBudgetScenario` (`workspace-watch-host.stress.harness.ts:712-720`) now contains:

```ts
await waitFor(() => watcher.isDegraded, 'the watcher to become degraded');

const overflowAtDegraded = recorder.overflowBatches();
await sleep(900); // ~3 rescan cadences at 300 ms
if (!(recorder.overflowBatches() > overflowAtDegraded)) {
  throw new Error(`expected more overflow batches during the degraded rescan cadence: ${recorder.overflowBatches()} vs ${overflowAtDegraded} before`);
}
```

In the pre-fix version this was `expect(recorder.overflowBatches()).toBeGreaterThan(overflowAtDegraded)`
inside the spec's `it(...)` body. It is now a hand-rolled `if`/`throw` living inside the harness
function, and `DegradedPathResult` (`:666-670`) does not return the two overflow counts the check
compares (`overflowAtDegraded` is a local the caller never sees) — so `workspace-watch-host.stress.spec.ts`'s
own test (`:139-147`) only asserts `expect(result.degradations).toBe(1)`; the rescan-cadence mechanism
check that used to be a first-class, spec-visible assertion is now invisible to a reader of the spec
file, and a Jest failure on it surfaces as a generic thrown error from inside imported harness code
rather than a named `expect` at a test-owned line. This is exactly the pattern the extraction was
supposed to avoid (scenario functions return data, the spec asserts on it) for every OTHER check in
the same function (`degradations`, `restarts`, final `overflowTotal` are all returned and asserted in
the spec) — this one check alone was left behind mid-refactor. Not a behavioural regression (the
check still runs, still fails the test on a real problem, real code paths are unaffected) but a
structural one: it reintroduces, for exactly one assertion, the "assertion logic hidden in a
non-test file" pattern the harness extraction (style serious #1/#2) was written to eliminate elsewhere
in the same file.

- Recommendation: return `overflowAtDegraded` (or the two raw counts) on `DegradedPathResult`, delete
  the `if`/`throw`, and add `expect(result.overflowAfterCadence).toBeGreaterThan(result.overflowAtDegraded)`
  (or similar) to the spec's own `it(...)` body, consistent with every other check in the function.

### `allowJs: true` in `tsconfig.spec.json` — side effects checked

- **Why it was needed, confirmed correct.** `jest.config.ts`'s `transform` matches `^.+\.[tj]s$` — Jest
  routes `.js` files through `ts-jest` too, not through Node's native loader, and `moduleFileExtensions`
  already included `'js'`. `readHostRssKb`'s `require('./workspace-watch-host-rss-sampler')`
  (`workspace-watch-host.stress.harness.ts:67`) is therefore transformed by `ts-jest`, which refuses a
  `.js` file without `allowJs` (TS6059). The flag is necessary, not incidental.
- **No conflict with `tsconfig.lib.json`.** That file is a separate config for the `typecheck`/`build`
  target, has its own `include` (`src/**/*.ts` only, `.js` never listed) and no `allowJs` of its own —
  `nx typecheck` and `nx build` never see this flag. Confirmed by reading both files side by side.
- **The fixture is excluded from the lib build.** Neither `tsconfig.lib.json`'s `include` nor any
  production import reaches `workspace-watch-host-rss-sampler.js`; it is loaded only via `require()`
  from test code and via `spawn(process.execPath, [scriptPath, ...])` (a bare `node` invocation that
  never goes through TypeScript or a bundler at all). No production-bundle risk.
- **Real, previously-absent side effect: coverage.** This is the ONLY `.js` file under
  `libs/backend/platform-electron/src` (confirmed by a project-wide search), and neither
  `jest.preset.js` nor this project's `jest.config.ts` sets `collectCoverageFrom` — so Jest's default
  "coverage from files actually required during the run" applies, and this file previously contributed
  nothing to the project's coverage stats simply because it did not exist. It now does: `sampleRssKb`
  (`workspace-watch-host-rss-sampler.js:20-45`) has three mutually-exclusive platform branches
  (`linux`/`win32`/other), of which only ONE executes on any single CI OS. This is a small, real drag
  on `coverageThreshold.global.branches: 75` (`jest.config.ts`) that did not exist before this batch —
  unlikely to tip a project with hundreds of files below the gate on its own, but worth naming rather
  than assuming `allowJs` was coverage-neutral. Not asserted anywhere as a risk in the report.

### git-watcher backport — does it change what ST-1/ST-1b measure?

Confirmed it does not, by reading `git-watcher.stress.harness.ts` directly rather than trusting the
report:

- `deleteInChildProcess` (`git-watcher.stress.harness.ts:96-106`) is a locally-duplicated copy (not a
  cross-boundary import — the file's own comment at `:90-94` and the report's "Shared-helper decision"
  correctly identify importing across the `apps/*` → `libs/backend/*` boundary as an
  `@nx/enforce-module-boundaries` violation, so duplication here is the deliberate, correct choice, not
  an oversight).
- `deleteAndSettle` (`:489-506`) only changes WHERE `fs.rmSync` executes (a separate `node -e` child
  instead of inline in the Jest process); it does not touch `GitWatcherService`, `fs.watch`, or
  anything the OS delivers to the watcher. `fs.watch`'s native notifications are generated by the
  filesystem itself regardless of which process issued the delete syscalls, so the SAME events reach
  the in-process `GitWatcherService` either way.
- `deleteAndSettle` is called from both the mechanism spec (`git-watcher.stress.spec.ts:70,110`) and
  the perf spec — confirmed the mechanism spec's own assertions (spawn counts, storm entered/exited,
  push counts) depend only on `CountingProcessSpawner`/`fs.watch` state, never on which process ran the
  delete, so they are unaffected. The report's own claim (`test-report-b15.md:185-187`, "unaffected by
  the fix... confirming the backport did not change mechanism behaviour") is accurate.
- Only the perf numbers benefit (ST-1 p99 16.6/max 24-25, ST-1b p99 16.7/max 33-34 — both comfortably
  inside AC-1/AC-2 P1 budgets), which is the intended and honest effect of moving CPU-heavy work off
  the measured process.

### Batch bound `< 100` with 3 observed — margin assessment

`expect(result.batches).toBeLessThan(100)` (`workspace-watch-host.stress.spec.ts:107`) against an
observed value of 3 across every recorded run (both submissions) is a generous but not vacuous margin:
INV-1 bounds delivery to at most one batch per 250 ms per subscription, so over the ~10-13 s measured
window the theoretical ceiling is on the order of 40-50 batches even under a worst-case sustained
delivery rate; 100 sits above that theoretical ceiling with room for a slow CI machine's timer jitter,
while still being an order of magnitude below "thousands" (the actual regression this assertion exists
to catch — a per-event message reaching the test process). This is a reasonable choice, not a
rubber-stamp bound; it would catch the specific regression class ST-2 is designed to catch while
tolerating legitimate scheduling variance.

### Report accuracy vs. logs

Every number in the delta message (batches 3, restart 892-948 ms, degradations 1; perf ST-2 p99
18.55-19.58/max 26.56-36.14; AC-7 restart 902-905/p99 17.68-20.07; git-watcher backport ST-1 p99
16.6/max 24-25, ST-1b p99 16.7/max 33-34) is reproduced verbatim in `test-report-b15.md`'s own tables
(`:162-163,173-174,192-193`), and the report cites `D:\projects\ptah-437-backup\b15r-mechanism-final1/2.log`,
`b15r-perf-final1/2.log`, and `b15r-gitwatcher-perf-run1/2.log` as the source — consistent with what I
was told to treat as evidence without re-running anything. The report's own honesty pass (A1 restated
without hedging, AC-7 bare-kill caveat, FU-15a duplication follow-up) matches what the code and its doc
comments actually say; I did not find a claim in the report that overstates what the current code does.

### Delta verdict

- Recommendation: APPROVE, with one follow-up required before the next batch touches this file: return
  the degraded-path overflow-cadence counts on `DegradedPathResult` and move that one `if`/`throw` back
  into the spec as an `expect(...)`. It is a structural regression introduced by this same fix (not a
  correctness bug — the check still runs and still fails on a real problem), it is narrow, and it does
  not block accepting the batch's actual review-item fixes, all seven of which are verified correct.
- Confidence: HIGH — every claimed fix was checked against the current file content, not the report's
  narrative; the `allowJs` and git-watcher-backport questions were independently verified by reading
  the tsconfig pair and both harness files rather than accepting the report's summary.
- Residual risks carried forward from the base review, still open by design (not regressions): the
  composite native-loss + process-kill overflow path (documented, not tested); A1's Windows-overflow
  path remains unconfirmed by direct observation (documented honestly); the new coverage-branch
  exposure from the RSS sampler fixture (not previously flagged, low severity, worth a
  `/* istanbul ignore */`-style exclusion or a per-platform test double if the coverage gate ever gets
  tight).
