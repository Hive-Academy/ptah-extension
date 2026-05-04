/**
 * Unit tests for SqliteConnectionService.
 *
 * All tests inject FakeSqliteDatabase via the `configure({ factory })` seam
 * so the suite runs without better-sqlite3 native bindings. A second
 * "smoke" test against the real native module is left to Track 1+ once
 * dependencies are installed.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { SqliteConnectionService } from './sqlite-connection.service';
import { FakeSqliteDatabase } from './testing/fake-sqlite-database';
import { createMockLogger } from './testing/mock-logger';
import { MIGRATIONS } from './migrations';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-persist-test-'));
  return path.join(dir, 'ptah.db');
}

describe('SqliteConnectionService', () => {
  it('opens the connection, applies pragmas, and runs every bundled migration', async () => {
    const dbPath = makeTempDbPath();
    const fake = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    service.configure({
      factory: () => fake,
      vecPathResolver: () => '/fake/vec/path',
    });

    await service.openAndMigrate();

    expect(service.isOpen).toBe(true);
    expect(service.vecExtensionLoaded).toBe(true);
    // Pragmas applied in order, and contain the three required statements.
    expect(fake.pragmas).toEqual(
      expect.arrayContaining([
        'journal_mode = WAL',
        'foreign_keys = ON',
        'synchronous = NORMAL',
      ]),
    );
    // Every migration is recorded.
    const finalVersion = MIGRATIONS[MIGRATIONS.length - 1].version;
    const rows = fake
      .prepare('SELECT version FROM schema_migrations')
      .all() as Array<{ version: number }>;
    expect(rows.map((r) => r.version)).toEqual(
      MIGRATIONS.map((m) => m.version),
    );
    expect(finalVersion).toBeGreaterThan(0);
  });

  it('is idempotent: a second openAndMigrate is a no-op when already open', async () => {
    const fake = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    let factoryCalls = 0;
    service.configure({
      factory: () => {
        factoryCalls += 1;
        return fake;
      },
      vecPathResolver: () => '/fake/vec/path',
    });

    await service.openAndMigrate();
    await service.openAndMigrate();

    expect(factoryCalls).toBe(1);
  });

  it('degrades gracefully when sqlite-vec cannot be loaded', async () => {
    const fake = new FakeSqliteDatabase();
    fake.setLoadExtensionBehavior('throw');
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({
      factory: () => fake,
      vecPathResolver: () => '/missing/vec',
    });

    await service.openAndMigrate();

    expect(service.isOpen).toBe(true);
    expect(service.vecExtensionLoaded).toBe(false);
    expect(
      logger.entries.some(
        (e) => e.level === 'warn' && /sqlite-vec load failed/.test(e.message),
      ),
    ).toBe(true);
  });

  it('degrades gracefully when no vec path resolver is configured', async () => {
    const fake = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await service.openAndMigrate();

    expect(service.vecExtensionLoaded).toBe(false);
  });

  it('throws when callers access db before opening', () => {
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    expect(() => service.db).toThrow(/not open/);
  });

  it('close() releases the connection and is idempotent', async () => {
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    service.configure({
      factory: () => fake,
      vecPathResolver: () => '/fake/vec',
    });

    await service.openAndMigrate();
    expect(service.isOpen).toBe(true);
    service.close();
    expect(service.isOpen).toBe(false);
    // Calling close twice does not throw.
    expect(() => service.close()).not.toThrow();
  });

  it('creates the parent directory for the DB path on first open', async () => {
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-persist-mkdir-'),
    );
    const nested = path.join(tmpRoot, 'nested', 'sub', 'ptah.db');
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(nested, createMockLogger());
    service.configure({
      factory: () => fake,
      vecPathResolver: () => '/fake/vec',
    });

    await service.openAndMigrate();

    expect(fs.existsSync(path.dirname(nested))).toBe(true);
  });
});

describe('SqliteConnectionService — vec0 smoke (skipped without native)', () => {
  // Real better-sqlite3 + sqlite-vec smoke test. Skipped when the native
  // modules aren't installed (Track 0 exit criteria forbids `npm install`).
  // Track 1 / 2 will land alongside the deps and these will execute.
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    require.resolve('sqlite-vec');
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? it : it.skip;

  maybe('creates a vec0 virtual table, inserts, and KNN queries', async () => {
    const dbPath = makeTempDbPath();
    const service = new SqliteConnectionService(dbPath, createMockLogger());
    await service.openAndMigrate();
    expect(service.vecExtensionLoaded).toBe(true);

    const db = service.db;
    db.exec('CREATE VIRTUAL TABLE smoke_vec USING vec0(embedding FLOAT[3])');
    // Don't bind `rowid` explicitly: sqlite-vec's vec0 rejects an explicit
    // rowid in the INSERT column list with "Only integers are allows for
    // primary key values" even when the value is an integer. Let SQLite
    // assign the rowid and capture it via lastInsertRowid.
    const insert = db.prepare('INSERT INTO smoke_vec(embedding) VALUES (?)');
    insert.run(Buffer.from(new Float32Array([0, 0, 0]).buffer));
    const r2 = insert.run(Buffer.from(new Float32Array([1, 0, 0]).buffer));
    const rows = db
      .prepare(
        'SELECT rowid FROM smoke_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 1',
      )
      .all(Buffer.from(new Float32Array([0.9, 0, 0]).buffer)) as Array<{
      rowid: number;
    }>;
    expect(rows[0].rowid).toBe(Number(r2.lastInsertRowid));
    service.close();
  });
});
