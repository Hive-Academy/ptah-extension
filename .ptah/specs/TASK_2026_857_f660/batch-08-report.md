# Batch 8 report — TASK_2026_857_f660

Executor: Claude backend-developer subagent. Status: complete, both checks green.

## Task 8.1 — one insert path, durable review holds, expiry to the ledger

`libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts`:

- **One insert path.** `apply` sends both `lane-completion` and `subagent-stop` rows through
  `store.insertStopWithHeldReports(row, now, reportEffectOf)`. The pipeline no longer calls
  `insertIfAbsent`. For both kinds, `result.invalid` is rejected as `invalid-payload`.
- **Insert callback.** The new `notifyInserted(row)` fires once, only when `result.inserted` is
  true, for lane rows and for `subagent-stop` rows. This covers the B7 hand-off. A throwing
  callback is logged as `Outcome insert callback failed`, the row stays stored, and draining
  continues. The swallow carries `// degradation-audit: reported - ...`.
- **Second producer.** A `subagent-stop` that did not insert calls
  `store.fillMissingSubagentJoin(runId, join)`. The first producer wins and the later one only
  fills null join fields.
- **Admission (`submit`).** The new helper `holdable(op)` decides what can wait:
  - a `review` to a missing run of any kind (lane or subagent) is held, with no held-deliverables
    precondition;
  - `deliverables` to a missing subagent run are held, as before;
  - `deliverables` to a missing lane run are refused as before (`run … not found`, plus the
    retry suffix while the store is closed).
  - While the store is closed, a review is admitted only for a run that the journal `heldRuns`
    index holds with an unexpired expiry, or that has a pending holdable report. The plan's
    "the journal heldRuns index covers the not-yet-open store" (implementation-plan.md:428-430)
    still applies.
  - `pendingHolds` now counts every pending holdable report that has no pending row, so lane
    review holds count against the 500 cap.
- **Apply (`applyReport`).** When the target is `missing`: a review of any kind, or subagent
  deliverables, is held under `HOLD_LIMIT`. Lane deliverables are rejected as `target-missing`.
- **Index.** `advanceIndex` clears a run's `heldRuns` entry on any row op (lane or subagent),
  because a lane insert now joins held reports too.
- **Expiry.** `expireHolds` still logs one `Outcome hold expired` warning per report. It now also
  writes each expired deliverables or review hold to the rejected ledger as
  `held-report-expired`, through `reject(op, reason, log = false)`, so no second warning is
  logged. Budget-stop expiry is unchanged: it is logged only.
- **Header.** The header comment is updated to the plan's wording.
- `onLaneRecordInserted` keeps its name. I did not rename it, and `register.ts` is untouched.

New cases in `outcome-write-pipeline.spec.ts`:

- the insert callback fires once for a new subagent row and skips the duplicate;
- two stop ops for one agent give one row with enriched join fields and one callback;
- a review before a subagent stop, with no held deliverables, is held and then joined
  (`reviseRounds` 1, receipt, no holds left);
- lane deliverables to a missing lane on a readable store are still refused, and the journal is
  unchanged;
- pending lane review holds count against the 500 cap: 499 indexed + 1 pending, so the next one
  gets `too many held reports`;
- an expired held review lands in the rejected ledger as
  `{kind:'review', runId, reportId, reason:'held-report-expired'}`, with exactly one warning.

## Task 8.2 — early-review integration spec

The new file `outcome-early-review.integration.spec.ts` uses the real `LaneOutcomeRecorder`,
`OutcomeWritePipeline` and stores. `describe.each` runs it over an in-memory store and a SQLite
store (`sqliteFixture`).

- For each of APPROVED, REJECTED and REVISE: `recorder.captureReview` before the lane row
  returns `{ok:true, state:'held'}`, and the hold carries `deterministicReviewReportId`. Then
  `recordLaneCompletion` inserts the row and joins the review: `finalReview` approved or
  rejected, or `reviseRounds` 1 for REVISE. A receipt is written and no holds remain.
- Replaying the same capture returns `applied`, and the counts do not change (receipt dedupe).
- A review whose lane never arrives: with a fake clock set past 24 h, it moves to the rejected
  ledger with `held-report-expired`.
- SQLite reopen: a review is held, then the pipeline is disposed and the DB is closed and
  reopened. The lane insert on the new store still joins it (`finalReview` approved).

