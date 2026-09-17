# Batch 3 Code Logic Review

## Summary table

| Item | Result |
| --- | --- |
| Score | 8.2 / 10 |
| Verdict | APPROVED WITH FIXES |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 1 |

The production implementation preserves the central safety properties: retention never marks observations processed, stuck-row ledgering and deletion share one transaction, batch failures roll back, the session-keyset walk is bounded and resumable, and the service's gates, ordering, budgets, outcome mapping, DI lifetimes, and diagnostics reads are coherent. The required Nx gate passed for exactly one project. The fixes below close two material regression-test holes and prevent a degraded page-stat read from overstating freed bytes.

## Findings

### M1 — Moderate — The integration test hides clock-sliding retention behind a settings change

- **Trigger:** A regression caches the first run's cutoff, computes it from construction time, or otherwise fails to advance the default 7/14-day windows with the run clock.
- **Symptom:** The current integration suite remains green. Run 1 exercises the default cutoffs, run 2 is stopped by `not-due`, and run 3 changes the settings to 8/15 days before advancing to `NOW + 25h`, deliberately keeping P-new and U-grace ineligible. The fake store used by the unit suite ignores both cutoff arguments, so it does not close this hole either.
- **Evidence:** `libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts:327-354`; `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts:87-104`; production cutoff calculation is at `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:315-316` and `:350-365`.
- **Recommendation:** Add a default-window run at `NOW + 25h` and require exactly 50 processed purges and 40 stuck quarantines. Assert the ledger total becomes 340 and assert exact per-key accumulation: the two existing `tool-use` rows for `u-0`/`u-1` increase, while the two `user-prompt` rows remain unchanged. “Earlier ledger rows untouched” cannot be literal because U-grace uses the same `(session_id, kind, reason)` keys as two existing ledger rows. Follow with a due run over a clean cohort if a separate no-op idempotence proof is desired.

### M2 — Moderate — The safety-bound specs do not prove the combined cap, row-budget ledger prune, or reclaim-stalled termination

- **Trigger:** A future change resets the row allowance between purge and quarantine, stops pruning the ledger after a row-budget stop, or removes the zero-progress reclaim break.
- **Symptom:** The current tests can still pass. Both row-cap tests spend the entire 250-row allowance in purge, so neither crosses from purge into quarantine; the unit assertion proves reclaim continues but never asserts that prune ran; and no test drives `reclaimStep()` to return zero while a freelist remains. These are explicit Batch 3 behaviors, not merely implementation details.
- **Evidence:** `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts:476-495`; `libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts:357-411`; the untested production branches are `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:380-398` and `:441-470`.
- **Recommendation:** Seed fewer than 250 eligible processed rows and more stuck rows than the remaining allowance, then assert the two counters total exactly 250, an old ledger row was pruned, and reclaim still ran. Add a fake-reclaimer case returning `{ pagesReclaimed: 0 }` with a non-empty freelist and assert one call, `partial / reclaim-stalled`, a backlog, and no spin.

### m1 — Minor — A degraded pre-purge stats read can overstate `freedBytes`

- **Trigger:** `readPageStats()` degrades to zero for the pre-purge sample (for example, a transient pragma failure) but succeeds for the post-purge sample while the database already had free pages.
- **Symptom:** The service treats the initial freelist as zero, attributes the pre-existing freelist to this purge, and persists an inflated `freedBytes` and `avg_processed_row_bytes`. This affects diagnostics honesty, not deletion correctness.
- **Evidence:** The two samples and calculation are unconditionally combined at `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:315-348`; the average derived from that value is persisted at `:582-585`.
- **Recommendation:** Only calculate freed bytes when both samples are known (positive, matching page sizes and otherwise valid stats); otherwise record zero/unknown and preserve the prior average. Add a regression test with an unavailable first sample and a valid second sample containing a pre-existing freelist.

## Answers to checks 1–10

### 1. Never-mark-processed and ledger/delete atomicity

