# Code logic review — Batch 6, `TASK_2026_443_40ec`

Review of the lifecycle step inside the retention run, the shared DTO, and the DI + real-SQLite reachability proofs (Tasks 6.1-6.4). Read-only review. The review ran the reachability specs, the mutation-check evidence, and the binding-specific suites itself. All findings carry `file:line` evidence.

## Score

**8/10 — APPROVED**

0 blocking, 0 serious, 1 moderate, 3 minor.

The implementation is sound. Every gate, ordering, rollback and preview rule that the plan states is present in code and pinned by a spec. The one moderate finding is a test-coverage gap, not a code defect: no committed spec runs with foreign keys disabled, so an issued-but-ineffective chunk DELETE cannot fail the committed suite.

## Evidence base — verification runs performed by this review

| Check | Result |
| ----- | ------ |
| `register.spec.ts` (production DI graph, real temp-file SQLite + sqlite-vec) | 4/4 passed |
| `memory-retention.integration.spec.ts` (real SQLite + sqlite-vec, fake clock) | 15/15 passed |
| Both reach suites under better-sqlite3 via `ELECTRON_RUN_AS_NODE=1` electron jest (XB1) | 19/19 passed, 0 skipped |
| `memory-retention.service.spec.ts` + `observation-retention.store.spec.ts` | 71/71 passed |
| `npx nx run degradation-audit:lint` (XB2) | `libs/backend/memory-curator: 20 ok (baseline 20)` |
| TODO / PLACEHOLDER / STUB / `.skip` / `xit` / `xdescribe` grep across the 13 changed files | Clean |

The executor's six-project test, typecheck and lint outputs were read at `batch-6-report.md:84-106` and are consistent with the focused reruns above.

## Confirmation items

### 1. Reachability — CONFIRMED

`register.spec.ts:140-194` resolves `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` from a child container built by the production pair `registerPersistenceSqliteServices` + `registerMemoryCuratorServices` (`register.spec.ts:78,87`). The test seeds a real recall row unused for 31 days (`register.spec.ts:171-176`), runs at `Date.now() + 2h`, and asserts `memoriesArchived === 1` plus the tier flip to `'archival'` (`register.spec.ts:188-193`).

- If `lifecycle.runStep` were removed from `execute` (`memory-retention.service.ts:377`), `lifecycleResult.exhausted` stays `false` and the `finish` chain at `memory-retention.service.ts:514-516` turns the run into `partial` with stop `'memory-row-budget'`; the counters read 0. Both assertions fail. The executor's mutation A observed exactly this (`batch-6-report.md:69`: DI expected 1, received 0; integration expected 45/completed, received 0/partial).
- If `MEMORY_LIFECYCLE_SERVICE` were unregistered, tsyringe resolution of the retention service (constructor parameter 7, `memory-retention.service.ts` constructor) throws before the run, failing all four DI tests.

The integration Run 1 case additionally asserts 45 rows archived and outcome `completed` on real SQLite with sqlite-vec loaded, which fails under the same mutation.

### 2. Mutation B judgment — GAP FOUND (finding 1)

The committed suite catches a **removed** explicit chunk DELETE: `memory-lifecycle.store.ts:282` returns early when `ids.length === 0`, so `DELETE_CHUNKS_SQL` is pushed into `issued` only immediately before `.run()`; the committed assertion `expect(h.t.issued).toContain(MEMORY_LIFECYCLE_SQL.DELETE_CHUNKS_SQL)` in the T0+61 d case fails if the statement is never issued.

The committed suite does **not** catch an **issued-but-ineffective** chunk DELETE (a weakened `WHERE`, a mis-bound parameter). Every committed fixture opens with `PRAGMA foreign_keys = ON` (`retention-sqlite.test-support.ts:206`) and re-sets it after the vec-less reopen (`retention-sqlite.test-support.ts:262`), so the FK cascade removes the chunks even when the explicit DELETE deletes nothing, and the per-id orphan assertions pass. The executor proved this by disabling FKs for the mutation run only (`batch-6-report.md:73`) — no FK-off variant is committed. Missing spec: an FK-off run of the T0+61 d case (a `reopenWithoutFk()` helper on the test support, or `PRAGMA foreign_keys = OFF` before the delete phase) asserting 0 chunks, 0 FTS docsize rows and 0 vec rowids per deleted id.

