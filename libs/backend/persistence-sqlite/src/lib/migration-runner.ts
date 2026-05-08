/**
 * SqliteMigrationRunner — applies numbered SQL migrations to a SQLite DB.
 *
 * Behaviour:
 *  - Forward-only: refuses to start if the DB reports a `schema_migrations`
 *    version higher than the highest version bundled with this build (the
 *    user must upgrade Ptah).
 *  - Idempotent: if a migration's version is already in `schema_migrations`,
 *    it is silently skipped.
 *  - Atomic per migration: each migration's SQL plus its bookkeeping row is
 *    wrapped in `BEGIN IMMEDIATE` / `COMMIT`. A failure mid-way reverts that
 *    migration; previously-applied migrations remain.
 *
 * The runner does NOT manage the connection itself — open/close is the
 * responsibility of {@link SqliteConnectionService}. The runner only needs a
 * minimal `SqliteDatabase` shape so it can be unit-tested without a real
 * better-sqlite3 instance.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { Migration } from './migrations';
import type { SqliteDatabase } from './sqlite-connection.service';
import type { IBackupService } from './backup.service';

/** Result of an `applyAll` run — useful for telemetry. */
export interface MigrationRunResult {
  /** Versions that were freshly applied during this call. */
  readonly appliedVersions: number[];
  /** Versions that were already present and therefore skipped. */
  readonly skippedVersions: number[];
  /** Highest version present after the run. */
  readonly finalVersion: number;
}

export class SqliteMigrationRunner {
  private _lastAppliedVersion = 0;

  /** Returns the last migration version applied during this session, or 0 if none. */
  get lastAppliedVersion(): number {
    return this._lastAppliedVersion;
  }

  constructor(
    private readonly db: SqliteDatabase,
    private readonly logger: Logger,
    private readonly backupService?: IBackupService,
  ) {}

  /**
   * Apply every migration in {@link migrations} that is not yet recorded in
   * `schema_migrations`. Migrations are processed in ascending `version`
   * order regardless of input order.
   *
   * @param migrations - List of migrations to apply.
   * @param options.vecExtensionLoaded - When `false`, migrations marked
   *   `requiresVec: true` are skipped with a warning instead of throwing.
   *   This allows cron / gateway / core migrations to succeed even when
   *   the sqlite-vec native extension is unavailable.
   *
   * @throws Error if the DB reports a version higher than the bundled max
   *         (forward-only invariant per architecture §8.5).
   */
  async applyAll(
    migrations: readonly Migration[],
    options: { vecExtensionLoaded?: boolean } = {},
  ): Promise<MigrationRunResult> {
    const vecLoaded = options.vecExtensionLoaded !== false; // default true for backward compat
    if (migrations.length === 0) {
      return { appliedVersions: [], skippedVersions: [], finalVersion: 0 };
    }
    this.ensureBookkeepingTable();
    const sorted = [...migrations].sort((a, b) => a.version - b.version);
    const bundledMaxVersion = sorted[sorted.length - 1].version;
    const applied = this.readAppliedVersions();
    const dbMaxVersion = applied.size === 0 ? 0 : Math.max(...applied);

    if (dbMaxVersion > bundledMaxVersion) {
      throw new Error(
        `SqliteMigrationRunner: database reports schema_migrations version ${dbMaxVersion}, ` +
          `but this build only bundles up to ${bundledMaxVersion}. Refusing to downgrade. ` +
          `Upgrade the application or restore an older database file.`,
      );
    }

    const pending = sorted.filter((m) => !applied.has(m.version));

    // D2: Take a pre-migration backup before applying any pending migrations.
    // Non-fatal — backup failure must not abort the migration run.
    if (pending.length > 0 && this.backupService) {
      await this.backupService
        .backup(this.db, 'pre-migration')
        .catch((err: unknown) => {
          this.logger.warn(
            '[persistence-sqlite] pre-migration backup failed (non-fatal)',
            { error: err instanceof Error ? err.message : String(err) },
          );
        });
      this.backupService.rotate('pre-migration', 3);
    }

    const appliedNow: number[] = [];
    const skippedNow: number[] = [];

    for (const migration of sorted) {
      if (applied.has(migration.version)) {
        skippedNow.push(migration.version);
        continue;
      }
      if (migration.requiresVec && !vecLoaded) {
        this.logger.warn(
          `[persistence-sqlite] skipping migration ${migration.version} (${migration.name}) — requires sqlite-vec which is not loaded`,
        );
        skippedNow.push(migration.version);
        continue;
      }
      this.applyOne(migration);
      appliedNow.push(migration.version);
    }

    const finalVersion = Math.max(dbMaxVersion, ...appliedNow, 0);
    this._lastAppliedVersion = finalVersion;
    if (appliedNow.length > 0) {
      this.logger.info('[persistence-sqlite] migrations applied', {
        appliedVersions: appliedNow,
        skippedVersions: skippedNow,
        finalVersion,
      });
    } else {
      this.logger.debug('[persistence-sqlite] migrations up to date', {
        finalVersion,
      });
    }

    return {
      appliedVersions: appliedNow,
      skippedVersions: skippedNow,
      finalVersion,
    };
  }

  /** Returns the set of versions already recorded in `schema_migrations`. */
  readAppliedVersions(): Set<number> {
    this.ensureBookkeepingTable();
    const rows = this.db
      .prepare('SELECT version FROM schema_migrations')
      .all() as Array<{ version: number }>;
    return new Set(rows.map((r) => Number(r.version)));
  }

  /**
   * Apply a single migration inside an IMMEDIATE transaction, recording the
   * bookkeeping row only if the SQL succeeds. D3: `PRAGMA user_version = N`
   * is written inside the same transaction so it rolls back atomically with
   * the bookkeeping INSERT if the migration fails.
   *
   * The 0001 migration also creates the bookkeeping table — handled by
   * `ensureBookkeepingTable` running first.
   */
  private applyOne(migration: Migration): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(migration.sql);
      this.db
        .prepare(
          'INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
        )
        .run(migration.version, Date.now());
      // D3: persist the schema fingerprint inside this transaction so
      // user_version stays consistent with schema_migrations on rollback.
      this.db.exec(`PRAGMA user_version = ${migration.version}`);
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore — original error is what matters */
      }
      throw new Error(
        `SqliteMigrationRunner: migration ${migration.version} (${migration.name}) failed: ` +
          stringifyError(err),
      );
    }
  }

  /**
   * Ensure the `schema_migrations` table exists. The 0001 migration creates
   * it `IF NOT EXISTS` so this is safe to call before applying it.
   */
  private ensureBookkeepingTable(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
