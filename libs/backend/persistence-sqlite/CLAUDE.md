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

`SqliteConnectionService` + types (`SqliteDatabase`, `SqliteStatement`, `SqliteDatabaseFactory`, `SqliteVecPathResolver`); `IBackupService`, `BackupKind`, `SqliteBackupService`; `BACKUP_WORKER_BUDGET_MS`; `KEEP_BY_KIND` (the one keep table every rotation call site reads); `SqlitePageReclaimer` + `SqlitePageStats` / `SqliteReclaimStepResult`; `SqliteMigrationRunner` + `MigrationRunResult`; `MIGRATIONS` array + `Migration` type; `isUniqueConstraintError`; `IEmbedder` interface; `PERSISTENCE_TOKENS`, `PersistenceDIToken`, `registerPersistenceSqliteServices`.

Backup collision details are exported as `BACKUP_DESTINATION_EXISTS` and
`BACKUP_STAGING_EXISTS` so host and worker use the same exact protocol values.

Integrity subsystem: `SqliteIntegrityService` (public surface is exactly `isDue(now?)`, `dispatchIfDue()` and `dispose()`; `DB_INTEGRITY_CHECK_INTERVAL_MS`, `INTEGRITY_WORKER_BUDGET_MS`); `DbWorkerRunner` + `DbWorkerRun` / `DbWorkerOutcome` / `DbWorkerRunOptions`; `IntegrityCheckStateStore` + `IntegrityCheckState`; the host port `IIntegrityWorkerProcessFactory` / `IIntegrityWorkerProcess`; `classifyQuickCheck`, `isIntegrityCheckRequest`, `isBackupRequest`, `validateBackupDestination`, `resolveRealBackupDestination` and the protocol types (`IntegrityVerdict`, `IntegrityCheckRequest`, `IntegrityCheckResponse`, `IntegrityErrorResponse`, `BackupRequest`, `BackupResponse`, `IntegrityWorkerInbound`, `IntegrityCheckOutbound`, `IntegrityWorkerOutbound`).

`performBackup` and the `BackupArtifactFs` / `BackupEnvironment` ports are deliberately NOT in the barrel — they are the worker's own internals, and `SqliteBackupService` talks to the worker over the protocol, not by calling them. The one exception is `removeBackupArtifact`, which `SqliteBackupService` imports directly (module-to-module, still not through the barrel): it is a pure filesystem helper, not a backup mechanism, and it owns the `-wal` / `-shm` suffix list. Two copies of "which files belong to a backup" is how one of them goes stale — see the sidecar rule below.

## Internal Structure

- `src/lib/sqlite-connection.service.ts` — opens DB, loads sqlite-vec extension
- `src/lib/slow-statement-timing.ts` — `withSlowStatementTiming`, the Proxy the
  connection hands out in place of the raw handle (TASK_2026_437 C13). Times
  `run/get/all/iterate`, `exec`, `pragma` and transaction functions; at or above
  `PTAH_SQLITE_SLOW_WARN_MS` (default 50) it warns `[SQLite] slow statement`, at
  most once per SQL text per minute. Measurement only: results and exceptions
  pass through untouched, and native methods are always called on the real
  object (better-sqlite3 brand-checks `this`). Transparent to spies and
  reassignment: a member written through the wrapper is returned as assigned,
  deleting it (or assigning its forwarder back) restores timing, and changes
  made on the raw handle are not seen.
