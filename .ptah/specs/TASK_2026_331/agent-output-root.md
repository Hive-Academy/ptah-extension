# SQLite maintenance worker safety audit

Date: 2026-08-27  
Scope: read-only audit of the requested Ptah sources; no production source was changed.

## Executive verdict

A separate Electron `utilityProcess` is appropriate for the long integrity scans and the online backup. It can also perform the retention purge and `PRAGMA optimize`, but those two operations require a read-write handle and therefore join SQLite's single-writer queue with the Electron owner connection. They must be short, retryable, and coordinated.

The one-time physical compaction is different. Do not replace or rename the database while the Electron owner has it open. For the production cutover, pause database work, successfully checkpoint, close every handle, let the worker become the sole connection, compact and validate, close the worker handle, then replace/reopen. On Windows, an open SQLite database cannot safely be renamed or replaced.

Current workspace `better-sqlite3` is 12.10.0 and its bundled SQLite header reports 3.53.1 (`node_modules/better-sqlite3/package.json:3`, `node_modules/better-sqlite3/deps/sqlite3/sqlite3.h:149`). This matters because SQLite documents a WAL reset race affecting multiple writing/checkpointing connections through 3.51.2. The packaged production artifact should log and gate on `sqlite_version() >= 3.51.3` before enabling the read-write worker path.

## 1. Current code facts

### Connection pragmas

`SqliteConnectionService` applies these in order on every open:

| Setting        |                 Exact value | Scope and effect                                                                                                  | Source                                                                       |
| -------------- | --------------------------: | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `journal_mode` |                       `WAL` | Persistent database setting; the code sets it again on each open.                                                 | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:85-92` |
| `foreign_keys` |                        `ON` | Per connection; every new worker write connection must set it too.                                                | same                                                                         |
| `synchronous`  |                    `NORMAL` | Per connection. In WAL this preserves consistency but may lose the latest committed transaction after power loss. | same                                                                         |
| `temp_store`   |                    `MEMORY` | Per connection.                                                                                                   | same                                                                         |
| `mmap_size`    | `268435456` bytes (256 MiB) | Per connection upper limit. A second process gets its own mapping/address-space budget.                           | same                                                                         |
| `busy_timeout` |                   `5000` ms | Per connection busy handler. It is not inherited by a worker connection.                                          | same                                                                         |

The loop that applies them is at `sqlite-connection.service.ts:556-567`. Failures are logged and swallowed, so the code does not currently verify that the requested journal mode was actually returned.

Other relevant state:

- No code in the audited connection setup changes `wal_autocheckpoint`; SQLite's default is 1000 pages. No `journal_size_limit` is set.
- Migration `0009` probes `auto_vacuum` and persists `auto_vacuum = INCREMENTAL` when needed (`migrations/0009_auto_vacuum.ts:53-58`). SQLite requires a subsequent full `VACUUM` to make a NONE-to-INCREMENTAL change effective.
- Connection close calls `PRAGMA wal_checkpoint(TRUNCATE)` before closing (`sqlite-connection.service.ts:506-537`). The return row is ignored. SQLite reports a blocked `FULL`/`RESTART`/`TRUNCATE` checkpoint by returning a first column of `1`; it need not throw. The current “completed” log can therefore be false.
- Connection health only reads `page_count`, `page_size`, `freelist_count`, and `journal_mode` (`sqlite-connection.service.ts:574-593`).
- `quick_check` and `foreign_key_check` run synchronously on every open, before migrations (`sqlite-connection.service.ts:206-215,596-635`).

### Queue and existing purge

Migration `0016` creates `observation_queue` with an `INTEGER PRIMARY KEY AUTOINCREMENT`, session/workspace/prompt metadata, several potentially large text payloads, `captured_at`, and nullable `processed_at` (`migrations/0016_observation_queue.ts:10-25`). Its indexes are:

- `(session_id, processed_at, captured_at)`; and
- `(processed_at, captured_at) WHERE processed_at IS NULL`

at `migrations/0016_observation_queue.ts:27-28`.

Neither index is tailored to retention of processed rows. The current purge is one unbounded statement:

```sql
DELETE FROM observation_queue
 WHERE captured_at < ?
   AND processed_at IS NOT NULL;
