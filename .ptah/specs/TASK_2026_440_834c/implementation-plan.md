# Implementation Plan - TASK_2026_440_834c

Phase 1 of the Thoth rework (umbrella TASK_2026_439_1310): stop database growth.

All paths are relative to the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention` unless absolute.
Every `file:line` was opened in that worktree (branch `feat/task-440-memory-retention`, HEAD 6349f03ac).

## Inputs and constraints

- Requirements used: `context.md` (section "Scope"), `verdict.md` section A, `brief.md` (live-DB numbers).
  There is no `task-description.md`; the verdict is the approved requirements source.
- Corrections applied: none.
- Design handoff used: none. The UI change is a minimal additive panel, not a redesign (redesign is phase 6).
- Missing decision-critical input: none. Two questions the brief left open were answered by a READ-ONLY
  `node:sqlite` inspection of the user's live file (`~/.ptah/state/ptah.sqlite`, opened `readOnly: true`,
  2026-09-14). Nothing was written to it:
  - `PRAGMA auto_vacuum` = **2 (INCREMENTAL)**, `page_size` = 4096, `page_count` = 313,997, `freelist_count` = 0,
    `journal_mode` = wal, `schema_migrations` max = 42.
  - Query plans and timings (warm cache) that decide the index question in Component 4:
    - `SELECT id ... WHERE processed_at < ? LIMIT 500` → `SEARCH ... USING COVERING INDEX idx_obs_queue_session (ANY(session_id) AND processed_at<?)`,
      1 ms. That is a **skip-scan**, and it exists only because `sqlite_stat1` has rows for this table
      (`idx_obs_queue_session: '79847 53 31 1'`).
    - The same predicate as a forced full covering-index scan (no skip-scan) took **766 ms per query**.
    - `processed_at IS NULL AND captured_at < ? ORDER BY captured_at` → `SEARCH ... USING COVERING INDEX idx_obs_queue_drain`, 4 ms.
    - `SELECT COUNT(*) FROM observation_queue` 72 ms; pending count + `MIN(captured_at)` 1 ms;
      `octet_length` sum over all rows 997 ms; `dbstat` over the table **32.5 s** (never use it).
    - Counts: 174,213 processed rows older than 7 days; 2,332 unprocessed rows older than 14 days
      (oldest `captured_at` 1785199523668 = 2026-07-28); 2,839 unprocessed rows inside the 14-day grace.
  - Bundled SQLite in `better-sqlite3` 12.10.0 is 3.53.1 (`node_modules/better-sqlite3/deps/sqlite3/sqlite3.h:149`),
    so `octet_length()` (3.43+) and `json_each()` are available in production and in `node:sqlite` (3.51.3) under Jest.
- Scheduled jobs on the live file today: `@ptah/daily-backup`, `@ptah/skills-drain-{frequent,nightly,weekly}`,
  `@ptah/db-integrity-check`. No retention, decay or vacuum job.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `PURGE_SQL` deletes `captured_at < ? AND processed_at IS NOT NULL`; `purgeOlderThan` runs it unbatched | `libs/backend/memory-curator/src/lib/observation-queue.store.ts:155,648-654` | One unbounded DELETE over 200k rows on the main thread. Replace it, do not call it. |
| `purgeOlderThan` has no production caller; only the store spec (`:305-321`) and five `jest.fn(() => 0)` mocks call it | `memory-search.service.spec.ts:129`, `triggers/memory-trigger.boot-defer.spec.ts:174`, `memory-trigger.boot-scan-budget.spec.ts:172`, `memory-trigger.integration.spec.ts:141`, `memory-trigger.service.spec.ts:310` | Deleting the method means updating those six spec sites and three doc comments (`observation-queue.store.ts:25-29,322,587`). |
| better-sqlite3 runs on the calling thread, which in Electron is the thread that owns every window | `observation-queue.store.ts:11-17` | Every retention SQL batch must be small and followed by a yield. |
| Explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` idiom, portable to `node:sqlite` | `observation-queue.store.ts:625-637` | Retention batches use it instead of `db.transaction()` (which `node:sqlite` lacks). |
| Table has no error column; indexes are `idx_obs_queue_session(session_id, processed_at, captured_at)` and partial `idx_obs_queue_drain(processed_at, captured_at) WHERE processed_at IS NULL` | `libs/backend/persistence-sqlite/src/lib/migrations/0016_observation_queue.ts:17-33` | Stuck predicate is fully indexed. Processed predicate needs `session_id` as a leading key, so a stats-independent walk is required (Component 4). |
| A stalled curator pass skips `markProcessed` so rows stay retryable; only a pass that ran marks them | `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:821-832` | Never write `processed_at` from retention. Quarantine deletes payload rows after 14 days instead. |
| Migration `0039` reaped unprocessed rows > 30 days ONCE | `migrations/0039_reap_orphaned_queue_rows.ts:189-204` | The recurring job replaces the need for any further one-time reap. |
| Highest migration is 42 | `migrations/index.ts` (last entry `version: 42`) | New migration is **0043**. Seven ratchet specs assert `toBe(42)`: `0028...spec.ts:77`, `0030...spec.ts:32`, `0038...spec.ts:85`, `0039...spec.ts:59`, `0040...spec.ts:72`, `0041...spec.ts:56`, `0042...spec.ts:64`. |
| Single-row state table precedent `id INTEGER PRIMARY KEY CHECK (id = 1)` | `migrations/0042_db_integrity_check_state.ts:266-276` | Retention run record copies this shape. |
| `0009` sets INCREMENTAL and VACUUMs; the runner calls `run(db)` without `dbPath` | `migrations/0009_auto_vacuum.ts:53-73`, `migration-runner.ts:172-217` | Mode is 2 on the live file (measured). Code still reads the mode at run time and skips reclamation when it is not 2. |
| Daily backup handler runs `incremental_vacuum(100)` (~400 KB) then `optimize` | `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:344-363` | Reclamation moves to the retention job; the `incremental_vacuum(100)` call is deleted (replace, not accumulate). `optimize` stays. |
| `rotate('pre-migration', 3)` after a non-null pre-migration backup | `libs/backend/persistence-sqlite/src/lib/migration-runner.ts:98-100` | Change to the keep table. |
| `KEEP_BY_KIND = { 'pre-migration': 3, daily: 7, reset: 0 }`, exported at `:485` but not in the barrel and read by nobody; `rotate(keep <= 0)` is a no-op | `libs/backend/persistence-sqlite/src/lib/backup.service.ts:105-110,443-444,485`; barrel `src/index.ts:29-32` | Make it the one keep table (pre-migration 1, reset bounded) and the source every `rotate` call site reads. |
| `db:reset` takes `backup('reset')` and never rotates | `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts:433` | Reset backups accumulate forever. Add rotation after a non-null backup. |
| Daily rotation literal `rotate('daily', 7)` in both hosts | `start-thoth-cron.ts:324`, `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:391` | Read `KEEP_BY_KIND.daily` instead. |
| Electron starts Thoth cron via `startThothCron` | `apps/ptah-electron/src/activation/boot-heavy-services.ts:411` | Host 1. |
| CLI runtime tier has its own `startCron` → `registerBackupJob`, `registerSkillDrainJobs` | `cli-engine/src/lib/bootstrap/thoth-runtime.ts:130,311-360` | Host 2. Must register the retention job separately. |
| VS Code has no Thoth cron and no memory handlers: no `startThothCron` call in `apps/ptah-extension-vscode`; `MemoryRpcHandlers` is in `EXPECTED_ABSENT_HANDLERS` | `apps/ptah-extension-vscode/src/di/expected-absent.ts:17-40`; `wire-runtime.ts:194` only reads `SQLITE_CONNECTION` | No VS Code change. The absent list already pins it. |
| One job table shared by both hosts, exported from `thoth-runtime`, because ids and keys drifted when copied | `libs/backend/thoth-runtime/src/lib/skill-drain-jobs.ts:13-40`; barrel `src/index.ts` | Retention job spec follows the same pattern. |
| Drain gating: the seam resolves `IPowerMonitor` per run and passes `onBattery`; the service owns the foreground gate | `start-thoth-cron.ts:66-75`; `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts:718-729` | Retention takes gate inputs as parameters. `memory-curator` must not import `cron-scheduler` or `skill-synthesis`. |
| `ForegroundActivityTracker.msSinceLastActivity()` returns `Infinity` before the first event; token `FOREGROUND_ACTIVITY_TRACKER` | `skill-synthesis/src/lib/queue/foreground-activity.tracker.ts:73-76`; `skill-synthesis/src/lib/di/tokens.ts:117` | The seam resolves it optionally and passes a function. `Infinity` at boot is why a separate uptime gate is required (`skill-drain.service.ts:873-890`). |
| Cold-start catch-up fires the most recent missed slot inside 24 h on `start()`, not awaited | `libs/backend/cron-scheduler/src/lib/catchup-coordinator.ts:81-117`; `cron-scheduler.ts:56,111` | A daily 03:xx slot missed overnight fires at every morning boot. The handler must defer cheaply at boot, and a daily cron alone would then never run for a user who launches at 09:00 every day. |
| Handler result has only `'succeeded' \| 'skipped'`; a throw is caught by the runner and recorded with `markFailed` | `cron-scheduler/src/lib/types.ts:155-184`; `job-runner.ts:212-232` | Failure channel decision in Component 6. |
| `withActivityEmit` rethrows and emits one event per run | `thoth-runtime/src/lib/activity-emitter.ts:114-133` | Electron wraps the retention handler like every other built-in job. |
| `DbWorkerRunner` spawns a worker that opens the file **read-only** for the check and the backup | `persistence-sqlite/src/lib/integrity/db-worker-runner.ts:1-29`; `persistence-sqlite/CLAUDE.md` (Internal Structure) | The worker cannot delete rows. See the worker-versus-main-thread decision. |
| "Single shared connection — never open ad-hoc connections" | `libs/backend/persistence-sqlite/CLAUDE.md` Guidelines | A second writer connection in a worker is ruled out. |
| `memory-curator` deps: memory-contracts, persistence-sqlite, platform-core (plus vscode-core, shared); must not import rpc-handlers or agent-sdk | `libs/backend/memory-curator/CLAUDE.md` (Dependencies, Cross-Lib Rules); `memory-trigger-config.ts:3` imports a DTO from `@ptah-extension/shared` | The retention service lives in `memory-curator` and may type its diagnostics DTO from `shared` directly. |
| `MEMORY_TOKENS` registry; registrations are all `Lifecycle.Singleton` in one function | `memory-curator/src/lib/di/tokens.ts:9-52`; `di/register.ts:47-170` | Add two tokens and two registrations. Both hosts call `registerMemoryCuratorServices` (`apps/ptah-electron/src/di/phase-2-libraries.ts:341`, `cli-engine/src/lib/thoth/register-thoth-libraries.ts:115`), so no composition-root file changes. |
| Electron `EXPECTED_RESOLVABLE` lists only shared RPC handler classes and resolves them in a minimal container with no memory graph | `apps/ptah-electron/src/di/expected-resolvable.ts:11-19`; `container.smoke.spec.ts:176-205` | Adding a memory-curator service there would require building the whole memory graph in the smoke container. It is not added; registration is proved by a `memory-curator` register spec instead. |
| `MemoryDiagnosticsService.getSnapshot` builds `MemoryDiagnosticsSnapshot` with `dbHealth` counts via `safeCount` | `memory-curator/src/lib/diagnostics.service.ts:24-60,131-147`; `diagnostics.types.ts:42,54` | Add a `storage` field built by the retention service, with per-read error capture. |
| `memory:diagnostics` exists and maps the snapshot field by field; file is 746 lines | `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:500-590` | No new RPC method, so no dual registration. Pass `storage` through in one line to avoid growing the file. |
| Wire DTOs | `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:103-138`; `rpc.types.ts:1614` | Add `MemoryStorageHealthDto` and a required `storage` field on `MemoryDiagnosticsResult`. |
| Frontend state keeps one signal per snapshot section; the accordion mounts `ptah-db-health-panel` | `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.ts:27-77`; `components/diagnostics/memory-diagnostics-accordion.component.ts:170-172`; `db-health-panel.component.ts` (447 lines) | Add a `storage` signal and a new small presentational panel beside the DB health panel. |
| Settings registry: `FILE_BASED_SETTINGS_KEYS` set and `FILE_BASED_SETTINGS_DEFAULTS` record, memory block at `:333-342` / `:586-590` | `libs/backend/platform-core/src/file-settings-keys.ts:154,435` | Register the four new keys in both. |
| Real-SQLite spec harness: `better-sqlite3` when its ABI loads, else `node:sqlite`, with an adapter that supplies `transaction()` | `memory-curator/src/lib/observation-queue.store.spec.ts:44-80,549-600` | The integration spec reuses this opener shape and also adapts `pragma()`. |
| Reachability-style assertions on a stub container | `thoth-runtime/src/lib/start-thoth-cron.spec.ts:254-497`; `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:299-415` | The two host reachability specs extend these files. |

