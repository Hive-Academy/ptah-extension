# Task 15.3 outcome pipeline fix round

## Files written

- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.backlog.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.durability.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\pipeline.test-support.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-15-3-report.md

The preceding lane also wrote outcome-write-pipeline.ts, report-effect.ts, and src/index.ts. This lane did not change those files or the store and journal contracts.

## Fix evidence

Paths are relative to libs/backend/lane-outcomes/src/lib.

| Fix | Evidence |
| --- | --- |
| F1 | write/outcome-write-pipeline.ts:267-273 edits the current journal value by acknowledged sequence; write/outcome-write-pipeline.durability.spec.ts:365 covers concurrent append. |
| F2 | write/outcome-write-pipeline.ts:324-327 invokes atomic stop join and rejects invalid held reports; write/outcome-write-pipeline.durability.spec.ts:296 checks a failed mid-join. |
| F3 | write/outcome-write-pipeline.ts:336-353 applies reports with receipts and handles missing, invalid, and full holds; write/outcome-write-pipeline.durability.spec.ts:174 checks a dead-lettered target. |
| F4 | write/outcome-write-pipeline.ts:307-318 rebuilds the held index from store rows; write/outcome-write-pipeline.backlog.spec.ts:66 and :282 cover stale and SQLite-deleted rows. |
| F5 | write/outcome-write-pipeline.ts:329 marks budget stops; write/outcome-write-pipeline.durability.spec.ts:415 asserts null failure class. |
| F6 | write/outcome-write-pipeline.ts:355-368 deduplicates dead letters by op; write/outcome-write-pipeline.durability.spec.ts:395 replays one. |
| F7 | write/outcome-write-pipeline.ts:220-243 warns once per expired entry; write/outcome-write-pipeline.spec.ts:111 checks two warnings. |
| F8 | write/outcome-write-pipeline.ts:45-56 and :113-115 validate payload before append; write/outcome-write-pipeline.durability.spec.ts:425 checks rejection. |
| F9 | write/outcome-write-pipeline.ts:371-389 closes intake and bounds disposal; write/outcome-write-pipeline.durability.spec.ts:271 checks deadline and remainder. |
| F10 | write/outcome-write-pipeline.ts:97-99 and :170-176 report prior and new refusals; write/outcome-write-pipeline.durability.spec.ts:213 checks the first full-journal refusal. |

The report-effect malformed JSON path at write/report-effect.ts:58-61 returns invalid; the pipeline logs the report ID at write/outcome-write-pipeline.ts:336-339. No payload text is logged.

## Fixture map

