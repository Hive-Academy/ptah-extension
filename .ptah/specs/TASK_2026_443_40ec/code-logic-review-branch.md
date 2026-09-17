# Code Logic Review — `TASK_2026_443_40ec` (Branch Gate 3)

## Summary

| Metric              | Value                |
| ------------------- | -------------------- |
| Overall score       | 8/10                 |
| Assessment          | APPROVED WITH FIXES  |
| Blocking issues     | 0                    |
| Serious issues      | 2                    |
| Moderate issues     | 1                    |
| Minor issues        | 2                    |
| Failure modes found | 5                    |

This review evaluates the integrated whole-branch diff of `feat/task-439-phase2-memory-lifecycle` (28 commits, `origin/main...HEAD`) against the approved architecture in `implementation-plan.md`, `batches.md` (Batches 1–10 + Task 10.4), `test-report.md`, and tribunal verdict `TASK_2026_439_1310/tribunal/verdict.md`.

The branch successfully unifies memory retention under the existing `@ptah/memory-retention` cron job, establishes the age-based lifecycle (archive at $N=30$, delete at $M=60$ counted strictly from `archived_at`), eliminates the unscheduled `MemoryDecayJob` and the self-feeding salience feedback loop, enforces the 25,000-row per-workspace cap with a 7-day grace period, introduces explicit use recording via `IMemoryUsageRecorder`, and proves production reachability across Electron and CLI hosts on real SQLite with `sqlite-vec`.

Two serious cross-batch logic defects require remediation before merge: (1) `continueAfterRows` in `MemoryRetentionService` fails to include `'memory-row-budget'`, silently skipping ledger pruning and page reclamation when a run hits its memory deletion cap, and (2) unhandled step exceptions inside `MemoryLifecycleService.runStep` drop partial counts from already-committed batches and skip search cache invalidation (`markWorkspacesChanged`).

---

## Five logic questions

### 1. How does this fail silently?

- **Reclaim skipped after memory row budget exhaustion** (`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:387,403`):
  When a heavy run evicts or deletes up to 25,000 memories (releasing tens of megabytes in `memory_chunks` and vector tables), `stop` is set to `'memory-row-budget'`. Lines 387 and 403 evaluate `continueAfterRows = stop === null || stop === 'row-budget'`, which evaluates to `false`. Both `pruneLedger` and `reclaimPages` (`incremental_vacuum`) are completely bypassed. The run reports `pagesReclaimed: 0` without error or warning, starving the database of physical page compaction.
- **Lost counters and stale cache on mid-run step error** (`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:195`, `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:378-382`):
  If `MemoryLifecycleStore` commits several delete or archive batches and then encounters `SQLITE_BUSY` or an unexpected error, the exception bubbles uncaught out of `runStep`. `execute` catches it and logs a failure or marks status `'partial'`, but `lifecycleResult` in `execute` was never assigned and defaults to all zeros (`memoriesArchived: 0, memoriesDeleted: 0, memoriesEvicted: 0`). Furthermore, line 195 (`this.memoryStore.markWorkspacesChanged(roots)`) is skipped, leaving in-memory search caches serving stale, already-deleted records.

### 2. What user action produces unexpected behaviour?

- **Submitting > 200 memory IDs to usage recording** (`libs/backend/memory-curator/src/lib/memory.store.ts:530`):
  `recordUse` runs `[...new Set(memoryIds)].slice(0, 200)`. Any call site or external RPC/MCP client providing more than 200 distinct IDs will have IDs 201+ silently ignored with no warning or error. While internal consumers currently respect this cap, external script calls will experience silent failure to touch `last_used_at` or restore archival rows.
- **Toggling `memory.lifecycle.enabled = false`** (`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:94-100`):
  When the user disables the lifecycle in settings, the run succeeds and outputs a preview, but records `lifecycleNote = 'disabled'`. If the user expects manual invocations to bypass the setting, it will not; it remains purely preview-only.

### 3. What input data produces a wrong answer?

- **`overCapWorkspaces` includes in-grace archival rows in preview count** (`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts:25-31`, `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:102`):
  `OVER_CAP_SQL` groups by workspace and sums `COUNT(*) - cap` without filtering out archival memories where `archived_at >= now - graceCutoff`. Consequently, the storage health preview displays "up to $Z$ over cap", leading an operator to expect $Z$ deletions on the next run, when in reality 0 will be deleted if those rows are within their 7-day grace window.