## Architecture decision

- **Chosen approach**: one `MemoryRetentionService` in `memory-curator` (facade: gates, due decision, budgets,
  run record). It is backed by one SQL collaborator, `ObservationRetentionStore` (queue purge, stuck quarantine,
  ledger bound, storage reads, state row). File-level page reclamation goes in a new `SqlitePageReclaimer` in
  `persistence-sqlite`. A single `@ptah/memory-retention` cron job is registered by both hosts from one job
  spec and one handler factory exported by `thoth-runtime`. The job ticks **hourly** and does work only when
  the run is due: the last completed run is 24 h old, or the last run left a backlog. It works in bounded,
  yielding batches on the shared main-thread connection. Migration `0043` adds the quarantine ledger and the
  single-row run record. Pre-migration rotation drops to 1, and `reset` is bounded, through the one
  `KEEP_BY_KIND` table.
- **Rationale**:
  - The verdict asks for one `memory-retention` daily job, idle/power-gated like the skill drain
    (`verdict.md` A, Fix). The job lives in `thoth-runtime` because that is the only lib allowed to join
    "work exists" with "something runs on a schedule". The drain and integrity seams do the same
    (`start-thoth-cron.ts:139-145`, `skill-drain-jobs.ts:26-30`).
  - Hourly tick with a 24 h due gate instead of a literal daily cron: catch-up fires a missed daily slot at boot
    (`catchup-coordinator.ts:81-117`), and that boot tick must be deferred. A pure daily cron then never does
    work for a user whose app is closed at the slot time and freshly booted when catch-up fires. The integrity
    check already separates "tick" from "is due" (`start-thoth-cron.ts:195-197`). The hourly tick also lets a
    1.28 GB first run finish over several idle hours without a special first-run mode.
  - Retention runs inside `memory-curator` because that lib owns `observation_queue`
    (`memory-curator/CLAUDE.md` Boundaries). `persistence-sqlite` forbids domain queries in itself
    ("Domain queries (each consumer owns its stores)").
  - Reclamation lives in `persistence-sqlite` because `incremental_vacuum`, `freelist_count` and `auto_vacuum`
    describe the file, not a table. The same lib already owns `logConnectionHealth`'s page statistics
    (`sqlite-connection.service.ts:573-592`).
- **Where retention lives relative to `MemoryDecayJob`**: a new collaborator, NOT inside `MemoryDecayJob`.
  - `MemoryDecayJob` is memory-lifecycle logic (salience and tiers, `memory-decay.job.ts:41-62`), and phase 2
    rewrites it around age, not salience. Retention is queue and file hygiene with a different data owner
    (`observation_queue`), different safety rules (never set `processed_at`) and different gates.
  - Putting both in one class gives it two unrelated reasons to change in consecutive phases.
  - The verdict's "one job runs purge, stale reap and the memory age rule" is respected at the **job** level.
    `MemoryRetentionService.run` is an ordered list of steps, so phase 2 adds one step that calls the reworked
    decay job. This phase adds no step abstraction for that future case (recorded as an assumption, not
    designed).
- **Worker versus main thread** (item 2): main thread, shared connection, bounded batches with a yield between
  them. The alternative is rejected:
  - Rejected: a new `retention` command in the integrity worker (`DbWorkerRunner`). The worker's contract is a
    read-only connection (`openReadOnly`, `persistence-sqlite/CLAUDE.md`). Deletes would need a SECOND
    read-write connection to the same WAL file. That breaks "single shared connection", and it would compete
    for the one WAL write lock with the capture path's 250 ms flushes (`observation-queue.store.ts:118-129`)
    under `busy_timeout = 5000` (`sqlite-connection.service.ts:91`). A long worker write transaction would
    stall hook capture, which is the TASK_2026_323 defect this store's batching fixed. The backup and
    integrity check can be out of process because they only read.
  - The measured costs make main-thread batching viable: one 500-row processed batch select is 1 ms, and
    reading 5,000 processed rows' text is 109 ms, so the payload read for 500 rows is about 11 ms.
- **Rejected alternatives**:
  - Call the existing `purgeOlderThan` from cron: one unbatched DELETE of ~174k rows (~800 MB of pages) in one
    implicit transaction on the Electron main thread. Rejected.
  - Add `CREATE INDEX ... (processed_at) WHERE processed_at IS NOT NULL` in migration 0043: `processed_at` is
    the last column, after up to 16 KB text columns (`0016:17-30`). The build must walk each row's overflow
    chain, which means reading most of the 1 GB file on the boot path inside `openAndMigrate`. That is the boot
    stall TASK_2026_380/383 removed. Rejected in favour of the session-keyset walk (Component 4), which uses the
    existing index regardless of `sqlite_stat1`.
  - Rely on the skip-scan plan the live file gets today: it depends on `sqlite_stat1`, which only the Electron
    daily backup's `optimize` produces (`start-thoth-cron.ts:355`). The CLI backup handler runs no pragmas
    (`cli-engine thoth-runtime.ts:379-385`). Without stats the plan is a full covering-index scan, measured at
    766 ms per batch. Rejected.
  - Full `VACUUM` (or `VACUUM INTO`) after the first purge: rewrites 1.28 GB under a write lock. Forbidden on
    the boot path by the verdict; also too long for an idle slice. Rejected.
  - Mark stuck rows processed: fakes consumption (verdict A; `memory-trigger.service.ts:821-832`). Rejected.
  - Daily cron expression `0 2 * * *`: see the catch-up rationale above. Rejected.
- **Assumptions**:
  - A1. `PRAGMA incremental_vacuum(2048)` on a 1.28 GB file completes in about 100 ms or less per step on the
    main thread. Check: run the reclaimer spec's timing harness (or the Electron app with
    `PTAH_DB_PATH` pointed at a COPY of `~/.ptah/state/ptah.pre-migration-20260909T230600Z.sqlite`, never the
    live file) and log step durations. The adaptive step halving in Component 2 bounds the damage if false.
  - A2. A 500-row processed-row DELETE batch (payload walk plus freelist update) completes in about 60 ms or
    less on the live data shape. Check: same copy-based run; the per-batch duration is logged at `debug`. The
    adaptive batch halving in Component 5 bounds it.
  - A3. `json_each(?)` with a bound JSON array of up to 5,000 integers behaves the same under `better-sqlite3`
    and `node:sqlite`. Check: the integration spec runs under `node:sqlite` in Jest, and the store spec's plan
    assertions run on both when `better-sqlite3` loads.
  - A4. Phase 2 will add the memory age rule as a step of `MemoryRetentionService.run`. Nothing in this phase
    depends on it.
- **Effect on existing code**:
  - Replaced: `ObservationQueueStore.purgeOlderThan` and `PURGE_SQL` (deleted); the `incremental_vacuum(100)`
    block in the Electron daily-backup handler (deleted); the literal keep counts at three call sites (read from
    `KEEP_BY_KIND`); `KEEP_BY_KIND` values.
  - Left alone: `MemoryDecayJob` and all memory lifecycle; `optimize` in the backup handler; the backup worker;
    the cron scheduler; VS Code host; the skill pipeline.

## Component specifications

### 1. Migration 0043 — retention ledger and run record

- **Purpose**: persist the stuck-row quarantine ledger and the single retention run record.
- **Responsibilities**: create two new tables, both `IF NOT EXISTS`, static SQL only. No backfill, no index on
  `observation_queue`.
