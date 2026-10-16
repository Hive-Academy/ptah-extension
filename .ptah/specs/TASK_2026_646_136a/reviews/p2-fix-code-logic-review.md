# P2 fix round - code logic re-review (Batch 36, commit 8cd5cc212)

- Task: TASK_2026_646_136a
- Scope: `git diff 8cd5cc212^..8cd5cc212 -- libs/backend/lane-outcomes` (18 files). Whole files read for
  `outcome-write-pipeline.ts`, `key-value-outcome-journal.ts`, `key-value-lane-outcome.store.ts`,
  `lane-outcome.store.ts`, the changed regions of `sqlite-lane-outcome.store.ts`, `di/register.ts`, the
  new specs, and the executor report `reports/batch-36-report.md`. Read-only; no Nx, Jest or build run
  (nothing re-executed; the "13 suites / 116 tests pass" claim in batches.md is taken from the team leader).
- Implementer family: OpenAI (CLI lane codex). Reviewer family: Anthropic.
- Out of scope and not re-opened: LT-P2-1..LT-P2-14, every P2-m Minor.

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 2 |
| Minor | 4 |

Evidence separating 6 from 7-8: the five targeted fixes work on the paths the new specs exercise (single
drain/submit race, single accept failure, SQLite `Promise.all`, mixed-validity snapshots, TL-36 verdict
rule). But two of the checks named in the task (order kept when the journal write fails; no stall on
corrupt persisted data) are met only for the simple case, and the drain hand-off introduces a visibility
regression in `submit`. Evidence separating 6 from 4-5: no data loss, no rejecting `submit`, no leaked
message text, and the strict write-path decode is intact.

No TODO / PLACEHOLDER / STUB, empty body, mock data or logging-in-place-of-logic was found in the diff
(grep of added lines for TODO|PLACEHOLDER|STUB|FIXME returned nothing).

## Check results

| Item | Result | Evidence |
| --- | --- | --- |
| P2-F1 exactly once under drain/submit/enqueue race | PASS | `drain` `outcome-write-pipeline.ts:393-402` splices before the await; the count splice is gone; `accept` `:330` splices; `drain` returns while `accepting` (`:390`); journal `update` serialises on `tail` (`key-value-outcome-journal.ts:136-150`). Each op reaches exactly one `appendEntries` call. Race spec `outcome-write-pipeline.spec.ts:114-146` asserts three distinct seqs. |
| P2-F1 order kept when the journal write fails | PARTIAL | Single-owner case OK (`:400`, `:341` unshift to the front). Concurrent drain + accept under an outage inverts order, see M-1. Dispose does not restore, see m-1. |
| P2-F3 `submit` never rejects, fixed text, waiting ops kept | PASS | `accept` catch `:339-346` returns `'write-failed'` and logs only `runId` + `failureCode`; `submit` maps to the fixed `'outcome journal write failed'` at `:253-261` and `:313-321`. The store reads are inside a try (`:238-250`); `flush()`/`drain()` cannot throw (outer catch `:463-467`). Spec `:147-190` checks the text, one warn without message, and later apply. |
| P2-F4 SQLite `update` atomic | PASS | `sqlite-lane-outcome.store.ts:273-282`: SELECT, `decode`, `parse`, `UPDATE` all inside one synchronous `db.transaction(() => ...)()`; no `await`. Return value (`false` when missing, `changes > 0`) kept. Spec `sqlite-lane-outcome.store.spec.ts:90` covers the `Promise.all` interleave. |
| P2-F5 no throw on corrupt data | PARTIAL | KV store (`key-value-lane-outcome.store.ts:44-88`), rejected ledger (`outcome-write-pipeline.ts:190-203`), SQLite `decodeMany` (`sqlite-lane-outcome.store.ts:83-101`) and journal construction do not throw. Strict `decode` kept for `get`/`update`/transaction paths (`:69-80`, `:146`, `:215`, `:245`, `:274`). Warn contexts hold counts, ids and the fixed code only. The journal still accepts unusable `op` values, see S-1. |
| P2-F6 TL-36 rule | PASS | `lane-outcome.store.ts:49-61`: for `executorKind !== 'subagent'`, `failed` or non-null `failureClass` keeps `row.verdict`; `deliverablesDeclaredAt` (first kept), `taskKind`, `taskId`, `routingSource` still applied; subagent rows and the `review` branch (`:62-64`) unchanged. All three stores route through `applyOutcomeEffect` (in-memory `:64`, `:93`; SQLite `:156`). |
| Regressions in touched functions | FAIL (one) | M-2 (in-flight ops invisible to `submit`). |

