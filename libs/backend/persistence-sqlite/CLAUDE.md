# @ptah-extension/persistence-sqlite

[Back to Main](../../../CLAUDE.md)

## Purpose

Owns the single shared `~/.ptah/ptah.db` SQLite connection and the forward-only migration runner. Provides the `IEmbedder` contract consumed by `memory-curator`, `skill-synthesis`, `cron-scheduler`, and `messaging-gateway`.

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

`SqliteConnectionService` + types (`SqliteDatabase`, `SqliteStatement`, `SqliteDatabaseFactory`, `SqliteVecPathResolver`); `IBackupService`, `BackupKind`, `SqliteBackupService`; `SqliteMigrationRunner` + `MigrationRunResult`; `MIGRATIONS` array + `Migration` type; `IEmbedder` interface; `PERSISTENCE_TOKENS`, `PersistenceDIToken`, `registerPersistenceSqliteServices`.

## Internal Structure

- `src/lib/sqlite-connection.service.ts` — opens DB, loads sqlite-vec extension
- `src/lib/migration-runner.ts` — applies pending migrations in order
- `src/lib/migrations/` — `MIGRATIONS` tuple (forward-only, append-only)
- `src/lib/backup.service.ts` — `SqliteBackupService` (uses VACUUM INTO / online backup API)
- `src/lib/embedder/embedder.interface.ts` — `IEmbedder` contract
- `src/lib/di/{tokens,register}.ts`

## Dependencies

**Internal**: none (foundation lib)
**External**: `better-sqlite3` (or platform-supplied factory), `sqlite-vec`, `tsyringe`

## Guidelines

- **Single shared connection** — never open ad-hoc connections; always inject via `PERSISTENCE_TOKENS.SQLITE_CONNECTION`.
- **Migrations are forward-only and append-only** — never rewrite or remove a migration that has shipped.
- `IEmbedder` is the only interface consumers can rely on for vector embeddings; concrete embedder is registered by `memory-curator`.
- DB path resolution is fixed at `~/.ptah/ptah.db` (see service implementation).
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by: `memory-curator`, `skill-synthesis`, `cron-scheduler`, `messaging-gateway`, `rpc-handlers`. Foundation lib — imports nothing from monorepo.