- **Verified contracts and entry points**:
  - The `Migration` registry entry shape `{ version, name, sql }` (`migrations/index.ts`, entry 42).
  - Static-SQL rule (`migrations/index.ts:14-18`).
  - Single-row precedent (`0042_db_integrity_check_state.ts:266-276`).
- **Exact SQL** (`0043_memory_retention.ts`, name `0043_memory_retention`):

```sql
CREATE TABLE IF NOT EXISTS observation_quarantine (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           TEXT    NOT NULL,
  kind                 TEXT    NOT NULL,
  reason               TEXT    NOT NULL,
  row_count            INTEGER NOT NULL,
  payload_bytes        INTEGER NOT NULL,
  oldest_captured_at   INTEGER NOT NULL,
  newest_captured_at   INTEGER NOT NULL,
  first_quarantined_at INTEGER NOT NULL,
  last_quarantined_at  INTEGER NOT NULL,
  UNIQUE (session_id, kind, reason)
);
CREATE INDEX IF NOT EXISTS idx_obs_quarantine_last
  ON observation_quarantine(last_quarantined_at);

CREATE TABLE IF NOT EXISTS memory_retention_state (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  last_started_at          INTEGER,
  last_finished_at         INTEGER,
  last_outcome             TEXT,
  last_reason              TEXT,
  last_error               TEXT,
  last_duration_ms         INTEGER,
  processed_purged         INTEGER NOT NULL DEFAULT 0,
  stuck_quarantined        INTEGER NOT NULL DEFAULT 0,
  ledger_pruned            INTEGER NOT NULL DEFAULT 0,
  freed_bytes              INTEGER NOT NULL DEFAULT 0,
  pages_reclaimed          INTEGER NOT NULL DEFAULT 0,
  backlog_remaining        INTEGER NOT NULL DEFAULT 0,
  last_completed_at        INTEGER,
  processed_rows_after     INTEGER,
  avg_processed_row_bytes  INTEGER,
  last_skipped_at          INTEGER,
  last_skip_reason         TEXT
);
```

  - `last_outcome` ∈ `'completed' | 'partial' | 'failed'`. It is written by the service; no CHECK is used, so a
    later phase can add values without a table rebuild (`persistence-sqlite/CLAUDE.md`, rebuild rule).
  - `reason` in the ledger is a literal token: `'stuck-unprocessed'`. The queue has no error column
    (`0016:17-30`), so there is no error text to copy.
- **Dependencies**: none beyond the runner.
- **Integration points**: read and written only by `ObservationRetentionStore`.
- **Failure behaviour**: a failure is a migration failure, handled by the existing runner. The DDL is
  idempotent. Applying 0043 on the user's DB triggers the existing out-of-process pre-migration backup
  (`migration-runner.ts:87-100`). With Component 3 that is followed by rotation to 1.
- **Quality requirements**: DDL on two empty tables; no scan of `observation_queue`, so no boot-path cost
  beyond the existing pre-migration backup.
- **Verification seam**: `0043_memory_retention.spec.ts`:
  - The registry entry is version 43, plain `sql`, not vec-gated, and the highest version.
  - No `${`.
  - Applying all bundled non-vec migrations then 0043 twice is a no-op.
  - `id = 2` is rejected in `memory_retention_state`.
  - A duplicate `(session_id, kind, reason)` violates UNIQUE.
  - Bump the seven ratchet specs from 42 to 43.
- **Files**:
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0043_memory_retention.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0043_memory_retention.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
  - MODIFY the ratchet specs `0028_gateway_conversation_workspace_root.spec.ts`, `0030_skill_event_metrics.spec.ts`,
    `0038_gateway_message_turn_state.spec.ts`, `0039_reap_orphaned_queue_rows.spec.ts`,
    `0040_skill_candidate_workspace_root.spec.ts`, `0041_skill_md_migration_state.spec.ts`,
    `0042_db_integrity_check_state.spec.ts` (all in `libs/backend/persistence-sqlite/src/lib/migrations/`).

### 2. `SqlitePageReclaimer` (persistence-sqlite)

- **Purpose**: the one owner of free-page statistics and incremental page reclamation for the shared file.
- **Responsibilities**:
  - `readPageStats(): { pageSize, pageCount, freelistCount, autoVacuumMode }` from four `PRAGMA ... simple` reads.
  - `reclaimStep(maxPages: number): { pagesReclaimed: number; durationMs: number }`:
    - The integer is validated as a finite integer from 1 to 65,536. The pragma argument cannot be bound, so
      validation is the injection guard.
    - It runs only when `autoVacuumMode === 2` and the connection is not `inTransaction`.
    - It executes `db.pragma('incremental_vacuum(N)')` with `N = min(freelistCount, maxPages)`. `pragma()`
      steps the statement to completion, which is required because incremental vacuum frees one page per step.
    - `pagesReclaimed = freelistBefore - freelistAfter`.
  - `checkpointPassive()`: `PRAGMA wal_checkpoint(PASSIVE)` so the WAL does not keep the relocated pages.
- **Verified contracts and entry points**:
  - `SqliteDatabase.pragma(pragma, { simple })` and `inTransaction` (`sqlite-connection.service.ts:36-50`).
  - The page-stat pragma shape already used at `sqlite-connection.service.ts:575-578`.
  - Token convention (`persistence-sqlite/src/lib/di/tokens.ts:1-9`).
  - Registration site (`di/register.ts:34-60`).
