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
   * @param options.vecExtensionLoaded - When `false`, each migration's base
   *   `sql` still applies; any `vecSql` is deferred into
   *   `schema_migrations_vec_pending`, and pure-vec migrations
   *   (`requiresVec: true` with no base `sql`) are skipped + deferred without
   *   being recorded as applied. When `true`, deferred vec statements are
   *   caught up at the end of the run. This keeps base relational + FTS5
   *   tables available even when the sqlite-vec native extension is missing.
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
    if (pending.length > 0 && this.backupService) {
      let backupDest: string | null = null;
      try {
        backupDest = await this.backupService.backup(this.db, 'pre-migration');
      } catch (err: unknown) {
        this.logger.warn(
          '[persistence-sqlite] pre-migration backup failed (non-fatal)',
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
      if (backupDest !== null) {
        this.backupService.rotate('pre-migration', 3);
      }
    }

    const appliedNow: number[] = [];
    const skippedNow: number[] = [];
    const vecPendingSet = vecLoaded
      ? new Set(this.readPendingVecVersions())
      : new Set<number>();

    for (const migration of sorted) {
      if (applied.has(migration.version)) {
        skippedNow.push(migration.version);
        continue;
      }
      if (vecPendingSet.has(migration.version)) {
        skippedNow.push(migration.version);
        continue;
      }
      const isPureVec =
        migration.requiresVec === true && migration.sql === undefined;
      if (isPureVec && !vecLoaded) {
        this.deferVecMigration(migration.version);
        this.logger.warn(
          `[persistence-sqlite] deferring vec-only migration ${migration.version} (${migration.name}) — sqlite-vec not loaded; will run when vec becomes available`,
        );
        skippedNow.push(migration.version);
        continue;
      }
      this.applyOne(migration, vecLoaded);
      appliedNow.push(migration.version);
    }

    if (vecLoaded) {
      this.runVecCatchUp(sorted, appliedNow);
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
   * Apply a single migration. Branches on whether the migration declares `run`
   * or `sql`:
   *
   * - `sql` path (standard): executes inside a single `BEGIN IMMEDIATE`
   *   transaction that also records bookkeeping and bumps `user_version`.
   * - `run` path (VACUUM-safe): calls `migration.run(db)` OUTSIDE any
   *   transaction, then records bookkeeping in a separate post-run transaction.
   *   If `run()` throws, the bookkeeping transaction is NOT attempted.
   *
   * A migration providing both `sql` and `run` is a configuration error — this
   * method throws immediately so the misconfiguration surfaces at apply-time.
   *
   * `PRAGMA user_version = N` is written inside the bookkeeping transaction
   * so it rolls back atomically with the INSERT if something goes wrong.
   */
  private applyOne(migration: Migration, vecLoaded: boolean): void {
    const hasSql = migration.sql !== undefined;
    const hasRun = migration.run !== undefined;
    const hasVecSql = migration.vecSql !== undefined;

    if (hasSql && hasRun) {
      throw new Error(
        `SqliteMigrationRunner: migration ${migration.version} (${migration.name}) ` +
          'defines both sql and run — a migration must provide exactly one.',
      );
    }
    if (hasRun && hasVecSql) {
      throw new Error(
        `SqliteMigrationRunner: migration ${migration.version} (${migration.name}) ` +
          'defines both run and vecSql — a migration must provide exactly one.',
      );
    }

    if (hasRun && migration.run !== undefined) {
      const runFn = migration.run;
      try {
        runFn(this.db);
      } catch (err: unknown) {
        throw new Error(
          `SqliteMigrationRunner: migration ${migration.version} (${migration.name}) run() failed: ` +
            stringifyError(err),
        );
      }
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db
          .prepare(
            'INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
          )
          .run(migration.version, Date.now());
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        this.db.exec('COMMIT');
      } catch (err: unknown) {
        this.db.exec('ROLLBACK');
        throw new Error(
          `SqliteMigrationRunner: migration ${migration.version} (${migration.name}) bookkeeping failed: ` +
            stringifyError(err),
        );
      }
      return;
    }
    const sql = migration.sql ?? '';
    const applyVecNow = hasVecSql && vecLoaded;
    const deferVec = hasVecSql && !vecLoaded;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (sql.length > 0) this.db.exec(sql);
      if (applyVecNow && migration.vecSql !== undefined) {
        this.db.exec(migration.vecSql);
      }
      this.db
        .prepare(
          'INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
        )
        .run(migration.version, Date.now());
      if (deferVec) {
        this.db
          .prepare(
            'INSERT OR IGNORE INTO schema_migrations_vec_pending(version) VALUES (?)',
          )
          .run(migration.version);
      }
      this.db.exec(`PRAGMA user_version = ${migration.version}`);
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw new Error(
        `SqliteMigrationRunner: migration ${migration.version} (${migration.name}) failed: ` +
          stringifyError(err),
      );
    }
    if (deferVec) {
      this.logger.warn(
        `[persistence-sqlite] migration ${migration.version} (${migration.name}) applied base schema only — sqlite-vec not loaded; vec index deferred`,
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
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations_vec_pending (version INTEGER PRIMARY KEY)',
    );
  }

  /** Record a version whose `vecSql` (or pure-vec body) still needs vec to run. */
  private deferVecMigration(version: number): void {
    this.ensureBookkeepingTable();
    this.db
      .prepare(
        'INSERT OR IGNORE INTO schema_migrations_vec_pending(version) VALUES (?)',
      )
      .run(version);
  }

  /** Versions awaiting their deferred vec statements, ascending. */
  readPendingVecVersions(): number[] {
    this.ensureBookkeepingTable();
    const rows = this.db
      .prepare('SELECT version FROM schema_migrations_vec_pending')
      .all() as Array<{ version: number }>;
    return rows.map((r) => Number(r.version)).sort((a, b) => a - b);
  }

  /**
   * Apply deferred vec statements once sqlite-vec is available. Idempotent and
   * safe to run on every boot: for each version in
   * `schema_migrations_vec_pending`, apply the migration's `vecSql` (and, for
   * a pure-vec migration that was never recorded, record it applied), then
   * clear the pending row. Versions whose migration is no longer bundled are
   * dropped from the pending table.
   */
  private runVecCatchUp(
    sorted: readonly Migration[],
    appliedNow: number[],
  ): void {
    const pending = this.readPendingVecVersions();
    if (pending.length === 0) return;
    const byVersion = new Map(sorted.map((m) => [m.version, m]));
    const recordedApplied = this.readAppliedVersions();
    for (const version of pending) {
      const migration = byVersion.get(version);
      if (migration === undefined || migration.vecSql === undefined) {
        this.clearVecPending(version);
        continue;
      }
      const isPureVec =
        migration.requiresVec === true && migration.sql === undefined;
      const needsApplyRecord = isPureVec && !recordedApplied.has(version);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(migration.vecSql);
        if (needsApplyRecord) {
          this.db
            .prepare(
              'INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
            )
            .run(version, Date.now());
          this.db.exec(`PRAGMA user_version = ${version}`);
        }
        this.db
          .prepare(
            'DELETE FROM schema_migrations_vec_pending WHERE version = ?',
          )
          .run(version);
        this.db.exec('COMMIT');
      } catch (err: unknown) {
        this.db.exec('ROLLBACK');
        throw new Error(
          `SqliteMigrationRunner: vec catch-up for migration ${version} (${migration.name}) failed: ` +
            stringifyError(err),
        );
      }
      if (needsApplyRecord && !appliedNow.includes(version)) {
        appliedNow.push(version);
      }
      this.logger.info(
        `[persistence-sqlite] applied deferred vec index for migration ${version} (${migration.name})`,
      );
    }
  }

  private clearVecPending(version: number): void {
    this.db
      .prepare('DELETE FROM schema_migrations_vec_pending WHERE version = ?')
      .run(version);
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
