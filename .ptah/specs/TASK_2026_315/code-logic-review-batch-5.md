# Code Logic Review - TASK_2026_315 / Batch 5 (C2)

## Review Summary

| Metric              | Value                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| Overall Score       | 8/10                                                                   |
| Assessment          | APPROVED                                                               |
| Critical Issues     | 0                                                                      |
| Serious Issues      | 0                                                                      |
| Moderate Issues     | 1                                                                      |
| Minor Issues        | 3                                                                      |
| Failure Modes Found | 4 (all pre-existing or non-exploitable, none introduced by this batch) |

This batch was independently re-verified against source rather than accepted on the
report's word: every producer call site was grepped, the fail-before/pass-after test
was actually reverted and re-run, typecheck/lint were re-run, and the operational
claim about `nx test a b c` was reproduced. No claim in `batch-5-report.md` was found
to be false. The issues below are gaps the report did not surface, not
misrepresentations of what it did surface.

## The 5 Paranoid Questions

### 1. How does this fail silently?

It mostly doesn't — that is the point of the batch. But one silent gap survives
untouched: the two **daily-backup** handlers
(`thoth-runtime/start-thoth-cron.ts:207`, `cli-engine/thoth-runtime.ts:424`) still
return `{ summary: 'skipped: no sqlite connection' }` on their own no-op path,
with no `outcome: 'skipped'`. `JobRunner` will record that as `succeeded` — the
exact defect shape C2 fixes, on a sibling handler this batch correctly left alone
(the report says so explicitly and I confirmed it's unmodified). Not a regression,
but the same lie survives one file over.

### 2. What user action causes unexpected behavior?

A user watching the Ink TUI's run history (`SchedulesPanel.tsx`, `mode === 'runs'`)
after this fix sees `skipped` instead of the old `succeeded` — a real improvement —
but never sees _why_. The panel renders `run.status` and `run.errorMessage` only;
`run.resultSummary` (where the skip reason lives) is never read in that file. A
user debugging "why did synthesis stop" from the TUI gets the correct verdict and
no explanation, while the same user in the Angular drawer gets both. This is a
pre-existing gap in `SchedulesPanel.tsx` (not part of this batch's diff), but the
batch's own stated purpose — "`cron:runs` history distinguishes the three outcomes
for a user debugging why synthesis stopped" — is only half-delivered on that one
surface.

### 3. What data makes this produce wrong results?

`job-runner.ts:187`'s fallback chain `result.reason ?? result.summary ??
'handler-skipped'` uses `??`, not `||`. A handler that returned `{ outcome:
'skipped', reason: '' }` would write the literal empty string to
`job_runs.result_summary` (not `'handler-skipped'`), and the drawer's
`run.resultSummary || run.errorMessage || ''` treats `''` as falsy and falls
through past it. No current producer emits an empty-string reason — the drain
always does `summary.reason ?? 'unknown'` — so this is not exploitable today. It
is a fragile assumption a careless future producer could trip.

### 4. What happens when dependencies fail?

Checked and clean: `tryClaim` throwing `SlotAlreadyClaimedError` is swallowed
inside `JobRunner.run` before reaching the new branch (pinned by the "returns
quietly" test), so a catchup replay hitting an already-claimed slot cannot surface
as an error. `dispatch()` throwing still lands in the unchanged `catch` block and
is recorded `failed`, never miscategorized as `skipped` — pinned by "still records
a thrown handler as FAILED" and independently re-read against source.

### 5. What's missing that the requirements didn't mention?

The batch's own consumer-blast-radius check missed that the reason token, despite
reaching `job_runs.result_summary`, does not reach the TUI's run-history view at
all (see Q2). `tasks.md`'s acceptance criterion — "Every one of the three
consuming surfaces above renders the outcome correctly" — is satisfied at the
status level (`skipped` vs `succeeded`) for all three, but the report's own framing
("the whole point of the fix" is to let a user find _why_) is not fully met on the
TUI. Worth a follow-up task; not a defect in what Batch 5 was scoped to touch.

## Failure Mode Analysis

### Failure Mode 1: TUI run-history never shows the skip reason

- **Trigger**: A budget-exhausted (or on-battery/disabled/foreground-active)
  drain tick, viewed via `ptah-tui`'s Schedules panel run history.
- **Symptoms**: The row shows `skipped` (correct, thanks to this fix) but no
  reason text — `run.errorMessage` is null for a skip, and `resultSummary` is
  never read by `SchedulesPanel.tsx`.
- **Impact**: Moderate. The specific class of user this fix targets — someone
  checking `cron:runs` to find out why background synthesis stopped — gets a
  status but not an explanation, on this one surface only.
- **Current handling**: Pre-existing; not touched by this batch's diff
  (confirmed: `SchedulesPanel.tsx` has zero occurrences of `resultSummary`).
- **Recommendation**: Follow-up task to render `run.resultSummary` in the TUI
  run-history row, mirroring the Angular drawer's `run.resultSummary ||
run.errorMessage || ''`.

### Failure Mode 2: Sibling backup-handler no-op still misreports as succeeded

- **Trigger**: `startThothCron`'s daily backup handler runs with
  `refs.sqliteConnection === null`.
- **Symptoms**: Returns `{ summary: 'skipped: no sqlite connection' }` with no
  `outcome` field, so `JobRunner` takes the `else` branch and calls
  `markSucceeded`. `cron:runs` would show `succeeded` with a summary that says
  "skipped" in prose — the identical defect shape C2 exists to remove, on the
  sibling handler in the same two files.
- **Impact**: Low today (a missing sqlite connection at backup time is rare and
  itself abnormal), but it is the same class of lie in the same run-history
  surface.
- **Current handling**: Confirmed unmodified by this batch, in both
  `start-thoth-cron.ts:207-211` and `cli-engine/thoth-runtime.ts:424-428` — this
  matches the report's explicit statement that the backup handler is untouched.
- **Recommendation**: Out of scope for Batch 5 (correctly identified as such by
  the developer); flag for a future finding/task rather than silently living
  with two instances of the pattern this task was created to eliminate.

### Failure Mode 3: Empty-string reason defeats the `??` fallback chain

- **Trigger**: A hypothetical future handler returning `{ outcome: 'skipped',
reason: '' }`.
- **Symptoms**: `result.reason ?? result.summary ?? 'handler-skipped'` resolves
  to `''` (not the intended fallback), stored verbatim in
  `job_runs.result_summary`. The Angular drawer's `run.resultSummary ||
run.errorMessage || ''` then falls through past the empty string to
  `errorMessage` (null) or `''`, rendering a blank row.
- **Impact**: Low — no current producer can trigger it (`DrainSkipReason` is a
  closed string union and the actual call sites always supply `?? 'unknown'`).
- **Current handling**: Not guarded against; relies on producer discipline.
- **Recommendation**: Not blocking. Could be hardened later (e.g. treat a
  blank string same as `undefined`) but doing so now would be defending against
  a case that cannot occur with any registered handler.

### Failure Mode 4: `lastRunAt` bump documented as a new decision when it is unchanged pre-existing behavior

- **Trigger**: None — this is a documentation-precision finding, not a runtime
  failure mode.
- **Symptoms**: The report frames "bumping `lastRunAt` on the handler-skipped
  path" as "one judgement call... documented in a code comment," implying a
  choice made during this batch. Re-reading the actual diff
  (`git diff -- libs/backend/cron-scheduler/src/lib/job-runner.ts`) shows the
  `if (!opts.suppressJobTimestamps) { this.jobs.update(...) }` line is
  **unchanged context**, not a `+` line — it ran unconditionally after every
  non-throwing `dispatch()` before this batch too (the old code called
  `markSucceeded` then always bumped `lastRunAt`, regardless of what the
  handler's summary prose said). Only the _comment_ explaining the (identical)
  behavior is new.
- **Impact**: None functionally — I independently confirmed no regression:
  `catchup-coordinator.ts:99`'s `since = Math.max(cutoff, job.lastRunAt ??
cutoff)` already treated every prior "succeeded-but-actually-gated" tick the
  same way, and `computeMissedSlots` only enumerates slots strictly after
  `since`, so a genuinely due future slot is never suppressed by this. The
  reasoning in the code comment is correct.
- **Recommendation**: None blocking — purely a note that the report's framing
  overstates this as a decision made now versus a decision (correctly) not
  to touch pre-existing behavior.

## Verified Claims (re-checked against source, not accepted on trust)

| Claim                                                                                                                                                 | Verification method                                                                                                                                                                                        | Result                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly two `JobHandlerResult` producer seams                                                                                                         | Grepped every `handlerRegistry.register(` call site repo-wide (excluding specs)                                                                                                                            | CONFIRMED — exactly 4 call sites in exactly 2 files (`thoth-runtime/start-thoth-cron.ts:104,207`; `cli-engine/thoth-runtime.ts:424,497`); no third file registers a handler                                                       |
| Backup handlers untouched, still bare `{ summary }` on the no-op path                                                                                 | Read both handler bodies                                                                                                                                                                                   | CONFIRMED (see Failure Mode 2 for a caveat on their own no-op path, unrelated to this batch's edits)                                                                                                                              |
| `lastRunAt` bump distinction (handler-executed vs runner-owned skips)                                                                                 | Read `job-runner.ts`, `git diff`                                                                                                                                                                           | CONFIRMED — concurrency cap (`:157`) and abort (`:215`) paths never call `jobs.update`; the handler-executed path (success/skip/fail) always does, unchanged from pre-fix                                                         |
| Catchup safety: `lastRunAt` as replay floor, `UNIQUE` constraint as backstop                                                                          | Read `catchup-coordinator.ts` in full                                                                                                                                                                      | CONFIRMED — `since` floor already excludes the just-fired slot regardless of outcome; `JobRunner.run` swallows `SlotAlreadyClaimedError` internally, never surfacing it to the coordinator                                        |
| Reason token passed through verbatim, no re-wording/truncation                                                                                        | Read `skill-drain.service.ts:181-186` (`DrainSkipReason` union), both producer diffs, `run.store.ts:135-147`                                                                                               | CONFIRMED — exact 5-member union (`disabled`, `daily-token-budget-exhausted`, `on-battery`, `foreground-active`, `aborted`) flows through `summary.reason ?? 'unknown'` unmodified into `markSkipped`                             |
| Consumers: drawer, TUI, CLI render `skipped` without fabricating a status; `ScheduledJobDto` not widened                                              | Read all three files plus two more the report flagged (`CronStateService.stats`, `cron:runNow`)                                                                                                            | CONFIRMED for status rendering and non-widening. See Failure Mode 1 for a gap the report did not raise (TUI never surfaces the reason text)                                                                                       |
| Modified test (`start-thoth-cron.spec.ts:394`) is a legitimate strengthening                                                                          | Read the diff                                                                                                                                                                                              | CONFIRMED — new assertion checks the first-class `{outcome, reason}` shape the runner actually consumes, replacing an assertion on prose the runner could not read                                                                |
| Task 5.2 fail-then-pass                                                                                                                               | **Independently reproduced**: reverted `job-runner.ts` to the unconditional `markSucceeded`, ran `npx nx test cron-scheduler --skip-nx-cache -- --testPathPattern=job-runner`, restored, re-ran full suite | CONFIRMED — reverted: 2 failed / 44 passed, identical failure messages to the report; restored: 5 suites / 46 tests passed                                                                                                        |
| `npx nx test a b c` silently runs only the first project                                                                                              | **Independently reproduced**: `npx nx test cron-scheduler skill-synthesis cli-engine --skip-nx-cache`                                                                                                      | CONFIRMED — ran only `@ptah-extension/cron-scheduler`, printed `No tests found, exiting with code 0`, and reported "Successfully ran target test for project @ptah-extension/cron-scheduler" (singular) despite three names given |
| `npx nx run-many -t test -p cron-scheduler skill-synthesis rpc-handlers cron-scheduler-ui thoth-runtime cli-engine` is the correct multi-project form | **Independently reproduced**                                                                                                                                                                               | CONFIRMED — 6 projects, matching suite/test counts from the report (`thoth-runtime`: 3/37; the four-project group: 15/145)                                                                                                        |
| Typecheck across 6 projects clean                                                                                                                     | **Independently reproduced**: `npx nx run-many -t typecheck -p ptah-tui ptah-cli cron-scheduler thoth-runtime cli-engine cron-scheduler-ui --skip-nx-cache`                                                | CONFIRMED clean                                                                                                                                                                                                                   |
| Lint clean except 2 named pre-existing warnings                                                                                                       | **Independently reproduced**: `npx nx run-many -t lint -p cron-scheduler thoth-runtime cli-engine cron-scheduler-ui --skip-nx-cache`                                                                       | CONFIRMED — exactly the same two warnings at the same lines (`cli-adapters.ts:249`, `thoth-runtime.spec.ts:14`), in files this batch's diff does not touch                                                                        |
| No `libs/backend/harness-sync/` file opened by this batch                                                                                             | `git status` / `git diff --stat`                                                                                                                                                                           | CONFIRMED — harness-sync's ~28 modified files are absent from this batch's diff of the 6 files under review                                                                                                                       |

## Operational Note — Confidence Impact on Earlier Batches

**The `npx nx test a b c` silent-truncation behavior is real and reproduced.**
Running `npx nx test cron-scheduler skill-synthesis cli-engine` executes only
`cron-scheduler`; the remaining names are passed through as Jest CLI args (here,
as a nonexistent `testPathPattern`), which is why it printed "No tests found,
exiting with code 0" and Nx still reported success. This means any earlier batch
in this task that verified with the space-separated multi-project form (`npx nx
test a b c`) instead of `npx nx run-many -t test -p a b c` may have verified only
the first-named project, with the rest silently skipped. This warrants
re-verification of batches whose verification commands used that form — flagging
per the explicit request in the task brief.

## Requirements Fulfillment

| Requirement                                                                                                                                                                   | Status   | Concern                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget-exhausted drain records `skipped` with reason, not `succeeded`                                                                                                         | COMPLETE | None                                                                                                                                                                                                                       |
| Drain doing real work still records `succeeded`                                                                                                                               | COMPLETE | None                                                                                                                                                                                                                       |
| Genuine failure still records `failed`                                                                                                                                        | COMPLETE | None                                                                                                                                                                                                                       |
| Existing skip paths (`:157` concurrency, `:215` abort — line numbers shifted slightly from the `:150`/`:181` cited in `tasks.md` due to added comments, same logic) unchanged | COMPLETE | None — confirmed byte-for-byte logic unchanged, only line numbers moved                                                                                                                                                    |
| Every consuming surface renders the outcome correctly                                                                                                                         | PARTIAL  | TUI shows the correct status but never the reason text (Failure Mode 1) — acceptance criterion is met at the letter (status renders correctly) but not at the stated spirit ("why synthesis stopped") for that one surface |
| No new `JobRunStatus` member, no wire/schema change                                                                                                                           | COMPLETE | Verified `rpc.types.ts` and `cron-rpc.handlers.ts` are absent from the diff entirely                                                                                                                                       |
| Task 5.2 named regression test, fail-before/pass-after                                                                                                                        | COMPLETE | Independently reproduced, not just re-read                                                                                                                                                                                 |

## Edge Case Analysis

| Edge Case                                                 | Handled          | How                                                                                | Concern                             |
| --------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| Handler omits `outcome` (pre-existing handlers)           | YES              | Defaults to `succeeded` branch                                                     | None — pinned by test               |
| Handler returns `{ outcome: 'skipped' }` with no `reason` | YES              | Falls back to `summary`, then `'handler-skipped'`                                  | None — pinned by test               |
| Handler returns `{ outcome: 'skipped', reason: '' }`      | NO (theoretical) | `??` does not treat `''` as absent                                                 | Low — no current producer does this |
| Concurrency cap / abort skips                             | YES (unchanged)  | Runner-owned branches, `lastRunAt` untouched                                       | None — pinned by test               |
| Catchup replay of an already-run (including skipped) slot | YES              | `since` floor excludes it; `SlotAlreadyClaimedError` swallowed if it somehow tried | None                                |
| Wire/DTO widening temptation                              | YES (resisted)   | `ScheduledJobDto` and `rpc.types.ts` untouched                                     | None                                |
| Multi-surface consumer check                              | PARTIAL          | Drawer/CLI fully verified; TUI renders status but not reason                       | Moderate (Failure Mode 1)           |

## Integration Risk Assessment

| Integration                                                                                     | Failure Probability | Impact                                                                       | Mitigation                                  |
| ----------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `JobRunner` → `RunStore.markSkipped`                                                            | LOW                 | Handled — reason written to `result_summary`, same column existing skips use | Pinned by test                              |
| `JobRunner` → `CatchupCoordinator` (via `lastRunAt`)                                            | LOW                 | None found — behavior unchanged, floor logic already correct                 | Verified by reading full coordinator source |
| Skill-drain seam → cron-scheduler seam (two producer files)                                     | LOW                 | Confirmed exactly two, both fixed identically                                | Grep-verified repo-wide                     |
| Cron backend → 5 consuming surfaces (drawer, TUI, CLI, `CronStateService.stats`, `cron:runNow`) | LOW-MODERATE        | TUI loses reason text                                                        | Follow-up task recommended, not blocking    |

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH
**Top Risk**: None blocking. The one user-facing gap (TUI never renders the skip
reason) is pre-existing, outside this batch's touched files, and does not
contradict any acceptance criterion literally — it just means the fix's stated
goal ("find out why synthesis stopped") is only fully realized on two of the
three surfaces. Recommend logging it as a follow-up finding rather than reopening
Batch 5.

## What a Bulletproof Implementation Would Additionally Include

- TUI run-history rendering `run.resultSummary` alongside `run.status`, matching
  the Angular drawer, so "why" reaches every surface the report says it does.
- The two untouched backup-handler no-op branches (`'skipped: no sqlite
connection'`) migrated to the `outcome: 'skipped'` channel in a follow-up task,
  closing the last instance of the pattern C2 exists to remove.
- A defensive `result.reason?.length ? result.reason : (result.summary ??
'handler-skipped')` in `job-runner.ts` to close the empty-string edge case,
  though this is optional given no current producer can trigger it.