- **Dependencies**: `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `TOKENS.LOGGER`. It depends downward only.
- **DI**: new token `PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER = Symbol.for('PtahSqlitePageReclaimer')`, registered
  as a singleton in `registerPersistenceSqliteServices`. Barrel exports the class and the `SqlitePageStats` type.
- **Integration points**: consumed by `MemoryRetentionService` (reclaim) and `ObservationRetentionStore` /
  diagnostics (page stats). No RPC.
- **Failure behaviour**:
  - Never throws. A pragma error returns `{ pagesReclaimed: 0 }` and logs `warn`.
  - `autoVacuumMode !== 2` returns 0 and the caller records the skip reason `auto-vacuum-not-incremental`.
  - A closed connection (the `db` getter throws `RpcUserError`) returns zeros.
- **Quality requirements**: one step stays about 100 ms or less (A1). No `VACUUM` statement anywhere in this
  class; a spec asserts the SQL text.
- **Verification seam**: `sqlite-page-reclaimer.spec.ts`, real SQLite with the `node:sqlite` fallback:
  - Create a temp DB with `auto_vacuum = INCREMENTAL` set before the first table, insert about 2 MB of blobs,
    delete them, and confirm `freelistCount > 0`.
  - `reclaimStep(64)` reduces `page_count` by the number it reports.
  - A mode-0 DB reports 0 and does not throw.
  - An invalid `maxPages` (0, 1.5, NaN, 1e9) is clamped or refused without executing SQL.
- **Files**:
  - CREATE `libs/backend/persistence-sqlite/src/lib/sqlite-page-reclaimer.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/sqlite-page-reclaimer.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/di/tokens.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/di/register.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/index.ts`
  - MODIFY `libs/backend/persistence-sqlite/CLAUDE.md` (Internal Structure and Public API lines)

### 3. Backup keep table (pre-migration 3→1, bounded `reset`)

- **Purpose**: one keep policy per backup kind, read by every rotation call site.
- **Responsibilities**:
  - Set `KEEP_BY_KIND` to `{ 'pre-migration': 1, daily: 7, reset: 2 }` and export it from the lib barrel.
  - Replace the three literals: `migration-runner.ts:99`, `start-thoth-cron.ts:324`, `cli-engine thoth-runtime.ts:391`.
  - Add rotation to `db:reset`: after `backup('reset')` returns a non-null path, call
    `this.backup.rotate('reset', KEEP_BY_KIND.reset)`. It is not called on `null`, which mirrors the runner's D2
    rule (`migration-runner.spec.ts:244`).
  - Update the `KEEP_BY_KIND` docblock (`backup.service.ts:105`). `reset` is no longer unbounded. `rotate(keep <= 0)`
    stays a no-op for callers, but no kind maps to 0.
- **Verified contracts and entry points**:
  - `IBackupService.rotate(kind, keep)` (`backup.service.ts:150-156`).
  - Rotation implementation (`:443-480`).
  - Reset flow (`persistence-rpc.handlers.ts:383-460`).
- **Dependencies**: `rpc-handlers` and `thoth-runtime` / `cli-engine` already import `@ptah-extension/persistence-sqlite`
  (`persistence-rpc.handlers.ts` backup type; `start-thoth-cron.ts:5-9`; `cli-engine thoth-runtime.ts:7-12`).
- **Integration points**: no wire change.
- **Failure behaviour**: `rotate` never throws (`backup.service.ts:445-480`). The reset handler still wraps the
  call in its existing try/catch so a rotation error cannot fail a reset.
- **Quality requirements**: at most one pre-migration copy (1.28 GB today, instead of three at ~3.2 GB).
- **Verification seam**:
  - `migration-runner.spec.ts:170-192` now expects `[['pre-migration', 1]]`.
  - `backup.service.spec.ts`:
    - A table test asserts `KEEP_BY_KIND['pre-migration'] === 1`, `reset > 0`, `daily === 7`.
    - The test at `:663-676` ("no-op when keep=0 (unbounded retention)") stops naming `reset` as the unbounded
      kind and uses a generic kind.
    - A new test asserts that `rotate('reset', KEEP_BY_KIND.reset)` keeps the newest 2.
  - `persistence-rpc.handlers.spec.ts` (near `:373`): rotate is called with `('reset', 2)` after a successful
    backup, and not called when `backup` resolves `null`.
  - `start-thoth-cron.spec.ts` and `cli-engine thoth-runtime.spec.ts` backup tests keep asserting
    `rotate('daily', 7)`.
- **Files**:
  - MODIFY `libs/backend/persistence-sqlite/src/lib/backup.service.ts`, `backup.service.spec.ts`,
    `migration-runner.ts`, `migration-runner.spec.ts`, `src/index.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts`, `persistence-rpc.handlers.spec.ts`
  - MODIFY (keep literal only) `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`,
    `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`. These files are also touched by Component 8;
    group them together.

### 4. `ObservationRetentionStore` (memory-curator)

- **Purpose**: every SQL statement retention runs against `observation_queue`, `observation_quarantine` and
  `memory_retention_state`. It holds no policy.
- **Responsibilities** (each batch method runs ONE `BEGIN IMMEDIATE` … `COMMIT` transaction and returns counts;
  none loops internally):
  1. `purgeProcessedBatch(cutoffMs, limit, cursor)` → `{ deleted, nextCursor, exhausted }`. It uses a
     **session-keyset walk** over `idx_obs_queue_session`, so the plan does not depend on `sqlite_stat1`:

     ```sql
     -- next session at or after the cursor (index seek)
     SELECT session_id FROM observation_queue INDEXED BY idx_obs_queue_session
      WHERE session_id > @after ORDER BY session_id LIMIT 1;

     -- ids for that session (index range: session_id = ?, processed_at range)
     SELECT id FROM observation_queue INDEXED BY idx_obs_queue_session
      WHERE session_id = @sid AND processed_at IS NOT NULL AND processed_at < @cutoff
      LIMIT @remaining;

     -- delete the collected ids (rowid lookups)
     DELETE FROM observation_queue
      WHERE id IN (SELECT value FROM json_each(@ids));
     ```

     - The walk collects ids across consecutive sessions until `limit` ids or the end of the sessions, then runs
       one DELETE.
     - The cursor is the last fully drained `session_id`. `''` starts a pass; `exhausted` is true when no next
       session exists.
     - The age predicate is `processed_at < now - processedDays`: seven days after consumption, not after
       capture. A row captured long ago and processed yesterday stays for the full window. The deleted
       `PURGE_SQL` used `captured_at`; the change is deliberate.
  2. `quarantineStuckBatch(cutoffMs, limit, nowMs)` → `{ quarantined, payloadBytes }`:

     ```sql
     SELECT id FROM observation_queue INDEXED BY idx_obs_queue_drain
      WHERE processed_at IS NULL AND captured_at < @cutoff
      ORDER BY captured_at LIMIT @limit;

     INSERT INTO observation_quarantine
       (session_id, kind, reason, row_count, payload_bytes,
        oldest_captured_at, newest_captured_at, first_quarantined_at, last_quarantined_at)
     SELECT q.session_id, q.kind, 'stuck-unprocessed', COUNT(*),
            SUM(COALESCE(octet_length(q.tool_response_text),0) + COALESCE(octet_length(q.tool_input_json),0)
              + COALESCE(octet_length(q.assistant_message),0) + COALESCE(octet_length(q.user_prompt),0)
              + COALESCE(octet_length(q.file_path),0)),
            MIN(q.captured_at), MAX(q.captured_at), @now, @now
       FROM observation_queue q
      WHERE q.id IN (SELECT value FROM json_each(@ids))
      GROUP BY q.session_id, q.kind
     ON CONFLICT(session_id, kind, reason) DO UPDATE SET
       row_count           = row_count + excluded.row_count,
       payload_bytes       = payload_bytes + excluded.payload_bytes,
       oldest_captured_at  = MIN(oldest_captured_at, excluded.oldest_captured_at),
       newest_captured_at  = MAX(newest_captured_at, excluded.newest_captured_at),
       last_quarantined_at = excluded.last_quarantined_at;

     DELETE FROM observation_queue
      WHERE id IN (SELECT value FROM json_each(@ids)) AND processed_at IS NULL;
     ```

     - The INSERT's `WHERE` clause is present on purpose. SQLite's upsert grammar needs the SELECT to carry a
       WHERE clause before `ON CONFLICT`.
     - The DELETE re-checks `processed_at IS NULL`. A row a curator pass marked processed between the SELECT and
       the DELETE cannot happen inside one synchronous transaction, but the guard makes the invariant local to
       the statement.
     - Nothing in this store writes `processed_at`. A spec asserts that no statement text contains
       `SET processed_at`.
  3. `pruneLedger(olderThanMs, maxRows)` → `{ pruned }`:

     ```sql
     DELETE FROM observation_quarantine WHERE last_quarantined_at < @olderThan;
     DELETE FROM observation_quarantine
      WHERE id NOT IN (SELECT id FROM observation_quarantine
                        ORDER BY last_quarantined_at DESC, id DESC LIMIT @maxRows);
     ```

     Ledger bound: 90 days and 5,000 rows (constants; see Component 5).
  4. `readLiveStorage(stuckCutoffMs)` → pending rows, pending bytes, oldest pending `captured_at`, stuck-eligible
     rows, ledger rows. All reads use `idx_obs_queue_drain`, apart from the 5k-row pending byte sum (measured
     26 ms) and `SELECT COUNT(*) FROM observation_quarantine`.
  5. `countTotalRows()`: `SELECT COUNT(*) FROM observation_queue` (smallest index, measured 72 ms). It is called
     only at the end of a run, never on a diagnostics poll.
  6. `readState()` / `writeRun(record)` / `writeSkip(atMs, reason)`: `INSERT ... ON CONFLICT(id) DO UPDATE` at
     `id = 1`. `writeSkip` touches only `last_skipped_at` and `last_skip_reason`.
- **Verified contracts and entry points**:
  - `SqliteConnectionService.db` (`sqlite-connection.service.ts`).
  - The statement-cache-by-db-identity pattern (`observation-queue.store.ts:287-299,477-488`); copy it.
  - `BEGIN IMMEDIATE` idiom (`:625-637`).
  - Index names (`0016:32-33`).
- **Dependencies**: `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `TOKENS.LOGGER`. Registered under the new
  `MEMORY_TOKENS.OBSERVATION_RETENTION_STORE = Symbol.for('PtahObservationRetentionStore')`.
- **Integration points**: used only by `MemoryRetentionService`.
- **Failure behaviour**:
  - A batch method wraps its transaction: on error, `ROLLBACK` and rethrow a typed `RetentionStepError`
    carrying a reason token: `database-busy` for `SQLITE_BUSY` (matched by `code`, like `sqlite-errors.ts`) and
    `sql-error` otherwise. Only the service catches it.
  - Reads (`readLiveStorage`) never throw. They return `null` fields and push `"<read>: <message>"` into
    `readErrors`, the same shape as `diagnostics.service.ts:131-147`.
- **Quality requirements**:
  - Every SELECT above must show `USING COVERING INDEX` or `INTEGER PRIMARY KEY` in `EXPLAIN QUERY PLAN` on a
    database **without** `sqlite_stat1`, and none may show a bare `SCAN observation_queue`.
- **Verification seam**: `observation-retention.store.spec.ts`, real SQLite (opener shape from
  `observation-queue.store.spec.ts:44-80`, adapter adds `pragma`):
  - Plan assertions on a fresh DB without `ANALYZE`.
  - Upsert accumulation across two batches for the same session and kind.
  - Ledger prune by age and by count.
  - `writeSkip` preserves the last run fields.
  - No statement text contains `processed_at =` in a SET clause.
- **Files**:
  - CREATE `libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/observation-retention.store.spec.ts`

### 5. `MemoryRetentionService` (memory-curator, the facade)

- **Purpose**: decide whether a retention run happens now, run it inside hard budgets, and record the result.
- **Public surface** (exact):
  - `run(options: MemoryRetentionRunOptions): Promise<MemoryRetentionReport>`. It never rejects.
    - `options = { signal: AbortSignal; isOnBattery: () => boolean; msSinceForegroundActivity: () => number; now?: () => number }`.
  - `storageHealth(): MemoryStorageHealthDto`. It never throws; this is the diagnostics read.
- **Report** (`retention/memory-retention.types.ts`):
  - `{ status: 'skipped'; reason: RetentionSkipReason }`
  - or `{ status: 'completed' | 'partial' | 'failed'; reason: string | null; processedPurged; stuckQuarantined; ledgerPruned; freedBytes; pagesReclaimed; backlogRemaining: boolean; durationMs; error: string | null }`.
  - `RetentionSkipReason = 'disabled' | 'already-running' | 'boot-deferred' | 'on-battery' | 'foreground-active' | 'not-due' | 'aborted' | 'persistence-unavailable'`.
