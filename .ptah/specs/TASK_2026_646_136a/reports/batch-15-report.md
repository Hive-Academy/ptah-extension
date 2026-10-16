# Batch 15 (B4b) report

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-15-report.md`

## Task evidence

- 15.1: `key-value-outcome-journal.ts:25-80` persists a FIFO value under one key, serializes concurrent writes, enforces 5,000 entries with a durable refusal count, and prunes expired hold values. `key-value-outcome-journal.spec.ts:21-57` covers restart, bound, rejected update and expiry. Public exports are at `src/index.ts:19-35`.
- 15.2: `outcome-write-pipeline.ts:100-149` validates report targets and global held-report capacity before acceptance. `:171-248` drains at most 25 operations, retries transient failures and acknowledges after the journal rewrite. `:256-270` rebuilds the hold index when a hold-table reader is supplied. `:292-335` applies reports and writes dead letters. `:336-342` handles shutdown. Public exports are at `src/index.ts:30-36`.

## Acceptance fixtures

| Fixture | Spec name | Status |
| --- | --- | --- |
| Unknown lane id, no journal change | `rejects an unknown lane target without changing the journal` | Covered for a closed store |
| Unknown subagent review, no journal change | `rejects an unknown review even when the store is closed` | Covered |
| Readable store with 500 held rows, 3 expired and a sweep within 60 s | `uses unexpired rows for the readable-store capacity check` | Covered with seeded rows and a prior sweep |
| Readable store with 500 unexpired rows | `refuses the 501st unexpired hold without a journal write` | Covered |
| Insert before its report | `applies an insert before its following report` | Covered |
| Applied and acknowledged hold, outage, review and join | `recognizes an acknowledged hold during an outage and joins its review after reopen` | Covered for one run |
| Journal restart, bound and rejected update | `survives restart with FIFO order and a durable refusal count`; `does not acknowledge a rejected update` | Covered |
| Per-report expiry in held index | `prunes expired held reports and preserves the unexpired count` | Covered |
| Other required variants: backlog unknown-id (a)-(e), dead-lettered target, hold cap (i)-(v), held review (i)-(iv), replay failure, recovery, ack crash, 1,500 pre-open operations, shutdown deadline | No specs | **Not done** |

## Assumptions and unresolved contract gaps

- A readable store's hold count means unexpired rows globally: `store/lane-outcome.store.ts:36` declares `countHeldReports(nowMs)`; `store/in-memory-lane-outcome.store.ts:105-108` filters by expiry. The pipeline calls it at `outcome-write-pipeline.ts:115` and `:302`.
- An applied hold must preserve the report verdict for a later join: `outcome-write-pipeline.ts:307` puts it in the serialized held payload; `:273-283` reads it on stop.
- Batch 6's `LaneOutcomeStore` has no non-destructive held-report enumeration method. `outcome-write-pipeline.ts:43-47` therefore accepts an optional `listHeldReports` capability and `:256-270` uses it for store-wins rebuild. Without a caller-provided reader, the required rebuild at open is **not satisfied**. The caller must supply a reader; no Batch 6 file was edited.
- Batch 6 has no atomic method to update a row and its receipt, or to insert a stop, join held reports and write receipts in one transaction. `outcome-write-pipeline.ts:286-290` and `:311-319` use separate store calls. An ack crash between those calls can double-apply a review or lose a held join, so the required ack-crash guarantee is **not satisfied**. KV `evict()` removes receipts without kept rows (`store/key-value-lane-outcome.store.ts:77-88`); this pipeline writes receipts after row updates at `outcome-write-pipeline.ts:319`, but Batch 6's separate writes still leave an atomicity gap.
- The existing row schema has no `budgetStopped` field. The `budget-stop` branch at `outcome-write-pipeline.ts:289` maps the event to `failureClass: 'timeout'`; this is a provisional semantic mismatch and needs a schema/store contract decision.
- The journal rejection key is written separately from its acknowledgement (`outcome-write-pipeline.ts:322-333`, `:232-235`), so a crash can duplicate a dead-letter entry.

## Decisions

- No Batch 6 store or schema file was changed because the assigned scope permits only `write/` and `src/index.ts`. The atomicity and hold-table read gaps above need team-leader follow-up.
- Nx and Jest were not run, per decision #53 and the batch instruction. No compile or runtime verification is claimed.