### 3. AC2 at T0+30 d and T0+61 d — CONFIRMED

All verified in `memory-retention.integration.spec.ts`:

- T0+30 d: `memoriesDeleted: 0`. Deletion counts from `archived_at`, and the T0 run set `archived_at = T0`; 30 days is under M=60.
- T0+61 d: 44 deleted (45 archived minus the restored old[0]). Per-id checks cover memories rows, `memory_chunks`, FTS docsize entries, vec rowids and `memory_chunks_vec` concept rows; FTS `MATCH` returns empty for the deleted subject terms; vec KNN excludes the deleted rowids.
- Survivors intact: restored old[0], the pinned pair, the core pair, the corpus-linked pair and the fresh rows keep tier and content.
- Cap eviction: only rows archived more than 7 days ago are evictable (`EVICT_ARCHIVAL_SELECT_SQL`, `memory-lifecycle.store.ts:33-37`, grace cutoff). The 6-row eviction test evicts the 6 oldest out-of-grace rows and leaves the 3 in-grace rows and workspace B untouched.
- Vec unavailable: `canDelete()` (`memory-lifecycle.store.ts:141-152`) returns `'vec-unavailable'` when the extension is loaded and the vec trigger exists; the run completes archive-only with a note, and the next hourly run is not due for the archive step. Nothing is deleted.
- Budget stop: a 25-row `memoryRowRoom` yields `partial` with stop `'memory-row-budget'`; the next hourly run completes the remaining 5.
- Mid-delete failure: the wrapped `db.prepare` fails the second `DELETE FROM memories` inside the pair; the `BEGIN IMMEDIATE`/`ROLLBACK` at `memory-lifecycle.store.ts:288-321` restores all 50 memories and all 50 chunks; the run reports `failed`; the single-flight flag is released and the second run succeeds.
- Disabled: no writes; the state row records a preview with `archiveEligible: 1`.

### 4. Task 6.1 wiring — CONFIRMED

- Gate: `memory-retention.service.ts:376` — `if (stop === null || stop === 'row-budget')`. The service specs assert `h.lifecycle.calls` length 0 for every earlier gate (disabled, already-running, boot-deferred, on-battery, foreground, aborted, persistence-unavailable, not-due, wall-budget) and exactly one call for the row-budget case.
- Same budget object: line 377 passes the same `budget` instance to `runStep` that the quarantine loop consumed. The spec proves it is a `RetentionRunBudget` carrying the run's governor; object identity is proven by the code path, not by a spec-level `toBe` — see finding 4.
- Lifecycle stop fills only a null run stop: lines 379-381.
- `completed` requires `lifecycleResult.exhausted`: lines 514-516 force `partial` with `lifecycleResult.stop ?? 'memory-row-budget'` when the lifecycle is not exhausted.
- Counters, note and preview persist through `writeRun`; `WRITE_RUN_SQL` uses `COALESCE` on all five preview columns, so a null preview keeps the previous one (same rule as `avg_processed_row_bytes`). Pinned by the store spec "a partial run keeps the previous completed time, average bytes and preview when null".
- Carried m3: the spec builds a real `MemoryLifecycleService` whose store throws in `canDelete()`; the run reports `failed`, no archive/delete batch is dispatched, and a second run is not blocked. Correct: `canDelete()` failure happens inside `runStep`, which throws before any batch, and the outer catch clears single-flight.
- AbortError during the lifecycle governor wait: `partial` with reason `aborted`, no ledger prune and no page reclaim after the abort.

### 5. `storageHealth()` — CONFIRMED

