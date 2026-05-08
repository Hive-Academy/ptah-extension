/**
 * FakeSqliteDatabase — minimal in-memory stand-in for better-sqlite3's
 * `Database` shape, sufficient for testing the migration runner and the
 * connection-service plumbing without the native module installed.
 *
 * Supported:
 *  - `exec(sql)` parses simple `CREATE TABLE`, `BEGIN`, `COMMIT`,
 *    `ROLLBACK`, `PRAGMA user_version = N` statements; multi-statement
 *    strings are split on `;`.
 *  - `prepare(sql)` recognises `INSERT INTO schema_migrations(...) VALUES (?, ?)`
 *    and `SELECT version FROM schema_migrations` for the runner's needs.
 *  - `pragma(...)` is an accumulator that returns configurable values.
 *  - `loadExtension` is configurable via `setLoadExtensionBehavior`.
 *  - WAL checkpoint calls via `pragma('wal_checkpoint(TRUNCATE)')` are
 *    recorded in `walCheckpointCalls` for assertion in tests.
 *
 * Anything outside that grammar throws — that is intentional. Tests should
 * exercise real better-sqlite3 once Track 1+ install it. This fake is for
 * the prep track only.
 */

import type {
  SqliteDatabase,
  SqliteStatement,
} from '../sqlite-connection.service';

interface MigrationRow {
  version: number;
  applied_at: number;
}

export class FakeSqliteDatabase implements SqliteDatabase {
  readonly tables = new Set<string>();
  readonly pragmas: string[] = [];
  /** Records every `wal_checkpoint(TRUNCATE)` call — asserted in D1 tests. */
  readonly walCheckpointCalls: string[] = [];
  private migrationRows: MigrationRow[] = [];
  private isOpen = true;
  private inTxn = false;
  private loadExtensionBehavior: 'available' | 'unavailable' | 'throw' =
    'available';
  private loadedExtensions: string[] = [];
  private userVersion = 0;
  /** When set, `pragma('quick_check', ...)` returns this value instead of 'ok'. */
  private quickCheckResult = 'ok';

  /** Configure how `loadExtension` behaves: present, unavailable, or throwing. */
  setLoadExtensionBehavior(
    behavior: 'available' | 'unavailable' | 'throw',
  ): void {
    this.loadExtensionBehavior = behavior;
  }

  /** Override the value returned by `pragma('quick_check', { simple: true })`. */
  setQuickCheckResult(result: string): void {
    this.quickCheckResult = result;
  }

  /** Read the current user_version as set by `PRAGMA user_version = N`. */
  getUserVersion(): number {
    return this.userVersion;
  }

  get loadedExtensionPaths(): readonly string[] {
    return this.loadedExtensions;
  }