## Five logic questions

1. Silent failure. A journal entry whose `op` is `null` (or missing) is accepted by `EntrySchema`
   (`key-value-outcome-journal.ts:31-34`, `op: z.unknown()`), survives construction with no
   `droppedOnRead`, and then makes `drain` stall without any warn (S-1). `decodeMany` warns, but labels
   every failure `ZOD_VALIDATION` even when the cause is not a Zod error (`sqlite-lane-outcome.store.ts:90-98`).
2. Unexpected user action. `enqueue(x)` followed at once by `submit(report for x)` while the drain
   journal write is in flight returns `run ... not found` (M-2).
3. Wrong answer from data. A non-subagent row with a null `failureClass` and verdict `unverified` becomes
   `delivered` (intended by TL-36). A row with `delivered`... cannot carry a class, so no wrong answer
   found. A skipped corrupt SQLite row silently shrinks a reader's result set (warned once per query,
   no row id).
4. Dependency failure. Journal storage failing during `accept` is handled. Storage failing during a
   concurrent `drain` + `accept` reorders the retry queue (M-1). Storage failing in `dispose` loses the
   spliced ops and rejects (m-1).
5. Missing but unspecified. No quarantine for dropped corrupt journal/KV entries: the first successful
   write after load overwrites the key and the dropped entries are gone for good (the report records this
   as a reversible decision; acceptable, only a warn count remains). No dedupe of the per-query
   `Lane outcome rows skipped` warn.

## Serious issues

### S-1. A malformed journal `op` stalls the whole write pipeline with a hot loop

- File: `libs/backend/lane-outcomes/src/lib/write/key-value-outcome-journal.ts:31-34`, `:107-110`;
  consumer `outcome-write-pipeline.ts:416-420`, `:468-476`.
- Scenario: persisted journal contains `{ seq: 1, op: null }` (or an entry with no `op`; `z.unknown()`
  accepts both). Construction keeps it (`droppedOnRead` stays 0, no warn). In `drain`,
  `next.entries[0].op` is nullish, so `if (!op) break` fires with `processed === 0`: no apply, no
  failure, no `defer`, no warn. The `finally` block then sees entries present, no `retry`, store open, and
  calls `schedule()`, which queues another `setImmediate` drain. The result is a CPU spin that never makes
  progress, and every later op stays behind the poison entry. A primitive `op` (for example `5`) instead
  reaches `'row' in op` in `apply` and throws a `TypeError`, which `isPermanent` (`:135-143`) does not
  classify as permanent, so it retries forever at the 60 s backoff with the head blocked.
- Impact: this is exactly the "tolerate corrupt persisted data" goal of P2-F5, and the journal is the
  durability layer for every outcome. One bad entry silently blocks all outcome recording and burns a core.
- Fix: validate `op` in `EntrySchema` (an object whose `kind` is one of the five kinds, with `row`,
  `report` or `runId` as appropriate) so a malformed entry is dropped and counted in `droppedOnRead`; and
  treat a non-actionable head entry in `drain` as a permanent reject instead of `break`.

## Moderate issues

### M-1. Queue order is not kept when drain and accept fail together

- File: `outcome-write-pipeline.ts:394-402` (drain), `:330-346` (accept); `key-value-outcome-journal.ts:136-150`.
- Scenario: `drain` owns `[a]` and is in `journal.update`; `enqueue(c)`; `submit` -> `accept` splices
  `[c]` and queues its own update behind the drain's on `tail`. Storage is down: the drain update rejects
  and its catch does `queue.unshift(a)`; the accept update then also rejects and its catch does
  `queue.unshift(c)`. Queue is `[c, a]`, original order was `[a, c]`. The same inversion happens when
  only the drain fails: the accept update's `edit` runs one or two microtask ticks after the rejection,
  before the drain's catch has restored `a`, so the journal gets `[c, report]` and `a` follows later.