`memory-storage-health.ts:61-158` queries only page stats, observation live storage, retention state and workspace lifecycle settings. The `memoryLifecycle` section (`memory-storage-health.ts:146-153`) is built from `readMemoryLifecycleSettings` plus the state row. No memory table is read. Lifecycle read errors flow into `readErrors` (`memory-storage-health.ts:88`) and pass through `input.sanitizeError` (`memory-storage-health.ts:154-156`); the spec pins the sanitised form `'preview: [path redacted]'`. See finding 2 for a staleness edge on this path.

### 6. Facade-rule deviation — VERDICT: CORRECT

`memory-storage-health.ts` is 158 lines (above the ~150 fragment floor), passes the nameability test (`readMemoryStorageHealth` / `memory-storage-health`), and holds one concern: the diagnostics mapping. The public `MemoryRetentionService` keeps its name, DI token, method signatures and `storageHealth()` return shape; `toRunDto` was a private mapper before the move. The service is 662 lines, under the 700 soft ceiling. The extracted body is identical to the old one except for the lifecycle additions and one negligible `nextDueAt` change (finding 3). This deviation follows the repo facade rule.

### 7. Task 6.2 DTO — CONFIRMED

`rpc-curator-diagnostics.types.ts` adds the three run counters as required fields, `MemoryLifecyclePreviewDto` with five required numbers, and a required `memoryLifecycle` storage-health section — exactly the plan's field set. `toRunDto` maps the three counters (`memory-storage-health.ts:54-56`). `lastDecayAt`, `lastDecayStats` and the `'decay-run'` skip reason remain for Batch 9. The two `memory-curator-ui` spec edits and the `thoth-runtime` `memory-retention-job.spec.ts` edit add required fixture fields only — no production frontend or job code changed.

### 8. XB1 / XB2 — CONFIRMED (independently re-run)

- XB1: 19/19 reach tests pass under better-sqlite3 through the `ELECTRON_RUN_AS_NODE=1` electron jest pattern; every added SQL binds all named parameters (verified in `memory-lifecycle.store.ts` — `@ids` via `json_each`, `@cutoff`, `@limit`, `@ws`, `@graceCutoff`, `@cap`, `@now`).
- XB2: the new fail-open catch (`memory-storage-health.ts:76-77`) carries `// degradation-audit: optional-capability`; `degradation-audit:lint` reports `memory-curator: 20 ok (baseline 20)`.
- 0 skipped tests in the two reach suites; no skip markers anywhere in the changed files.

## Findings

### 1. No committed FK-off spec — the explicit chunk DELETE is not proven effective

- **Severity: moderate**
- **Files**: `retention-sqlite.test-support.ts:206`, `retention-sqlite.test-support.ts:262`, `memory-retention.integration.spec.ts` (T0+61 d case)
- **Scenario**: a future edit weakens `DELETE_CHUNKS_SQL` (`memory-lifecycle.store.ts:44-47`) — for example the `tier <> 'core' AND pinned = 0` guard moves into a branch that excludes the rows under deletion, or a binding typo makes `json_each(@ids)` match nothing. The statement is still issued, so the committed `issued.toContain(DELETE_CHUNKS_SQL)` pin passes. Every fixture runs with `foreign_keys = ON`, so the cascade removes the chunks and every orphan assertion passes. The suite stays green while `deleteArchivedBatch` returns a count from `DELETE_MEMORIES_SQL` and the chunk table keeps rows whose parent memory is gone. In production the same fault would leak orphaned chunks, stale FTS docsize entries and stale vec rowids — precisely the corruption AC2 exists to prevent.
- **Current handling**: the executor documented the gap honestly (`batch-6-report.md:73,157`) and proved the mutation fails when FKs are off, but committed no FK-off variant.
- **Fix**: add a `reopenWithoutFk()` helper to `retention-sqlite.test-support.ts` (mirroring `reopenWithoutVec`) and one T0+61 d variant that reopens with `foreign_keys = OFF` before the delete run, then asserts 0 chunks, 0 docsize rows and 0 vec rowids per deleted id.

### 2. `lifecycleReadErrors` keeps the previous run's value when `runStep` throws

