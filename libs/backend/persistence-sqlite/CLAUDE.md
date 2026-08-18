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

`SqliteConnectionService` + types (`SqliteDatabase`, `SqliteStatement`, `SqliteDatabaseFactory`, `SqliteVecPathResolver`); `IBackupService`, `BackupKind`, `SqliteBackupService`; `SqliteMigrationRunner` + `MigrationRunResult`; `MIGRATIONS` array + `Migration` type; `isUniqueConstraintError`; `IEmbedder` interface; `PERSISTENCE_TOKENS`, `PersistenceDIToken`, `registerPersistenceSqliteServices`.

## Internal Structure

- `src/lib/sqlite-connection.service.ts` — opens DB, loads sqlite-vec extension
- `src/lib/migration-runner.ts` — applies pending migrations in order
- `src/lib/migrations/` — `MIGRATIONS` tuple (forward-only, append-only)
- `src/lib/backup.service.ts` — `SqliteBackupService` (uses VACUUM INTO / online backup API)
- `src/lib/sqlite-errors.ts` — `isUniqueConstraintError`, the driver-level predicate behind every at-most-once claim (cron slot claim, synthesis-queue enqueue)
- `src/lib/embedder/embedder.interface.ts` — `IEmbedder` contract
- `src/lib/di/{tokens,register}.ts`

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
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by: `memory-curator`, `skill-synthesis`, `cron-scheduler`, `messaging-gateway`, `rpc-handlers`. Foundation lib — imports nothing from monorepo.