| Required fixture | Dedicated spec name |
| --- | --- |
| Backlog unknown (a), absent lane L9 while closed | rejects unknown review %s with unchanged journal (lane:L9) |
| Backlog unknown (b), open store with SQLITE_BUSY writes | rejects an unknown lane review while an open store has SQLITE_BUSY writes |
| Backlog unknown (c), unknown subagent review | rejects unknown review %s with unchanged journal (subagent:x) |
| Backlog unknown (d), deliverables before stop | holds an unknown subagent deliverables report and joins after stop |
| Backlog unknown (e), review behind pending insert | queues a review behind its pending insert |
| Held review outage base | recognizes a held deliverables report across an outage |
| Held review outage (i), restart closed | retains an acknowledged hold across a closed-store process restart and joins its review |
| Held review outage (ii), never-held review | rejects a never-held review during an outage without touching the journal |
| Held review outage (iii), stale index with readable store | lets a readable store reject a stale held-run index and rebuilds it |
| Held review outage (iv), expired index | rejects a review after its indexed hold expires while closed |
| Hold cap base, 500 held deliverables | counts 500 held reports globally and refuses the next one |
| Hold cap (i), review at 500 | refuses a review when 500 deliverables are held |
| Hold cap (ii), held review counted | counts a held review as the 500th report |
| Hold cap (iii), closed restart | preserves the 500 report cap across a closed-store restart |
| Hold cap (iv), first hold expires | accepts the next report after only the first of 500 timed holds expires |
| Hold cap (v), SQLite row deleted | rebuilds the held-run index from SQLite after a held row is deleted |
| R6-1, three expired among 500 | uses unexpired rows for the readable-store capacity check |
| R6-1, all 500 unexpired | refuses the 501st unexpired hold without a journal write |
| SC-7 B4, reports before stop and held review revise | joins reports submitted by runId and agentId before either stop |
| SC-7 B4, unknown subagent review | rejects an unknown review even when the store is closed |
| SC-7 B4, same slug, one held and one applied | keeps concurrent same-slug held and applied reports on their own runs |
| SC-7 B4, expiry warning | expires each old held report with one warning per report |
| SC-7 B4, 501st refused | refuses the 501st unexpired hold without a journal write |
| SC-7 B4, KV restart with hold | joins a held report after a KV store and pipeline reopen |
| SC-7 B4, SQLite reopen with hold | joins a held report after the SQLite file is reopened |
| Delayed open, three rows | keeps three completions journaled until delayed open and drains in order |
| Delayed open, restart and replay twice | restarts before delayed open and replays three journaled rows once |
| Report before open, queued after stop | applies a report queued behind a stop before open |
| Stop and report ordering | applies an insert before its following report |
| Replay failure, ordered suffix, retry and log | retries a transient middle insert without overtaking it |
| Restart during failure streak | restarts during a transient streak and drains the ordered suffix |
| Recovery with a fourth queued op | keeps a new op behind a transient failure streak and recovers in order |
| Permanent Zod failure | dead letters a permanent Zod row and applies entries behind it |
| Dead-lettered target after invalid stop | dead letters a review after its pending stop fails validation |
| Ack crash, lane L1 | replays an acknowledged row without duplication after an ack failure |
| Ack crash, review revise | applies a revise report once across an ack crash |
| 1,500 pre-open operations, 25 per turn | handles 1500 pre-open completions in 25-op turns |
| 5,000 plus one, durable counter | refuses the 5001st journal entry and preserves its capacity count across restart |
| VS Code KV ack failure | retries a failed VS Code KV acknowledgement in FIFO order |
| VS Code queue full | refuses the 1001st VS Code queue entry with one warning |
| Shutdown deadline and journal remainder | closes intake and journals the remainder when shutdown reaches its deadline |
| Budget stop | keeps budget stops separate from failure classification |
| Failed join atomicity | keeps every held report and the row absent when a stop join throws mid-join |
| Concurrent append during apply | preserves an op appended while another op is applying |
| Dead-letter replay | does not duplicate a dead letter on replay |

## Validation

- npx eslint on the four edited write files plus report-effect.ts: exit 0, no output.
- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1, filtered to lane-outcomes, FAIL, TOTAL: exit 0; no lane-outcomes or FAIL line; degradation-audit: TOTAL 296 unsuppressed site(s). The lane-outcomes baseline remains 0.
- Nx and Jest were not run, per decision #53. The tests therefore have not been executed by this lane.

## Decisions

- The test helper creates a SQLite schema matching the store test support at store/sqlite-lane-outcome.store.spec.ts:14-48; its database file is removed by the owning spec.
- The 500 report cap and expired-row rule are from implementation-plan.md:538-550 and batches.md:724-728.
- The pre-open and capacity limits are from implementation-plan.md:579-640. The 5,000 row spec checks lane:4999 directly because listByLane is capped at 2,000 rows by the store contract.

## Not done

The pipeline accepts runId on report ops; resolving a submitted agentId to runId lives outside the allowed pipeline files. The combined SC-7 B4 test covers the downstream run identity and distinct agentId records, but does not execute the host's agentId resolver. No pipeline production change was needed in this lane. Jest and Nx execution remain with the team leader.
