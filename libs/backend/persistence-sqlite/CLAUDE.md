# @ptah-extension/persistence-sqlite

[Back to Main](../../../CLAUDE.md)

## Purpose

Owns the single shared `~/.ptah/state/ptah.sqlite` SQLite connection and the forward-only migration runner. Provides the `IEmbedder` contract consumed by `memory-curator`, `skill-synthesis`, `cron-scheduler`, and `messaging-gateway`.

## Boundaries

**Belongs here**:

- SQLite connection factory + sqlite-vec resolution
- Migration runner and migration list
- Backup service
- `IEmbedder` interface (implementation lives in `memory-curator`)
- `PERSISTENCE_TOKENS` registry

**Does NOT belong**:

- Domain queries (each consumer owns its stores)
- Embedder implementation (in `memory-curator`)
- LLM/agent code

## Public API

`SqliteConnectionService` + types (`SqliteDatabase`, `SqliteStatement`, `SqliteDatabaseFactory`, `SqliteVecPathResolver`); `IBackupService`, `BackupKind`, `SqliteBackupService`; `BACKUP_WORKER_BUDGET_MS`; `SqliteMigrationRunner` + `MigrationRunResult`; `MIGRATIONS` array + `Migration` type; `isUniqueConstraintError`; `IEmbedder` interface; `PERSISTENCE_TOKENS`, `PersistenceDIToken`, `registerPersistenceSqliteServices`.

Integrity subsystem: `SqliteIntegrityService` (public surface is exactly `isDue(now?)`, `dispatchIfDue()` and `dispose()`; `DB_INTEGRITY_CHECK_INTERVAL_MS`, `INTEGRITY_WORKER_BUDGET_MS`); `DbWorkerRunner` + `DbWorkerRun` / `DbWorkerOutcome` / `DbWorkerRunOptions`; `IntegrityCheckStateStore` + `IntegrityCheckState`; the host port `IIntegrityWorkerProcessFactory` / `IIntegrityWorkerProcess`; `classifyQuickCheck`, `isIntegrityCheckRequest`, `isBackupRequest`, `validateBackupDestination`, `resolveRealBackupDestination` and the protocol types (`IntegrityVerdict`, `IntegrityCheckRequest`, `IntegrityCheckResponse`, `IntegrityErrorResponse`, `BackupRequest`, `BackupResponse`, `IntegrityWorkerInbound`, `IntegrityCheckOutbound`, `IntegrityWorkerOutbound`).

`performBackup` and the `BackupArtifactFs` / `BackupEnvironment` ports are deliberately NOT in the barrel — they are the worker's own internals, and `SqliteBackupService` talks to the worker over the protocol, not by calling them. The one exception is `removeBackupArtifact`, which `SqliteBackupService` imports directly (module-to-module, still not through the barrel): it is a pure filesystem helper, not a backup mechanism, and it owns the `-wal` / `-shm` suffix list. Two copies of "which files belong to a backup" is how one of them goes stale — see the sidecar rule below.

## Internal Structure

- `src/lib/sqlite-connection.service.ts` — opens DB, loads sqlite-vec extension
- `src/lib/migration-runner.ts` — applies pending migrations in order
- `src/lib/migrations/` — `MIGRATIONS` tuple (forward-only, append-only)
- `src/lib/backup.service.ts` — `SqliteBackupService`. **Worker-driven since
  TASK_2026_383**: it opens no database and calls no backup API. `backup(kind)`
  computes the destination, drives ONE `backup` round-trip through
  `DbWorkerRunner`, maps the verdict, and owns rotation. The copy and its
  `quick_check` happen in the integrity worker, off the host's main thread —
  the pair measured ~27 s inline on a real 1 GB file, all of it on the boot path.
  - **There is no in-process fallback, by design.** A host that registers no
    `INTEGRITY_WORKER_PROCESS_FACTORY` takes NO backup: `null`, one `warn`, and
    one `'critical'` degradation event (`database.backup.no-worker-factory`).
    Re-adding an in-process path would keep the 27 s route alive as a silent
    fallback and nobody would ever know which one ran.
  - **Overlapping calls are SERIALIZED, never rejected** — the second awaits the
    first. A pre-migration backup must not be skipped because the daily cron was
    running. The chain tail is advanced synchronously, before the first `await`.
  - **Every `null`-returning path discards the destination AND its `-wal` /
    `-shm` sidecars**, via the worker's own `removeBackupArtifact`. The worker
    cannot do this for itself when the host kills it (budget expiry, early exit):
    `performBackup`'s cleanup never runs, and a write-mode validation session
    leaves sidecars behind. `rotate()` cannot mistake one for a backup, but
    nothing else would ever remove them.
  - `BACKUP_WORKER_BUDGET_MS` is 20 min — deliberately 4× `INTEGRITY_WORKER_BUDGET_MS`,
    because a copy plus a validation is strictly more work than one `quick_check`.
    A budget set too tight does not report slowness; it means "the migration ran
    with no backup".
