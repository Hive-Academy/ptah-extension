# Batch 3 fixes: M1, M2, m1 (TASK_2026_440_834c)

All three findings from `code-logic-review-batch-3.md` are fixed. I edited only files under `libs/backend/memory-curator/src/lib/retention/`. I did not run `nx reset`, did not commit, did not edit `batches.md`, and did not open `~/.ptah` or any real database.

## M1: the default windows now slide with the run clock (integration)

**Test changed:** `memory-retention.integration.spec.ts` › `purges, quarantines, reclaims and records; run 2 is not due; run 3 slides the default windows; run 4 is idempotent`

- Runs 1 and 2 are unchanged. Run 2 still asserts `not-due` and no state write.
- The old run 3 changed the settings to 8/15 days and expected zero work. It has been **replaced**.
- **New run 3** runs at `NOW + 25h` with the default 7/14-day windows and no settings change. It asserts:
  - `status: 'completed'`, `reason: null`, `processedPurged: 50` (P-new), `stuckQuarantined: 40` (U-grace), `ledgerPruned: 0`, `backlogRemaining: false`, `error: null`.
  - Every P-new and U-grace id is gone. The only rows left are the 10 P-old-captured-new-processed rows. Each one equals its pre-run-1 snapshot and still has `processed_at === NOW - DAY`.
  - The ledger `row_count` total is **340**, with 4 ledger rows.
  - Per-key numbers come from the real seed. The stuck seed gives 75 rows each to `u-0|tool-use`, `u-1|tool-use`, `u-0|user-prompt` and `u-1|user-prompt`. U-grace adds 20 `tool-use` rows each to `u-0` and `u-1`, with no payload.
    - For `u-0|tool-use` and `u-1|tool-use`, the prior `row_count` was 75 and is now **95**. `payload_bytes` and `oldest_captured_at` are unchanged. `newest_captured_at` is `NOW - 13d`, `first_quarantined_at` is `NOW`, and `last_quarantined_at` is `NOW + 25h`.
    - For `u-0|user-prompt` and `u-1|user-prompt`, `row_count` is still **75** and the whole row `toEqual`s its value before run 3.
  - State: `lastCompletedAt === NOW + 25h`, outcome `completed`, `backlogRemaining false`, `processedPurged 50`, `stuckQuarantined 40`, `processedRowsAfter 10`.
- **New run 4** (idempotence) runs at `NOW + 50h`. It is due, uses the defaults, and sees a clean cohort. It asserts:
  - The report `toEqual`s `{completed, reason null, all counters 0, freedBytes 0, pagesReclaimed 0, backlogRemaining false, durationMs 0, error null}`.
  - The ledger total is still **340**, the ledger rows are identical to those after run 3, and the queue snapshot is identical to the one after run 3.
  - `lastCompletedAt === NOW + 50h`.

## M2: combined row cap, prune after a row-budget stop, reclaim-stalled

### (a) and (b): integration

**Test added:** `memory-retention.integration.spec.ts` › `the row cap is shared across purge and quarantine; a row-budget stop still prunes the ledger and reclaims`

**Setup:**
- `maxRowsPerRun: 250` and `batchSize: 500`, so each step's limit is the allowance that is left.
- 100 eligible processed rows (fewer than 250) and 200 stuck rows (more than the 150 left after the purge). All rows carry an 8 KB payload.
- The store's `quarantineStuckBatch` is wrapped to record the limit it receives.
- Two ledger rows are seeded directly:
  - `old-s`, with `last_quarantined_at = NOW - 91d`. This is older than the 90-day bound.
  - `recent-s`, with `last_quarantined_at = NOW - 89d`.

**Assertions:**
- `status: 'partial'`, `reason: 'row-budget'`, `processedPurged: 100`, `stuckQuarantined: 150`, `ledgerPruned: 1`, `backlogRemaining: true`, `error: null`.
- `processedPurged + stuckQuarantined === 250`.
- The quarantine step was called with the reduced limit only: `quarantineLimits` `toEqual([150])`.
- All 100 processed ids are gone, the 150 oldest stuck ids are gone, and the 50 newest stuck ids survive (50 rows left).
- Ledger prune: `old-s` is gone. The ledger session list is exactly `['recent-s', 'u-0']`, and `u-0` has `row_count` 150.
- Reclaim still ran: `pagesReclaimed > 0` and `PRAGMA freelist_count === 0`.
- Raw `memory_retention_state` row: `last_outcome 'partial'`, `last_reason 'row-budget'`, `backlog_remaining = 1`, `ledger_pruned = 1`, `last_completed_at IS NULL`.

