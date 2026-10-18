# Task 15.3 TL-23 fix round

Paths below are relative to `libs/backend/lane-outcomes/src`.

| TL-23 item | Fix and proving spec |
| --- | --- |
| 1 FIFO and data loss | `lib/write/outcome-write-pipeline.ts:258-287` moves queued ops and the submitted report in one journal update, preserving capacity behavior; `:324` prevents a drain during acceptance. `lib/write/outcome-write-pipeline.backlog.spec.ts:264` (`queues a review behind its pending insert`), `lib/write/outcome-write-pipeline.durability.spec.ts:367` (`dead letters a review after its pending stop fails validation`), and `:630` (`preserves an op appended while another op is applying`, including the apply order at `:679`). |
| 2 Expiry warnings | `lib/write/outcome-write-pipeline.ts:424-460` shares expiry and warning logic with the sweep at `:356` and the hold path at `:577`. `lib/write/outcome-write-pipeline.spec.ts:194` (`expires each old held report with one warning per report`) seeds both old reports without purging; `:232` (`warns when applying a report clears an expired hold`) exercises the hold path. |
| 3 Budget stop fixtures | `lib/write/outcome-write-pipeline.durability.spec.ts:711` (`keeps budget stops separate from failure classification`) now asserts the flag after insert, duplicate replay, and one `budget-stop-expired` warning for an orphan marker older than 24 hours. |
| 4 Atomic join retry | `lib/write/outcome-write-pipeline.durability.spec.ts:518` (`keeps every held report and the row absent when a stop join throws mid-join`) fails once, then retries and checks one row, both receipts, one revise round, no holds, and an empty journal at `:562-570`. |
| 5 Backlog case (d) | `lib/write/outcome-write-pipeline.backlog.spec.ts:222` (`holds an unknown subagent deliverables report and joins after stop`) starts closed with journal L1, checks one appended report, holds it when opened, then joins on S(y). |
| 6 Held review outage | `lib/write/outcome-write-pipeline.backlog.spec.ts:277` (`recognizes a held deliverables report across an outage`) checks the held index before and after, one appended review, deliverables verdict, exactly two receipt IDs, one revise round, and an empty hold table. |
| Moderate deadline loop and timer | `lib/write/outcome-write-pipeline.ts:318-321` stops `flush()` after disposal; `:621-642` marks disposal at the deadline and clears the race timer. Existing spec `lib/write/outcome-write-pipeline.durability.spec.ts:477` (`closes intake and journals the remainder when shutdown reaches its deadline`) covers the deadline. |
| Minor export | `index.ts:12` exports `HeldEntryKind`. |

No store, journal, or report-effect file was changed. The recorded minor issue about a VS Code queued write returning `applied` remains outside this fix round.

## Permitted checks

- `npx eslint` on the five changed source/spec files: exit 0, no diagnostics.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1` (filtered for lane-outcomes, FAIL, TOTAL): `degradation-audit: TOTAL 296 unsuppressed site(s)`; no `lane-outcomes` or `FAIL` line.
- `npx prettier --write` on those five files: completed. No Nx or Jest command was run, per decision #53; the specs above are added assertions, not an executed test result.