Pass. Retention SQL contains no assignment to `processed_at`; the only occurrences are predicates (`observation-retention.store.ts:43-55`, `:84-87`). Stuck selection, ledger upsert, and guarded deletion execute in one `inTransaction` callback (`:374-394`), while the DELETE re-checks `processed_at IS NULL` (`:84-87`). The shared wrapper begins before the callback, commits after it, and rolls back any callback/commit error (`:552-588`), so payload deletion cannot commit without the corresponding ledger write. The real-SQLite specs exercise the SQL text and resulting ledger/deletes (`observation-retention.store.spec.ts:166-197`, `:308-381`).

### 2. Per-batch atomicity and error mapping

Pass. Each of the three public batch methods calls `inTransaction` exactly once (`observation-retention.store.ts:324-366`, `:374-394`, `:398-409`). The wrapper issues one `BEGIN IMMEDIATE`, one `COMMIT`, and attempts `ROLLBACK` on work/commit failure (`:552-588`). A failed BEGIN is classified without a meaningless rollback because no transaction opened. Busy detection covers better-sqlite3's `SQLITE_BUSY*` string codes and node:sqlite's primary result code 5 extracted from `errcode` (`:281-286`). The real second-handle busy test and dropped-ledger rollback test are behaviorally strong (`observation-retention.store.spec.ts:576-627`).

### 3. SQL plans, purge walk, cursor, and exhaustion

Pass. Queue reads use explicit indexes or rowid lookups; only the end-of-run total count is deliberately unfiltered (`observation-retention.store.ts:43-114`). The no-`sqlite_stat1` plan suite rejects every non-SEARCH queue plan and pins the expected indexes (`observation-retention.store.spec.ts:79-163`). The purge batch caps both collected IDs and visited sessions, advances the cursor after fully inspected sessions, leaves it before a partially drained session, and reports exhausted only after no next session exists (`observation-retention.store.ts:329-365`). The service continues on `exhausted`, not `deleted`, so batches containing only ineligible sessions make forward progress (`memory-retention.service.ts:318-344`). Cursor/resume and empty-eligible-page behavior are pinned at `observation-retention.store.spec.ts:259-304`. The wall budget bounds a very large session set.

### 4. A6: processed rows with `session_id = ''`

The walk does not reach them because its first seek is `session_id > ''` (`observation-retention.store.ts:43-44`, `:318`). However, a fix is **not required now on the evidence available without opening real data**. The schema has always allowed the value, and the store accepted it until commit `6c90a4915`, but repository history shows every production `ObservationQueueStore.insert` caller guarded empty IDs from the time those capture writes were introduced; `git grep` at `6c90a4915^` shows the trigger service as the sole production writer. The same trigger guarded the drain/mark-processed path, making a processed empty-ID row even less reachable. Migration 0039 preserves processed rows (`0039_reap_orphaned_queue_rows.ts:39-48`, `:81-84`), so the planned Task 7.2 count on the copy remains worthwhile. If that count is nonzero, support the empty key explicitly on the first keyset step and add a real-SQLite regression test before merge. Whitespace-only historical IDs are greater than `''` and are already reachable.

### 5. Gates and single-flight

Pass. Settings-disabled and already-running are checked before taking ownership; ownership is then set synchronously before the first await and cleared in `finally` (`memory-retention.service.ts:131-165`). Boot deferral compares the run time with the singleton's construction timestamp (`:111-115`, `:239-241`). Battery, foreground, abort, persistence, and due gates follow (`:242-267`). Persistence precedes due because state cannot be read without a connection; both `persistence-unavailable` and `not-due` return directly and write nothing (`:248-265`). The outer catch converts throwing gate callbacks into a failed report rather than rejecting (`:142-165`), pinned at `memory-retention.service.spec.ts:608-621`.

### 6. Budgets, reclaim, outcomes, and reporting

Implementation passes, subject to Findings M2 and m1. The shared row allowance is the sum of both deletion counters (`memory-retention.service.ts:292-293`, `:323-332`, `:356-365`); the 60-second wall check is part of every inter-batch hard stop (`:294-303`); batch and reclaim halving respect floors (`:304-312`, `:461-466`); reclaim enforces its page cap and exits on zero progress (`:441-470`). A row-budget stop still permits prune and reclaim (`:380-398`). Status, backlog, and completed-at mapping are correct (`:485-522`, `:567-585`), and failure text is sanitized before persistence (`:489-495`). `reclaim-budget` and `reclaim-stalled` cannot spin in the current code. Freed bytes intentionally measure only the processed purge, but the degraded-sample edge in m1 can overstate them.

