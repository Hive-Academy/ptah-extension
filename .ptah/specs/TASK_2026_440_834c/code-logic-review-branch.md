# Whole-Branch Code-Logic Review — TASK_2026_440_834c (Gate 3)

Independent branch review for memory retention, storage hygiene, and backup hardening (`feat/task-440-memory-retention`).

## Summary

| Metric | Value |
| --- | --- |
| **Review Score** | **9.2 / 10** |
| **Verdict** | **APPROVED WITH FIXES** |
| **Blocking Findings** | 0 |
| **Serious Findings** | 0 |
| **Moderate Findings** | 1 |
| **Minor Findings / Residuals** | 3 |

---

## Findings

### Finding 1 (Moderate) — "Next run" displays past relative timestamp on backlog remaining
- **Trigger**: A retention run finishes with `status: 'partial'` (e.g. hitting the 50,000-row budget, 32,768-page budget, or stopped by battery/foreground/database-busy), setting `backlogRemaining = true`.
- **Symptom**: In the frontend diagnostics panel (`ptah-storage-health-panel`), the "Retention settings" card shows "Next run: X min ago" (e.g. "12 min ago") instead of indicating that it is due now or at the next idle hourly check.
- **Evidence**:
  - In [memory-retention.service.ts:685-692](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L685-L692):
    ```ts
    private nextDueAt(state: RetentionState): number | null {
      if (state.backlogRemaining && state.lastFinishedAt !== null) {
        return state.lastFinishedAt;
      }
      return state.lastCompletedAt !== null
        ? state.lastCompletedAt + this.limits.intervalMs
        : null;
    }
    ```
  - In [storage-health-panel.component.ts:68-72](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts#L68-L72) & [L340-L343](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts#L340-L343):
    ```ts
    const diff = now - at;
    if (diff >= 0) return `${formatSpan(diff)} ago`;
    return `in ${formatSpan(-diff)}`;
    ...
    nextDueText:
      s.retention.nextDueAt !== null
        ? formatRelativeTime(s.retention.nextDueAt, now)
        : 'at the next idle hourly check',
    ```
    When `backlogRemaining = true`, `nextDueAt` equals `lastFinishedAt` (a past epoch). `diff >= 0` evaluates to true, rendering `${formatSpan(diff)} ago` for the "Next run" field.
- **Recommendation**: In `storage-health-panel.component.ts`, check if `s.retention.nextDueAt <= now`. If so, format `nextDueText` as `'at the next idle hourly check'` or `'due now'` rather than passing a past timestamp into `formatRelativeTime`.

---

### Finding 2 (Minor) — Power monitor resolution in handler factory is outside the resolve try block
- **Trigger**: Host container disposal or misconfiguration where `CRON_POWER_MONITOR` is not registered.
- **Symptom**: `createMemoryRetentionHandler` throws during `container.resolve(CRON_TOKENS.CRON_POWER_MONITOR)`, turning the tick into an unhandled throw in `JobRunner` (`status: failed` in `job_runs`), whereas a missing `MEMORY_RETENTION_SERVICE` gracefully skips with `'retention-service-unavailable'`.
- **Evidence**:
  - In [memory-retention-job.ts:66-80](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/thoth-runtime/src/lib/memory-retention-job.ts#L66-L80):
    ```ts
    let service: MemoryRetentionService;
    try {
      service = container.resolve<MemoryRetentionService>(
        MEMORY_TOKENS.MEMORY_RETENTION_SERVICE,
      );
    } catch {
      return {
        outcome: 'skipped' as const,
        reason: 'retention-service-unavailable',
      };
    }

    const monitor = container.resolve<IPowerMonitor>(
      CRON_TOKENS.CRON_POWER_MONITOR,
    );
    ```
- **Recommendation**: Wrap `CRON_POWER_MONITOR` resolution in the same try/catch or fallback to `isOnBattery: () => false` if unresolvable.

---

### Finding 3 (Minor / Residual R-TL8) — Occasional WAL auto-checkpoint fsync stall during large purge passes
- **Trigger**: Rapid bulk page relocation/deletion during the 50,000-row purge crossing SQLite's default 1,000-page autocheckpoint threshold on Windows NTFS SSD.
- **Symptom**: One out of 350 purge batches took 487 ms in Task 7.4 ([test-report.md:305](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/.ptah/specs/TASK_2026_440_834c/test-report.md#L305)), exceeding the 120 ms soft design bound due to an inline WAL auto-checkpoint.
- **Evidence**: [observation-retention.store.ts:336-373](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts#L336-L373).
- **Recommendation**: Accept as documented residual R-TL8: retention only executes after 5 minutes of idle foreground activity on AC power, and adaptive halving subsequently shrinks batch sizes.

---

### Finding 4 (Minor / Residual Task 7.3) — Filesystems lacking hard-link support permanently fail atomic publish
- **Trigger**: Backups directory on FAT32, exFAT, network shares (SMB/NFS), or cross-volume junctions where `fs.linkSync` fails with `EXDEV` or `ENOSYS`.
- **Symptom**: `performBackup` returns `unavailable` with detail `atomic publish failed`, and no backup is created.
- **Evidence**: [integrity-worker-protocol.ts:708-716](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts#L708-L716) and [backup.service.ts:21-27](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/backup.service.ts#L21-L27).
- **Recommendation**: Accept as documented residual; Task 7.3 explicitly added documentation in `backup.service.ts` and `CLAUDE.md`.

---

## Detailed Examination (Items 1 – 7)

### 1. Shared Connection + Main Thread Concurrency
- **UI Blocking & Duration Bounds**:
  - The retention run consists of discrete batch calls: `store.purgeProcessedBatch` (max 500 rows), `store.quarantineStuckBatch` (max 500 rows), `store.pruneLedger`, and `reclaimer.reclaimStep` (256 pages, clamped to 64 floor).
  - Every batch method in [observation-retention.store.ts:336-417](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts#L336-L417) executes completely synchronously inside `inTransaction`:
    `BEGIN IMMEDIATE` → SQL statements → `COMMIT`.
  - In [memory-retention.service.ts:370, 403, 494](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L370), between every batch, the service invokes `await yieldToEventLoop()`.
  - **Does anything hold a write transaction across an await?** **NO.** Every write transaction is opened and committed synchronously inside `inTransaction`. The event loop yield `await yieldToEventLoop()` occurs strictly between transactions when `db.inTransaction` is false.
  - **30 s Diagnostics Poll (`storageHealth`)**: In [observation-retention.store.ts:423-450](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts#L423-L450), live queries use the covering index `idx_obs_queue_drain`. The expensive row-count (`TOTAL_ROWS_SQL`) was removed from the poll and is only run at the end of retention. The pending byte sum (`PENDING_BYTES_SQL`) is capped at `PENDING_BYTES_MAX_ROWS = 5000` rows (~26 ms); above 5,000 rows, it returns `null` and records a policy skip in `readErrors` ([observation-retention.store.ts:104, 461-468](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts#L104)). Total diagnostics poll duration on the main thread is ~5–30 ms, well below 120 ms.
  - **Capture Flush vs Retention**: Observation queue flushes occur on the main thread timer. Because Node is single-threaded, a capture flush and a retention batch cannot interleave mid-transaction. They can only interleave during `await yieldToEventLoop()`. When retention yields, `db.inTransaction` is false, allowing queue flushes to acquire the write lock without waiting for `busy_timeout`.
  - **Backup & Integrity Check**: The daily backup and integrity check run in worker processes (`DbWorkerRunner`) opening the file with `readonly: true` in WAL mode. In SQLite WAL mode, readers do not block writers and writers do not block readers. `checkpointPassive()` runs `PRAGMA wal_checkpoint(PASSIVE)` which does not wait for readers.

---

### 2. Backup ↔ Retention Interaction
- **Migration 0043 Pre-migration Backup & Rotation**:
  - In [migration-runner.ts:90-103](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/migration-runner.ts#L90-L103), `backup('pre-migration')` is executed before migration 0043 runs, followed by `rotate('pre-migration', KEEP_BY_KIND['pre-migration'])`.
  - `KEEP_BY_KIND['pre-migration']` was lowered from 3 to 1 in [backup.service.ts:116](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/backup.service.ts#L116). For a 1.28 GB database, this prevents retention from holding 3.84 GB of historical snapshots, leaving at most 1 copy (1.28 GB) plus the active database.
  - Peak disk usage during upgrade: Live DB (1.28 GB) + 1 prior pre-migration backup (1.18 GB) + 1 new staging backup (1.28 GB) = ~3.74 GB peak, dropping immediately to ~2.56 GB upon rotation.
- **In-flight Backup Copy vs Page Moves**:
  - The backup worker copies into an exclusively created staging file (`stagingPath = <destPath>.<8 hex>.tmp`) via `source.backup(stagingPath)` ([integrity-worker-protocol.ts:658-675](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts#L658-L675)).
  - SQLite's `sqlite3_backup` API tracks pages modified by concurrent writers and recopies changed pages automatically.
  - Before publication, the worker executes `validateCopy(stagingPath)` which runs `PRAGMA quick_check;` on the completed staging file ([integrity-worker-protocol.ts:678](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts#L678)).
  - Only when `quick_check` passes `ok` and sidecars are cleaned up does `fs.linkSync(stagingPath, destPath)` atomically publish the file ([integrity-worker-protocol.ts:709](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts#L709)).
  - If retention relocates pages during backup, `quick_check` guarantees no corrupted staging copy can ever be linked to `destPath`.
- **Staging Sweep vs Rotation**:
  - [backup.service.ts:474-490](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/persistence-sqlite/src/lib/backup.service.ts#L474-L490) sweeps staging files matching `STAGING_SUFFIX` older than `2 * BACKUP_WORKER_BUDGET_MS` (10 minutes). Younger staging files belonging to active in-flight copies are left intact.

---

### 3. Dual Hosts: Electron & CLI on Shared Database
- **Job Registration & Slot Claiming**:
  - Both hosts register the exact same job: `@ptah/memory-retention` with cron expression `17 * * * *` ([memory-retention-job.ts:39-45](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/thoth-runtime/src/lib/memory-retention-job.ts#L39-L45)).
  - Slot claiming in `cron-scheduler` is backed by `RunStore.tryClaim` using SQLite's `UNIQUE(job_id, scheduled_for)` table constraint. When the hourly tick fires, the first process to insert claims the slot; the second process receives `SlotAlreadyClaimedError` and quietly exits ([job-runner.ts:135-145](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/cron-scheduler/src/lib/job-runner.ts#L135-L145)).
- **Single-Flight & Concurrent Execution**:
  - `MemoryRetentionService` maintains a per-process `running` flag ([memory-retention.service.ts:141, 164-166](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L141)).
  - If two processes attempt retention simultaneously, `inTransaction` uses `BEGIN IMMEDIATE` ([observation-retention.store.ts:576](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts#L576)). The second process waits up to `busy_timeout` (5,000 ms). Because batches take ~5–10 ms, the lock clears quickly. If a timeout occurs, `isBusyError` catches it and stops with `database-busy`, setting `backlogRemaining = true` without throwing or corrupting data ([observation-retention.store.ts:578-582](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts#L578-L582), [memory-retention.service.ts:427-434](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L427-L434)).

---

### 4. Gates, Time & Scheduling
- **Boot Deferral vs Cron Catch-Up**:
  - `startedAt` is captured in `MemoryRetentionService` constructor ([memory-retention.service.ts:138](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L138)).
  - When the app starts, cron catch-up executes missed jobs immediately. Gate 3 checks `startedAt - this.startedAt < bootDeferralMs` (10 minutes = 600,000 ms) and skips with `'boot-deferred'` ([memory-retention.service.ts:265-267](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L265-L267)).
  - At minute 17 after startup (>= 17 minutes later), Gate 3 is open.
- **Not-Due vs Backlog**:
  - Gate 8 checks:
    `state !== null && !state.backlogRemaining && state.lastCompletedAt !== null && startedAt - state.lastCompletedAt < this.limits.intervalMs` ([memory-retention.service.ts:284-291](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L284-L291)).
  - If `backlogRemaining` is true (partial run), Gate 8 is open every hour. Once completed with 0 backlog remaining, it rests for 24 hours.
  - `writeSkip` is NOT called on `not-due`, preventing unnecessary database writes.
- **Clock Jumps & System Sleep**:
  - If the system sleeps for days, `startedAt - lastCompletedAt > 24h`, so the first hourly tick after waking runs immediately.
  - If the clock jumps backwards, `startedAt - lastCompletedAt` is negative (< 24h), so it skips as `not-due` until the clock catches up, preventing runaway spin.

---

### 5. Upgrade Path on Real Data
- **Boot-Path Impact**:
  - Pre-migration backup of 1.28 GB file runs via out-of-process worker (`integrity-worker`).
  - Migration 0043 executes two `CREATE TABLE IF NOT EXISTS` statements with no table scans or backfills, measured at **9 ms** on the actual snapshot ([test-report.md:143](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/.ptah/specs/TASK_2026_440_834c/test-report.md#L143)).
  - Boot catch-up tick hits Gate 3 and returns in ~1 ms (`writeSkip`).
  - Zero boot stall introduced.
- **First Days Behavior (174k processed rows, 2.3k stuck rows, ~250k pages)**:
  - Run 1 (Hour 1): Purges 50,000 processed rows (hits `maxRowsPerRun`), reclaims 32,768 pages (128 MB), takes ~3 s wall time, exits `partial: row-budget` with `backlogRemaining: true`.
  - Runs 2 & 3 (Hours 2 & 3): Each purges 50,000 rows and reclaims 32,768 pages.
  - Run 4 (Hour 4): Purges remaining ~24,800 rows, quarantines all 2,332 stuck rows into `observation_quarantine`, reclaims 32,768 pages.
  - Subsequent hourly runs: Continue page reclamation (32,768 pages/run) until `freelist_count == 0`.
  - Over ~8 idle hourly runs, ~800 MB - 1 GB of disk space is reclaimed and returned to the OS without ever blocking the UI.

---

### 6. Contract End-to-End Consistency
- **Settings → Config → Service → Report → State Table → DTO → UI**:
  - Settings keys registered in [file-settings-keys.ts:333-342, 591-600](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/platform-core/src/file-settings-keys.ts#L333-L342) match defaults in [memory-retention-config.ts:60-70](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts#L60-L70): `true`, `7`, `14`, `500`.
  - Service `finish()` writes `memory_retention_state` with `INSERT ... ON CONFLICT(id) DO UPDATE` ([observation-retention.store.ts:135-150](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts#L135-L150)). `avg_processed_row_bytes` and `last_completed_at` use `COALESCE` to prevent overwriting valid historical numbers with nulls.
  - `storageHealth()` builds `MemoryStorageHealthDto` with index-bounded queries ([memory-retention.service.ts:199-257](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts#L199-L257)).
  - `MemoryDiagnosticsResult` wire DTO gains `storage: MemoryStorageHealthDto` ([rpc-curator-diagnostics.types.ts:138](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts#L138)).
  - Frontend `StorageHealthPanelComponent` binds `storage` signal and renders all metrics cleanly with fallback dashes `—` for null states ([storage-health-panel.component.ts:134-259](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts#L134-L259)).
  - Only issue identified is Finding 1 (`nextDueAt` rendering past relative time when backlog remains).

---

### 7. Cross-Cutting & Hexagonal Architecture Boundaries
- **Hexagonal Architecture**:
  - `persistence-sqlite` has zero upward dependencies on domain libraries.
  - `memory-curator` depends only downward on `persistence-sqlite`, `platform-core`, and `shared`. It does NOT import `cron-scheduler`, `skill-synthesis`, `agent-sdk`, or `rpc-handlers`.
  - Battery and foreground activity are provided via functional callbacks (`isOnBattery`, `msSinceForegroundActivity`).
- **DI Composition Roots**:
  - Electron registers services in `apps/ptah-electron/src/di/phase-2-libraries.ts` and starts the job in `boot-heavy-services.ts`.
  - CLI registers services in `cli-engine/src/lib/thoth/register-thoth-libraries.ts` and starts the job in `thoth-runtime.ts`.
- **VS Code Extension Host Isolation**:
  - VS Code host explicitly lists `MemoryRpcHandlers`, `CronRpcHandlers`, and `PersistenceRpcHandlers` in `EXPECTED_ABSENT_HANDLERS` ([expected-absent.ts:34-45](file:///D:/projects/ptah-extension/.claude-worktrees/task-440-memory-retention/apps/ptah-extension-vscode/src/di/expected-absent.ts#L34-L45)).
  - VS Code host does not call `startThothCron` and does not construct `MemoryRetentionService`. No incomplete or half-wired services exist in VS Code.

---

## Command Output Summary

Command executed:
```powershell
npx nx run-many -t typecheck test --parallel=1 -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/thoth-runtime @ptah-extension/cli-engine
```

**Header confirmed 4 projects**:
```
 NX   Running targets typecheck, test for 4 projects:

- @ptah-extension/persistence-sqlite
- @ptah-extension/memory-curator
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
```

**Results**:
- `@ptah-extension/persistence-sqlite`: 29 suites passed, 9 skipped (pre-existing native ABI gates); 393 tests passed, 80 skipped; typecheck PASSED.
- `@ptah-extension/memory-curator`: 35 suites passed, 2 skipped (unrelated native gates); 551 tests passed, 59 skipped; typecheck PASSED.
- `@ptah-extension/thoth-runtime`: 5 suites passed; 87 tests passed; typecheck PASSED.
- `@ptah-extension/cli-engine`: 17 suites passed; 179 tests passed; typecheck PASSED.
- **Overall**: `NX Successfully ran targets typecheck, test for 4 projects`. Exit code: 0.

---

## Verdict

**APPROVED WITH FIXES** — 0 blocking, 0 serious, 1 moderate, 3 minor.
- **Moderate fix recommended before release**: Finding 1 (display "due at next idle hourly check" instead of a past relative time "X min ago" in the frontend panel when `backlogRemaining = true`).
