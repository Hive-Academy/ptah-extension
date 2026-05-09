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

  it('throws a typed RpcUserError when callers access db before opening', () => {
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    expect(() => service.db).toThrow(/Persistence is offline/);
    try {
      void service.db;
      throw new Error('expected db getter to throw');
    } catch (err) {
      // Surface as PERSISTENCE_UNAVAILABLE so the RPC layer returns a
      // structured response instead of a raw stack trace.
      expect((err as { errorCode?: string }).errorCode).toBe(
        'PERSISTENCE_UNAVAILABLE',
      );
    }
    expect(service.unavailable).toEqual({
      reason: 'not_initialized',
      detail: null,
    });
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

  // --- D4: busy_timeout pragma ---

  it('D4: applies busy_timeout = 5000 pragma on open', async () => {
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    service.configure({ factory: () => fake, vecPathResolver: null });

    await service.openAndMigrate();

    expect(fake.pragmas).toContain('busy_timeout = 5000');
  });

  // --- D1: WAL checkpoint on close ---

  it('D1: wal_checkpoint(TRUNCATE) is called before close()', async () => {
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    service.configure({ factory: () => fake, vecPathResolver: null });
    await service.openAndMigrate();

    service.close();

    expect(fake.walCheckpointCalls).toHaveLength(1);
    expect(fake.walCheckpointCalls[0]).toBe('wal_checkpoint(TRUNCATE)');
  });

  it('D1: WAL checkpoint failure is non-fatal — close() still completes', async () => {
    const fake = new FakeSqliteDatabase();
    // Override pragma to throw on WAL checkpoint only.
    const originalPragma = fake.pragma.bind(fake);
    (fake as unknown as Record<string, unknown>)['pragma'] = (
      p: string,
      opts?: { simple?: boolean },
    ) => {
      if (/wal_checkpoint/i.test(p)) {
        throw new Error('WAL checkpoint error (fake)');
      }
      return originalPragma(p, opts);
    };

    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });
    await service.openAndMigrate();

    expect(() => service.close()).not.toThrow();
    expect(service.isOpen).toBe(false);
    expect(
      logger.entries.some(
        (e) => e.level === 'warn' && /WAL checkpoint failed/.test(e.message),
      ),
    ).toBe(true);
  });

  // --- D3: quick_check + boot continues ---

  it('D3: quick_check pass logs info and boot continues normally', async () => {
    const fake = new FakeSqliteDatabase(); // default: quick_check returns 'ok'
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await service.openAndMigrate();

    expect(service.isOpen).toBe(true);
    expect(
      logger.entries.some(
        (e) => e.level === 'info' && /quick_check passed/.test(e.message),
      ),
    ).toBe(true);
  });

  it('D3: quick_check failure logs error but boot continues and db is accessible', async () => {
    const fake = new FakeSqliteDatabase();
    fake.setQuickCheckResult('row 42 missing from index');
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await service.openAndMigrate();

    // Connection must still be open — quick_check failure is non-fatal.
    expect(service.isOpen).toBe(true);
    expect(() => service.db).not.toThrow();
    expect(
      logger.entries.some(
        (e) => e.level === 'error' && /quick_check FAILED/.test(e.message),
      ),
    ).toBe(true);
  });

  // --- D6: logConnectionHealth ---

  it('D6: logConnectionHealth emits one info log with required health fields', async () => {
    const fake = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await service.openAndMigrate();

    const healthLogs = logger.entries.filter(
      (e) => e.level === 'info' && /connection health/.test(e.message),
    );
    expect(healthLogs).toHaveLength(1);
    const ctx = healthLogs[0].context as Record<string, unknown>;
    expect(typeof ctx['dbSizeMb']).toBe('number');
    expect(typeof ctx['pageCount']).toBe('number');
    expect(typeof ctx['pageSize']).toBe('number');
    expect(typeof ctx['freelistCount']).toBe('number');
    expect(typeof ctx['journalMode']).toBe('string');
    expect(typeof ctx['vecExtensionLoaded']).toBe('boolean');
  });

  it('D6: logConnectionHealth failure is non-fatal — boot continues', async () => {
    const fake = new FakeSqliteDatabase();
    // Make every pragma call throw to trigger logConnectionHealth failure.
    let pragmaCallCount = 0;
    const originalPragma = fake.pragma.bind(fake);
    (fake as unknown as Record<string, unknown>)['pragma'] = (
      p: string,
      opts?: { simple?: boolean },
    ) => {
      // Only throw for the health-check simple pragmas to avoid breaking applyPragmas.
      if (opts?.simple) {
        pragmaCallCount += 1;
        if (pragmaCallCount === 1) {
          throw new Error('pragma failed (fake health error)');
        }
      }
      return originalPragma(p, opts);
    };

    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await expect(service.openAndMigrate()).resolves.not.toThrow();
    expect(service.isOpen).toBe(true);
    expect(
      logger.entries.some(
        (e) =>
          e.level === 'warn' && /logConnectionHealth failed/.test(e.message),
      ),
    ).toBe(true);
  });

  // --- D5: classifyOpenFailure ENOSPC / EPERM ---

  it('D5: classifyOpenFailure sets open_failed + disk-full detail on ENOSPC', async () => {
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({
      factory: () => {
        throw new Error('ENOSPC: no space left on device');
      },
      vecPathResolver: null,
    });

    await expect(service.openAndMigrate()).rejects.toThrow();

    expect(service.unavailable?.reason).toBe('open_failed');
    expect(service.unavailable?.detail).toMatch(/Disk is full/);
  });

  it('D5: classifyOpenFailure sets open_failed + disk-full detail on SQLITE_FULL', async () => {
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({
      factory: () => {
        throw new Error('SQLITE_FULL: database or disk is full');
      },
      vecPathResolver: null,
    });

    await expect(service.openAndMigrate()).rejects.toThrow();

    expect(service.unavailable?.reason).toBe('open_failed');
    expect(service.unavailable?.detail).toMatch(/Disk is full/);
  });

  it('D5: classifyOpenFailure sets open_failed + antivirus detail on EPERM', async () => {
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({
      factory: () => {
        throw new Error('EPERM: operation not permitted');
      },
      vecPathResolver: null,
    });

    await expect(service.openAndMigrate()).rejects.toThrow();

    expect(service.unavailable?.reason).toBe('open_failed');
    expect(service.unavailable?.detail).toMatch(/antivirus/i);
  });

  it('D5: classifyOpenFailure sets open_failed + antivirus detail on "permission denied"', async () => {
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({
      factory: () => {
        throw new Error('permission denied, open ptah.sqlite');
      },
      vecPathResolver: null,
    });

    await expect(service.openAndMigrate()).rejects.toThrow();

    expect(service.unavailable?.reason).toBe('open_failed');
    expect(service.unavailable?.detail).toMatch(/antivirus/i);
  });

  it('D5: classifyOpenFailure sets open_failed + antivirus detail on "access is denied" (Windows)', async () => {
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({
      factory: () => {
        throw new Error('access is denied');
      },
      vecPathResolver: null,
    });

    await expect(service.openAndMigrate()).rejects.toThrow();

    expect(service.unavailable?.reason).toBe('open_failed');
    expect(service.unavailable?.detail).toMatch(/antivirus/i);
  });

  // --- D5: handleFatalWriteError ---

  it('D5: handleFatalWriteError closes + marks unavailable on SQLITE_FULL', async () => {
    const fake = new FakeSqliteDatabase();
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });
    await service.openAndMigrate();
    expect(service.isOpen).toBe(true);

    const acted = service.handleFatalWriteError(
      new Error('SQLITE_FULL: database or disk is full'),
    );

    expect(acted).toBe(true);
    expect(service.isOpen).toBe(false);
    expect(
      logger.entries.some(
        (e) => e.level === 'error' && /fatal write error/.test(e.message),
      ),
    ).toBe(true);
  });

  it('D5: handleFatalWriteError closes + marks unavailable on ENOSPC', async () => {
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    service.configure({ factory: () => fake, vecPathResolver: null });
    await service.openAndMigrate();

    const acted = service.handleFatalWriteError(
      new Error('ENOSPC: no space left on device'),
    );

    expect(acted).toBe(true);
    expect(service.isOpen).toBe(false);
  });

  it('D5: handleFatalWriteError returns false and does not close on unrelated errors', async () => {
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    service.configure({ factory: () => fake, vecPathResolver: null });
    await service.openAndMigrate();

    const acted = service.handleFatalWriteError(
      new Error('UNIQUE constraint failed: memories.id'),
    );

    expect(acted).toBe(false);
    expect(service.isOpen).toBe(true);
  });

  it('D5: handleFatalWriteError returns false and does NOT close on EPERM (DB still readable)', async () => {
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    service.configure({ factory: () => fake, vecPathResolver: null });
    await service.openAndMigrate();

    const acted = service.handleFatalWriteError(
      new Error('EPERM: operation not permitted'),
    );

    expect(acted).toBe(false);
    expect(service.isOpen).toBe(true);
  });

  // --- D10: foreign_key_check at boot ---

  it('D10: foreign_key_check is silent when there are no violations', async () => {
    const fake = new FakeSqliteDatabase();
    // Default: empty FK violations.
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await service.openAndMigrate();

    // No warn log mentioning foreign_key_check violations.
    expect(
      logger.entries.some(
        (e) =>
          e.level === 'warn' && /foreign_key_check violations/.test(e.message),
      ),
    ).toBe(false);
  });

  it('D10: foreign_key_check logs warn with count and sample when violations found', async () => {
    const fake = new FakeSqliteDatabase();
    fake.setForeignKeyViolations([
      { table: 'memories', rowid: 1, parent: 'workspaces', fkid: 0 },
      { table: 'memories', rowid: 2, parent: 'workspaces', fkid: 0 },
      { table: 'memories', rowid: 3, parent: 'workspaces', fkid: 0 },
      { table: 'memories', rowid: 4, parent: 'workspaces', fkid: 0 },
    ]);
    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await service.openAndMigrate();

    // Must still open successfully — FK violations are non-fatal.
    expect(service.isOpen).toBe(true);

    const fkWarnLogs = logger.entries.filter(
      (e) =>
        e.level === 'warn' && /foreign_key_check violations/.test(e.message),
    );
    expect(fkWarnLogs).toHaveLength(1);
    const ctx = fkWarnLogs[0].context as Record<string, unknown>;
    expect(ctx['count']).toBe(4);
    const sample = ctx['sample'] as unknown[];
    // Sample is capped at 3.
    expect(sample).toHaveLength(3);
  });

  it('D10: foreign_key_check pragma error is swallowed — non-fatal', async () => {
    const fake = new FakeSqliteDatabase();
    const originalPragma = fake.pragma.bind(fake);
    (fake as unknown as Record<string, unknown>)['pragma'] = (
      p: string,
      opts?: { simple?: boolean },
    ) => {
      if (/^foreign_key_check/i.test(p.trim())) {
        throw new Error('foreign_key_check failed (fake)');
      }
      return originalPragma(p, opts);
    };

    const logger = createMockLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    service.configure({ factory: () => fake, vecPathResolver: null });

    await expect(service.openAndMigrate()).resolves.not.toThrow();
    expect(service.isOpen).toBe(true);
    expect(
      logger.entries.some(
        (e) => e.level === 'warn' && /foreign_key_check error/.test(e.message),
      ),
    ).toBe(true);
  });
});

describe('SqliteConnectionService — vec0 smoke (skipped without native)', () => {
  // Real better-sqlite3 + sqlite-vec smoke test. Skipped when the native
  // modules aren't installed (Track 0 exit criteria forbids `npm install`).
  // Track 1 / 2 will land alongside the deps and these will execute.
  // require.resolve only checks the JS shim exists — it doesn't validate
  // that the .node binary matches the host runtime's ABI. We need to
  // actually open a database to confirm the native module loads.
  // Without this, an Electron-ABI build (`npm run electron:rebuild`)
  // crashes Jest with NODE_MODULE_VERSION 143 vs 137 instead of skipping.
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    require.resolve('sqlite-vec');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
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