### 7. `storageHealth()`

Pass. The page reclaimer's contract degrades page-stat failures to zero, while `readLiveStorage` catches the connection and each individual read (`observation-retention.store.ts:412-480`); state read failure is caught by the service (`memory-retention.service.ts:173-230`). Diagnostics use partial-index pending/stuck reads and the bounded ledger table; the unfiltered queue count exists only in `countTotalRows()` and is called while recording a run, not by `storageHealth()` (`observation-retention.store.ts:95-114`, `:483-490`; `memory-retention.service.ts:553-560`). `nextDueAt` is `lastFinishedAt` for a backlog and otherwise `lastCompletedAt + interval`, else null (`memory-retention.service.ts:645-655`).

### 8. DI and the third token

Pass. `MEMORY_RETENTION_LIMITS` is justified. An interface-typed constructor parameter emits `Object` metadata under tsyringe, so a default parameter would not supply a resolvable runtime token. The explicit injection is at `memory-retention.service.ts:117-129`; the instance and both required singletons are registered at `di/register.ts:138-155`. The DI spec asserts all three memory tokens plus the reclaimer token, identity of the limits object, singleton identity, and a real database read/run (`di/register.spec.ts:81-143`).

### 9. Integration deviations

- **(a) 8/15-day run 3:** Run 2 genuinely proves `not-due` and no state write (`memory-retention.integration.spec.ts:327-333`). Run 3 proves that already-deleted rows are not ledgered again under the widened policy, but it does not prove that default retention windows slide with time. The extra default-window run is required; see M1. The literal “earlier ledger rows untouched” expectation must be adjusted for the two colliding ledger keys.
- **(b) 300+100 budget seed:** The arithmetic now allows run 2 to finish and it proves committed progress plus backlog-driven early retry (`:357-411`). It does not prove that the cap is shared across the two row steps; see M2.
- **(c) Pointer-map pages:** Accepted. With no reserved bytes, each pointer-map page covers `floor(pageSize / 5)` entries, so pointer-map pages recur every `floor(pageSize / 5) + 1` pages starting at page 2. Counting those in `(pageCountAfter, pageCountBefore]` and adding them to the freelist delta is the correct page-count drop (`:148-164`, `:296-309`).
- **(d) Opener:** Pass. `requireSqliteOpener()` throws when neither better-sqlite3 nor node:sqlite loads (`retention-sqlite.test-support.ts:49-85`), and the store/integration/DI suites call the throwing opener rather than using conditional skips (`observation-retention.store.spec.ts:75-76`; `memory-retention.integration.spec.ts:182-184`; `di/register.spec.ts:52-54`).

### 10. Spec strength

Mostly strong. The store tests execute real SQL, inspect plans on a database without statistics, verify resulting rows and ledger values, hold a real second write lock, and force a rollback. The integration test uses real store/reclaimer/service instances and checks committed batch boundaries and persisted state. The DI test proves resolution rather than registration alone. The service fakes are appropriate for gate and budget sequencing. The material regression holes are the default clock slide, combined cross-step row cap, row-budget prune continuation, and reclaim-stalled termination described in M1/M2. The degraded freed-byte sample in m1 is also untested. These are not tautological failures; they are missing adverse inputs.

## Command output summary

Command run exactly as requested:

`npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator`

- Header: `Running targets typecheck, test, lint for project @ptah-extension/memory-curator` and listed exactly one project.
- Exit code: 0.
- Typecheck: passed.
- Tests: 35 suites passed, 2 older native-gated suites skipped; 542 tests passed, 59 skipped.
- Lint: 0 errors, 6 existing warnings. No warning points into the new retention files.
- No test failure pointed into `libs/backend/persistence-sqlite`; therefore there is no possibly in-flight Task 1.4 failure to report.
- No `nx reset` was run, and no real database or `~/.ptah` path was opened.

## Verdict

**APPROVED WITH FIXES** — the retention logic is safe and coherent, with no blocking or serious defect found. Add the focused regression coverage in M1/M2 and harden freed-byte sampling per m1.