### (c): unit

**Test added:** `memory-retention.service.spec.ts` › `a reclaim step that frees nothing while a freelist remains stops once, partial / reclaim-stalled`

**Setup:**
- The fake reclaimer reports `autoVacuumMode 2` and `freelist 100`.
- `reclaimStep` is a `jest.fn` that returns `{ pagesReclaimed: 0, durationMs: 1 }`.
- If a second call ever happens, the fake aborts the run. A regression that spins then fails on the call count instead of hanging the suite.

**Assertions:**
- `reclaimStep` is called exactly once, with `100`.
- The report matches `{ status 'partial', reason 'reclaim-stalled', pagesReclaimed 0, backlogRemaining true, error null }`.
- The freelist is still 100, there is 1 checkpoint and 1 run record (`outcome partial`, `reason reclaim-stalled`, `backlogRemaining true`, `completedAt null`).
- `run()` resolves.

## m1: freed bytes only from two valid page-stat samples

**Production change:** `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts`

- `:101-122`: new module function `purgeFreedBytes(before, after)`. It returns `null` unless both samples have a finite `pageSize > 0`, a finite `freelistCount >= 0`, and equal page sizes. Otherwise it returns `max(0, afterFree - beforeFree) * pageSize`.
- `:130-131`: new field `RunTally.freedBytesMeasured`, initialised to `false` at `:308`.
- `:371-373`: `tally.freedBytes = freed ?? 0` and `tally.freedBytesMeasured = freed !== null`. This replaces the old calculation, which combined the two samples unconditionally.
- `:552` and `:583`: `finish` passes `tally.freedBytesMeasured` to `record(…, freedBytesMeasured)`.
- `:614-619`: `avgProcessedRowBytes` is only computed when `freedBytesMeasured && processedPurged > 0`. Otherwise it is `null`, which the store's `COALESCE` treats as "keep the previous value" (already pinned in `observation-retention.store.spec.ts`). A purge that fails before the second sample also no longer persists an average of 0.

**Tests added:** `memory-retention.service.spec.ts`

- `a degraded pre-purge page-stat sample records freedBytes 0 and keeps the previous average`
  - Prior state `avgProcessedRowBytes: 777`, a pre-existing freelist of 500 pages, and 10 processed rows.
  - The first `readPageStats` returns all zeros. Later reads are real, so the post-purge sample shows 510 free pages at 4096 bytes. The old code would have reported `510 * 4096` bytes.
  - Asserts the report is `completed`, `processedPurged 10`, `freedBytes 0`, and the run record has `processedPurged 10`, `freedBytes 0`, `avgProcessedRowBytes null` (the previous 777 is kept).
- `page-stat samples with different page sizes are not compared`
  - The first sample reports `pageSize 1024` and the second reports `4096`.
  - Asserts `freedBytes 0` and `avgProcessedRowBytes null`.

## Verification

- `npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator --outputStyle=static`
  - Header: `Running targets typecheck, test, lint for project @ptah-extension/memory-curator`, so 1 project.
  - Result: `Successfully ran targets typecheck, test, lint for project @ptah-extension/memory-curator`.
  - Tests: 35 suites passed and 2 were skipped (the older native-gated suites, the same as before). 546 tests passed and 59 were skipped. This is the 542 from the review baseline plus 4 new tests.
  - Lint: 0 errors, 6 warnings, the same 6 as before (`max-lines` and similar in `memory-trigger.service.ts`, `memory-search.service.ts`, etc.). None is in a retention file.
  - I ran the gate twice: once after the edits, and again after `prettier --write` on the three edited files. Both runs gave the same result.
  - No failure pointed into `libs/backend/persistence-sqlite`, so there is nothing to attribute to Task 1.4.
- `npx jest -c libs/backend/memory-curator/jest.config.ts libs/backend/memory-curator/src/lib/retention libs/backend/memory-curator/src/lib/di/register.spec.ts --json`:

| File | Status | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- |
| `retention/memory-retention.service.spec.ts` | passed | 30 (was 27; +3) | 0 | 0 |
| `retention/memory-retention.integration.spec.ts` | passed | 5 (was 4; +1, and the main test was extended) | 0 | 0 |
| `retention/observation-retention.store.spec.ts` | passed | 20 | 0 | 0 |
| `di/register.spec.ts` | passed | 2 | 0 | 0 |

The total for those four files is 57 passed, 0 pending, 0 failed.

## Files modified

- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\.ptah\specs\TASK_2026_440_834c\batch-3-fixes-report.md (this report)
