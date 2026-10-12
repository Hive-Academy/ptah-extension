import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { SqliteMigrationRunner } from '../migration-runner';
import {
  defaultBetterSqlite3Factory,
  type SqliteDatabase,
  type SqliteDatabaseFactory,
} from '../sqlite-connection.service';
import { SESSION_STORE_MIGRATIONS } from './session-store-migrations';

// No mmap or temp_store tuning: this file holds small rows. Applied with exec
// so a test can run on node:sqlite, which has no pragma() method.
const SESSION_STORE_PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA busy_timeout = 5000',
] as const;

/**
 * The connection to `sessions.sqlite`.
 *
 * Opened on first use rather than with ptah.sqlite: that one opens late in
 * boot (boot-heavy-services), while sessions are read and written from the
 * first seconds. Electron and the CLI both open this file; WAL and
 * busy_timeout cover the two processes.
 */
export class SessionStoreDatabase {
  private database: SqliteDatabase | null = null;
  private opening: Promise<SqliteDatabase> | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly logger: Logger,
    private readonly factory: SqliteDatabaseFactory = defaultBetterSqlite3Factory,
  ) {}

  get path(): string {
    return this.dbPath;
  }

  /** The open, migrated connection. Opens it on the first call. */
  ready(): Promise<SqliteDatabase> {
    if (this.database) return Promise.resolve(this.database);
    this.opening ??= this.open().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  close(): void {
    const db = this.database;
    this.database = null;
    db?.close();
  }

  private async open(): Promise<SqliteDatabase> {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const db = this.factory(this.dbPath);
    try {
      for (const pragma of SESSION_STORE_PRAGMAS) db.exec(pragma);
      const result = await new SqliteMigrationRunner(db, this.logger).applyAll(
        SESSION_STORE_MIGRATIONS,
        { vecExtensionLoaded: false },
      );
      this.logger.info('[persistence-sqlite] session store open', {
        dbPath: this.dbPath,
        applied: result.appliedVersions,
        finalVersion: result.finalVersion,
      });
    } catch (error: unknown) {
      db.close();
      throw error;
    }
    this.database = db;
    return db;
  }
}