## Files touched (absolute)

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/outcome-early-review.integration.spec.ts`
- MODIFIED (test-only, decisions.md row 20) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.backlog.spec.ts`
- MODIFIED (test-only, decisions.md rows 20 and 21) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.durability.spec.ts`
- MODIFIED (test-only, decisions.md row 21) `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/batch-08-report.md`

I did not touch `batches.md`, `task.md`, `di/register.ts`, the stores, or the
frontend/chat files.

## Verification

1. `npm run verify -- -p @ptah-extension/lane-outcomes`. The first run, before decisions.md
   row 21, failed with 8 tests (7 durability, 1 recorder). The final run after the approved
   edits printed:

   ```
   NX   3 tasks: 3 succeeded
   [verify 2026-10-30T20:06:09.655Z] lock released after 59.5s, exit code 0
   ```

2. `npm run verify -- -t lint -p degradation-audit`. This passed both times. Final run:

   ```
   Run duration:      9.9s
   [verify 2026-10-30T20:11:40.570Z] lock released after 16.7s, exit code 0
   ```

3. Mojibake: `grep "â€"` over all touched files found nothing.
4. Host typecheck: B8 does not list one. The change is internal to lane-outcomes and its
   public types are unchanged.

## Risks and how they were handled

- **Durability and admission semantics (plan F1).** Retry and rejection semantics are
  unchanged. A held review survives a restart: it is in the SQLite held table or the KV snapshot,
  and the journal index covers the closed store. The SQLite reopen integration case proves this.
- **Callback fires once.** It fires only on `result.inserted`. Covered by the lane and subagent
  duplicate-op cases. B7's async task-kind classification consumes the brief before its call, so
  a later producer's enrichment cannot classify twice. The recorder spec asserts
  `classify` was called exactly once.
- **Recorder absent or rejected.** A missing or throwing callback leaves the row stored and logs
  the existing diagnostic. Rejected ops go to the rejected ledger and never count as success.
- **Privacy.** Ledger entries and logs carry only kind, runId, reportId, reason and code. No
  review text or payload is logged or stored by the pipeline.
- **R12 degradation baseline.** The new swallow is annotated and the audit lint is green. No
  baseline was raised.
- **Unbounded growth.** Holds stay capped at 500, and the rejected ledger keeps the existing
  200-entry cap with an overflow counter.

## Decisions

| #      | Decision                                                                                                                                 | Options                                                      | Evidence                                                                                                                                                                                                                         | Reversible |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D-B8-1 | Keep the closed-store review refusal for a run without an unexpired index entry or a pending holdable report                             | (a) hold every review while closed; (b) keep the index check | implementation-plan.md:428-430 ("journal heldRuns index covers the not-yet-open store"). An unindexed run cannot be told apart from a stored row while closed. backlog.spec.ts cases at :101, :151 and :187 stay green unchanged | yes        |
| D-B8-2 | Expired deliverables/review holds write the rejected ledger quietly (`reject(..., log=false)`); budget-stop expiry is only logged        | ledger for all kinds; ledger for reports only                | Task 8.1 and plan :69, :421-423 (reports). Budget-stop expiry has its own `budget-stop-expired` diagnostic, and durability.spec.ts asserts one warning there                                                                     | yes        |
| D-B8-3 | Did not rename `onLaneRecordInserted`                                                                                                    | rename now; keep                                             | The orchestrator asked to prefer not renaming. `register.ts` is owned by B9                                                                                                                                                      | yes        |
| D-B8-4 | A later `subagent-stop` that does not insert calls `fillMissingSubagentJoin` in the pipeline, beside the recorder's in-memory enrichment | pipeline only; recorder only; both                           | plan :408-409. This covers a restart or an evicted `subagentRuns` entry, where the recorder re-enqueues                                                                                                                          | yes        |

### Scope exception, decisions.md row 20: assertions edited to F1 semantics (implementation-plan.md:410-420)

1. `outcome-write-pipeline.backlog.spec.ts:22-62`. Old title: "rejects an unknown lane review
   while an open store has SQLITE_BUSY writes". New title: "holds …".
   - Old: `{ok:false, error:'run L9 not found'}`, journal unchanged, no writes, 0 holds.
   - New: `{ok:true, state:'held', runId:'L9'}`, `nextSeq+1`, heldRuns
     `[{runId:'L9', expiresAt:0, holdExpiries:[n]}]`, storage written, 1 held review. Row and
     receipt are still absent.
   - Plan :412.
2. `outcome-write-pipeline.backlog.spec.ts:~150-165` ("lets a readable store reject a stale
   held-run index and rebuilds it").
   - Old: `{ok:false, 'run subagent:v not found'}`, heldRuns `[]`.
   - New: `{ok:true, state:'held'}`. heldRuns is rebuilt to hold only the new review's expiry,
     and the stale expiry is gone.
   - Plan :412 (no deliverables precondition).
3. `outcome-write-pipeline.backlog.spec.ts:~620-650` ("dead letters a missing report target
   once").
   - Old: the enqueued review to `lane:missing` was immediately rejected with `target-missing`.
   - New: the review is held, with no ledger entry. After the fake clock moves 24 h ahead, the
     ledger holds exactly one `held-report-expired` entry for `report-70` and no holds remain.
   - Plan :418, :421-423.
4. `outcome-write-pipeline.durability.spec.ts:~384-415`. Old title: "dead letters a review after
   its pending stop fails validation". New title: "holds a review …".
   - Old: ledger `[ZOD_VALIDATION, target-missing]`, 2 warnings, 0 holds.
   - New: ledger `[ZOD_VALIDATION]`, 1 warning, the review `report-702` is held.
   - This spec has no fake clock, so expiry is asserted in item 3 and in the integration spec.
   - Plan :418.

### Scope exception, decisions.md row 21: fixtures retargeted to the one insert path (plan :403-405)

5. `durability.spec.ts:36-46` ("drains only the journal snapshot …").
   - Old: the spy on `insertIfAbsent`.
   - New: the spy on `insertStopWithHeldReports`, with the same enqueue-during-insert logic.
   - Added `expect(spy).toHaveBeenCalledTimes(4)`, which proves the hook fired.
6. `durability.spec.ts:~210-222` (OnceStore, "retries a transient middle insert").
   - Old: the fault hit the first `insertStopWithHeldReports` call, which used to be the
     subagent row.
   - New: the fault is guarded by `args[0].runId.startsWith('subagent:')`, so it still hits the
     "middle" subagent insert.
   - Fault proof: the existing assertions that lane:2 is not yet applied and that one
     `Outcome write deferred` warning is logged.
7. `durability.spec.ts:~259-270` (FailingStore, "restarts during a transient streak").
   - The same subagent-prefix guard as item 6.
   - Fault proof: the existing journal `toHaveLength(2)` after the first run.
8. `durability.spec.ts:~312-325` (StreakStore).
   - Old: the `insertIfAbsent` override.
   - New: the `insertStopWithHeldReports` override, with the same `lane:2` two-failure streak.
   - Fault proof: the existing `order` equals `['lane:1']` after the first flush.
9. `durability.spec.ts:~569-605` (StalledStore, "closes intake … at its deadline").
   - Old: the `insertIfAbsent` override.
   - New: the `insertStopWithHeldReports` override, with the same gate.
   - Added a `stalls` counter and `expect(stalled.stalls).toBe(1)`.
10. `durability.spec.ts:~733-748` (PausedStore, "preserves an op appended while another op is
    applying").
    - Old: the `insertIfAbsent` override.
    - New: the `insertStopWithHeldReports` override, with the same `lane:1` pause.
    - Fault proof: `await started` (the test cannot proceed unless the hook ran) and the
      existing `applied` order.
11. `durability.spec.ts:~785` ("does not duplicate a dead letter on replay").
    - Old: `reportOp('lane:absent', 20, 'review')`.
    - New: `reportOp('lane:absent', 20)` (lane deliverables, still `target-missing`), with the
      one-line comment "under F1 an early review is held, not dead-lettered". The dedupe
      assertions are unchanged.
12. `lane-outcome-recorder.service.spec.ts:~571-572` ("classifies a first-producer brief from
    the insert callback").
    - Deleted the `taskKindSource === 'unclassified'` expectation and the manual
      `recorder.onLaneRecordInserted(row)` call.
    - The remaining `expect(tasks.classify).toHaveBeenCalledTimes(1)` and `taskKind 'plan'`
      prove that the pipeline's callback fired for the subagent row and that nothing
      classified twice.

## Hand-off to B9

- `onLaneRecordInserted` was not renamed. If B9 renames it to `onRecordInserted`, update
  `di/register.ts:~74-77`, the pipeline constructor parameter, the recorder method, and its
  callers in `lane-outcome-recorder.service.spec.ts` and `outcome-early-review.integration.spec.ts`.
- The pipeline now fires the insert callback for `subagent-stop` rows. When B9 subscribes
  `recordSubagentEnded`, the first-producer classification runs from the pipeline callback, so
  no extra wiring is needed.
- `store.hasHeldDeliverables` is no longer called by the pipeline. It stays on the
  `LaneOutcomeStore` port because the stores and their specs still implement it. Removing it is
  a separate cleanup and not in B8's scope.
- `backlog.spec.ts:26-30` BusyStore still overrides `insertIfAbsent`, which the pipeline no
  longer calls. The test passes, but that override is now inert (decisions.md row 20 limited the
  change to assertion edits only).
