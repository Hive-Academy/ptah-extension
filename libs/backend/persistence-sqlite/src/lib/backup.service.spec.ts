/**
 * Unit tests for SqliteBackupService.
 *
 * Uses a real temp directory so rotation tests can assert on actual filesystem
 * state. The `db.backup()` stub (provided by FakeSqliteDatabase) writes a
 * small placeholder file so the happy-path test can confirm file creation
 * without better-sqlite3 native bindings.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SqliteBackupService } from './backup.service';
import { FakeSqliteDatabase } from './testing/fake-sqlite-database';
import { createMockLogger } from './testing/mock-logger';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-backup-test-'));
}

describe('SqliteBackupService', () => {
  // --- Happy path: backup creates the expected file ---

  it('backup() creates a pre-migration backup file at the expected path and returns it', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    const result = await svc.backup(db, 'pre-migration');

    expect(result).not.toBeNull();
    expect(result).toMatch(/ptah\.pre-migration-\d{8}T\d{6}Z\.sqlite$/);
    expect(result).toContain(tmpDir);
    expect(fs.existsSync(result as string)).toBe(true);
  });

  it('backup() emits an info log on success', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    await svc.backup(db, 'pre-migration');

    expect(
      logger.entries.some(
        (e) => e.level === 'info' && /backup completed/.test(e.message),
      ),
    ).toBe(true);
  });

  // --- Non-fatal when db.backup is missing ---

  it('backup() returns null and logs warn when db.backup is unavailable', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    // Construct a plain object without backup() to simulate the guard path.
    const dbWithoutBackup = {
      exec: () => undefined,
      prepare: () => ({
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => undefined,
        all: () => [],
        iterate: () => [][Symbol.iterator](),
      }),
      pragma: () => [],
      close: () => undefined,
      open: true,
      inTransaction: false,
      transaction: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
    };
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    const result = await svc.backup(dbWithoutBackup, 'pre-migration');

    expect(result).toBeNull();
    expect(
      logger.entries.some(
        (e) =>
          e.level === 'warn' && /db\.backup\(\) is unavailable/.test(e.message),
      ),
    ).toBe(true);
  });

  it('backup() returns null and logs warn when db.backup() throws', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    // Override backup() to throw.
    (db as unknown as Record<string, unknown>)['backup'] = async () => {
      throw new Error('backup IO error (fake)');
    };
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    const result = await svc.backup(db, 'pre-migration');

    expect(result).toBeNull();
    expect(
      logger.entries.some(
        (e) => e.level === 'warn' && /backup failed/.test(e.message),
      ),
    ).toBe(true);
  });

  // --- Rotation: keeps newest N, deletes older ---

  it('rotate() keeps the 3 newest pre-migration files and deletes the rest', () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    // Create 5 fake backup files with ascending ISO timestamps.
    const timestamps = [
      '20250101T120000Z',
      '20250102T120000Z',
      '20250103T120000Z',
      '20250104T120000Z',
      '20250105T120000Z',
    ];
    const createdFiles = timestamps.map((ts) => {
      const name = `ptah.pre-migration-${ts}.sqlite`;
      const filePath = path.join(tmpDir, name);
      fs.writeFileSync(filePath, 'placeholder');
      return name;
    });

    svc.rotate('pre-migration', 3);

    const remaining = fs
      .readdirSync(tmpDir)
      .filter((f) => f.endsWith('.sqlite'));
    // Should keep the 3 newest (highest ISO timestamp).
    expect(remaining.sort()).toEqual(
      [createdFiles[2], createdFiles[3], createdFiles[4]].sort(),
    );
  });

  it('rotate() is a no-op when keep=0 (unbounded retention)', () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const svc = new SqliteBackupService(dbPath, createMockLogger());

    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(
        path.join(tmpDir, `ptah.reset-2025010${i}T120000Z.sqlite`),
        'placeholder',
      );
    }

    svc.rotate('reset', 0);

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.sqlite'));
    expect(files).toHaveLength(5);
  });

  it('rotate() is a no-op when file count is within the keep limit', () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const svc = new SqliteBackupService(dbPath, createMockLogger());

    const file = path.join(
      tmpDir,
      'ptah.pre-migration-20250101T120000Z.sqlite',
    );
    fs.writeFileSync(file, 'placeholder');

    svc.rotate('pre-migration', 3);

    expect(fs.existsSync(file)).toBe(true);
  });

  it('rotate() is non-fatal when the backup directory does not exist', () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'state', 'ptah.sqlite'); // state/ does not exist
    const svc = new SqliteBackupService(dbPath, createMockLogger());

    expect(() => svc.rotate('pre-migration', 3)).not.toThrow();
  });

  // --- daily backup uses backups/ subdirectory ---

  it('backup() places daily backups in a backups/ subdirectory', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const svc = new SqliteBackupService(dbPath, createMockLogger());

    const result = await svc.backup(db, 'daily');

    expect(result).not.toBeNull();
    expect(result).toContain(path.join(tmpDir, 'backups'));
  });
});
