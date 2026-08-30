/**
 * Unit tests for SqliteBackupService.
 *
 * Uses a real temp directory so rotation tests can assert on actual filesystem
 * state. The `db.backup()` stub (provided by FakeSqliteDatabase) writes a
 * small placeholder file so the happy-path test can confirm file creation
 * without better-sqlite3 native bindings.
 */
import 'reflect-metadata';

/**
 * `node:fs` is mocked at the module registry rather than with `jest.spyOn`:
 * ts-jest emits `__importStar`, which copies the namespace with
 * non-configurable getters, so `spyOn` fails with "Cannot redefine property"
 * and would in any case only patch this file's copy, not the service's.
 * Every function stays real except `chmodSync`, which throws while
 * `mockChmodShouldThrow` is set.
 */
let mockChmodShouldThrow = false;
jest.mock('node:fs', () => {
  const real = jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...real,
    chmodSync: (target: fs.PathLike, mode: fs.Mode): void => {
      if (mockChmodShouldThrow) {
        throw new Error('chmod refused (fake)');
      }
      real.chmodSync(target, mode);
    },
  };
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SqliteBackupService } from './backup.service';
import { PERSISTENCE_TOKENS } from './di/tokens';
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

  // --- Failed backups must leave no artifact behind ---

  it('backup() deletes the partial destination file when db.backup() throws after writing bytes', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    let partialPath = '';
    // Simulate a backup that gets far enough to create the file, then fails
    // (disk full, IO error, process interrupted mid-copy).
    (db as unknown as Record<string, unknown>)['backup'] = async (
      dest: string,
    ) => {
      partialPath = dest;
      fs.writeFileSync(dest, 'PARTIAL_BACKUP_BYTES');
      throw new Error('disk full midway through page copy (fake)');
    };
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    const result = await svc.backup(db, 'pre-migration');

    expect(result).toBeNull();
    expect(partialPath).not.toBe('');
    expect(fs.existsSync(partialPath)).toBe(false);
  });

  it('backup() deletes the destination file when chmodSync throws', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);
    mockChmodShouldThrow = true;

    try {
      const result = await svc.backup(db, 'pre-migration');

      expect(result).toBeNull();
      const leftovers = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith('.sqlite'));
      expect(leftovers).toEqual([]);
    } finally {
      mockChmodShouldThrow = false;
    }
  });

  it('rotate() does not evict a valid backup after a failed backup attempt', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    // Three genuinely valid, older backups already retained on disk.
    const valid = [
      'ptah.pre-migration-20250101T120000Z.sqlite',
      'ptah.pre-migration-20250102T120000Z.sqlite',
      'ptah.pre-migration-20250103T120000Z.sqlite',
    ];
    for (const name of valid) {
      fs.writeFileSync(path.join(tmpDir, name), 'valid-backup');
    }

    const db = new FakeSqliteDatabase();
    (db as unknown as Record<string, unknown>)['backup'] = async (
      dest: string,
    ) => {
      fs.writeFileSync(dest, 'PARTIAL_BACKUP_BYTES');
      throw new Error('disk full midway through page copy (fake)');
    };

    expect(await svc.backup(db, 'pre-migration')).toBeNull();

    // Rotation keeps 3. If the failed attempt left an artifact behind it
    // carries the newest timestamp, takes a keep slot, and evicts the
    // oldest genuinely valid backup.
    svc.rotate('pre-migration', 3);

    const remaining = fs
      .readdirSync(tmpDir)
      .filter((f) => f.endsWith('.sqlite'))
      .sort();
    expect(remaining).toEqual(valid);
  });

  // --- Integrity validation before a path is ever returned ---

  it('backup() deletes the file and returns null when quick_check does not report ok', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    const corrupt = new FakeSqliteDatabase();
    corrupt.setQuickCheckResult(
      '*** in database main *** Page 4 is never used',
    );
    svc.setValidationFactory(() => corrupt);

    const result = await svc.backup(db, 'pre-migration');

    expect(result).toBeNull();
    const leftovers = fs
      .readdirSync(tmpDir)
      .filter((f) => f.endsWith('.sqlite'));
    expect(leftovers).toEqual([]);
    expect(
      logger.entries.some(
        (e) => e.level === 'warn' && /integrity check failed/.test(e.message),
      ),
    ).toBe(true);
  });

  it('backup() returns the path and keeps the file when quick_check reports ok', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    const healthy = new FakeSqliteDatabase(); // quick_check defaults to 'ok'
    svc.setValidationFactory(() => healthy);

    const result = await svc.backup(db, 'pre-migration');

    expect(result).not.toBeNull();
    expect(fs.existsSync(result as string)).toBe(true);
    expect(healthy.pragmas).toContain('quick_check');
  });

  it('backup() closes the validation handle on both the ok and the corrupt path', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const svc = new SqliteBackupService(dbPath, createMockLogger());

    const healthy = new FakeSqliteDatabase();
    svc.setValidationFactory(() => healthy);
    await svc.backup(new FakeSqliteDatabase(), 'pre-migration');
    expect(healthy.open).toBe(false);

    const corrupt = new FakeSqliteDatabase();
    corrupt.setQuickCheckResult('malformed');
    svc.setValidationFactory(() => corrupt);
    await svc.backup(new FakeSqliteDatabase(), 'pre-migration');
    expect(corrupt.open).toBe(false);
  });

  it('backup() degrades to returning the path when the validation mechanism is unavailable', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    svc.setValidationFactory(null);

    const result = await svc.backup(db, 'pre-migration');

    // An unvalidatable backup is still a backup — it must not be destroyed.
    expect(result).not.toBeNull();
    expect(fs.existsSync(result as string)).toBe(true);
    expect(
      logger.entries.some(
        (e) => e.level === 'warn' && /integrity check skipped/.test(e.message),
      ),
    ).toBe(true);
  });

  it('backup() degrades rather than deleting when opening the backup for validation throws', async () => {
    const tmpDir = makeTempDir();
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    const db = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const svc = new SqliteBackupService(dbPath, logger);

    svc.setValidationFactory(() => {
      throw new Error('database is locked (fake)');
    });

    const result = await svc.backup(db, 'pre-migration');

    expect(result).not.toBeNull();
    expect(fs.existsSync(result as string)).toBe(true);
  });

  // --- DI registration must keep working unchanged ---

  it('SqliteBackupService still resolves through the DI container', () => {
    const tmpDir = makeTempDir();
    const child = container.createChildContainer();
    child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
      useValue: path.join(tmpDir, 'ptah.sqlite'),
    });
    child.register(TOKENS.LOGGER, { useValue: createMockLogger() });
    child.registerSingleton(
      PERSISTENCE_TOKENS.BACKUP_SERVICE,
      SqliteBackupService,
    );

    const resolved = child.resolve<SqliteBackupService>(
      PERSISTENCE_TOKENS.BACKUP_SERVICE,
    );

    expect(resolved).toBeInstanceOf(SqliteBackupService);
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