- **Severity: minor**
- **File**: `memory-retention.service.ts:377-378`
- **Scenario**: `this.lifecycleReadErrors` is assigned only after `runStep` returns. If `runStep` throws (the carried m3 `canDelete()` path), the field still holds the previous run's errors. A later `storageHealth()` call — before the next successful run — reports those stale errors in `readErrors` as if they came from the current state. The run itself is reported `failed` with the new error, so the report is correct; only the diagnostics channel can mislead.
- **Current handling**: harmless in the common case because a failed run is followed by an hourly run that refreshes the field; the stale window is at most one run cycle.
- **Fix**: clear `lifecycleReadErrors` to `[]` at the start of the lifecycle step, before the `runStep` call.

### 3. `nextDueAt` behaviour change for an unreachable state combination

- **Severity: minor**
- **File**: `memory-storage-health.ts:111-115`
- **Scenario**: the extracted expression evaluates `state?.backlogRemaining` first. A state row with `backlogRemaining` truthy and `lastFinishedAt` null now yields `null` instead of falling through to the `lastCompletedAt + intervalMs` branch. Before the extraction, the same input fell through. The combination is not producible in practice: `backlogRemaining` is written only by a run that also writes `lastFinishedAt`. No action needed; the finding records the deviation so a future reader does not treat it as accidental.
- **Fix**: none required. Optionally pin the intended precedence with a comment or a spec if the state writer ever changes.

### 4. Budget identity is proven by code, not by a spec-level assertion

- **Severity: minor**
- **Files**: `memory-retention.service.ts:377`, `memory-retention.service.spec.ts` (budget identity test)
- **Scenario**: the plan requires "the same budget object" reaches the lifecycle. The spec asserts the lifecycle receives a `RetentionRunBudget` instance carrying the run's governor; it does not assert `toBe` identity with the budget consumed by the quarantine loop. The code guarantees identity because line 377 closes over the same local `budget`. A future refactor that constructs a second budget for the lifecycle (for example to give it a fresh row allowance) would pass the committed spec and silently break the shared-budget rule.
- **Fix**: in the row-budget service spec, capture the budget instance passed to the fake lifecycle and assert the quarantine phase observed the same instance, or assert `lifecycle.calls[0].budget === observedQuarantineBudget` via the fake.

## Five logic questions

1. **Silent failure**: finding 1 — a chunk DELETE that deletes nothing passes every committed spec because the FK cascade hides it. Finding 2 — stale `lifecycleReadErrors` surfaces prior-run diagnostics as current.
2. **Unexpected user action**: none found on the happy paths. Disabling the lifecycle mid-run, aborting the host during the governor wait, and running with sqlite-vec absent all produce the planned note/partial/preview behaviour and are pinned.
3. **Wrong-answer input**: an empty ids list (`deletePair`, `memory-lifecycle.store.ts:282`) returns 0 without issuing SQL — correct. A `workspace_root IS NULL` workspace in `OVER_CAP_SQL` groups under `null` and evicts through `evictBatch(null, ...)` — handled by the `IS @ws` binding. No input produced a wrong count in the cases read.
4. **Dependency failure**: `canDelete` throw → failed run, single-flight released, second run works (integration-pinned). Mid-pair DELETE failure → ROLLBACK restores both tables (pinned, 50/50 rows). Busy database → `RetentionStepError('database-busy')`. Governor `AbortError` → `partial`/`aborted`, no prune/reclaim after (pinned). Governor timeout → continues. Unavailable settings provider → lifecycle defaults + `readErrors` entry, XB2-annotated.
5. **Missing from requirements**: the FK-off orphan proof (finding 1) is the one requirement the reachability plan states ("no orphans") that no committed spec can enforce on its own.

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: a future regression that makes the explicit chunk DELETE ineffective would pass the committed suite on FK-enabled fixtures (finding 1).
- **A robust follow-up adds**: the FK-off delete variant; the `lifecycleReadErrors` reset; the spec-level budget identity assertion.