- **Partial preview read failure blanks the entire preview DTO** (`libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:97-110`):
  If `readPreview` captures valid counts for `archiveEligible` and `deleteEligible` but `overCapWorkspaces` encounters a query error, `state.previewOverCap` remains `null`. `readMemoryStorageHealth` tests `state.previewOverCap != null` in an all-or-nothing check, nulling the entire preview object and causing the UI to display "preview after the first run".

### 4. What happens when a dependency fails?

- **`sqlite-vec` unavailable**:
  `canDelete()` (`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts:141-152`) checks `vecStatus.available` or absence of trigger `memory_chunks_vec_ad`. If unavailable, it sets `note = 'vec-unavailable'`, safely skips age deletes and cap evictions, but allows age archives to proceed. Deletion SQL is never executed, preventing `no such module: vec0` crashes.
- **`BackgroundWorkAdmission` (governor) timeout or rejection**:
  `waitForGovernor` (`libs/backend/memory-curator/src/lib/retention/retention-run-budget.ts:61-90`) bounds `maxDeferMs` to `msLeft()`. If aborted, it yields `'aborted'`. If rejected with any other error, it logs a warning once per run and fails open, permitting retention to complete without hanging the process.
- **`SQLITE_BUSY` contention**:
  Individual batch operations run inside `inTransaction` (`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.ts:288-321`), rolling back the contested batch and throwing `RetentionStepError('database-busy')`. `MemoryRetentionService` maps this to `stop = 'database-busy'`, sets `status = 'partial'`, and marks `backlogRemaining = true`, ensuring an automatic retry on the subsequent hourly cron tick.
- **CLI headless boot with failed memory curator registration**:
  If Track 1 crashes during CLI registration, `ensureMemoryContractFallbacks` registers null providers for reader, lister, and symbol sink, but lacks a null fallback for `MEMORY_USAGE_RECORDER` (`libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:187-220`). Because `createCliRpcHostProfile` statically declares `capabilities.memory: true`, `resolveRpcHandlerPlan` instructs `registerRpcSurface` to resolve `MemRpcHandlers` (`libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts:51-52`), which crashes with an unresolvable injection error instead of degrading gracefully.

### 5. What is missing that the requirements never mentioned?

- **Exception-safe cache invalidation and progress reporting**:
  Neither the plan nor the tribunal verdict addressed partial progress recovery when an unhandled database exception strikes mid-lifecycle. A try/finally block in `runStep` is needed to ensure `memoryStore.markWorkspacesChanged(roots)` runs for all committed batches even if a subsequent batch fails.
- **Dual row-budget tokens in retention orchestration**:
  Phase 1 had one row-budget stop token (`'row-budget'`). Phase 2 introduced `'memory-row-budget'` for the memory lifecycle, but the continuation conditions for post-row steps (ledger prune and vacuum) were not updated to recognise the new token.

---

## Failure modes

### FM1: Vacuum and reclaim starvation under heavy memory lifecycle churn
- **Trigger**: A workspace accumulates > 25,000 memories, causing the retention run to hit `limits.maxMemoryRowsPerRun = 25_000` during age deletion or cap eviction.
- **Symptom**: Tens of thousands of records and chunk vectors are removed from SQLite, but file size does not decrease; `pagesReclaimed` reports 0; freelist pages accumulate indefinitely across consecutive partial runs.
- **Evidence**: [`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:387`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L387), [`line 403`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L403).
- **Current handling**: `const continueAfterRows = stop === null || stop === 'row-budget'`. Because `stop === 'memory-row-budget'`, `continueAfterRows` is `false`, skipping `pruneLedger` and `reclaimPages`.
- **Recommendation**: Update lines 387 and 403 to: `const continueAfterRows = stop === null || stop === 'row-budget' || stop === 'memory-row-budget';`.

