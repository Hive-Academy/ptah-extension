# Batch 1 report — TASK_2026_440_834c (persistence)

Executor: backend-developer. Tasks 1.1, 1.2, 1.3 complete. No git operations, no `nx reset`, no
`~/.ptah` access. Files outside the batch (`libs/shared`, `platform-core`, `start-thoth-cron.ts`,
CLI `thoth-runtime.ts`) were not touched.

## Task 1.1 — Migration 0043 + ratchet bump: COMPLETE

- `0043_memory_retention.ts`: the plan's exact DDL (`observation_quarantine` + UNIQUE
  `(session_id, kind, reason)` + `idx_obs_quarantine_last`; `memory_retention_state` with
  `id INTEGER PRIMARY KEY CHECK (id = 1)`). Static SQL, all `IF NOT EXISTS`, no reference to
  `observation_queue`, no CHECK on `last_outcome`.
- Registered in `migrations/index.ts` as `{ version: 43, name: '0043_memory_retention', sql }`.
- Seven ratchet specs moved `toBe(42)` → `toBe(43)` with a one-line comment each. Migration 0039's
  history was not edited.
- `0043_memory_retention.spec.ts` (11 tests, 0 skipped): registry entry (v43, plain sql, not vec-gated,
  highest); no `${`; 2 tables + 1 index all `IF NOT EXISTS`; SQL has no `observation_queue` / DROP /
  INSERT / UPDATE / DELETE; all migrations ≤42 then 0043 applied twice keeps rows; `id = 2` rejected
  and two upserts leave one row with counter defaults 0; duplicate `(session_id, kind, reason)` throws
  UNIQUE while a different reason/kind is accepted; ledger columns NOT NULL and index on
  `last_quarantined_at`. It asserts the opener is non-null, so it fails instead of skipping.

## Task 1.2 — `SqlitePageReclaimer` + token + barrel: COMPLETE

- Class in `sqlite-page-reclaimer.ts` (`@injectable`, deps `TOKENS.LOGGER` and
  `PERSISTENCE_TOKENS.SQLITE_CONNECTION`): `readPageStats()`, `reclaimStep(maxPages)`,
  `checkpointPassive()`. Types `SqlitePageStats` and `SqliteReclaimStepResult`.
- Token `PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER = Symbol.for('PtahSqlitePageReclaimer')`, registered
  as a singleton in `registerPersistenceSqliteServices`. The barrel exports the class and both types.
- The persistence-sqlite `CLAUDE.md` Public API and Internal Structure sections are updated.
- `sqlite-page-reclaimer.spec.ts` (18 tests, 0 skipped). It uses real SQLite: better-sqlite3 when it
  loads, `node:sqlite` otherwise (the `node:sqlite` adapter supplies `pragma` and `inTransaction`).
  The spec asserts the opener is non-null.
  - It seeds a temp DB with `auto_vacuum = INCREMENTAL` and 250 × 10 KB blobs, then deletes them.
    `reclaimStep(64)` reports 64 and `page_count` drops by exactly 64.
  - A request larger than the freelist is clamped to `freelistCount`, and an empty freelist gives 0.
  - A mode-0 file gives 0, issues no `incremental_vacuum` and does not throw.
  - An open transaction gives zeros.
  - `checkpointPassive` issues `wal_checkpoint(PASSIVE)` only.
  - No issued statement is `VACUUM`, and the source has no `VACUUM` statement literal.
  - A closed connection (`db` getter throws `RpcUserError`) gives zeros for all three methods.
  - A busy pragma gives 0 and logs a `warn`.
  - **DI reach (Component 11 item 3)**: a child container with LOGGER and DB_PATH runs
    `registerPersistenceSqliteServices`. After that, `isRegistered(SQLITE_PAGE_RECLAIMER)` is true,
    the resolved instance is a singleton `SqlitePageReclaimer`, the unopened connection gives zeros,
    and no file is created.

## Task 1.3 — `KEEP_BY_KIND` keep table + reset rotation: COMPLETE

- `backup.service.ts`: `KEEP_BY_KIND` is now `Readonly<Record<BackupKind, number>>` with the values
  `{ 'pre-migration': 1, daily: 7, reset: 2 }`. The docblock is rewritten: no kind is unbounded, and
  `rotate(keep <= 0)` is still a no-op. The barrel exports `KEEP_BY_KIND`.
- `migration-runner.ts:99` → `rotate('pre-migration', KEEP_BY_KIND['pre-migration'])`, still only
  after a non-null backup.
- `persistence-rpc.handlers.ts`: after `backup('reset')`, the handler calls
  `this.backup.rotate('reset', KEEP_BY_KIND.reset)` only when `rawBackupPath !== null`. The call is
  inside the existing backup try/catch. The workflow docblock is updated.
- Specs:
  - `migration-runner.spec.ts` now expects `[['pre-migration', 1]]`.
  - `backup.service.spec.ts` adds a `KEEP_BY_KIND` table test (1 / 7 / 2, all > 0).
  - The keep=0 test no longer names `reset`. It now uses `pre-migration` files with keep 0.
  - A new test checks that `rotate('reset', KEEP_BY_KIND.reset)` keeps the newest 2 of 4 reset files
    and does not touch a pre-migration file in the same directory.
  - `persistence-rpc.handlers.spec.ts` checks `rotate('reset', 2)` once, after `backup`. When `backup`
    resolves `null`, `rotate` is not called.