- Impact: ops for the same run (a lane insert and a later budget stop) can apply in the wrong order after
  recovery. Exactly-once still holds. Spec coverage only has a single-owner failure.
- Fix: keep one ordered pending structure (for example a single in-flight list, or a sequence number
  assigned at `enqueue`) and restore by that order, not by `unshift` in completion order.

### M-2. Ops owned by `drain` are invisible to `submit`

- File: `outcome-write-pipeline.ts:394` (splice), `:226-232`, `:273-278`, `:303-310` (the `pending` scan).
- Scenario: before the fix `drain` left ops in `this.queue` until the journal write finished, so
  `submit`'s `pending` (journal snapshot + queue) saw them. Now `splice(0)` removes them for the length of
  the storage write, and `pending` also misses them in `pendingInsert`, `pendingHold` and the
  `pendingHolds` hold-limit count. `submit(report)` for a lane run whose `lane-completion` is mid-hand-off
  returns `run X not found`; a `review` whose `deliverables` is mid-hand-off is rejected; the hold limit
  can be exceeded by the in-flight count. `accept` already had this window; the fix widens it to the drain
  path.
- Impact: misleading, visible error on a narrow timing window. `submit` has no host caller yet (wired in
  a later batch), so no user sees it today.
- Fix: track the ops a drain or accept currently owns in a field (`inflight`) and include it in `pending`.

## Minor issues

- m-1. `dispose` (`:704-709`) splices `remaining` and, if `journal.update` throws, drops them and rejects
  `dispose()`; no restore. The check list names dispose; the plan only asked for the shared append rule.
- m-2. `findLatestByAgent` (`sqlite-lane-outcome.store.ts:293-298`) is a read path and still uses the
  strict `decode`, so one corrupt newest row throws. Not in the listed scope (`decodeMany` only); noted.
- m-3. `decodeMany` warns on every query that meets a corrupt row, with a count and no id, so a persistent
  bad row logs on every reader call and cannot be located. Catch is not limited to `ZodError`.
- m-4. The journal envelope schema rejects the whole value if `nextSeq` is not a positive integer or
  `droppedAtCapacity` is negative, discarding valid entries instead of keeping them.

## Data flow (enqueue -> journal -> store)

1. `enqueue` pushes to `queue` - OK (`:214`).
2. `drain` splices the queue, `appendEntries` in one `update` - OK, restores on failure (order caveat M-1).
3. Ack by `seq` set after apply, `heldRuns` carried - OK, unchanged (`:442-453`).
4. `submit` -> `accept` - OK, never rejects; `pending` snapshot misses in-flight ops (M-2).
5. Load: journal/KV/ledger/SQLite decode - OK for shape, gap on `op` content (S-1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| P2-F1 exactly once | COMPLETE | none |
| P2-F1 order kept on failure | PARTIAL | M-1, m-1 |
| P2-F3 | COMPLETE | none |
| P2-F4 | COMPLETE | none |
| P2-F5 | PARTIAL | S-1 |
| P2-F6 | COMPLETE | none |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (static reading only; S-1 hot-loop and M-1 inversion traced by hand, not run;
  the missing-`op` variant of S-1 depends on how Zod 4.6.5 treats an absent `unknown` key, the `null`
  variant does not)
- Top risk: a single malformed persisted journal entry blocks all outcome writes with an idle-less
  `setImmediate` loop (S-1).
- What a robust implementation would add: `op` validation in the journal entry schema plus a permanent
  reject for non-actionable head entries; an ordered in-flight owner list shared by `drain`, `accept` and
  `submit`'s pending scan; a restore in `dispose`; a spec for drain + accept both failing; a spec for a
  journal entry with a `null` op.