### FM2: Stale search cache serving deleted/archived memories after a mid-step failure
- **Trigger**: Batch 1 of `deleteArchivedBatch` or `archiveBatch` commits changes for workspace $W_1$. Batch 2 throws an error (e.g. disk I/O failure or SQLite busy on commit).
- **Symptom**: Rows in $W_1$ have had their tier changed or rows deleted in SQLite, but `MemoryStore.writeCounts` for $W_1$ is not bumped. `MemorySearchService` continues returning cached search hits containing deleted memories until another write occurs.
- **Evidence**: [`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:195`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts#L195).
- **Current handling**: `this.memoryStore.markWorkspacesChanged(roots)` is placed after all loops. If an error throws in any loop, line 195 is never reached.
- **Recommendation**: Wrap the loop executions in `runStep` with `try ... finally { if (roots.size > 0) this.memoryStore.markWorkspacesChanged(roots); }`.

### FM3: Misleading zero-counters recorded in retention state on mid-run failure
- **Trigger**: A lifecycle batch throws an exception after previous batches archived or deleted rows.
- **Symptom**: `memory_retention_state` has its `memories_archived`, `memories_deleted`, `memories_evicted` overwritten with `0`. The diagnostics panel and audit logs report 0 memories affected despite thousands having been modified on disk.
- **Evidence**: [`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:293-302, 378, 411-420, 536-538`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L293-L302).
- **Current handling**: `lifecycleResult` retains its initial all-zero object when `this.lifecycle.runStep` rejects.
- **Recommendation**: Catch errors inside `MemoryLifecycleService.runStep`, populate `result.stop` or attach accumulated counts to a custom error, and ensure `execute` receives partial counts.

### FM4: Unhandled DI resolution crash during degraded CLI boot
- **Trigger**: SQLite initialization or `registerMemoryCuratorServices` fails during CLI startup.
- **Symptom**: Headless CLI or TUI fails to boot with an unhandled tsyringe error: `Cannot resolve MEMORY_USAGE_RECORDER`.
- **Evidence**: [`libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts:51-52`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts#L51-L52), [`libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:187-219`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts#L187-L219).
- **Current handling**: `ensureMemoryContractFallbacks` registers null fallbacks for reader, lister, and symbol sink, but not for `MEMORY_USAGE_RECORDER`. `MemRpcHandlers` is library-owned with `requires: ['memory']`, which CLI declares enabled.
- **Recommendation**: Either register a no-op `NullMemoryUsageRecorder` in `ensureMemoryContractFallbacks` and `register-rpc-surface.ts:installNullImplementations`, or mark `usageRecorder` as `{ isOptional: true }` in `MemRpcHandlers`.

### FM5: Silent truncation of usage recording beyond 200 items
- **Trigger**: A batch operation or external MCP query calls `recordUse` with 201+ memory IDs.
- **Symptom**: Memories 201+ remain untouched; their `last_used_at` does not update, and if in `archival`, they remain in `archival` and are eventually deleted.
- **Evidence**: [`libs/backend/memory-curator/src/lib/memory.store.ts:530`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/memory.store.ts#L530).
- **Current handling**: `const ids = [...new Set(memoryIds)].slice(0, 200);` truncates silently.
- **Recommendation**: Log a debug warning when `memoryIds.length > 200`, or chunk the array into 200-element slices inside the transaction.

---

## Blocking issues

*None found.* No regressions cause total boot crashes under normal configuration, deadlocks, or immediate data loss.

---

## Serious issues

### 1. `continueAfterRows` omits `'memory-row-budget'`, bypassing page reclamation on large deletions
- **File**: [`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:387, 403`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L387)
- **Scenario**: When memory lifecycle deletes or evicts 25,000 memories, the memory row budget is exhausted (`room <= 0`), setting `lifecycleResult.stop = 'memory-row-budget'`. Lines 387 and 403 only check `stop === null || stop === 'row-budget'`.
- **Impact**: Ledger pruning and incremental vacuum page reclamation are skipped entirely whenever memory deletions hit the run cap. Over time, databases undergoing heavy lifecycle pruning never return pages to the OS during the runs that created the free pages, violating the performance contract.
- **Fix**:
  ```ts
  const continueAfterRows =
    stop === null || stop === 'row-budget' || stop === 'memory-row-budget';
  ...
  if (continueAfterRows && (stop === null || stop === 'row-budget' || stop === 'memory-row-budget')) {
    const reclaim = await this.reclaimPages(budget, tally);
  ```

### 2. Unhandled exception in `MemoryLifecycleService.runStep` loses committed counters and skips search cache invalidation
- **File**: [`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:195`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts#L195), [`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:378-382`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L378)
- **Scenario**: A retention run processes 10 delete batches (1,000 memories deleted). On batch 11, SQLite throws `SQLITE_BUSY` or a disk error. The error propagates uncaught out of `runStep`.
- **Impact**:
  1. `this.memoryStore.markWorkspacesChanged(roots)` at line 195 is skipped. Memory search and listing caches for those workspaces are not invalidated, causing AI models to continue receiving deleted memories in prompt context.
  2. In `MemoryRetentionService.execute`, `lifecycleResult` remains `{ archived: 0, deleted: 0, evicted: 0 }`. The run record persisted to `memory_retention_state` records 0 memories deleted, obscuring disk state from diagnostics.
- **Fix**:
  Ensure `runStep` wraps batch iterations in `try ... finally { if (roots.size > 0) this.memoryStore.markWorkspacesChanged(roots); }`, and catches `RetentionStepError` to return accumulated counts with `result.stop` set appropriately.

---

## Moderate and minor issues

### 3. Missing `NullMemoryUsageRecorder` fallback in degraded CLI boot (Moderate)
- **File**: [`libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts:51-52`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts#L51-L52), [`libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:193-219`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts#L193)
- `MemRpcHandlers` requires `MEMORY_USAGE_RECORDER`. If Track 1 fails in CLI, `ensureMemoryContractFallbacks` installs `NullMemoryReader`, `NullMemoryLister`, and `NullSymbolSink`, but omits `MEMORY_USAGE_RECORDER`.
- **Fix**: Export a `NullMemoryUsageRecorder` from `memory-contracts` and register it in `ensureMemoryContractFallbacks`.

### 4. Premature blanking of storage health preview DTO (Minor)
- **File**: [`libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:97-110`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts#L97-L110)
- The preview object is evaluated with an all-or-nothing check. If any single preview field is null due to an isolated query error, `preview` becomes `null`, forcing the UI to report "preview after the first run".
- **Fix**: Allow individual preview count fields to be nullable in `MemoryLifecyclePreviewDto` or default unreadable counts to 0 while populating `readErrors`.

### 5. Unbounded input truncation in `recordUse` (Minor)
- **File**: [`libs/backend/memory-curator/src/lib/memory.store.ts:530`](file:///D:/projects/ptah-extension/.claude-worktrees/task-439-phase2-memory-lifecycle/libs/backend/memory-curator/src/lib/memory.store.ts#L530)
- Slicing `[...new Set(memoryIds)].slice(0, 200)` drops trailing IDs without warning.
- **Fix**: Chunk `ids` into batches of 200 inside the transaction, or emit a debug log when IDs are truncated.

---

## Would not ship

1. **Do not ship with `continueAfterRows` omitting `'memory-row-budget'`**:
   Skipping page reclamation on runs that evict up to 25,000 memories directly undermines the goal of Thoth phase 2 to control database bloat.
2. **Do not ship without `finally` cache invalidation in `MemoryLifecycleService.runStep`**:
   Cache consistency between `MemoryStore.writeCounts` and committed SQLite rows is critical to prevent hallucination on deleted memories.

---

## Cross-batch interactions checked and found sound

1. **Write transactions spanning an `await` (XB1/XB3)**:
   - **Audited**: `memory-retention.service.ts`, `retention-run-budget.ts`, `memory-lifecycle.service.ts`, `memory-lifecycle.store.ts`, `observation-retention.store.ts`.
   - **Finding**: **Sound.** In `MemoryLifecycleStore`, every batch method (`deleteArchivedBatch`, `archiveBatch`, `evictBatch`) executes synchronously inside `inTransaction((db) => { ... })`. `db.exec('BEGIN IMMEDIATE')` and `db.exec('COMMIT')` enclose only synchronous statement preparations and runs. All asynchronous operations (`await budget.waitForGovernor()`, `await budget.yieldToEventLoop()`, `await this.reclaimPages()`) occur strictly outside any transaction.
2. **Governor wait vs wall budget and single-flight flag (XB3)**:
   - **Audited**: `retention-run-budget.ts:61-90`, `memory-retention.service.ts:170-204`.
   - **Finding**: **Sound.** `waitForGovernor` caps `maxDeferMs` at `this.msLeft()`. If `msLeft() <= 0`, it immediately returns `this.hardStop()` without calling `governor.whenClear()`. On abort or `AbortError`, it returns `'aborted'`. Rejections fail open with a single log warning and fall back to `hardStop()`. The `this.running` flag in `MemoryRetentionService` is unconditionally reset in a `finally` block at line 202.
3. **Diagnostics read path (`memory-storage-health.ts`)**:
   - **Audited**: `readMemoryStorageHealth`.
   - **Finding**: **Sound.** Reads zero memory tables (queries only `observation_queue`, `observation_quarantine`, `memory_retention_state`, and page pragmas). Catches all internal errors, normalises outputs, and routes every read error through `sanitizeRetentionError`. Runs cleanly under WAL concurrent reader isolation.
4. **Use recording vs age lifecycle concurrency**:
   - **Audited**: `recordUse` vs `archiveBatch` / `deleteArchivedBatch` / `evictBatch`.
   - **Finding**: **Sound.** `recordUse` updates `tier = 'recall', archived_at = NULL` inside a transaction. If executed before delete, the row is no longer in `tier = 'archival'` and is not selected. If executed after, the row is gone and update changes are 0. The 7-day grace window strictly prevents rows archived in the current run from being evicted by cap in the same run.
5. **Decay job deletion across all 90 projects (Batch 9)**:
   - **Audited**: Full repository search for `MemoryDecayJob`, `SalienceScorer`, `recordHit`, `updateSalience`, `lastDecay`, and `decay-run`.
   - **Finding**: **Sound.** Clean removal. No dangling references remain in apps, libs, or UI fixtures. Zero SQL writes to `salience` exist outside of migration 0044.
6. **Batch-size reduction (200 → 100, Task 10.4)**:
   - **Audited**: `RETENTION_MEMORY_DELETE_BATCH_SIZE = 100`.
   - **Finding**: **Sound.** Halving delete batch size maintains bounded per-statement wall times ($\le 66\text{ ms}$) without altering total run caps (60 s wall budget, 25,000 memory rows). Yields more frequently to the event loop.
7. **Reachability proofs (AC8)**:
   - **Audited**: Specs in `thoth-runtime`, `cli-engine`, and `memory-curator`.
   - **Finding**: **Sound.** `start-thoth-cron.spec.ts` and `cli-engine/thoth-runtime.spec.ts` use a real `MemoryRetentionService` instance wired to a spy lifecycle step and assert both invocation and summary content format. Omitting `runStep` causes test failure.

---

## Data flow

```
[Cron Tick: 17 * * * *]
       │
       ▼
[startThothCron / activateThoth]
       │  (resolves memory:retention handler)
       ▼
[MemoryRetentionService.run]
       │  (checks gates: boot-deferral, battery, foreground, single-flight)
       ▼
[MemoryRetentionService.execute]
       │
       ├──► 1. Purge Processed (observation_queue) ──► [BEGIN IMMEDIATE...COMMIT]
       │       (yields to governor + event loop)
       │
       ├──► 2. Quarantine Stuck (observation_queue) ──► [BEGIN IMMEDIATE...COMMIT]
       │       (yields to governor + event loop)
       │
       ├──► 3. Memory Lifecycle Step (MemoryLifecycleService.runStep)
       │       │
       │       ├──► canDelete() check (vec available?)
       │       │
       │       ├──► deleteArchivedBatch (100 rows, tier='archival' & archived_at < now - 60d)
       │       │       └──► [BEGIN IMMEDIATE: delete chunks + memories...COMMIT]
       │       │
       │       ├──► archiveBatch (500 rows, tier='recall' & last_used_at < now - 30d)
       │       │       └──► [BEGIN IMMEDIATE: update tier='archival', archived_at=now...COMMIT]
       │       │
       │       ├──► capEviction (overCap workspaces: archival > 7d grace, then recall)
       │       │       └──► [BEGIN IMMEDIATE: delete chunks + memories...COMMIT]
       │       │
       │       ├──► readPreview (evaluates eligible counts for next run)
       │       └──► markWorkspacesChanged (bumps write counter for affected roots)
       │
       ├──► 4. Ledger Prune (observation_quarantine)
       │       [GAP: skipped if lifecycle hit memory-row-budget]
       │
       ├──► 5. Page Reclaim (incremental_vacuum + passive WAL checkpoint)
       │       [GAP: skipped if lifecycle hit memory-row-budget]
       │
       └──► 6. writeRun (persists tally + lifecycle counts + preview to memory_retention_state)
```

---

## Requirements fulfilment

| Requirement | Description | Status | Gap |
| ----------- | ----------- | ------ | --- |
| **AC1** | Age lifecycle, exemptions, no orphans | COMPLETE | Core, pinned, and corpus rows exempt; cascade triggers clean chunks, FTS, and vector indices. |
| **AC2** | $M=60$ counted from `archived_at` | COMPLETE | Migration 0044 backfills archival rows; deletion query keys on `archived_at < cutoff`. |
| **AC3** | Explicit use recording & restore | COMPLETE | `recordUse` implemented; hooked into prompt injection, MCP search, `memory:get`, `mem:getObservations`, and merge. |
| **AC4** | Per-workspace cap (25,000) & 7d grace | COMPLETE | Archival evicted first with grace cutoff; recall evicted only if recall alone exceeds cap. |
| **AC5** | Ranking-only salience | COMPLETE | `salience-ranking.ts` expression adopted; stored salience rebased in migration 0044; no writes post-insert. |
| **AC6** | Scheduling, decay removal, diagnostics | PARTIAL | `MemoryDecayJob` and scorer deleted. Gap: `continueAfterRows` omits `'memory-row-budget'`. |
| **AC7** | Dry-run preview | COMPLETE | Preview reads computed at end of run; `enabled=false` converts step to preview-only; UI rows present. |
| **AC8** | Reachability proofs | COMPLETE | 4 proofs present and verified (DI, SQLite integration, Electron cron, CLI runtime). |
| **AC9** | Performance and timing validation | COMPLETE | M1 accepted deviation documented; M4 resolved via Task 10.4 (batch size 200 → 100). |

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| `sqlite-vec` missing / unloaded | YES | `canDelete()` returns false; deletes paused with note `'vec-unavailable'`. | None. |
| Memory used during archival window | YES | `recordUse` restores tier to `'recall'` and sets `archived_at = NULL`. | None. |
| Workspace root `NULL` or empty | YES | Bound via `IS @ws` in SQL; maps to `''` in memory write counters. | None. |
| Contention / `SQLITE_BUSY` on batch | YES | Rolls back batch, throws `RetentionStepError`, maps to `partial`, sets `backlogRemaining = 1`. | Partial counters lost in `writeRun` report (FM3). |
| Governor wait exceeds deadline | YES | `msLeft()` caps deferral; deadline expiry caught by `hardStop()` as `'time-budget'`. | None. |
| Memory deletion cap reached (25k) | PARTIAL | Step stops with `'memory-row-budget'`, backlog preserved. | Reclaim and ledger prune skipped (FM1). |
| CLI initialization with broken SQLite | PARTIAL | Catches error in Track 1, installs null fallbacks for reader/lister/sink. | Omits null fallback for usage recorder, crashing `MemRpcHandlers` (FM4). |

---

## Verdict

- **Recommendation**: **APPROVED WITH FIXES**
- **Confidence**: **HIGH**
- **Top risk**: Memory row cap exhaustion skips SQLite incremental vacuum, causing disk space to remain un-reclaimed after deleting 25,000 memories.
- **Required fixes before merge**:
  1. In `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:387, 403`, add `|| stop === 'memory-row-budget'` to `continueAfterRows` and the reclaim condition.
  2. In `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:195`, wrap batch processing in a `try ... finally` block ensuring `this.memoryStore.markWorkspacesChanged(roots)` executes whenever `roots.size > 0`, even on error.
  3. In `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:187`, register a no-op fallback for `MEMORY_CONTRACT_TOKENS.MEMORY_USAGE_RECORDER` so headless degraded boot does not crash.