- Remaining literals, left to Batch 5: `start-thoth-cron.ts:324` and `cli-engine thoth-runtime.ts:391`,
  both `rotate('daily', 7)`.

## Files

CREATED

- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\sqlite-page-reclaimer.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\sqlite-page-reclaimer.spec.ts

MODIFIED

- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\index.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0028_gateway_conversation_workspace_root.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0030_skill_event_metrics.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0038_gateway_message_turn_state.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0040_skill_candidate_workspace_root.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0041_skill_md_migration_state.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migrations\0042_db_integrity_check_state.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\di\tokens.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\di\register.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\index.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\CLAUDE.md
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migration-runner.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\migration-runner.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\persistence-rpc.handlers.ts
- D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\rpc-handlers\src\lib\handlers\persistence-rpc.handlers.spec.ts

## Edge cases and risks

| Item | Handling | Evidence |
| --- | --- | --- |
| Invalid pragma integer (0, 1.5, NaN, Infinity, 1e9, -5, 65,537) | `Number.isInteger && 1..65,536` check before `openDb()`; returns `{0,0}` | `it.each` asserts `issued` is `[]` and `page_count` is unchanged |
| `auto_vacuum != 2` | Returns 0 after the stat read; no `incremental_vacuum` | mode-0 test |
| Closed connection | `openDb()` catches the getter's `RpcUserError` and returns null, so the methods return zeros | degraded-connection test + DI test on an unopened real `SqliteConnectionService` |
| Open transaction | `inTransaction` checked first; returns zeros | `BEGIN` test |
| Pragma throws (busy) | Caught; logs `warn`; returns `pagesReclaimed: 0` | busy test |
| No full VACUUM | Only `incremental_vacuum(N)` / `wal_checkpoint(PASSIVE)` / stat pragmas | issued-SQL + source assertion |
| `backup('reset')` resolves null | No rotate | handler spec |
| Rotation error cannot fail reset | `rotate` never throws, and the call is inside the existing backup try/catch | code, `persistence-rpc.handlers.ts` |
| R3 (1.28 GB pre-migration copies) | keep 1; runner rotates right after a non-null backup | runner spec `[['pre-migration', 1]]` |
| Spec must fail, not skip, without an opener | Both new specs assert `opener !== null`, and the helpers throw when it is null | 0 skipped in both specs |
| R4 WAL growth | `checkpointPassive()` provided (called by Batch 3) | spec |

## Plan deviations

1. `migration-runner.spec.ts` now starts with `import 'reflect-metadata'`.
   - Cause: the runner now imports the value `KEEP_BY_KIND` from `backup.service.ts`, and that module
     loads tsyringe decorators. Without the polyfill the suite failed to load ("tsyringe requires a
     reflect polyfill").
   - Production impact: none. `sqlite-connection.service.ts` already imports both tsyringe and the
     runner, and there is no import cycle (`backup.service.ts` never imports the runner).
2. The barrel also exports `SqliteReclaimStepResult`, the public return type of `reclaimStep`. The
   plan named only `SqlitePageStats`.

## Verification

Command: `npx nx run-many -t typecheck test lint -p @ptah-extension/persistence-sqlite @ptah-extension/rpc-handlers`

- Header: `Running targets typecheck, test, lint for 2 projects`. Footer: `Successfully ran targets
  typecheck, test, lint for 2 projects`. Exit 0.
- persistence-sqlite results:
  - typecheck: pass.
  - lint: "All files pass linting".
  - test: 29 suites passed and 9 skipped (38 total); 376 tests passed and 80 skipped (456 total).
  - The skipped suites and tests existed before this batch. They are gated on native better-sqlite3,
    sqlite-vec, or POSIX: `realbinary-spec`, the `integration-spec` A-1 native probe,
    `migration-runner.spec.ts:638` `describe.skip`, and `backup.service.spec.ts:41` `itPosix`.
- rpc-handlers results:
  - typecheck: pass.
  - lint: 0 errors, 19 warnings. Every warning is in a file this batch did not touch (for example
    unused `TOKENS` in `chat-session.service.ts` and `agent-rpc.handlers.ts`).
  - test: 99 of 99 suites passed; 2993 tests passed and 33 skipped (3026 total).
- The new specs ran with nothing skipped (Jest `--json` per-spec status):
  - `0043_memory_retention.spec.ts`: `{"passed":11}`
  - `sqlite-page-reclaimer.spec.ts`: `{"passed":18}`
  - `persistence-rpc.handlers.spec.ts`: 28 passed, including the 2 new ones.
- Jest printed "A worker process has failed to exit gracefully". Suites that already existed print
  this too; no test failed.
- Batch 2's in-flight edits to `libs/shared` and `platform-core` were present in the worktree during
  the run (R-TL5), and the run still passed.