- `src/lib/sqlite-errors.ts` — `isUniqueConstraintError`, the driver-level predicate behind every at-most-once claim (cron slot claim, synthesis-queue enqueue)
- `src/lib/embedder/embedder.interface.ts` — `IEmbedder` contract
- `src/lib/integrity/` — the out-of-process `quick_check`/`foreign_key_check`.
  `integrity-check.service.ts` (interval gate + due decision + what gets recorded),
  `db-worker-runner.ts` (**the ONE worker run loop** — spawn, a single settle on
  reply/exit/budget/abort, and a kill on every one of those paths; injected into
  BOTH `SqliteIntegrityService` and `SqliteBackupService`, stateless per run so
  one singleton serves both, and the budget is the caller's parameter rather than
  a shared constant), `integrity-check-state.store.ts`
  (migration `0042`'s single-row `id INTEGER PRIMARY KEY CHECK (id = 1)` table),
  `integrity-worker-protocol.ts` (`classifyQuickCheck`, verdict `'ok' | 'corrupt' | 'unavailable'`),
  `worker-process.port.ts` (host-supplied spawn), and `integrity-worker.ts` — the
  worker entry, which each host bundles to `integrity-worker.mjs` and opens the
  database on its own **read-only** connection. A run that cannot produce a
  verdict answers `unavailable` and writes no record, so the check stays due.
- **The worker serves TWO commands: `check` and `backup`** (TASK_2026_383). The
  backup's source is opened read-only by the same `openReadOnly` the check uses —
  assumption A-1, and it is pinned by
  `integrity/integrity-worker-backup.integration.spec.ts` against the real
  `better-sqlite3`, not by prose. **Anything the worker needs tested lives in
  `integrity-worker-protocol.ts`, not in `integrity-worker.ts`**: the entry
  subscribes to a parent port at module scope and throws when there is none, so
  Jest cannot import it and any logic left there is unassertable. That is why
  `performBackup` is in the protocol module behind an injected
  `BackupEnvironment`, and why `integrity-worker.ts` is only openers + dispatch.
- **The backup COPY is validated read-WRITE** (`openForValidation`), not
  read-only. A read-only connection cannot checkpoint on close and leaves
  `<file>-wal` / `<file>-shm` beside the backup; rotation selects by filename
  PREFIX, so those sidecars take rotation slots and evict a real backup. Do not
  "deduplicate" `openReadOnly` and `openForValidation` — they differ by one flag
  and that flag is the bug fix.
- **`destPath` containment is checked twice.** `validateBackupDestination` is
  pure string containment; `resolveRealBackupDestination` re-checks it against
  `realpathSync`-resolved ancestors, because a symlinked `backups/` defeats the
  string check. `performBackup` runs both, before it creates anything.
- `src/lib/di/{tokens,register}.ts` — includes `INTEGRITY_WORKER_PROCESS_FACTORY`
  and `INTEGRITY_WORKER_PATH` (both host-supplied) and `SQLITE_INTEGRITY_SERVICE`

## Dependencies

**Internal**: none (foundation lib)
**External**: `better-sqlite3` (or platform-supplied factory), `sqlite-vec`, `tsyringe`

## Guidelines

- **Single shared connection** — never open ad-hoc connections; always inject via `PERSISTENCE_TOKENS.SQLITE_CONNECTION`.
- **Migrations are forward-only and append-only** — never rewrite or remove a migration that has shipped.
- **A migration may rebuild a table, and a rebuild is not re-runnable.** `0035` drops and recreates `skill_synthesis_budget` to re-key it, because `0032` declared `day_key TEXT PRIMARY KEY` and SQLite cannot drop the implicit UNIQUE index any other way. No rebuild can be `IF NOT EXISTS`-guarded, so it relies on `SqliteMigrationRunner`'s exactly-once `schema_migrations` bookkeeping — the same guarantee `0033`'s bare `ADD COLUMN`s already depend on. Copy `0035`'s four-statement shape only for a table with no foreign keys, triggers or views; anything else needs the full twelve-step SQLite recipe.
- `IEmbedder` is the only interface consumers can rely on for vector embeddings; concrete embedder is registered by `memory-curator`.
- The DB path is host-injected via `PERSISTENCE_TOKENS.SQLITE_DB_PATH`; use the exported `resolvePtahDbPath()` helper. Resolution order: `PTAH_DB_PATH` (absolute override, wins over everything including an explicit `opts.isDev`), then the profile — `development` → `ptah-dev.sqlite`, `test` → `ptah-test.sqlite`, anything else including **unset** → `ptah.sqlite`. Unset must stay production: packaged Electron and the VS Code extension host both run with no `NODE_ENV`.
- **A boot migrates whatever database it opens, and migrations are forward-only.** So any process running a newer tree against the production file leaves an older installed build unable to open its own data ("Refusing to downgrade"). That is not hypothetical — before TASK_2026_291 `test` was not a recognised profile, so the Electron e2e launcher (`NODE_ENV=test`) and Jest both resolved to `ptah.sqlite`; a docs-screenshot capture run carried working-tree migrations into a 998 MB production database. Harnesses must set `PTAH_DB_PATH` to a temp file rather than rely on `NODE_ENV`.
- **`openAndMigrate` runs no `quick_check`/`foreign_key_check` any more.** On a 1 GB database the pair measured 1868 ms warm and 20–26 s cold, all of it on the boot path (TASK_2026_380). The check now runs interval-gated (`DB_INTEGRITY_CHECK_INTERVAL_MS`, 7 days) and out of process, dispatched by `thoth-runtime` — never inline in the opener.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by: `memory-curator`, `skill-synthesis`, `cron-scheduler`, `messaging-gateway`, `rpc-handlers`. Foundation lib — imports nothing from monorepo.
