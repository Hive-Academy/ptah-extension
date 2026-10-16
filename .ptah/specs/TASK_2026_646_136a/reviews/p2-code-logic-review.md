# Code Logic Review — `TASK_2026_646_136a`, phase P2 (Outcome store core)

Scope: `git diff 8fc9278e9^..dd021d709 -- libs/backend/lane-outcomes libs/shared/src/lib/types/lane-outcome.types.ts`
(Batches 6, 34, 35, 15, 20). All paths below are relative to the worktree `W`; line numbers are on disk at `dd021d709`.
Read in full: pipeline, journal, report-effect, the three stores, recorder, reader, join, signals, schema, DI, index.
Specs were read only where cited. No Nx, Jest or build was run (team-leader's results taken as given).

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 11             |
| Failure modes found | 10             |

Evidence for the score: no stubs, TODOs or mocks stand in for logic anywhere in `src/lib` outside specs. Every plan file exists,
logging is ids and codes only, and the store replay contract (receipts, `INSERT OR IGNORE`, atomic join) is sound. One real
silent-loss race sits in the pipeline hand-off (S-1), which keeps it below 7. The Moderates are mostly unbounded or
silent-degradation paths rather than wrong results on the happy path, which keeps it above 5.

## Risks the phase had to close

| Risk | Verdict | Evidence |
| --- | --- | --- |
| R-1 (B4 split) | Closed | Batches 6/15/20 deliver every file the plan lists: stores, journal, pipeline, recorder, reader, seam port, signals, join, schema, DI (`src/index.ts:1-60`). `takeHeldReports` became `insertStopWithHeldReports` (atomic join, better than planned) |
| PB-1 (`subagentSessionId` join key) | Closed | Stored at `lane-outcome-recorder.service.ts:105-107`. The reader builds skill scopes and evidence only from `row.subagentSessionId` (`lane-outcome-reader.service.ts:114-131`) and has no agentId fallback. Telemetry is keyed by `runId`, as the plan says |
| TL-16 (budget stop read-time only) | Closed | The subagent class is derived in `subagent-join.ts:18-21` (budget stop with failed/no-deliverable gives `timeout`, `isError` gives `crash`, else null) and never written for subagents. Only the `budget_stopped` flag is stored |
| TL-20 (deliverables payload has no verdict) | Closed | `DeliverablesPayloadSchema` is `.strict()` with no verdict field (`report-effect.ts:8-25`). The verdict is computed at apply time from the checks and the row's `startedAt` (`:66-73`) |
| SC-4 (classifier) | Closed with caveats | Called only when `inserted` is true (`lane-outcome-recorder.service.ts:76-97`, `outcome-write-pipeline.ts:546-556`), only if the class is null, the verdict is failed/no-deliverable and the status is not `stopped`. Fire-and-forget with one `update` and a warn carrying `runId` and `error.name`. Caveats: M-2 (leak, lost on replay) and M-5 (`update` is not atomic) |
| SC-10 (awaited flush disposer) | Closed, residual M-1 | `start.ts:48-51` awaits `pipeline.dispose()`. The dispose deadline timer is cleared (`:648`) |

## Five logic questions

### 1. How does this fail silently?

- Ops dropped from the in-memory queue with no log or counter when `enqueue` races an in-flight drain (S-1, `outcome-write-pipeline.ts:326-347` vs `:259-290`).
- The read cap warning can never fire: the stores already truncate to 2000, so `rows.length > READ_LIMIT` is never true (`lane-outcome-reader.service.ts:49-52`, `:76-77`; stores `sqlite…:237,254,260`, `in-memory…:156,170`). A busy lane is silently truncated, contrary to the plan's "log when capped".
- Classification is silently skipped for any row inserted via journal replay after a restart or crash, because the input map is in memory only (`lane-outcome-recorder.service.ts:30-33,87-90`).
- `recentOutcomes` returns `[]` on any store error while `isPersistent()` stays true (`lane-outcome-reader.service.ts:51-58`). Routing reads this as "history exists, nothing in it". This is plan-sanctioned by SC-2, but it is a success-looking value.
- A subagent record whose `workspaceRoot` is `''` is dropped with one warn, because the schema has `.min(1)` (`lane-outcome-recorder.service.ts:122-127`, `lane-outcome.schema.ts:41`).
- In queue mode (no storage), `submit` reports `applied` for a write that is still queued (`outcome-write-pipeline.ts:203-210`). This is unreachable in production because all three hosts register `STATE_STORAGE` (`platform-*/src/registration.ts`).

### 2. What user action produces unexpected behaviour?

- The orchestrator reports deliverables for a lane run whose verdict is already `failed`: `applyOutcomeEffect` overwrites it with `delivered` and keeps `failureClass` (`lane-outcome.store.ts:49-57`, M-11).
- A foreground subagent stop followed immediately by an outcome report (the normal skill flow) is exactly the timing that opens S-1.
- Declaring the same deliverables twice is allowed by design (latest wins, first `deliverablesDeclaredAt` kept), and each `revise` review counts once per `reportId`. The caller cannot make a retry idempotent, because `reportId` is a fresh `randomUUID()` per call (`lane-outcome-recorder.service.ts:155,177`). A retried `revise` review therefore double-counts `reviseRounds`.

### 3. What input data produces a wrong answer?

- Subagent rows always have `startedAt: null` (`lane-outcome-recorder.service.ts:116`), so `deliverablesVerdictOf` skips the freshness rule and a pre-existing file reads as `delivered` (M-10, `report-effect.ts:42-49`).
- `agentType === 'unknown'` is stored as role `'unknown'` and aggregated as a slug (M-3).
- A lane `deliverables` report over a `failed` lane row gives `delivered` with a stale `failureClass` (M-11).
- `agentSignals` over several slugs shares one 2000-row cap sorted by recency (`sqlite…:243-261`, `in-memory…:159-171`), so a busy slug starves a sparse one's window.

### 4. What happens when a dependency fails?

- Store throw, transient: backoff 250 ms to 60 s with a warn on the 1st and every 10th failure, and the journal is retained. Good (`:376-384`).
- Store throw in `expireHolds` or `rebuildIndex` (both run before the op loop, `:352-357`): the outer catch logs a warn and retries every 250 ms with no backoff and no throttle, and no op is processed (M-7).
- A non-permanent but deterministic error on the head op (anything other than `CHECK`/`NOTNULL`, for example `no such column`) blocks every later op indefinitely (M-7).
- `journal.update` fails (disk full): ops stay in `this.queue`, which is uncapped when a journal exists (`:154`, M-8). `submit` rejects with the raw error instead of resolving `{ok:false}` (`:259-283`, M-8).
- Corrupt or evolved persisted data: the `KeyValueLaneOutcomeStore` constructor throws on the first invalid row (`key-value-lane-outcome.store.ts:38-45`), so the DI factory throws and the whole outcome service is dead until the key is cleared. The SQLite `decodeMany` has the same all-or-nothing behaviour for one bad row (M-9).
- Seam throw: handled, rows fall back to `unavailable` with a warn (`lane-outcome-reader.service.ts:132-143`). Good.
- Dispose with a failing store: re-arms a retry timer of up to 60 s after dispose (M-1).

### 5. What is missing that the requirements never mentioned?

- No dead-letter or attempt cap for a transient-classified poison op.
- No retention for the SQLite table (plan D9 defers it; the KV store caps at 2000 rows and 90 days).
- No test for an `enqueue` or `submit` landing during a drain's journal write (`grep` of the write specs finds only one `Promise.all` case, `outcome-write-pipeline.spec.ts:76,161`).
- Nothing yet wires `startLaneOutcomes` or `registerLaneOutcomeServices` into any app (`grep` finds no callers outside the lib). This is expected for P2, but "Confirm the token is bound for Electron and CLI" is therefore unverifiable here and belongs to the DI batch.

## Failure modes

### FM-1 Journal hand-off race loses and duplicates ops (S-1)

- Trigger: `drain()` is mid-`journal.update` (storage I/O) while `submit()` calls `accept()` and `enqueue()` fires again.
- Symptom: an enqueued op never reaches the journal and is never applied or logged (lost). The earlier ops are journaled twice.
- Evidence: `outcome-write-pipeline.ts:330-347` and `:259-290`.
- Current handling: `drain` checks `this.accepting` only at entry (`:327`). `accept` does not check `this.draining`.
- Recommendation: see S-1.

### FM-2 Retry timer re-armed after dispose (M-1)

- Trigger: store failing at shutdown (for example SQLite closed first).
- Symptom: a ref'd 250 ms to 60 s timer survives `dispose()`, delaying CLI exit (up to 60 s) or leaking an open handle.
- Evidence: `dispose` clears `retry` once at `:637` and then runs `flush()` → `drain()`, whose failure path calls `defer()` (`:383,466-472`). `defer` has no `closing` or `disposed` guard and no `unref()`.

### FM-3 Pipeline stall on a failing pre-loop step (M-7)

- Trigger: `store.expireHeldReports` or `listHeldReports` throws (for example `HeldSchema.parse` on one malformed held row).
- Symptom: no op is ever applied. One warn "Outcome journal update failed" is logged every 250 ms with a misleading message and code.
- Evidence: `:352-357,408-412`.

### FM-4 Unbounded memory growth (M-2, M-8)

- `classificationInputs` is never cleaned for duplicates, rejects, queue-full or capacity drops (`lane-outcome-recorder.service.ts:30-33,75-90`).
- `this.queue` is unbounded while the journal rejects writes (`:154,330-347`).

### FM-5 Lost update in SQLite `update()` (M-5)

- Trigger: the classifier's `update(runId, {failureClass})` interleaves with `applyReportWithReceipt` (a `revise` increment or a verdict) between `await this.get()` and the all-columns `UPDATE`.
- Symptom: the report's change is overwritten with stale values. A lost `reviseRounds` increment or a reverted `finalReview` is not detectable afterwards, because the receipt exists.
- Evidence: `sqlite-lane-outcome.store.ts:125-130` (read at `:129`, then write of every column from `{...current, ...patch}`).

### FM-6 Poison-data intolerance (M-9)

- KV constructor: `key-value-lane-outcome.store.ts:38-45`. SQLite reads: `sqlite…:65-83,234,251`.

### FM-7 Stale or incorrect verdict semantics (M-10, M-11)

- Subagent freshness is not enforced. A lane verdict can be flipped from `failed` to `delivered`.

### FM-8 Privacy and contract leak in reader output (M-4)

- `recentOutcomes` is typed `LaneOutcomeSummary` ("Holds no text", `lane-outcome.types.ts:106`) but returns full rows (see M-4).

### FM-9 Classification lost on replay (part of M-2)

- A crash or restart between enqueue and apply: replayed insert, `onLaneRecordInserted` fires with no stored input, so no classification and no log.

### FM-10 `submit` can reject (M-8)

- `accept()` rethrows the journal error (`:281-283`), so `submit` rejects with a raw `Error`. The contract in the plan says the pipeline never throws to the lane. A storage error message can carry a file path, against the SC-9 and `file-settings-errors` convention.

## Blocking issues

None.

## Serious issues

### S-1 `drain()` and `accept()`/`enqueue()` race: lost op and duplicated ops

- File: `libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts:330-347` (drain), `:259-290` (accept), `:152-163` (enqueue)
- Scenario, step by step:
  1. The queue holds `[a]`, for example a `subagent-stop` just enqueued.
  2. `drain` starts with `accepting === 0`, sets `moved = [a]` and awaits `journal.update` (real storage I/O).
  3. The agent calls `ptah_outcome_report`, so `submit` runs and reaches `accept()`, which does `waiting = this.queue.splice(0)`. This returns `[a]` because the drain has not spliced yet. `accepting` becomes 1.
  4. `enqueue(c)` arrives, so the queue is `[c]`.
  5. The drain's update lands, and `drain` runs `this.queue.splice(0, moved.length)`, which removes `c`.
  6. `c` was never journaled. It is lost with no log and no counter. `a` is journaled twice (once by drain, once by accept).
- Impact: a silently lost `subagent-stop`, `budget-stop` or lane completion. A lost stop means the subagent row never exists and its held reports expire after 24 h. The duplicates are harmless today because every op is idempotent, but they inflate the 5000-entry journal.
- Why it is reachable: the plan's normal flow is a stop followed within milliseconds by an outcome report from the same session, and the Memento or file write inside `journal.update` is the widest await in the module.
- Fix (any one):
  - In `drain`, take ownership of the ops the same way `accept` does: `const moved = this.queue.splice(0)` before the await, and `this.queue.unshift(...moved)` in the failure path (restoring order ahead of any newer ops). Then `accept` can never see the same ops.
  - Or make `accept` return early to `enqueue` semantics when `this.draining` is true (push to the queue, then `await this.flush()`).
  - Add a spec that calls `enqueue(a)`, starts a drain with a slow `storage.update`, then calls `submit` and `enqueue(c)`, and asserts the journal holds each op exactly once and every op is applied.

## Moderate issues

### M-1 Retry timer survives `dispose()` (Batch 15 carry-in residual)

- `:466-472` (`defer`), `:383`, `:412`, `:634-637`. `dispose` clears the existing timer, but its own `flush()` can set a new one. `defer` neither checks `this.closing || this.disposed` nor calls `unref()`.
- Fix: `if (this.closing || this.disposed) return;` at the top of `defer`, and `this.retry.unref?.()`.

### M-2 M20-1 CONFIRMED: `classificationInputs` is unbounded and not replay-safe

- `lane-outcome-recorder.service.ts:30-33,75-90`. The entry is added on every `recordLaneCompletion` that qualifies. It is removed only by `onLaneRecordInserted`, which fires only when `inserted === true`.
- Leaks on: a duplicate `runId` (the first insert already deleted the entry, so each duplicate re-adds one that is never removed), a permanent reject, a queue-full drop (`:154-160`), a journal-capacity drop (`:335-337`), and a closing or disposed pipeline (`:153`).
- Lost on: restart and crash replay (see FM-9).
- Grade: Moderate. Entries are about 150 bytes and failures are rare, but the growth is unbounded and silent.
- Fix: carry the classification in the op, for example `{kind:'lane-completion', row, classification?}` (ids, enums and numbers only, so no text and SC-4 stays satisfied). Journal it with the op and pass it to the insert callback, so it is garbage-collected and replay-safe. The cheaper alternative is a size-capped Map (say 500, FIFO eviction) plus deletion on reject.
- A third option is to clear the entry when the op is dropped or rejected.

### M-3 M20-2 CONFIRMED: `agentType: 'unknown'` stored as a role

- `lane-outcome-recorder.service.ts:111`; producer sentinel at `agent-sdk/src/lib/helpers/subagent-hook-handler.ts:525` (`record?.agentType ?? 'unknown'`).
- The plan says "unknown values stored as null (Req 5.2)" (part B §3 verification list). The sentinel makes a pseudo-slug `unknown` that `listByRoles` and `computeAgentSignals` will aggregate, and it blocks the "role is null → not counted" rule at `agent-signals.ts:11`.
- Fix: `role: payload.agentType && payload.agentType !== 'unknown' ? payload.agentType : null` (trim first). Add a recorder spec.

### M-4 M20-3 CONFIRMED: reader returns full rows, not summaries

- `lane-outcome-reader.service.ts:59-60,89` (`[...rows]` returns the store rows) and `subagent-join.ts:14-16` (`...row`). The runtime objects carry `budgetStopped`, `workspaceRoot` (an absolute path), `parentSessionId`, `subagentSessionId`, `agentId`, `taskId` and `role`, although `LaneOutcomeSummary` is declared "Holds no text" (`lane-outcome.types.ts:106-124`).
- The only consumer today (`lane-routing/.../capability-matrix.store.ts:285`) aggregates them, so nothing leaks yet. But the NFR says aggregated outcomes go to the decision model, and one `JSON.stringify` or `state: rows` in a later batch would ship a workspace path.
- Fix: in `recentOutcomes`, project each row to the `LaneOutcomeSummary` keys. Strip `budgetStopped` in `join` for every row returned through `LaneOutcomeRecord`, and keep `get()` as the full record.

### M-5 `SqliteLaneOutcomeStore.update()` is a non-atomic read-modify-write of all columns

- `sqlite-lane-outcome.store.ts:125-130`. See FM-5. The KV and in-memory stores serialise through `write()`, so only SQLite is affected, which makes this a host-specific bug.
- Fix: run get, parse and `UPDATE` inside one `this.db.transaction(() => …)()` with no await, or make the `UPDATE` touch only the patched columns.

### M-6 Read cap is never logged

- `lane-outcome-reader.service.ts:49-52,76-77`. See Q1. The plan (part B §3, "log when capped") is unmet.
- Fix: have the stores request `LIMIT 2001` (or return a truncated flag), or compare with `>=`.

### M-7 Pipeline stalls without backoff on a failing pre-loop step; no poison-op escape

- `:352-357,408-412` and `:102-110`. See FM-3 and Q4. Only `ZodError`, `SyntaxError`, `CHECK` and `NOTNULL` count as permanent, so a deterministic SQLite error (for example a schema missing a column, since `apply` ran against an older DB) blocks everything at the head op, retrying at 60 s forever. The journal then fills to 5000 and starts refusing.
- Fix: wrap `rebuildIndex` and `expireHolds` in their own try/catch (a sweep failure must not block applies). Route the outer catch through the same `DELAYS` backoff, and throttle its warn like `:377`. Add a per-op attempt cap that dead-letters through `reject()`.

### M-8 Queue is uncapped with a journal, and `submit` can reject

- `:154-160` caps only the no-journal case. With a journal, a storage that keeps failing leaves every enqueued op in memory (`:330-347` never splices on failure).
- `accept()` rethrows (`:281-283`), so `submit` rejects with the raw error. Return `{ok:false, error:'outcome journal write failed'}` after logging `failureCode`, per the typed-error rule (no raw message).

### M-9 Corrupt or evolved persisted data kills the store

- `key-value-lane-outcome.store.ts:38-45` (strict `SnapshotSchema.parse` of up to 2000 rows) and `sqlite…:65-83` (`decodeMany` rethrows on the first bad row, which turns one bad row into an empty `recentOutcomes` for the whole lane).
- Fix: per-row `safeParse`; drop and count invalid rows, and log via a logger. For KV, start empty rather than throw. A thrown DI factory would otherwise stop `startLaneOutcomes`.

### M-10 Subagent deliverable freshness cannot be enforced

- `lane-outcome-recorder.service.ts:116` (`startedAt: null`) and `report-effect.ts:42-49`. The plan says the verdict uses "the row's `startedAt`" (SC-7 join paragraph), but a subagent row never has one. A tracked, non-empty file that already existed therefore reads `delivered`, which is the exact false positive `sessionChildVerdictOf` was written to stop (`lane-completion-notifier.service.ts:121-130`).
- Fix: either derive a `startedAt` for subagent rows (the registry record has a start time) or have the report tool pass `writtenAfterSpawn` into the stat facts. At minimum, document it as an accepted limit and record it as a Decision.

### M-11 A lane `deliverables` report overrides a `failed` verdict

- `lane-outcome.store.ts:49-57`. Req 5.5 says "an error row is `failed`". The subagent case is covered at read time (`subagent-join.ts:13`), but a lane row that failed (crash, quota) flips to `delivered` while `failureClass` stays set, giving an inconsistent record that skews routing's delivered rate.
- Fix: do not overwrite `failed` (or a non-null `failureClass`) from a deliverables report on a non-subagent row. Alternatively reject with `target-not-reportable`.

## Minor issues

- Batch 6 note (a), KV `evict()` drops receipts of rows not kept: DISMISSED as Minor. Receipts are only created after the row exists (`in-memory…:78-80` returns `missing` before any receipt write; `insertStop…` creates receipts together with its row), so "receipt before its row" cannot occur. The only effect is dropping receipts together with an evicted row, which is consistent.
- Batch 6 note (b), `holdReport` purges with `Date.now()` (`sqlite…:276`, `in-memory…:158`, `key-value…` via super): Minor. It is harmless because the pipeline passes `Date.now()` anyway, and it only matters for fake-`nowMs` tests.
- Batch 6 note (c), SQLite `decode` fixes `telemetryJoin`, `skillsLoaded` and `sessionEvidenceClass` (`sqlite…:70-72`): DISMISSED, intentional. They are read-time joins with no column (P1-L8). Minor parity nit: a stored subagent row reads `unavailable` from KV and `not-applicable` from SQLite until `join` overrides it.
- Batch 15 Minor 1, `HeldEntryKind` export: FIXED (`src/index.ts:10`).
- Batch 15 Minor 2, `submit` returns `applied` in queue mode: CONFIRMED (`:203-210`) but unreachable in production. Return `queued` when `!this.journal` and the queue is not empty.
- Batch 15 Moderate, `flush` spins after `dispose`: FIXED. The loop at `:320` exits on `disposed`, and the deadline timer is cleared at `:648`. The residual timer problem is M-1.
- TL-18 (atomicity per op, not per turn): ACCEPTED, no defect. Replay is safe: inserts use `INSERT OR IGNORE` and receipts, the join and the deletes happen in one transaction (SQLite) or one `update` (KV). A crash between the store write and the journal ack replays no-ops, and `needsRebuild` repairs the held index. Cost is at most 25 `update`s per turn on a rare path.
- The drain's final ack writes the stale `next.heldRuns` (`:391-398`), overwriting an index change made by an `expireHolds` call inside `applyReport` (`:590`). It self-heals on the next prune or rebuild.
- `5000` literal at `:335,655` vs `OUTCOME_JOURNAL_LIMIT` (`:17`).
- `KeyValueOutcomeJournal.snapshot()` does a `structuredClone` of up to 5000 entries on every call. `submit` calls it 3 to 4 times (`:174,206,221,235`), so pending-op scans get expensive near capacity.
- `reportId` is a fresh `randomUUID()` per call, so a caller retry is not idempotent for `revise` (Q2).
- `taskId` in `LaneOutcomeRowSchema` has no length bound (`lane-outcome.schema.ts:44`) while the report payload caps it at 200.
- `workspaceRoot: ''` drops a whole subagent record (Q1). Normalise `|| null` as for `role`.
- `startLaneOutcomes` skips `pipeline.dispose()` if any unsubscribe throws (`start.ts:48-51`). Use try/finally.
- `FAILURE_CLASSIFIER` and `SKILL_TELEMETRY_SEAM` are checked with `isRegistered` when the cached singleton is first built (`register.ts:62-67,78`). A classifier registered after `startLaneOutcomes` resolves the recorder is silently ignored. Document or assert the order in the DI batch.
- `LaneCompletionOutcomeInput` excludes `subagent` only at the type level. A runtime `executorKind: 'subagent'` on a lane op passes the schema and would be joined as a subagent.

## Data flow

1. Producer (`recordLaneCompletion`, `recordSubagentStop`, `markSubagentBudgetStop`): Zod `safeParse` at the entry, ids-only warn, never throws. OK, except `workspaceRoot: ''` (Minor) and `role: 'unknown'` (M-3).
2. `pipeline.enqueue`: pushes to `this.queue`. OK. Uncapped with a journal (M-8).
3. `drain` part 1, move to journal: GAP, S-1 (lost and duplicated ops).
4. `drain` part 2, availability gate and index rebuild: an unguarded throw stalls the pipeline (M-7).
5. Apply: row re-validated with `LaneOutcomeRowSchema.parse` (OK). Reports re-validated through `reportEffectOf` with a strict schema (OK, TL-20). Store call is one atomic op (TL-18).
6. Ack: by `seq`, so concurrent appends are preserved. OK, except the stale `heldRuns` write (Minor).
7. Insert callback: `onLaneRecordInserted` runs inside a try/catch. The classifier is fire-and-forget with a `.catch` warn. OK, except M-2 (leak, lost on replay) and M-5 (lost update).
8. Report path (`declareSubagentDeliverables`, `attachReview` → `submit`): payload validated twice. `not found` error naming the id (Req 5.6). Hold with a 500 cap and a 24 h expiry. OK. `accept` rejection leaks as a raw throw (M-8).
9. Read path: store, then `join` (seam batched once per query, fallback to `unavailable` on a throw). OK. Rows are returned unprojected (M-4) and the cap is silent (M-6).
10. Dispose: awaited flush with a 2 s deadline, then the residual queue is written to the journal. OK, but the timer is re-armed (M-1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| SC-2 reader port (`recentOutcomes`, `isPersistent`, never rejects) | COMPLETE | Success-looking `[]` after a store failure is plan-sanctioned. Unprojected rows (M-4) |
| SC-4 classifier (new insert only, one update, ids-only warn) | PARTIAL | Conditions are met. Not replay-safe, unbounded map (M-2), non-atomic `update` (M-5) |
| SC-7 report hold, 500 cap, 24 h expiry, receipts, atomic join | COMPLETE | Verdict freshness unenforceable for subagents (M-10) |
| SC-9 logging in the new lib (ids and codes only) | COMPLETE | `accept()` can rethrow a raw error to the caller (M-8) |
| SC-10 pipeline: journal, backoff, backlog, awaited disposer | PARTIAL | S-1 race, M-1 timer, M-7 stall and poison op, M-8 queue cap |
| Part B §3 "reads cap at 2000 (log when capped)" | PARTIAL | Never logs (M-6) |
| Part B §3 "unknown values stored as null (Req 5.2)" | PARTIAL | Role `'unknown'` (M-3) |
| Req 5.5 deliverable verdict, error row is `failed` | PARTIAL | Subagent: read-time join OK. Lane: overwritten (M-11) |
| PB-1, TL-16, TL-20 | COMPLETE | See the risk table |
| Req 5.9 write failure does not block the lane | COMPLETE | Recorder and enqueue never throw |

Implicit requirements not addressed: corrupt-data recovery (M-9), a dead-letter bound for poison ops (M-7), an idempotency key for caller retries (Q2), retention of the SQLite table (deferred by plan D9).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Duplicate lane completion | YES | `INSERT OR IGNORE`, `inserted=false`, no classification | `classificationInputs` leaks (M-2) |
| Duplicate subagent stop | YES | insert is a no-op, held reports already deleted | none |
| Report before stop (held) | YES | hold, atomic join, receipts | none |
| Report for an unknown run id | YES | error naming the id, nothing written | none |
| Review with no held deliverables | YES | rejected | none |
| 501st hold | YES | refused, newest only | none |
| Expired hold | YES | swept every 60 s with one warn per report | a sweep failure stalls applies (M-7) |
| DB not open | YES | journaled, applied in order on open | none |
| Journal full (5000) | YES | newest refused, durable counter, warn every 100 | the dropped op is not visible to the recorder (M-2) |
| Crash between store write and ack | YES | idempotent replay, index rebuilt | classification lost (FM-9) |
| Concurrent submit and enqueue | NO | S-1 | lost and duplicated ops |
| Dispose with a hung store | YES | 2 s deadline, then disposed | timer re-armed on failure (M-1) |
| Storage write failure | PARTIAL | KV store rolls back and retries | queue unbounded, `submit` rejects (M-8) |
| One corrupt stored row | NO | whole read or construction fails | M-9 |
| Empty slugs / `windowDays <= 0` | YES | `[]` / throws `Invalid outcome window` | none |
| Seam throw | YES | `unavailable` plus warn | none |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on S-1 (traced against the code, no test exercises the interleaving), MEDIUM on M-5 and M-10 (depend on host timing and on how the later report tool builds its stat facts)
- Top risk: S-1, a silently dropped op when `submit()`/`enqueue()` overlap the journal write inside `drain()`.
- What a robust implementation would add:
  1. Single owner of `this.queue` (`drain` splices before awaiting, restores on failure) and a concurrency spec for the overlap.
  2. `defer` guarded by `closing`/`disposed` and `unref()`'d.
  3. Pre-loop sweeps wrapped separately, a shared backoff and throttled warn on the outer catch, and a per-op attempt cap with a dead-letter.
  4. Classification carried inside the journaled op (replaces the Map), with an `inserted`-only call.
  5. A transactional or column-scoped `SqliteLaneOutcomeStore.update`.
  6. Projection to `LaneOutcomeSummary` in `recentOutcomes`, and `budgetStopped` stripped everywhere.
  7. `agentType` `'unknown'` and `workspaceRoot` `''` normalised to null.
  8. A truthful cap log (`LIMIT 2001`).
  9. Per-row tolerant decode in the KV constructor and SQLite `decodeMany`.
  10. A coded `{ok:false}` for journal write failures in `submit`.
  11. A decision recorded on subagent freshness (M-10) and on the lane `failed` override (M-11).
