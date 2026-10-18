# P2 fix round 2 - code logic re-review (Batch 36b, commit bfae43c3c)

- Task: TASK_2026_646_136a
- Scope: `git show bfae43c3c -- libs/backend/lane-outcomes` (5 source and spec files). Whole files read:
  `write/outcome-write-pipeline.ts` (738 lines), `write/key-value-outcome-journal.ts`,
  `write/outcome-write-op.schema.ts`, `lane-outcome.schema.ts`, `di/register.ts`; the two new durability
  specs, the new journal spec, `batches.md` TL-42..TL-46 and decisions #83/#84, and
  `reports/batch-36b-round2-report.md`.
- Read-only. No Nx, Jest, tsc or build was run (a heavy check may be in flight). The "13 suites / 119 tests
  pass" and "typecheck passes" claims are the team leader's and the orchestrator's (decision #84); I did
  not re-execute them. Scoped `ptah_get_diagnostics` was not called because the round-2 report says it
  times out on this lib.
- Implementer family: OpenAI (codex lane). Reviewer family: Anthropic.
- Out of scope, not re-opened: M-1 and M-2 of the previous re-review (now LT-P2-15 and LT-P2-16, decision
  #83), LT-P2-1..LT-P2-14, all Minors from earlier rounds.

## Summary

| Metric   | Value    |
| -------- | -------- |
| Score    | 7.5/10   |
| Verdict  | APPROVED |
| Blocking | 0        |
| Serious  | 0        |
| Moderate | 2        |
| Minor    | 3        |

Evidence separating 7.5 from 9: the S-1 defect (a `null`, missing or primitive `op` stalls `drain` with a
`setImmediate` spin, or retries a `TypeError` forever) is closed on both the load path and the drain path,
and the TL-42 regression (phantom `invalid-op` ledger rows for queue slots) is closed. The remaining gaps
are narrow: the same zero-progress shape still exists for an `undefined` head in the storage-less queue
mode (Moderate), the load-time drop leaves no run identifier behind (Moderate), and three Minors. None of
them loses an op that was durably accepted, so there is no Blocking or Serious finding. Evidence separating
7.5 from 6: S-1 is genuinely closed, and every path I traced for "processed === 0 with no retry armed" is
now unreachable in journal mode.

## Check results

| Item                                                  | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 load path: malformed `op` dropped and counted     | PASS   | `KeyValueOutcomeJournal` takes an `opSchema` (`key-value-outcome-journal.ts:73-77`) and validates each entry with `EntryHeaderSchema.extend({ op: opSchema })` (`:105-108`); `droppedOnRead` adds the dropped entry count (`:110-114`). The pipeline passes `OutcomeWriteOpSchema` (`outcome-write-pipeline.ts:172-177`) and warns once with the count and the fixed code (`:183-188`). A missing `op` key fails the discriminated union, so the Zod 4.6.5 "absent `unknown`" uncertainty from the last review no longer applies. |
| S-1 drain path: non-actionable head rejected, no spin | PASS   | `drain` parses every candidate (`:429-430`), rejects a failure to the ledger as `invalid-op` and does `processed++; continue` (`:431-441`). The ack at `:464-475` includes the rejected seq, so the head leaves the journal. A primitive `op` (previous `TypeError` path) can no longer reach `apply`, because it fails the parse first.                                                                                                                                                                                          |
| Zero-progress reschedule audit (journal mode)         | PASS   | `processed === 0` in journal mode now only happens when: the store is closed (`:415`, and `finally` does not reschedule while closed, `:496`); `apply` threw a non-permanent error (`defer` arms `retry`, `:453-461`, `finally` skips on `!this.retry`, `:495`); or the journal update threw (`:485-489`, `defer(250)`). Each has a timer.                                                                                                                                                                                        |
| TL-42: drain stops at the end of the journal batch    | PASS   | `next` is the pre-loop snapshot (`:423-424`); the break condition reads `next.entries[processed]` in journal mode and `queue[processed]` only without a journal (`:426-428`). Queue items added during an `await` are not parsed as `undefined`. Spec `durability.spec.ts:25-56` (3 enqueues during the first insert, 4 turns, all rows applied, ledger empty).                                                                                                                                                                   |
| Queue items enqueued during a drain are not lost      | PASS   | They stay in `this.queue`; `finally` reschedules when `journal entries + queue > 0` (`:492-498`); `dispose` moves leftovers into the journal (`:726-731`).                                                                                                                                                                                                                                                                                                                                                                        |
| Ledger accepts the new kind                           | PASS   | `RejectedValueSchema` lists `'invalid-op'` (`:82`), so a ledger holding an invalid-op row does not fail `readRejected` and get reset. `RejectableOp` includes it (`:46-47`); `runIdOf` handles it through the `runId` branch (`:116-122`).                                                                                                                                                                                                                                                                                        |
| Schema moved without behaviour change                 | PASS   | `outcome-write-op.schema.ts:5-26`; `OutcomeWriteOp` stays exported from the pipeline (`:35-44`, type-only import in the schema file, no runtime cycle). TL-46 import restored at `outcome-write-pipeline.ts:15` and used by `apply` (`:607` per the batch notes; `LaneOutcomeRowSchema.parse` is the first line of the row branch).                                                                                                                                                                                               |
| Log hygiene                                           | PASS   | The new warn carries `dropped` and the fixed `ZOD_VALIDATION` only (`:184-187`); the reject warn carries `runId` (`journal:<seq>`), `reportId` (undefined) and the reason (`:621-625` equivalent, `reject` body `:673-709`). No payloads, paths or error messages.                                                                                                                                                                                                                                                                |

## Five logic questions

1. Silent failure. A journal entry that fails `OutcomeWriteOpSchema` on load is dropped and only counted
   (`key-value-outcome-journal.ts:105-114`); the warn has no run id, and no ledger row is written. If the
   entry held a `lane-completion` whose row fails the schema, the outcome is gone with a count as the only
   trace (m-2 below). In the storage-less queue mode an `undefined` queue head still spins (M-1).
2. Unexpected user action. `enqueue` calls during a drain are now deferred to the next turn
   (`:426-428`), so a caller that does `enqueue(x)` and then `await flush()` while a drain is mid-flight gets
   `x` applied by the same `flush()` only if `flush` starts a fresh drain after the first one ends
   (`flush` loops while `draining`, then drains, `:391-396`). I traced it and `x` is applied. No problem found.
3. Wrong answer from data. Zod strips unknown keys, so `parsed.data` (`:442`) replaces the stored op with a
   stripped copy. `apply` already parsed the row the same way (`:524` pre-change), so this adds no new loss
   for rows. For reports the schema covers every `HeldOutcomeReport` field (`lane-outcome.store.ts:19-26`
   against `outcome-write-op.schema.ts:5-11`).
4. Dependency failure. Ledger storage failing inside `reject` (`:700`) throws out of the loop to the outer
   catch (`:485-489`): earlier ops of the same batch are applied but not acknowledged and get applied again
   on the next turn (at-least-once; the store writes are idempotent), and the warn repeats every 250 ms
   (m-3). Journal storage failing at load is handled by the existing envelope fallback.
5. Missing but unspecified. Nothing keeps the dropped load-time entries for inspection (no quarantine key),
   and there is no test that runs the production schema on the load path (m-4).

## Moderate issues

### M-1. Storage-less queue mode still has a zero-progress reschedule for an `undefined` head

- File: `outcome-write-pipeline.ts:426-428` (break test), `:476` (queue splice), `:492-498` (reschedule).
- Scenario: no `IStateStorage` is registered (`di/register.ts:47-49` allows this), so `journal` is `null`
  and `next` is `null`. A caller enqueues `undefined` (a typing violation, for example an unchecked
  optional). `this.queue[0] === undefined` fires the break at `:427` with `processed === 0`. Nothing arms
  `retry`, the queue is non-empty and the store is open, so `finally` calls `schedule()` and the drain spins
  on `setImmediate` forever, with every later op behind it. This is the S-1 failure shape on the one branch
  the new test and the new guard do not cover. A `null` head is fine: it passes the break test, fails the
  parse and is rejected (`:430-441`). In journal mode `undefined` is also fine, because the journal entry
  object exists and the parse rejects it.
- Impact: needs a type violation plus a deployment without state storage, so likelihood is low; the effect
  would be a CPU spin that blocks all outcome recording.
- Fix: decide "no item" by length, not by value: `const exhausted = next ? processed >= next.entries.length
: processed >= this.queue.length`. Add a spec with a storage-less pipeline and `enqueue(undefined as never)`.

### M-2. Loss of identity when a malformed entry is dropped on load

- File: `key-value-outcome-journal.ts:33-42`, `:105-114`; `outcome-write-pipeline.ts:183-188`.
- Scenario: before this commit, a persisted `lane-completion` whose row failed `LaneOutcomeRowSchema` was
  rejected by `apply` into the ledger with its real `runId`. Now it is dropped during construction: one
  warn with a count, no `runId`, no ledger row, and the next successful journal write overwrites the key
  so the entry is gone for good. The same applies to an op kind that a newer build wrote and this build does
  not know (a rollback case): it is discarded on the first write rather than left for the newer build.
- Impact: a lost outcome row cannot be traced to a run. Recorded as a deliberate decision in the report, so
  not a defect in the fix itself; the diagnosability loss is the cost.
- Fix: when `droppedOnRead > 0`, write a ledger row per dropped entry (`invalid-op`, `journal:<seq>`, taking
  the `seq` from the header if it parses), or keep the dropped raw entries under a separate quarantine key
  until the next restart. Either is small.

## Minor issues

- m-1. `reject` dedupes invalid-op rows on `kind` plus `runId` (`outcome-write-pipeline.ts:683-692`), and the
  `runId` is `journal:<seq>`. If the journal envelope is reset (`key-value-outcome-journal.ts:99-103`,
  `nextSeq` back to 1) a later invalid entry with a seq that is already in the ledger is dropped without a
  ledger row and without a warn (the early `return` before the warn). Include a timestamp or a counter in
  the id, or warn on the dedupe path.
- m-2. `reject` of an op that `submit` already acknowledged: a report that passes `validPayload` but fails
  `ReportSchema` (for example a non-finite `heldAt`) is accepted by `submit`, then rejected in `drain` as
  `invalid-op` with only `journal:<seq>` (the real `runId` and `reportId` are not carried), and `submit`
  still returns `state: 'applied'` once the journal is empty (`:272-279`). The caller sees success. Validate
  the full `ReportSchema` in `validPayload` so `submit` returns `invalid report payload`.
- m-3. A failing ledger write in `reject` (`:700`) makes `drain` retry every `JOURNAL_RETRY_MS` (250 ms)
  with one warn per attempt and no escalation (`:485-489`), while the already-applied ops of the batch stay
  unacknowledged. Pre-existing for the permanent-error reject at `:447-451`; the new site inherits it.
- m-4. Test gaps: the journal spec uses a local `budget-stop` schema (`key-value-outcome-journal.spec.ts:
29-51`), not `OutcomeWriteOpSchema`, so no spec shows that the pipeline warns `Outcome journal unreadable`
  or drops a bad lane row on load; no spec covers the storage-less queue (M-1) or a failing ledger write.

## Data flow (enqueue -> journal -> store)

1. `enqueue` pushes to `queue` (`:223`) - OK. Type-only guarantee; no runtime validation here.
2. Load: `KeyValueOutcomeJournal` parses each entry with `OutcomeWriteOpSchema`; failures dropped and
   counted (`:105-114`) - OK, identity lost (M-2).
3. `drain` moves the queue into the journal (`:402-411`) - OK, unvalidated but re-parsed at step 4.
4. Per entry: `safeParse` (`:430`); failure -> `invalid-op` ledger row, seq acknowledged (`:431-441`) - OK.
5. Valid entry -> `apply` -> ack by seq with `heldRuns` carried (`:464-475`) - OK.
6. Non-permanent failure -> `defer` with backoff, loop breaks (`:453-461`) - OK.
7. Ops enqueued mid-drain wait for the next turn; `finally` reschedules (`:492-498`) - OK.
8. Storage-less queue: `queue[processed] === undefined` conflates "no item" and "undefined item" - gap (M-1).

## Requirements fulfilment

| Requirement                                                                                 | Status    | Gap                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal validates each op on read; malformed entries dropped and counted in `droppedOnRead` | COMPLETE  | M-2 (identity lost)                                                                                                                                                              |
| `drain` rejects a non-actionable head as `invalid-op` (`ZOD_VALIDATION`) and moves on       | COMPLETE  | M-1 on the storage-less branch; m-1                                                                                                                                              |
| No zero-progress loop                                                                       | PARTIAL   | M-1 (`undefined` head, no storage)                                                                                                                                               |
| Journal mode stops at the end of the journal batch; queue items wait for the next turn      | COMPLETE  | none                                                                                                                                                                             |
| Schemas moved to `outcome-write-op.schema.ts`, pipeline under max-lines                     | COMPLETE  | 738 physical lines; 695 counted per the round-3 note                                                                                                                             |
| Specs fail on 8cd5cc212                                                                     | PLAUSIBLE | Not re-run by me; the null-head spec (`durability.spec.ts:58-105`) injects the bad op through `journal.update`, which skips the load filter, so it does exercise the drain guard |

Implicit requirements not addressed: ledger evidence for load-time drops (M-2); `submit` validating the
whole report shape (m-2).

## Edge cases

| Case                                       | Handled            | How                                                           | Concern                |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------- | ---------------------- |
| `{ seq, op: null }` in persisted journal   | YES                | dropped on load (`:105-114`); drain also rejects (`:430-441`) | count-only trace (M-2) |
| `{ seq }` with no `op`                     | YES                | union parse fails                                             | none                   |
| `op: 5` (primitive)                        | YES                | fails parse before `'row' in op`                              | none                   |
| Valid-looking op with bad row              | YES                | dropped on load or rejected in drain                          | identity lost on load  |
| Unknown op kind (downgrade)                | YES, destructively | dropped and overwritten                                       | M-2                    |
| Enqueue during an `await` inside drain     | YES                | batch ends at the snapshot                                    | none                   |
| Journal at 5000 entries, all valid         | YES                | parsed once at load; cost is linear                           | negligible             |
| `undefined` in storage-less queue          | NO                 | break test conflates it with "empty"                          | M-1                    |
| Ledger write fails during reject           | PARTIAL            | retries at 250 ms, replays earlier ops                        | m-3                    |
| Duplicate invalid seq after envelope reset | PARTIAL            | silently deduped                                              | m-1                    |
| Store closed with a poison head            | YES                | drain returns at `:415`; rejected once it opens               | none                   |

## Verdict

- Recommendation: APPROVE (APPROVED, 7.5/10)
- Confidence: MEDIUM-HIGH (static trace of every reschedule path and of the load and drain validation;
  test execution not repeated by me; types rely on the orchestrator's typecheck result in decision #84)
- Top risk: the storage-less queue mode can still spin on an `undefined` head (M-1), the same defect class
  as S-1 but unreachable without a typing violation.
- What a robust implementation would add: a length-based "no item" test in `drain`; a ledger or quarantine
  record for entries dropped on load; the full report schema in `submit`'s `validPayload`; specs for the
  storage-less queue, the production schema on load, and a failing ledger write. M-1 can ride with the
  LT-P2-15 / LT-P2-16 task.