- `src/lib/migration-runner.ts` — applies pending migrations in order
- `src/lib/migrations/` — `MIGRATIONS` tuple (forward-only, append-only)
- `src/lib/backup.service.ts` — `SqliteBackupService`. **Worker-driven since
  TASK_2026_383**: it opens no database and calls no backup API. `backup(kind)`
  computes the destination, drives ONE `backup` round-trip through
  `DbWorkerRunner`, maps the verdict, and owns rotation. The copy and its
  `quick_check` happen in the integrity worker, off the host's main thread —
  the pair measured ~27 s inline on a real 1 GB file, all of it on the boot path.
  - **There is no in-process fallback, by design.** Except when today's existing
    daily backup is returned without taking a new copy, a host that registers no
    `INTEGRITY_WORKER_PROCESS_FACTORY` takes NO backup: `null`, one `warn`, and
    one `'critical'` degradation event (`database.backup.no-worker-factory`).
    Re-adding an in-process path would keep the 27 s route alive as a silent
    fallback and nobody would ever learn which one ran.
  - **Overlapping calls are SERIALIZED, never rejected** — the second awaits the
    first. A pre-migration backup must not be skipped because the daily cron was
    running. The chain tail is advanced synchronously, before the first `await`.
  - **Only a `daily` backup waits for the background-work governor**
    (TASK_2026_437 C14 d; optional `TOKENS.BACKGROUND_WORK_GOVERNOR`). It waits
    BEFORE joining the queue, so it never holds a `pre-migration` (boot path)
    or `reset` (a user click) backup behind it; neither of those ever waits.
    `'clear'` or the governor's 10-min `'timeout'` → the backup runs; an
    `AbortError` (governor disposed at shutdown) → `null`, one `info` line, no
    worker and no degradation report; any other rejection fails open.
  - **Only validated copies are published at a final name; publish is an atomic
    no-overwrite hard link.** The worker exclusively creates a randomized
    staging file, validates it, removes its sidecars, then links it to the final
    name. Worker and host failure paths remove staging only. Daily same-day
    re-runs return the existing final; the one residual is an old-version partial
    daily final created earlier on the upgrade day, which is trusted once.
  - `BACKUP_WORKER_BUDGET_MS` is 20 min — deliberately 4× `INTEGRITY_WORKER_BUDGET_MS`,
    because a copy plus a validation is strictly more work than one `quick_check`.
    A budget set too tight does not report slowness; it means "the migration ran
    with no backup".
- `src/lib/sqlite-page-reclaimer.ts` — `SqlitePageReclaimer` (`PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER`,
  TASK_2026_440): the ONE owner of free-page stats (`readPageStats`) and bounded
  `incremental_vacuum` steps (`reclaimStep(maxPages)`, `checkpointPassive`). It
  never issues a full `VACUUM`. `maxPages` must be a finite integer 1..65,536
  before any SQL runs — the pragma argument cannot be bound, so that check is the
  injection guard. It reclaims only when `auto_vacuum = 2` and no transaction is
  open, and every method returns zeros instead of throwing (closed connection,
  busy pragma).
- **Backup keep counts live in `KEEP_BY_KIND` only**: `{ 'pre-migration': 1, daily: 7, reset: 2 }`.
  Call sites pass `KEEP_BY_KIND[kind]`, never a literal. The migration-runner
  and `db:reset` call sites rotate only after a non-null `backup()` (a failed
  backup must not shrink the archive); daily cron call sites rotate
  unconditionally so stale staging cleanup can still run.
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
- **The backup STAGING COPY is validated read-WRITE** (`openForValidation`), not
  read-only. A read-only connection cannot checkpoint on close and leaves
  `<staging>-wal` / `<staging>-shm`; both are removed before atomic publish.
  Rotation's `.sqlite` suffix filter excludes staging and sidecars, and sweeps
  staging groups older than two backup-worker budgets. Do not "deduplicate"
  `openReadOnly` and `openForValidation`; their different modes are required.
- **Both `destPath` and `stagingPath` containment are checked twice.**
  `validateBackupDestination` is pure string containment;
  `resolveRealBackupDestination` re-checks it against `realpathSync`-resolved
  ancestors because a symlinked `backups/` defeats the string check.
  `performBackup` runs both checks for both paths before creating staging, then
  enforces `<destPath>.<8 lowercase hex>.tmp` in the same directory.
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