  exec(sql: string): void {
    if (!this.isOpen) throw new Error('database is closed');
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      this.execOne(stmt);
    }
  }

  private execOne(stmt: string): void {
    const normalised = stmt.trim().replace(/\s+/g, ' ');
    if (!normalised) return;
    const upper = normalised.toUpperCase();

    if (upper.startsWith('BEGIN')) {
      if (this.inTxn) throw new Error('already in a transaction');
      this.inTxn = true;
      return;
    }
    if (upper === 'COMMIT' || upper === 'COMMIT;') {
      if (!this.inTxn) throw new Error('no active transaction');
      this.inTxn = false;
      return;
    }
    if (upper === 'ROLLBACK' || upper === 'ROLLBACK;') {
      this.inTxn = false;
      return;
    }
    // PRAGMA user_version = N — track the value.
    const userVersionMatch = /^PRAGMA\s+USER_VERSION\s*=\s*(\d+)$/i.exec(
      normalised,
    );
    if (userVersionMatch) {
      this.userVersion = Number(userVersionMatch[1]);
      return;
    }
    const createMatch =
      /^CREATE (?:VIRTUAL )?TABLE (?:IF NOT EXISTS )?([A-Za-z_][A-Za-z0-9_]*)/i.exec(
        normalised,
      );
    if (createMatch) {
      this.tables.add(createMatch[1]);
      return;
    }
    if (/^CREATE (UNIQUE )?INDEX/i.test(normalised)) {
      // Indexes are silently accepted.
      return;
    }
    if (/^CREATE TRIGGER/i.test(normalised)) {
      return;
    }
    // ALTER TABLE / DROP statements — silently accepted. The fake doesn't
    // model a column catalog so additive schema changes (e.g. migration 0006
    // adding `pairing_code`) are inert here; production better-sqlite3
    // applies them for real.
    if (/^ALTER TABLE/i.test(normalised) || /^DROP /i.test(normalised)) {
      return;
    }
    if (upper.startsWith('NOT VALID SQL')) {
      throw new Error('syntax error in fake SQL');
    }
    if (
      upper.startsWith('SELECT') ||
      upper.startsWith('INSERT') ||
      upper.startsWith('UPDATE') ||
      upper.startsWith('DELETE')
    ) {
      // These shouldn't be sent through exec() in our codepath; ignore.
      return;
    }
    // Unknown statement — throw so tests of bad SQL surface clearly.
    throw new Error(
      `FakeSqliteDatabase: unsupported statement: ${normalised.slice(0, 80)}`,
    );
  }

  prepare(sql: string): SqliteStatement {
    const trimmed = sql.trim();
    return new FakeStatement(this, trimmed);
  }

  pragma(pragma: string, options?: { simple?: boolean }): unknown {
    this.pragmas.push(pragma);

    // WAL checkpoint calls are tracked separately for D1 test assertions.
    if (/wal_checkpoint/i.test(pragma)) {
      this.walCheckpointCalls.push(pragma);
      return [];
    }

    // Return structured values for health/boot pragmas when simple=true.
    if (options?.simple) {
      const key = pragma.trim().toLowerCase();
      if (key === 'quick_check') return this.quickCheckResult;
      if (key === 'page_count') return 10;
      if (key === 'page_size') return 4096;
      if (key === 'freelist_count') return 0;
      if (key === 'journal_mode') return 'wal';
      if (key === 'user_version') return this.userVersion;
    }

    // foreign_key_check — return empty array (clean DB by default).
    if (/^foreign_key_check/i.test(pragma.trim())) {
      return [];
    }

    return [];
  }

  loadExtension(file: string): void {
    if (this.loadExtensionBehavior === 'throw') {
      throw new Error('loadExtension failed (fake)');
    }
    this.loadedExtensions.push(file);
  }

  close(): void {
    this.isOpen = false;
  }

  get open(): boolean {
    return this.isOpen;
  }

  get inTransaction(): boolean {
    return this.inTxn;
  }

  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return fn;
  }

  // Internal helpers used by FakeStatement.
  insertMigrationRow(version: number, appliedAt: number): void {
    const idx = this.migrationRows.findIndex((r) => r.version === version);
    if (idx >= 0) {
      this.migrationRows[idx] = { version, applied_at: appliedAt };
    } else {
      this.migrationRows.push({ version, applied_at: appliedAt });
    }
  }
  selectMigrationRows(): MigrationRow[] {
    return [...this.migrationRows];
  }
}

class FakeStatement implements SqliteStatement {
  constructor(
    private readonly db: FakeSqliteDatabase,
    private readonly sql: string,
  ) {}

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const upper = this.sql.toUpperCase();
    if (
      upper.startsWith('INSERT OR REPLACE INTO SCHEMA_MIGRATIONS') ||
      upper.startsWith('INSERT INTO SCHEMA_MIGRATIONS')
    ) {
      const [version, appliedAt] = params as [number, number];
      this.db.insertMigrationRow(Number(version), Number(appliedAt));
      return { changes: 1, lastInsertRowid: Number(version) };
    }
    throw new Error(
      `FakeSqliteDatabase: unsupported run() SQL: ${this.sql.slice(0, 80)}`,
    );
  }

  get(..._params: unknown[]): unknown {
    return undefined;
  }

  all(..._params: unknown[]): unknown[] {
    const upper = this.sql.toUpperCase();
    if (upper.startsWith('SELECT VERSION FROM SCHEMA_MIGRATIONS')) {
      return this.db.selectMigrationRows().map((r) => ({ version: r.version }));
    }
    if (upper.startsWith('SELECT VERSION, APPLIED_AT FROM SCHEMA_MIGRATIONS')) {
      return this.db.selectMigrationRows();
    }
    throw new Error(
      `FakeSqliteDatabase: unsupported all() SQL: ${this.sql.slice(0, 80)}`,
    );
  }

  iterate(..._params: unknown[]): IterableIterator<unknown> {
    return [][Symbol.iterator]();
  }
}

function splitStatements(sql: string): string[] {
  // Strip line comments then split on `;` while respecting BEGIN..END blocks
  // (used by triggers in 0002_memory.sql). For our test grammar we treat
  // `BEGIN` outside a transaction context as a trigger body opener that runs
  // until matching `END;`.
  const noComments = sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  const statements: string[] = [];
  let buffer = '';
  let inTriggerBody = false;
  for (const line of noComments.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Trigger bodies start when a CREATE TRIGGER ... BEGIN line ends with BEGIN.
    if (/CREATE TRIGGER/i.test(trimmed) && /\bBEGIN\b\s*$/i.test(trimmed)) {
      inTriggerBody = true;
    }
    buffer += line + '\n';
    if (inTriggerBody) {
      if (/^\s*END\s*;\s*$/i.test(line)) {
        inTriggerBody = false;
        statements.push(buffer.trim());
        buffer = '';
      }
      continue;
    }
    if (trimmed.endsWith(';')) {
      statements.push(buffer.trim().replace(/;$/, ''));
      buffer = '';
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements.filter((s) => s.length > 0);
}