- **Gates, in order** (a closed gate does no SQL except `writeSkip`, and `not-due` does not even write that, so an
  hourly tick costs one state read):
  1. `memory.retention.enabled === false` → `disabled`.
  2. Single-flight flag set → `already-running`. The flag is set synchronously before the first `await`, the
     same rule as `SqliteIntegrityService.dispatching`.
  3. `now - this.startedAt < RETENTION_BOOT_DEFERRAL_MS` (10 min; `startedAt` captured in the constructor, the
     same as `skill-drain.service.ts:618`) → `boot-deferred`. This is what keeps the catch-up tick at boot
     (`catchup-coordinator.ts:81-117`) off the boot path.
  4. `isOnBattery()` → `on-battery`.
  5. `msSinceForegroundActivity() < RETENTION_FOREGROUND_BACKOFF_MS` (5 min, matching
     `skillSynthesis.drain.foregroundBackoffMs`' default) → `foreground-active`.
  6. `signal.aborted` → `aborted`.
  7. Not due: `state.backlog_remaining === 0 && last_completed_at !== null && now - last_completed_at < RETENTION_INTERVAL_MS`
     (24 h) → `not-due`.
  8. `sqlite.db` getter throws → `persistence-unavailable`.
- **Run steps** (strictly ordered; each loop re-checks `signal.aborted`, `isOnBattery()`,
  `msSinceForegroundActivity()` and the wall budget between batches, then `await`s a `setImmediate` yield — the
  repository's yield idiom, `agent-sdk/.../session-history-reader.service.ts:63-64`):
  1. **Processed purge**:
     - Cutoff is `now - processedDays·86_400_000`. Batches of `batchSize` rows loop until the pass is exhausted
       or a budget stops it.
     - Freed bytes are `(freelist after − freelist before) × pageSize`, taken from
       `SqlitePageReclaimer.readPageStats()` around the step.
  2. **Stuck quarantine**: cutoff is `now - stuckDays·86_400_000`, same batching, until a batch returns 0.
  3. **Ledger prune**: once per run, `pruneLedger(now - 90d, 5000)`.
  4. **Page reclaim**: `reclaimStep(step)` repeated until `freelistCount === 0`, the per-run page cap, or a
     budget stops it; `checkpointPassive()` after the last step. It is skipped when `autoVacuumMode !== 2`, with
     reason `auto-vacuum-not-incremental` recorded on the report.
  5. **Record**:
     - `countTotalRows()` minus pending rows gives `processed_rows_after`.
     - `avg_processed_row_bytes` = `freedBytes / processedPurged` when `processedPurged > 0`, otherwise the
       previous value.
     - `writeRun(...)`; `last_completed_at = now` only when `status === 'completed'`.
- **Budgets and bounds** (constants in `retention/memory-retention-config.ts`, except the four settings):

  | Bound | Value | Why |
  | --- | --- | --- |
  | `batchSize` (setting) | default 500, clamped 50–5,000 | ~11 ms of payload read per 500 processed rows (measured); A2 |
  | Adaptive batch | a batch over 120 ms halves the batch size for the rest of the run (floor 50) | caps main-thread stalls if A2 is wrong |
  | `RETENTION_MAX_ROWS_PER_RUN` | 50,000 (both steps combined) | the first run on the live file (174,213 + 2,332 eligible) finishes in about 4 idle hourly runs |
  | `RETENTION_MAX_RUN_MS` | 60,000 wall clock, yields included | one hourly slot never holds a cron concurrency slot for long |
  | `RETENTION_RECLAIM_PAGES_PER_STEP` | 2,048 pages (8 MB); a step over 120 ms halves it (floor 256) | A1 |
  | `RETENTION_MAX_RECLAIM_PAGES_PER_RUN` | 32,768 pages (128 MB) | about 800 MB of freed pages is returned to the OS over about 7 idle runs, never in one long burst |
  | Ledger | 90 days, 5,000 rows | the ledger itself cannot grow without limit |
  | `RETENTION_INTERVAL_MS` | 24 h | the "daily" semantics |
  | `RETENTION_BOOT_DEFERRAL_MS` | 10 min | off the boot path |
  | `RETENTION_FOREGROUND_BACKOFF_MS` | 5 min | the same as the drain gate |

- **Outcome mapping**:
  - `completed`: both row steps exhausted, ledger pruned, and reclaim finished (or not applicable).
  - `partial`: a budget, abort, battery, foreground or `database-busy` stop after at least one committed batch
    (`reason` = the token, `backlog_remaining = 1`, so the next hourly tick is due).
  - `failed`: a `RetentionStepError` other than busy, or any unexpected throw. Batches committed before the
    failure stay committed, `backlog_remaining = 1`, `error` is the sanitized message (absolute paths stripped),
    and one `warn` is logged.
- **Verified contracts and entry points**:
  - Settings are read through `IWorkspaceProvider.getConfiguration('ptah', key, default)`
    (`memory-trigger-config.ts:5` and the `readMemoryTriggers` pattern).
  - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`diagnostics.service.ts:34`).
- **Dependencies**:
  - Injected: `TOKENS.LOGGER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `PERSISTENCE_TOKENS.SQLITE_CONNECTION`,
    `PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER`, `MEMORY_TOKENS.OBSERVATION_RETENTION_STORE` (5 deps).
  - No import of `cron-scheduler`, `skill-synthesis`, `agent-sdk` or `rpc-handlers` (`memory-curator/CLAUDE.md`
    Cross-Lib Rules). Battery and foreground signals arrive as functions, as `SkillDrainService.drain` receives
    `onBattery` (`skill-drain-jobs.ts:26-30`).
- **DI**: token `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE = Symbol.for('PtahMemoryRetentionService')`, registered as
  a singleton in `registerMemoryCuratorServices` beside `MEMORY_DECAY_JOB` (`register.ts:129-133`). The singleton
  lifetime is required, because the single-flight flag and `startedAt` are per instance. Barrel exports the
  class, the report types and `MEMORY_RETENTION_KEYS`.
- **Settings** (`retention/memory-retention-config.ts`, `MEMORY_RETENTION_KEYS`):
  `memory.retention.enabled` (true), `memory.retention.processedDays` (7, clamp 1–365),
  `memory.retention.stuckDays` (14, clamp 7–365), `memory.retention.batchSize` (500, clamp 50–5,000). A
  non-finite value falls back to the default. Clamping is the validation at this file-I/O boundary.
- **Integration points**: the cron handler (Component 8) calls `run`; `MemoryDiagnosticsService` calls
  `storageHealth` (Component 9).
- **Failure behaviour**: `run` catches everything (outer `try/catch (error: unknown)`), always clears the
  single-flight flag in `finally`, and never rejects. `storageHealth` never throws.
- **Quality requirements**: no single synchronous SQLite call above about 120 ms by design (adaptive halving);
  no work within 10 minutes of process start; no work while chat moved in the last 5 minutes or on battery.
- **Verification seam**:
  - `memory-retention.service.spec.ts` (fake store, fake reclaimer, fake clock) covers:
    - every gate and its token, including `not-due` doing no write;
    - adaptive halving;
    - the row cap and wall budget producing `partial` with `backlog_remaining`;
    - a mid-run foreground change stopping after the current batch;
    - a thrown store error producing `failed` with earlier counts kept and the flag cleared;
    - a concurrent second `run` returning `already-running`.
  - The integration spec is in the reachability section.
- **Files**:
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-retention.types.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts`
  - CREATE `libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts`
  - CREATE `libs/backend/memory-curator/src/lib/di/register.spec.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/di/tokens.ts`, `di/register.ts`, `src/index.ts`
  - MODIFY `libs/backend/memory-curator/CLAUDE.md`. Add the retention entries. Correct the false line
    "`memory-decay.job.ts` — registered with cron-scheduler": it is not registered, and phase 2 wires it.

### 6. `ObservationQueueStore` purge removal

- **Purpose**: leave no orphan purge path.
- **Responsibilities**:
  - Delete `PURGE_SQL` (`observation-queue.store.ts:155`) and `purgeOlderThan` (`:648-654`).
  - Rewrite the three doc mentions (`:25-29`, `:322`, `:587`) to point at `ObservationRetentionStore`.
  - Replace the purge test (`observation-queue.store.spec.ts:305-321`). The behaviour is covered by Component 4
    and the integration spec.
  - Remove `purgeOlderThan: jest.fn(() => 0)` from the five mocks listed in Codebase evidence.
  - Update the comment in `0039_reap_orphaned_queue_rows.ts:32,61`? **No.** Migrations are forward-only and must
    not be rewritten (`persistence-sqlite/CLAUDE.md`), so that historical prose stays.
- **Verified contracts**: see Codebase evidence rows 1-2.
- **Failure behaviour**: not applicable (deletion).
- **Verification seam**: `npx nx run-many -t typecheck test -p @ptah-extension/memory-curator` is green, and a
  grep for `purgeOlderThan` in `libs/` and `apps/` finds matches only in migration 0039's comments.
- **Files**:
  - MODIFY `libs/backend/memory-curator/src/lib/observation-queue.store.ts`, `observation-queue.store.spec.ts`,
    `memory-search.service.spec.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/triggers/memory-trigger.boot-defer.spec.ts`,
    `memory-trigger.boot-scan-budget.spec.ts`, `memory-trigger.integration.spec.ts`,
    `memory-trigger.service.spec.ts`

### 7. Settings registration (platform-core)

- **Purpose**: make the four retention keys persist in `~/.ptah/settings.json` on every host.
- **Responsibilities**:
  - Add `memory.retention.enabled`, `memory.retention.processedDays`, `memory.retention.stuckDays` and
    `memory.retention.batchSize` to `FILE_BASED_SETTINGS_KEYS` (memory block, `file-settings-keys.ts:333-342`).
  - Add them to `FILE_BASED_SETTINGS_DEFAULTS` (`:586-590`) with the values `true / 7 / 14 / 500`.
  - The defaults must equal the fallbacks in `memory-retention-config.ts`, which is the same mirroring the drain
    table documents at `skill-drain-jobs.ts:36-38`.
- **Verified contracts**: `file-settings-keys.ts:154,435`; spec `file-settings-keys.spec.ts:9`.
- **Failure behaviour**: not applicable.
- **Verification seam**:
  - The existing membership spec.
  - A new assertion in `memory-retention.service.spec.ts` imports `FILE_BASED_SETTINGS_DEFAULTS` and checks that
    each default equals the config fallback, so drift fails a test.
- **Files**: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`

### 8. `@ptah/memory-retention` cron job (thoth-runtime + CLI host)

- **Purpose**: make the retention service reachable on a schedule in every host that starts Thoth cron.
- **Job spec** (`thoth-runtime/src/lib/memory-retention-job.ts`, exported from the barrel beside `SKILL_DRAIN_JOBS`):
  - `jobId: '@ptah/memory-retention'`
  - `name: 'Memory Retention'`
  - `handlerName: 'memory:retention'`
  - `cronExpr: '17 * * * *'`, `timezone: 'UTC'`
    - Hourly tick. Minute 17 avoids :00 (backup `0 3`, nightly drain `0 3`, weekly drain `0 4`), :30
      (integrity `30 3`) and the */15 drain slots (:00, :15, :30, :45).
    - A constant, not a setting: the user-facing knobs are days and batch size.
- **Handler factory**: `createMemoryRetentionHandler(container: DependencyContainer): JobHandler`, exported from
  the barrel. Per run it:
  1. Resolves `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` inside a `try`. A resolve failure (for example a disposed
     container) returns `{ outcome: 'skipped', reason: 'retention-service-unavailable' }`, the same as
     `start-thoth-cron.ts:178-194`.
  2. Resolves `CRON_TOKENS.CRON_POWER_MONITOR` **per run** and passes `isOnBattery: () => monitor.isOnBattery()`,
     the same as `:66-75`.
  3. When `container.isRegistered(SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER)`, resolves the tracker,
     calls `start()` (idempotent, `foreground-activity.tracker.ts:56-62`) and passes
     `() => tracker.msSinceLastActivity()`. Otherwise it passes `() => Number.POSITIVE_INFINITY`.
  4. Calls `service.run({ signal: ctx.signal, ... })`.
  5. Maps the report:
     - `skipped` → `{ outcome: 'skipped', reason }`
     - `completed` / `partial` →
       `{ summary: 'purged <n> processed, quarantined <m> stuck, reclaimed <p> pages' + (partial ? ' (partial: <reason>)' : '') }`
     - `failed` → **throws** `new Error('memory retention failed: <reason token>')`.
- **Failure channel decision (item 9)**:
  - The request says "job errors never throw into the scheduler".
  - The repository's own rule is that a thrown handler is the failure channel. `JobRunner` catches it and writes
    `markFailed` (`job-runner.ts:212-232`), and `thoth-runtime/CLAUDE.md` says "the scheduler's run row is the
    failure channel". Returning `succeeded` or `skipped` for a failed run repeats the TASK_2026_315 defect that
    `types.ts:158-175` documents.
  - Resolution: `MemoryRetentionService.run` never throws, and nothing escapes into the scheduler **loop**.
    Every step error is caught, committed batches are kept, and the result is persisted to
    `memory_retention_state` for diagnostics. Only the thin handler converts an already-recorded `failed` report
    into the runner's documented `failed` row, with a reason token and no raw paths.
  - This keeps the cron history honest and keeps the scheduler safe.
- **Registration in `startThothCron`** (Electron host): a new guarded block
  `registerMemoryRetentionJob(container, jobStore, handlerRegistry, logPrefix, emitActivity)`, placed after the
  integrity block (`start-thoth-cron.ts:409-427`) and wrapped in its own try/catch like the others. It:
  - returns early when `!container.isRegistered(MEMORY_TOKENS.MEMORY_RETENTION_SERVICE)`;
  - registers the handler behind `handlerRegistry.has(...)`, wrapped by `withActivityEmit(emit, 'memory:retention', ...)`;
  - calls `jobStore.upsert({ id, name, cronExpr, timezone: 'UTC', prompt: 'handler:memory:retention', enabled: true })` unconditionally;
  - logs `Memory retention cron job registered (@ptah/memory-retention)`.

  The same block also deletes the `incremental_vacuum(100)` try block (`:344-353`) and reads `KEEP_BY_KIND.daily`
  (Component 3).
- **Registration in the CLI `startCron`**: a new `registerMemoryRetentionJob(container, logger)`, called after
  `registerSkillDrainJobs` (`cli-engine thoth-runtime.ts:324`). It has the same guards and uses the same spec and
  handler factory imported from `@ptah-extension/thoth-runtime` (already imported at `:24`). It has no activity
  emitter (the CLI has none, `:430-432`). It logs `warn` through `Logger` on registration failure.
- **Does not merge lifecycles**: only the data and the per-run handler body are shared, which is the precedent
  `SKILL_DRAIN_JOBS` set (`skill-drain-jobs.ts:17-25`). `activateThoth` / `startThothCron` stay separate
  (`thoth-runtime/CLAUDE.md` last guideline).
- **VS Code**: no change. It has no Thoth cron and no memory handlers (Codebase evidence).
- **Dependencies**: `thoth-runtime` already depends on `memory-curator`, `cron-scheduler` and `skill-synthesis`
  (`thoth-runtime/CLAUDE.md` Cross-Lib Rules; imports at `start-thoth-cron.ts:10-20`).
- **Failure behaviour**: registration errors are non-fatal and logged. A double `startThothCron` / `activateThoth`
  call registers the handler once and upserts twice (idempotent).
- **Quality requirements**: registration performs no SQL beyond the upsert, and the handler does no work at boot
  (gate 3).
- **Verification seam**: host reachability specs (next section) plus `memory-retention-job.spec.ts` for the
  report-to-result mapping, including the throw on `failed`, the per-run power monitor resolve, the tracker
  optionality and the resolve-failure skip.
- **Files**:
  - CREATE `libs/backend/thoth-runtime/src/lib/memory-retention-job.ts`
  - CREATE `libs/backend/thoth-runtime/src/lib/memory-retention-job.spec.ts`
  - MODIFY `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`, `start-thoth-cron.spec.ts`, `src/index.ts`,
    `CLAUDE.md` (Owns line, Public API, a guideline for the retention job and the removed `incremental_vacuum`)
  - MODIFY `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`, `thoth-runtime.spec.ts`

### 9. Diagnostics contract (shared + memory-curator + rpc-handlers)

- **Purpose**: show storage numbers and the retention run result through the existing `memory:diagnostics` method.
- **Wire DTO** (add to `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`, exported through the
  existing shared barrel path):

```ts
export interface MemoryRetentionRunDto {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: 'completed' | 'partial' | 'failed';
  readonly reason: string | null;
  readonly error: string | null;
  readonly durationMs: number;
  readonly processedPurged: number;
  readonly stuckQuarantined: number;
  readonly ledgerPruned: number;
  readonly freedBytes: number;
  readonly pagesReclaimed: number;
  readonly backlogRemaining: boolean;
}

export interface MemoryStorageHealthDto {
  readonly dbBytes: number | null;              // page_count × page_size, live
  readonly reclaimableBytes: number | null;     // freelist_count × page_size, live
  readonly autoVacuumIncremental: boolean | null;
  readonly observations: {
    readonly pendingRows: number | null;        // live, idx_obs_queue_drain
    readonly pendingBytes: number | null;       // live, octet_length over pending rows
    readonly oldestPendingAt: number | null;    // live
    readonly stuckEligibleRows: number | null;  // live: pending and older than stuckDays
    readonly processedRows: number | null;      // as of the last run (not polled)
    readonly processedBytesEstimate: number | null; // processedRows × avg freed bytes per purged row
    readonly measuredAt: number | null;         // when processedRows was counted
    readonly quarantineLedgerRows: number | null;
  };
  readonly retention: {
    readonly enabled: boolean;
    readonly processedDays: number;
    readonly stuckDays: number;
    readonly lastRun: MemoryRetentionRunDto | null;
    readonly lastCompletedAt: number | null;
    readonly nextDueAt: number | null;          // null = never ran → due at the next idle tick
    readonly lastSkippedAt: number | null;
    readonly lastSkipReason: string | null;
  };
  readonly readErrors?: readonly string[];
}
```

  - `MemoryDiagnosticsResult` gains `readonly storage: MemoryStorageHealthDto;` (`:126-138`).
  - `nextDueAt` is `last_finished_at` when `backlog_remaining = 1` (the next idle hourly tick), otherwise
    `last_completed_at + 24 h`.
  - Processed rows and bytes are deliberately run-time snapshots, not live values. A live `COUNT` measured 72 ms
    warm and 1.4 s cold, and a live byte sum measured 997 ms. The panel polls every 30 s on the main thread
    (`memory-diagnostics-state.service.ts:19`).
- **memory-curator**:
  - `MemoryDiagnosticsSnapshot` (`diagnostics.types.ts:54`) gains `readonly storage: MemoryStorageHealthDto`,
    typed from `@ptah-extension/shared` (precedent `memory-trigger-config.ts:3`), so the handler needs no second
    mapping.
  - `MemoryDiagnosticsService` injects `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` and sets
    `storage: this.retention.storageHealth()`.
- **rpc-handlers**: `memory-rpc.handlers.ts:522-580` adds exactly `storage: snapshot.storage,`. No new method, so
  no change to `rpc.types.ts` method map or `ALLOWED_METHOD_PREFIXES` (the dual-registration rule applies to new
  namespaces only; `memory:` already exists at `rpc.types.ts:3598`).
- **Failure behaviour**: `storageHealth` returns nulls plus `readErrors` on any read failure. The existing handler
  catch (`:581-589`) still covers an unexpected throw.
- **Quality requirements**: `storageHealth` runs no statement that scans `observation_queue` rows beyond the
  pending set. A spec asserts the SQL it issues contains no `COUNT(*) FROM observation_queue` without the
  `processed_at IS NULL` predicate.
- **Verification seam**:
  - `diagnostics.service.spec.ts`: `storage` is present and passed through.
  - `memory-rpc.handlers.spec.ts`: the `storage` object is returned unchanged.
  - The integration spec asserts `storageHealth()` numbers after a run.
- **Files**:
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/diagnostics.types.ts`, `diagnostics.service.ts`,
    `diagnostics.service.spec.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`, `memory-rpc.handlers.spec.ts`

### 10. Storage panel in memory diagnostics (frontend, minimal)

- **Purpose**: show the numbers from Component 9 in the existing diagnostics accordion. This is not a redesign.
- **Responsibilities**:
  - `MemoryDiagnosticsStateService` adds `_storage = signal<MemoryStorageHealthDto | null>(null)`, public
    `storage`, and sets it in `refresh()` next to `_dbHealth` (`memory-diagnostics-state.service.ts:33,71`).
  - New presentational `StorageHealthPanelComponent` (`selector: 'ptah-storage-health-panel'`, OnPush, signal
    `input<MemoryStorageHealthDto | null>(null)`, uses `NativeCardComponent` as `db-health-panel.component.ts:44`
    does). It shows:
    - DB size;
    - reclaimable space;
    - pending rows, pending size and oldest pending age;
    - stuck rows eligible for quarantine;
    - processed rows and estimated size (labelled "as of last retention run");
    - last run: time, outcome, purged / quarantined / reclaimed, reason or error;
    - next due;
    - last skip reason;
    - `readErrors` as a muted list.
  - Byte and relative-time formatting are local pure functions in the component file. The repository has no
    shared byte formatter: `formatBytes` is private to `marketplace/src/lib/external-consent-dialog.component.ts:378`.
  - Mounted in `memory-diagnostics-accordion.component.ts` directly after `<ptah-db-health-panel>` (`:172`).
- **Failure behaviour**: a `null` input renders a neutral "No storage data yet" state; a `null` field renders "—".
- **Quality requirements**:
  - Accessibility: a section `aria-label="Storage and retention"`, a heading, and no colour-only status (the
    outcome is text plus a badge).
  - The Electron-only gating is inherited from the tab (`memory-curator-ui/CLAUDE.md` Guidelines).
  - No settings writes (the tab is read-only by design).
- **Verification seam**:
  - `storage-health-panel.component.spec.ts`: renders nulls, a `partial` run with its reason, a `failed` run with
    its error, and byte formatting.
  - `memory-diagnostics-state.service` spec: `storage` is set on refresh.
  - `memory-diagnostics-accordion.component.spec.ts`: the panel is mounted.
- **Files**:
  - CREATE `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts`
  - CREATE `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.spec.ts`
  - MODIFY `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.ts` (and its spec if
    present; otherwise the accordion spec covers it)
  - MODIFY `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts`,
    `memory-diagnostics-accordion.component.spec.ts`
  - MODIFY `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-rpc.service.spec.ts` (fixture gains
    `storage`)

### 11. Reachability proof (non-negotiable)

These specs exist to fail when retention is built but not reached. Unit specs alone do not satisfy this component.

1. **Electron / thoth-runtime host**: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`, new
   `describe('memory retention job')`:
   - With a stub container that registers `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE` (the token is imported from
     `@ptah-extension/memory-curator`, never re-declared, so a rename breaks the spec), `startThothCron` upserts
     exactly
     `{ id: '@ptah/memory-retention', name: 'Memory Retention', cronExpr: '17 * * * *', timezone: 'UTC', prompt: 'handler:memory:retention', enabled: true }`
     and `handlerRegistry.register` receives `'memory:retention'`.
   - The registered handler, invoked with a fake ctx, calls `service.run` with `ctx.signal`. **This is what proves
     reach, not just registration.**
   - Two `startThothCron` calls register once and upsert twice.
   - Without the token, no retention upsert happens and the other jobs are unaffected.
   - The backup handler no longer calls `pragma('incremental_vacuum(100)')`; it still calls `pragma('optimize')`.
2. **CLI host**: `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts`, new tests in
   `describe('activateThoth — runtime tier')`:
   - `activateThoth(... 'runtime')` upserts `@ptah/memory-retention` and registers `memory:retention` once.
   - The handler reaches `service.run`.
   - `oneshot` tier registers nothing.
3. **DI reach**: `libs/backend/memory-curator/src/lib/di/register.spec.ts`. After
   `registerMemoryCuratorServices(childContainer, logger)`, `isRegistered` is true for `MEMORY_RETENTION_SERVICE`
   and `OBSERVATION_RETENTION_STORE`. `registerPersistenceSqliteServices` registers `SQLITE_PAGE_RECLAIMER`
   (asserted in `sqlite-page-reclaimer.spec.ts`). Both hosts call these registration functions
   (`apps/ptah-electron/src/di/phase-2-libraries.ts:341`, `cli-engine/src/lib/thoth/register-thoth-libraries.ts:115`).
4. **Integration, real SQLite, fake clock**: `libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts`.
   - **Harness**:
     - Temp-file DB (never `~/.ptah`).
     - `PRAGMA auto_vacuum = INCREMENTAL` before schema.
     - Migrations 0016 and 0043 applied.
     - The opener falls back from `better-sqlite3` to `node:sqlite`, with an adapter supplying `pragma(sql, {simple})`
       and `transaction`.
     - The spec **fails** (not `it.skip`) when neither opener loads; Node 24 always has `node:sqlite`.
     - Real `ObservationRetentionStore`, `SqlitePageReclaimer` and `MemoryRetentionService`.
     - Fake `now` and a service `startedAt` more than 10 minutes in the past; `isOnBattery: () => false`;
       `msSinceForegroundActivity: () => Infinity`.
   - **Seed**, relative to a fixed `NOW`:
     - P-old: 1,200 processed rows with `processed_at = NOW − 8d`, spread over 3 sessions, each with 8 KB of
       `tool_response_text` so pages actually free.
     - P-new: 50 processed rows with `processed_at = NOW − 6d`.
     - P-old-captured-new-processed: 10 rows with `captured_at = NOW − 30d` and `processed_at = NOW − 1d`.
     - U-grace: 40 unprocessed rows with `captured_at = NOW − 13d`.
     - U-stuck: 300 unprocessed rows with `captured_at = NOW − 15d`, 2 sessions × 2 kinds.
     - `batchSize = 100`, so every step needs several committed batches.
   - **Assertions after run 1**:
     - `status === 'completed'`.
     - No P-old row remains. All P-new, P-old-captured-new-processed and U-grace rows remain with unchanged
       `processed_at`.
     - No U-stuck row remains, and no row anywhere had `processed_at` written: compare a snapshot of
       `(id, processed_at)` for surviving rows.
     - `observation_quarantine` has exactly 4 rows, whose `row_count` values sum to 300, with
       `reason = 'stuck-unprocessed'` and correct oldest and newest `captured_at`.
     - `processedPurged === 1200`, `stuckQuarantined === 300`.
     - `freelist_count` after the run is 0 or smaller than before, and `page_count` decreased by `pagesReclaimed`.
     - `memory_retention_state.last_completed_at === NOW`.
     - `storageHealth().observations.pendingRows === 40`.
   - **Run 2** at `NOW + 1h` returns `skipped / not-due`. **Run 3** at `NOW + 25h`, with nothing new eligible,
     returns `completed` with all counters 0. The ledger `row_count` sum is still 300 (idempotent), and all
     surviving rows are identical.
   - **Budget and partial**: a second test with `RETENTION_MAX_ROWS_PER_RUN` overridden through the config seam
     (constructor-injectable constants object, default the module constants) to 250. Run 1 is `partial` with
     `backlog_remaining = 1`, and the committed deletes are visible. Run 2 at `NOW + 1h` is due (not `not-due`)
     and finishes the backlog.
   - **Failure mid-run**: a third test wraps the store so the third purge batch throws. Report `failed`; rows from
     batches 1-2 are gone and batch 3's rows remain (per-batch commit); `last_error` is persisted; the next `run`
     is not `already-running`.

## Integration architecture

- **Data flow**:
  1. The cron tick (`17 * * * *` UTC, or catch-up at start) goes through `JobRunner` to the
     `memory:retention` handler (`thoth-runtime`, both hosts).
  2. The handler resolves the service, power monitor and optional foreground tracker, then calls
     `MemoryRetentionService.run(signal, isOnBattery, msSinceForegroundActivity)`.
  3. The gates run. Then processed purge batches, then stuck quarantine batches, each a
     `BEGIN IMMEDIATE`/`COMMIT` on the shared connection with a `setImmediate` yield between batches.
  4. Ledger prune, then `SqlitePageReclaimer.reclaimStep` loop, then `wal_checkpoint(PASSIVE)`.
  5. `memory_retention_state` is written, the report is mapped to a job result, and the `job_runs` row plus
     (Electron) one `activity:event` are recorded.
  6. On the diagnostics side, the webview's `memory:diagnostics` goes to `MemoryRpcHandlers`, then
     `MemoryDiagnosticsService.getSnapshot`, then `MemoryRetentionService.storageHealth()`. The state row is
     read with live pragma and pending-index reads, and the result reaches `MemoryStorageHealthDto`,
     `MemoryDiagnosticsStateService.storage` and `ptah-storage-health-panel`.
- **State and persistence**:
  - `observation_quarantine` and `memory_retention_state` are owned by `ObservationRetentionStore` and persist
    across restarts, which is required because runs are daily and processes restart.
  - The single-flight flag and `startedAt` live in memory on the singleton service.
  - The purge cursor is per run only. A partial pass restarts from `''` next run, which is cheap: sessions with
    nothing eligible cost one index seek each.
- **External boundaries**:
  - Settings are file I/O and are clamped in `memory-retention-config.ts`.
  - The `incremental_vacuum` argument is a validated integer, because pragma arguments cannot be bound.
  - Id lists are passed as a bound JSON string to `json_each`, never interpolated.
  - The RPC params are already Zod-validated (`memory-rpc.handlers.ts:505-516`).
  - Error text leaving the process (`last_error`, the job summary) is sanitized of absolute paths, following the
    reset handler's `sanitiseErrorMessage` rule.
- **Failure and rollback**:
  - Each batch is atomic; a failure rolls back only that batch. Committed batches stay committed, which is the
    intended partial progress.
  - `backlog_remaining = 1` makes the next hourly tick due.
  - The service never rejects; the handler throws only to record a `failed` run row.
  - Registration failures are non-fatal, per host.
  - Migration 0043 failure follows the existing runner path, with the pre-migration backup as recovery.
- **Observability**:
  - `job_runs` rows (succeeded, skipped with reason token, failed with reason token), visible in the Schedules tab.
  - `memory_retention_state` surfaced in the diagnostics panel.
  - One `info` log per non-skipped run with counts and duration; `debug` per batch with the duration, which is
    how A1 and A2 are checked in the field; `warn` on failure.
  - The Electron `activity:event` via `withActivityEmit`.

## Architecture-level quality requirements

- **Functional**:
  - Processed rows whose `processed_at` is more than `processedDays` (7) days old are deleted.
  - Unprocessed rows whose `captured_at` is more than `stuckDays` (14) days old are recorded in
    `observation_quarantine` and then deleted.
  - Unprocessed rows inside the window are never touched, and no code path writes `processed_at` except the
    curator's `markProcessed`.
  - Free pages are returned to the OS incrementally.
  - At most 1 pre-migration and 2 reset backups are kept.
  - Diagnostics show DB bytes, reclaimable bytes, pending, processed and stuck rows with bytes, oldest pending
    age, and the last and next retention run with its result.
- **Performance**:
  - No retention work inside 10 minutes of process start.
  - No migration work beyond DDL on two empty tables.
  - No single retention SQL call designed above about 120 ms (adaptive halving).
  - At most 60 s wall time and 50,000 rows per hourly run; at most 128 MB reclaimed per run.
  - The diagnostics poll adds only index-bounded reads (about 30 ms or less on the live file).
- **Security**:
  - Static migration SQL.
  - Validated pragma integer.
  - Bound parameters everywhere else.
  - No absolute paths in persisted error text.
  - Ledger stores `session_id`, `kind`, counts and times only, no payload.
- **Maintainability**:
  - `memory-curator` imports no `cron-scheduler`, `skill-synthesis`, `agent-sdk` or `rpc-handlers`.
  - `persistence-sqlite` imports nothing new from the monorepo.
  - Frontend imports only `shared`.
  - One job spec and one handler factory for both hosts.
  - No new RPC method.
  - `memory-rpc.handlers.ts` grows by one line.
  - No new file exists only to satisfy the line cap: each new file owns one nameable concern.
- **Testability**:
  - Proof of reach in both hosts, as a spec that fails if the job is not registered at cron start AND the handler
    does not call the service.
  - A real-SQLite, fake-clock proof that rows leave the table, grace rows stay, stuck rows are ledgered then
    deleted, a second run is idempotent, a budget-stopped run resumes, and a mid-run failure keeps prior batches.
  - Plan assertions proving no retention SELECT full-scans `observation_queue` on a stats-less DB.

## Team-leader handoff

- **Recommended executors**:
  - Components 1-7 and 9 (backend and shared): `backend-developer`. These are SQL, DI, cron seams and DTOs
    following established repository patterns.
  - Component 10: `frontend-developer`. It is an Angular OnPush presentational component and a state signal.
  - Component 11's integration and reachability specs: `backend-developer`, with `senior-tester` verification
    afterwards. Timings A1 and A2 must be measured against a copy of the pre-migration DB, never the live file.
- **Complexity**: MEDIUM-HIGH.
  - The code volume is moderate, but correctness hinges on SQL plan behaviour on a 1.28 GB file, main-thread
    budgets, the never-mark-processed invariant, and two host seams that must stay in step.
- **Dependencies and ordering** (component level only):
  - 1 (migration) and 2 (reclaimer) come before 4 and 5.
  - 7 (settings keys) comes before 5's settings-parity assertion.
  - 4 and 5 come before 8 (the handler needs the token and types) and before 9 (diagnostics needs
    `storageHealth` and the DTO).
  - The DTO part of 9 (shared file) comes before 5, because `storageHealth` returns the shared DTO.
  - 9 comes before 10.
  - 6 can land with 4 and 5 (the same lib).
  - 3 is independent, except that it shares `start-thoth-cron.ts` and the CLI `thoth-runtime.ts` with 8; put those
    edits in the same group.
- **File-disjoint grouping hint** (requested by the orchestrator; the team-leader owns the final batches):
  1. Persistence (`backend-developer`): Component 1, Component 2, and the persistence-sqlite part of 3
     (`backup.service.ts` + spec, `migration-runner.ts` + spec, barrel, `di/*`, lib `CLAUDE.md`).
  2. Shared DTO + settings (`backend-developer`): `rpc-curator-diagnostics.types.ts` and `file-settings-keys.ts`.
  3. memory-curator (`backend-developer`): Components 4, 5 and 6, plus the memory-curator part of 9
     (`diagnostics.types.ts`, `diagnostics.service.ts` + spec) and the integration and register specs. Depends
     on groups 1 and 2.
  4. thoth-runtime + CLI host (`backend-developer`): Component 8 and the call-site parts of 3 in
     `start-thoth-cron.ts` and the CLI `thoth-runtime.ts`, with their specs. Depends on group 3.
  5. rpc-handlers (`backend-developer`): the `memory-rpc.handlers.ts` one-liner + spec and the `db:reset` rotation
     + spec. Depends on groups 1 and 3.
  6. Frontend diagnostics (`frontend-developer`): Component 10. Depends on group 2.
  7. Verification (`senior-tester`): run all reachability and integration specs; run the copy-based timing check
     for A1 and A2.

  Groups 4, 5 and 6 are file-disjoint and can run in parallel after group 3 (group 6 after group 2).
- **Parallel-safe work**:
  - Groups 1 and 2 are parallel-safe with each other.
  - Group 6 is parallel-safe with groups 3, 4 and 5.
  - Groups 4 and 5 are parallel-safe with each other.
- **Files affected**:
  - **CREATE**:
    - `libs/backend/persistence-sqlite/src/lib/migrations/0043_memory_retention.ts`
    - `libs/backend/persistence-sqlite/src/lib/migrations/0043_memory_retention.spec.ts`
    - `libs/backend/persistence-sqlite/src/lib/sqlite-page-reclaimer.ts`
    - `libs/backend/persistence-sqlite/src/lib/sqlite-page-reclaimer.spec.ts`
    - `libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts`
    - `libs/backend/memory-curator/src/lib/retention/observation-retention.store.spec.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-retention.types.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts`
    - `libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts`
    - `libs/backend/memory-curator/src/lib/di/register.spec.ts`
    - `libs/backend/thoth-runtime/src/lib/memory-retention-job.ts`
    - `libs/backend/thoth-runtime/src/lib/memory-retention-job.spec.ts`
    - `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts`
    - `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.spec.ts`
  - **MODIFY**:
    - persistence-sqlite: `migrations/index.ts`; the seven ratchet specs (0028, 0030, 0038, 0039, 0040, 0041,
      0042); `di/tokens.ts`; `di/register.ts`; `src/index.ts`; `backup.service.ts`; `backup.service.spec.ts`;
      `migration-runner.ts`; `migration-runner.spec.ts`; `CLAUDE.md`
    - memory-curator: `di/tokens.ts`; `di/register.ts`; `src/index.ts`; `observation-queue.store.ts`;
      `observation-queue.store.spec.ts`; `memory-search.service.spec.ts`; `triggers/memory-trigger.boot-defer.spec.ts`;
      `triggers/memory-trigger.boot-scan-budget.spec.ts`; `triggers/memory-trigger.integration.spec.ts`;
      `triggers/memory-trigger.service.spec.ts`; `diagnostics.types.ts`; `diagnostics.service.ts`;
      `diagnostics.service.spec.ts`; `CLAUDE.md`
    - thoth-runtime: `start-thoth-cron.ts`; `start-thoth-cron.spec.ts`; `src/index.ts`; `CLAUDE.md`
    - cli-engine: `src/lib/bootstrap/thoth-runtime.ts`; `src/lib/bootstrap/thoth-runtime.spec.ts`
    - rpc-handlers: `handlers/memory-rpc.handlers.ts`; `handlers/memory-rpc.handlers.spec.ts`;
      `handlers/persistence-rpc.handlers.ts`; `handlers/persistence-rpc.handlers.spec.ts`
    - shared: `src/lib/types/rpc/rpc-curator-diagnostics.types.ts`
    - platform-core: `src/file-settings-keys.ts`
    - memory-curator-ui: `services/memory-diagnostics-state.service.ts`; `services/memory-diagnostics-rpc.service.spec.ts`;
      `components/diagnostics/memory-diagnostics-accordion.component.ts`;
      `components/diagnostics/memory-diagnostics-accordion.component.spec.ts`
  - **REWRITE**: none.
  - **No change** (verified): `apps/ptah-extension-vscode/src/di/*` (no Thoth cron, memory handlers expected absent);
    `apps/ptah-electron/src/di/expected-resolvable.ts` (shared RPC handlers only, and the minimal smoke container
    has no memory graph); `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (no new namespace);
    `libs/shared/src/lib/types/rpc.types.ts` (method map unchanged).
- **Verification points**:
  - References to confirm when implementing: `observation-queue.store.ts:625-637` (transaction idiom),
    `start-thoth-cron.ts:66-75,178-194` (per-run resolve and resolve-failure skip), `job-runner.ts:212-232`
    (throw becomes `markFailed`), `catchup-coordinator.ts:81-117` (boot catch-up), `0016:32-33` (index names),
    `backup.service.ts:105-110,485` (keep table).
  - Invariants to honour: never write `processed_at` from retention; no `VACUUM` statement; no index created on
    `observation_queue` in a migration; single shared connection; `memory-curator` imports no cron or skill libs.
  - Data changes: migration 0043 (DDL only). The first launch after upgrade on the user's DB takes the existing
    pre-migration backup and then rotates to 1, deleting the 2026-09-09 copy (about 1.18 GB).
  - Commands that must pass (use `run-many`, never `nx test a b c`, per root `CLAUDE.md`):
    - `npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/memory-curator-ui`.
      Check that the header reports 8 projects.
    - `npx nx run-many -t typecheck -p` (same set)
    - `npx nx run-many -t lint -p` (same set)
  - Manual field check: run the Electron app with `PTAH_DB_PATH` set to a COPY of the 1.18 GB pre-migration file.
    Confirm:
    - no retention work in the first 10 minutes;
    - per-batch and per-reclaim-step `debug` durations stay at or under about 120 ms (A1, A2);
    - the file shrinks over successive idle ticks;
    - the diagnostics panel shows the run.

## Risks

- R1. The main thread still does I/O-heavy work. Adaptive halving and the 120 ms target bound each call, but a
  slow disk (network home directory) can still make individual batches janky. Mitigations are the idle, battery
  and foreground gates and `batchSize` as a user setting. If A1 or A2 fail on the copy, lower the defaults before
  merging; do not move writes to a worker.
- R2. Catch-up fires `last`-policy slots at boot. The boot-deferral gate makes that a cheap skip. The hourly tick
  guarantees a later due run; a pure daily schedule would not.
- R3. The first upgrade still copies 1.28 GB for the pre-migration backup (existing behaviour, out of process).
  Disk peak is live file + 1 copy + the old copy until rotation deletes it right after.
- R4. `incremental_vacuum` relocation writes go to the WAL. `wal_checkpoint(PASSIVE)` after each run plus the
  default autocheckpoint keeps it bounded. The WAL file itself is only truncated on close
  (`sqlite-connection.service.ts:510`).
- R5. Two hosts (Electron and CLI runtime) sharing one `~/.ptah/state/ptah.sqlite` may both tick.
  - `JobRunner`'s UNIQUE slot claim is keyed per job and slot, so only one host runs a given slot
    (`catchup-coordinator.ts:20-23`).
  - `BEGIN IMMEDIATE` serialises writers.
  - A `database-busy` stop is recorded as `partial`.
- R6. Retention deletes a stuck session's rows between a curator drain and its `markProcessed`. `markProcessed`
  then updates 0 rows. This is harmless, and it only affects rows already 14 days stuck.
- R7. Semantics change: the old `PURGE_SQL` keyed on `captured_at`; retention keys on `processed_at`. This is
  intentional (Component 4) and pinned by the integration spec's P-old-captured-new-processed rows.
- R8. The processed bytes figure is an estimate (average freed bytes per purged row). It is labelled as such in
  the DTO field name and the UI.

## Deferred to phase 2 (explicitly not in this plan)

- Scheduling or changing `MemoryDecayJob`.
- The age-based memory lifecycle (recall → archival after N days unused, archival delete after M days, deletion of
  chunks, FTS and vec rows).
- The per-workspace count cap and the dry-run preview.
- Salience becoming ranking-only and removal of the `< 0.1` branch.
- Adding the memory age rule as a step of `MemoryRetentionService.run`.
- Any `skill_synthesis_queue` reaping, UI redesign, the Overview page, and the activity ledger (phases 3-6).