```

It is defined at `observation-queue.store.ts:155` and executed at `observation-queue.store.ts:650-656`. It flushes the owner's in-memory capture batch first, but it has no batch limit, no cursor, no sleep/backoff, and no production caller.

### Existing backup and maintenance job

- `SqliteBackupService` uses the better-sqlite3 online backup API, not `VACUUM INTO` (`backup.service.ts:95-134`). It keeps 7 daily backups (`backup.service.ts:37-42`) and writes them under `state/backups` (`backup.service.ts:66-93`).
- The daily cron handler runs at 03:00 UTC and currently performs online backup, rotation, `incremental_vacuum(100)`, then `PRAGMA optimize` on the owner connection (`start-thoth-cron.ts:205-260`). Rotation is attempted even when `backup()` returned `null`, so a failed attempt can still age out an older valid backup.
- `incremental_vacuum(100)` removes at most 100 freelist pages per run and only works because migration `0009` selected incremental auto-vacuum. At a 4 KiB page size that is only about 400 KiB per day; the actual amount must use the runtime `page_size`. It will not promptly reclaim roughly 684 MB.
- The backup service comment at `backup.service.ts:13-16` attributes backup restarts to concurrent reads. SQLite's online-backup documentation says writes through a different handle/process cause restarts; reads do not.

## 2. Safety of the five proposed operations

| Operation                              | Worker connection                                                                                                                             | Safe while owner is open and writing in WAL?                                                                                                                      | Exclusive/quiescent access?                                                               | Main consequence                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `quick_check` + `foreign_key_check` | True read-only source (`readonly: true`, file must exist); `query_only=ON` is optional defense-in-depth                                       | Yes. The worker reads a consistent WAL snapshot.                                                                                                                  | No, but close the read transaction promptly.                                              | A long scan pins a WAL end mark. Writers continue, but checkpoint progress can stop and the WAL can grow until the scan ends.                                          |
| 2. Retention purge                     | Read-write                                                                                                                                    | Yes, if SQLite is new enough, all processes use the same VFS/path, and each batch is a short transaction.                                                         | No. Only one SQLite writer exists at a time, so it contends with the owner.               | Deletes add WAL frames and freelist pages. A large transaction can create a large WAL; use small commits and backoff.                                                  |
| 3a. Plain `VACUUM`                     | Read-write, no open transaction/statements                                                                                                    | Not as a production policy. It may run when other handles are merely open and idle, but it fails on conflicting locks and monopolizes the writer for the rebuild. | Yes for this application: pause and close the owner; make the worker the sole connection. | Rebuilds/overwrites the source. Up to twice the original DB size may be required as free disk space.                                                                   |
| 3b. `VACUUM INTO` copy only            | A read-only source connection is supported, but do **not** set `PRAGMA query_only=ON` because the command must write the attached destination | Yes for creating a snapshot copy.                                                                                                                                 | No for copy-only; **yes for using that copy as the new live DB**.                         | The copy is a consistent snapshot, but later owner commits are not in it. Live cutover without pausing loses those commits.                                            |
| 4. Daily online backup                 | True read-only source                                                                                                                         | Yes. This is the intended online-backup use case.                                                                                                                 | No. Prefer an idle window.                                                                | Owner writes through another handle can restart the backup; sustained writes can prevent completion. The backup read can also prolong WAL retention.                   |
| 5. `PRAGMA optimize`                   | Read-write because it may run `ANALYZE` and update statistics                                                                                 | Yes. Usually a no-op or short operation.                                                                                                                          | No. It can wait behind the current writer.                                                | Small WAL write when statistics change. A fresh worker should use `PRAGMA optimize=0x10002` when it needs to survey all tables, because it has no owner-query history. |

### Read-only connection details

Use better-sqlite3's actual read-only open flag, not only `PRAGMA query_only`. In WAL mode, the `-wal` and `-shm` files must already be readable or creatable. The owner is open, so this normally holds. Never use URI `immutable=1`: SQLite disables locking and change detection for immutable databases, which is invalid while the Electron owner continues writing.

The worker should query and assert `journal_mode = wal`; it should not try to set journal mode from a read-only handle. Give every worker handle its own `busy_timeout = 5000`. The timeout only waits for locks. It does not cap operation duration, prevent checkpoint starvation, or make `TRUNCATE` complete successfully.

### WAL and checkpoint behavior

An open connection alone does not starve checkpoints; an active read transaction does. `quick_check`, `foreign_key_check`, and online backup can each hold a read snapshot. While one is active, a checkpoint can copy frames only up to that reader's end mark. Owner writes still append, so the WAL may grow and reads become slower.

Required behavior:

1. Run only one long maintenance reader at a time.
2. End/finalize each statement and close the read-only handle immediately after the operation. Do not wrap both checks and backup in one long read transaction.
3. Use `wal_checkpoint(PASSIVE)` for opportunistic progress while the app is live.
4. After the purge, request a quiescent gap from the owner, then run `wal_checkpoint(TRUNCATE)` and inspect its three-column result. A first column of `1` means busy; retry later. `TRUNCATE` blocks concurrent writers and waits for readers through the busy handler.

### Multi-process SQLite version gate

SQLite's current corruption guidance documents a WAL-reset race when separate connections write or checkpoint concurrently in versions 3.7.0 through 3.51.2. The current source bundle is 3.53.1, but the installed Electron artifact must be checked independently. The worker handshake should include:

```text
sqliteVersion, betterSqlite3Version, dbPath, journalMode, autoVacuum, pageSize
```

Refuse a read-write worker when `sqliteVersion < 3.51.3`, when the canonical DB paths differ, or when journal mode is not WAL. Read-only scans can still be delegated.

## 3. VACUUM, disk guard, and NTFS cutover

### Plain VACUUM

SQLite says plain `VACUUM` can need as much as twice the original database size in free disk space. For a 951 MB source, the documented hard floor is therefore roughly 1.9 GB free. Use a conservative guard on the exact NTFS volume:

```text
available = statfs(databaseDirectory).bavail * statfs(...).bsize
required  = 2 * databaseFileBytes + walFileBytes + max(512 MiB, 20% of databaseFileBytes)
```

For the stated file this is about 2.6 GB plus the current WAL, before allowing for a new pre-maintenance backup. Compute with integer/BigInt values and recheck immediately before starting. Do not count space on another drive. Also verify the backup destination budget separately.

Plain `VACUUM` is the preferred one-time choice when this guard passes: it avoids an application-managed live-file swap. Run it only after a successful pre-maintenance online backup, successful purge, owner quiescence, successful checkpoint, and closure of every owner handle.

### VACUUM INTO and replacement

`VACUUM INTO` uses the output file instead of VACUUM's temporary database and omits the copy-back step. It therefore has a lower peak requirement, but the original and compact output coexist. Conservatively require at least the estimated compact output plus the same safety margin. The output path must be nonexistent or empty.

`VACUUM INTO` is safe against a live source as a backup operation. It is not safe to swap that snapshot into the live path while writes continue, because commits after the snapshot would be discarded.

The current migration helper is not a usable Windows cutover:

- `migrations/0009_auto_vacuum.ts:61-70` executes `VACUUM INTO` and calls `fs.renameSync(vacuumedPath, dbPath)` while its `db` handle is still open.
- SQLite explicitly says renaming/unlinking an in-use database is undefined and notes that Windows does not allow this case.
- The migration runner calls `runFn(this.db)` without `dbPath` (`migration-runner.ts:211-215`), so normal migration execution never reaches that `VACUUM INTO` branch anyway; it falls back to plain `VACUUM` at `0009_auto_vacuum.ts:71-73`.

If disk pressure requires `VACUUM INTO`, use this cutover protocol:

1. Pause new DB work in the owner and drain/finalize all statements.
2. Run and verify `wal_checkpoint(TRUNCATE)`.
3. Close the owner connection and all other handles.
4. Worker opens the sole source handle, creates a same-directory/same-volume uniquely named output, and closes the source handle.
5. Open the output read-only; run `quick_check`, `foreign_key_check`, validate schema/user version and expected row counts; close it.
6. With **no SQLite handles open**, replace the source using a Windows-aware recovery protocol. `ReplaceFileW` can preserve an original backup name and requires all files on the same volume. A plain `fs.renameSync(new, live)` is not a sufficient crash-recovery design.
7. Reopen through `SqliteConnectionService.openAndMigrate()` so WAL and all connection-local pragmas are reapplied. Rebuild every prepared-statement cache; the existing queue store already invalidates its cache when DB object identity changes (`observation-queue.store.ts:289-301,478-489`).

Never manually delete or mismatch a hot `-wal`/`-shm` file. Let SQLite checkpoint/close it before replacement.

## 4. Ordered recommendation

### Normal maintenance worker

1. **Owner boots and migrates first.** The maintenance worker must never run migrations and must never open a newer working-tree schema against production. Spawn it only after `openAndMigrate()` completes.
2. **Worker claims a persisted lease/marker.** One operation at a time; include build/protocol and SQLite versions in the handshake.
3. **Integrity checks, when due:** open a true read-only connection, run `quick_check`, finalize it, then run `foreign_key_check`, record bounded samples/counts, and close. Do not make these part of synchronous boot.
4. **Daily backup, when due:** open a true read-only source handle and call the online backup API with progress/deadline telemetry. Rotate only after success. Close promptly. Validate the resulting backup at least with `quick_check` before declaring success.
5. **Retention purge:** use a read-write worker handle and repeat short `BEGIN IMMEDIATE` batches. Commit marker progress atomically with each delete, sleep between batches, and yield/retry on `SQLITE_BUSY`. Do not call current `purgeOlderThan()` unchanged.
6. **Optimize after material purge:** on the worker write handle run `PRAGMA optimize=0x10002`; close the handle. This is safe but may wait for the owner writer.
7. **Checkpoint handoff:** worker reports completion. Owner creates a reader/writer gap and either runs `wal_checkpoint(TRUNCATE)` itself or authorizes the worker to do so. Inspect the result; do not infer success from lack of exception.
8. **Continue small incremental reclamation:** retain `incremental_vacuum`, but make its page budget adaptive/bounded if it remains useful. It is maintenance, not the one-time 684 MB reclaim mechanism.

### One-time reclaim

1. Run a successful integrity check and a successful, validated pre-maintenance backup.
2. Complete the processed-row purge in batches.
3. Pause the owner, drain active reads/writes, successfully truncate-checkpoint, and close all handles.
4. Pass the NTFS free-space guard.
5. Prefer sole-handle plain `VACUUM`. Use `VACUUM INTO` only with the closed-handle validation/replacement protocol above.
6. Validate the compacted database before accepting it.
7. Reopen the owner, reapply pragmas/migrations, re-register/rebuild DB-dependent caches, and resume cron/capture work.

What must stay with the owner is lifecycle coordination: finishing migrations before spawn, pausing admission of DB work, draining the in-memory services and active statements, proving a successful final checkpoint, closing/reopening the canonical connection, and rebuilding consumers. The heavy SQL itself can execute in the worker once those gates are met.

## 5. Persisted marker and incremental purge design

Add a forward-only migration for a generic maintenance state table:

```sql
CREATE TABLE db_maintenance_state (
  operation          TEXT PRIMARY KEY,
  status             TEXT NOT NULL
                     CHECK (status IN ('idle','running','succeeded','failed')),
  next_eligible_at   INTEGER NOT NULL DEFAULT 0,
  last_started_at    INTEGER,
  last_completed_at  INTEGER,
  cutoff_at          INTEGER,
  cursor_id          INTEGER NOT NULL DEFAULT 0,
  rows_affected      INTEGER NOT NULL DEFAULT 0,
  lease_owner        TEXT,
  lease_expires_at   INTEGER,
  result_json        TEXT,
  updated_at         INTEGER NOT NULL
);
```

All timestamps are epoch milliseconds, matching the queue.

### Integrity-check throttle

Claim `integrity-check` in one short `BEGIN IMMEDIATE` transaction only when `next_eligible_at <= now` and no live lease exists. At claim time set:

```text
status = running
last_started_at = now
next_eligible_at = now + N days
lease_owner / lease_expires_at = worker identity / deadline
```

Setting `next_eligible_at` before the scan provides the requested strict “at most once per N days,” including worker crashes. When the read-only scan ends, use a short write transaction to set `succeeded` or `failed`, `last_completed_at`, and a bounded JSON result. A failed/cancelled run remains throttled until the next interval; if a faster retry policy is desired later, that is a deliberate relaxation of “at most once.”

### Crash-resumable purge

At a new purge run, freeze `cutoff_at = now - retentionDays`, set `cursor_id = 0`, and claim a lease. A 30-day default aligns with the retention precedent documented by migration `0039`, but it should be configuration-owned.

For each batch:

1. `BEGIN IMMEDIATE`.
2. Select at most `N` eligible IDs with `id > cursor_id`, fixed `captured_at < cutoff_at`, and `processed_at IS NOT NULL`, ordered by `id`.
3. Delete exactly those IDs.
4. Update `cursor_id` to the maximum selected ID and increment `rows_affected` in the same transaction.
5. Commit.
6. Sleep 100-250 ms initially. On `SQLITE_BUSY`, rollback, use jittered exponential backoff up to several seconds, and retry without advancing the cursor.

Start around 250-500 rows per batch and adapt to transaction duration/WAL growth rather than assuming row count equals byte cost. The queue contains large text values, so a fixed 5,000-row batch can still be a very large write. Target short transactions (for example, under 100 ms under normal load).

When no eligible ID remains, set `succeeded`, `last_completed_at`, clear the lease, and reset the cursor for the next scheduled run. Rows that were old but unprocessed when the cursor passed are intentionally untouched; a later purge starts from zero and can collect them after they become processed.

## 6. Primary references

- SQLite, [Write-Ahead Logging — §2.1 Checkpointing, §2.2 Concurrency, §5 Read-Only Databases, §6 Avoiding Excessively Large WAL Files, §9 SQLITE_BUSY](https://www.sqlite.org/wal.html).
- SQLite, [PRAGMA documentation — `busy_timeout`, `incremental_vacuum`, `optimize`, `quick_check`, `foreign_key_check`, `wal_checkpoint`](https://www.sqlite.org/pragma.html).
- SQLite, [VACUUM — §2.1 VACUUM with an INTO clause and §3 How VACUUM works](https://www.sqlite.org/lang_vacuum.html).
- SQLite, [Online Backup API — §3 Example 2 and concurrent external-write restart behavior](https://www.sqlite.org/backup.html).
- SQLite, [Opening a New Database Connection — read-only and `immutable` URI semantics](https://www.sqlite.org/c3ref/open.html).
- SQLite, [How To Corrupt An SQLite Database — §1.2 live backup, §1.4 hot journal pairing, §2.5 renaming in-use DBs, §2.7 child-process handles, §8.1 WAL-reset bug](https://www.sqlite.org/howtocorrupt.html).
- Microsoft, [`ReplaceFileW` — parameters, sharing modes, backup name, same-volume requirement](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).
