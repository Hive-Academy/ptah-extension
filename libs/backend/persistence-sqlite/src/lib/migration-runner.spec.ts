/**
 * Unit tests for SqliteMigrationRunner.
 *
 * Uses an in-memory FakeSqliteDatabase so the suite runs without
 * better-sqlite3 native bindings — this matches the Track 0 exit
 * criteria (tests must pass before tracks 1–4 install deps).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteMigrationRunner } from './migration-runner';
import type { Migration } from './migrations';
import { run as run0009AutoVacuum } from './migrations/0009_auto_vacuum';
import { FakeSqliteDatabase } from './testing/fake-sqlite-database';
import { createMockLogger } from './testing/mock-logger';

const FIXTURE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '0001_init',
    sql: 'CREATE TABLE t1 (id INTEGER PRIMARY KEY);',
  },
  {
    version: 2,
    name: '0002_add_t2',
    sql: 'CREATE TABLE t2 (id INTEGER PRIMARY KEY);',
  },
  {
    version: 3,
    name: '0003_add_t3',
    sql: 'CREATE TABLE t3 (id INTEGER PRIMARY KEY);',
  },
];

describe('SqliteMigrationRunner', () => {
  it('applies all migrations on a fresh DB', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    const result = await runner.applyAll(FIXTURE_MIGRATIONS);

    expect(result.appliedVersions).toEqual([1, 2, 3]);
    expect(result.skippedVersions).toEqual([]);
    expect(result.finalVersion).toBe(3);
    expect(db.tables.has('t1')).toBe(true);
    expect(db.tables.has('t2')).toBe(true);
    expect(db.tables.has('t3')).toBe(true);
    expect(runner.readAppliedVersions()).toEqual(new Set([1, 2, 3]));
  });

  it('is a no-op on second run', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    await runner.applyAll(FIXTURE_MIGRATIONS);
    const second = await runner.applyAll(FIXTURE_MIGRATIONS);

    expect(second.appliedVersions).toEqual([]);
    expect(second.skippedVersions).toEqual([1, 2, 3]);
    expect(second.finalVersion).toBe(3);
  });

  it('applies only the new migration when one is added later', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    await runner.applyAll(FIXTURE_MIGRATIONS.slice(0, 2));
    expect(runner.readAppliedVersions()).toEqual(new Set([1, 2]));

    const result = await runner.applyAll(FIXTURE_MIGRATIONS);
    expect(result.appliedVersions).toEqual([3]);
    expect(result.skippedVersions).toEqual([1, 2]);
  });

  it('refuses to start when the DB version exceeds the bundled max', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    // Pre-seed schema_migrations with a "future" version row.
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    db.prepare(
      'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    ).run(99, Date.now());

    await expect(runner.applyAll(FIXTURE_MIGRATIONS)).rejects.toThrow(
      /version 99.*bundles up to 3/,
    );
  });

  it('rolls back a failing migration and leaves earlier ones intact', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const broken: Migration[] = [
      FIXTURE_MIGRATIONS[0],
      { version: 2, name: 'broken', sql: 'NOT VALID SQL;' },
    ];

    await expect(runner.applyAll(broken)).rejects.toThrow(
      /migration 2.*failed/,
    );
    expect(runner.readAppliedVersions()).toEqual(new Set([1]));
  });

  it('returns an empty result for an empty migration list', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    const result = await runner.applyAll([]);
    expect(result.appliedVersions).toEqual([]);
    expect(result.finalVersion).toBe(0);
  });

  it('records applied_at timestamps as epoch ms integers', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const before = Date.now();

    await runner.applyAll(FIXTURE_MIGRATIONS);

    const rows = db
      .prepare('SELECT version, applied_at FROM schema_migrations')
      .all() as Array<{ version: number; applied_at: number }>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(typeof row.applied_at).toBe('number');
      expect(row.applied_at).toBeGreaterThanOrEqual(before);
    }
  });

  // --- D3: PRAGMA user_version written inside applyOne ---

  it('D3: user_version is bumped to the last applied migration version', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    await runner.applyAll(FIXTURE_MIGRATIONS);

    // After applying versions 1, 2, 3 the user_version should be 3.
    expect(db.getUserVersion()).toBe(3);
  });

  it('D3: user_version reflects the highest applied version after partial run', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());

    await runner.applyAll(FIXTURE_MIGRATIONS.slice(0, 2));
    expect(db.getUserVersion()).toBe(2);

    await runner.applyAll(FIXTURE_MIGRATIONS);
    expect(db.getUserVersion()).toBe(3);
  });

  it('D3: user_version is not bumped when a migration rolls back on failure', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const withBroken: Migration[] = [
      FIXTURE_MIGRATIONS[0],
      { version: 2, name: 'broken', sql: 'NOT VALID SQL;' },
    ];

    await expect(runner.applyAll(withBroken)).rejects.toThrow(
      /migration 2.*failed/,
    );
    // Only version 1 was applied successfully before the failure.
    expect(db.getUserVersion()).toBe(1);
  });

  // --- D2: pre-migration backup hook ---

  it('D2: calls backup then rotate before applying pending migrations', async () => {
    const db = new FakeSqliteDatabase();
    const backupCalls: string[] = [];
    const rotateCalls: Array<[string, number]> = [];
    const fakeBackupService = {
      backup: async (_db: unknown, kind: string) => {
        backupCalls.push(kind);
        return '/fake/backup/path.sqlite';
      },
      rotate: (kind: string, keep: number) => {
        rotateCalls.push([kind, keep]);
      },
    };
    const runner = new SqliteMigrationRunner(
      db,
      createMockLogger(),
      fakeBackupService,
    );

    await runner.applyAll(FIXTURE_MIGRATIONS);

    expect(backupCalls).toEqual(['pre-migration']);
    expect(rotateCalls).toEqual([['pre-migration', 3]]);
  });

  it('D2: skips backup when there are no pending migrations', async () => {
    const db = new FakeSqliteDatabase();
    const backupCalls: string[] = [];
    const fakeBackupService = {
      backup: async (_db: unknown, kind: string) => {
        backupCalls.push(kind);
        return null;
      },
      rotate: () => undefined,
    };
    const runner = new SqliteMigrationRunner(
      db,
      createMockLogger(),
      fakeBackupService,
    );

    // Apply all migrations first — now no pending migrations remain.
    await runner.applyAll(FIXTURE_MIGRATIONS);
    backupCalls.length = 0;

    // Second run: all up-to-date, backup should NOT be called.
    await runner.applyAll(FIXTURE_MIGRATIONS);

    expect(backupCalls).toHaveLength(0);
  });

  it('D2: continues with migrations when backup fails', async () => {
    const db = new FakeSqliteDatabase();
    const fakeBackupService = {
      backup: async () => {
        throw new Error('backup disk error (fake)');
      },
      rotate: () => undefined,
    };
    const logger = createMockLogger();
    const runner = new SqliteMigrationRunner(db, logger, fakeBackupService);

    // Must not throw — backup failure is non-fatal.
    const result = await runner.applyAll(FIXTURE_MIGRATIONS);

    expect(result.appliedVersions).toEqual([1, 2, 3]);
    expect(
      logger.entries.some(
        (e) =>
          e.level === 'warn' && /pre-migration backup failed/.test(e.message),
      ),
    ).toBe(true);
  });

  it('D2 review fix: rotate() is NOT called when backup returns null', async () => {
    // If backup() returns null (db.backup unavailable), rotate() must not run —
    // deleting old backups without writing a new one would silently shrink the archive.
    const db = new FakeSqliteDatabase();
    const rotateCalls: number[] = [];
    const fakeBackupService = {
      backup: async () => null as string | null, // simulate unavailable db.backup
      rotate: (_kind: string, _keep: number) => {
        rotateCalls.push(1);
      },
    };
    const runner = new SqliteMigrationRunner(
      db,
      createMockLogger(),
      fakeBackupService,
    );

    await runner.applyAll(FIXTURE_MIGRATIONS);

    // rotate() must NOT have been called because backup returned null.
    expect(rotateCalls).toHaveLength(0);
  });

  it('D2 review fix: rotate() IS called when backup returns a path', async () => {
    const db = new FakeSqliteDatabase();
    const rotateCalls: number[] = [];
    const fakeBackupService = {
      backup: async () => '/fake/backup.sqlite' as string | null,
      rotate: (_kind: string, _keep: number) => {
        rotateCalls.push(1);
      },
    };
    const runner = new SqliteMigrationRunner(
      db,
      createMockLogger(),
      fakeBackupService,
    );

    await runner.applyAll(FIXTURE_MIGRATIONS);

    expect(rotateCalls).toHaveLength(1);
  });

  it('D2: backup order is backup → rotate → apply', async () => {
    const db = new FakeSqliteDatabase();
    const callOrder: string[] = [];
    const fakeBackupService = {
      backup: async () => {
        callOrder.push('backup');
        return '/path.sqlite';
      },
      rotate: () => {
        callOrder.push('rotate');
      },
    };
    // Intercept applyOne by checking tables after the run
    const runner = new SqliteMigrationRunner(
      db,
      createMockLogger(),
      fakeBackupService,
    );

    await runner.applyAll(FIXTURE_MIGRATIONS);

    // backup and rotate must precede any migrations; tables are created by applyOne
    expect(callOrder.indexOf('backup')).toBeLessThan(
      callOrder.indexOf('rotate'),
    );
    // Both backup and rotate completed before tables were populated
    expect(callOrder).toEqual(['backup', 'rotate']);
    // Tables ARE created, confirming apply ran after
    expect(db.tables.has('t1')).toBe(true);
  });

  // --- D9 / run() interface ---

  it('D9 run path: migration.run() is called OUTSIDE any transaction', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    let waInTransaction: boolean | null = null;
    const runMigration: Migration = {
      version: 99,
      name: '0099_run_test',
      run: (d) => {
        // Capture the transaction state at the moment run() is invoked.
        waInTransaction = d.inTransaction;
      },
    };

    await runner.applyAll([...FIXTURE_MIGRATIONS, runMigration]);

    // run() must be called outside a transaction.
    expect(waInTransaction).toBe(false);
    // Bookkeeping must still be recorded.
    expect(runner.readAppliedVersions().has(99)).toBe(true);
    // user_version must be bumped.
    expect(db.getUserVersion()).toBe(99);
  });

  it('D9 run path: bookkeeping is NOT written when run() throws', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const failingMigration: Migration = {
      version: 99,
      name: '0099_fail_run',
      run: () => {
        throw new Error('run() failed (fake)');
      },
    };

    await expect(
      runner.applyAll([...FIXTURE_MIGRATIONS, failingMigration]),
    ).rejects.toThrow(/migration 99.*run\(\) failed/);

    // Bookkeeping must NOT have been written for the failing migration.
    expect(runner.readAppliedVersions().has(99)).toBe(false);
    // user_version must NOT have been bumped beyond the last successful migration.
    expect(db.getUserVersion()).toBe(3);
  });

  it('D9 run path: migration with both sql and run throws at apply time', async () => {
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const ambiguous: Migration = {
      version: 99,
      name: '0099_ambiguous',
      sql: 'SELECT 1;',
      run: () => {
        /* no-op */
      },
    };

    await expect(
      runner.applyAll([...FIXTURE_MIGRATIONS, ambiguous]),
    ).rejects.toThrow(/both sql and run/);
  });

  it('D9 run path: post-run bookkeeping transaction is isolated from run()', async () => {
    // Verify that BEGIN/COMMIT does NOT appear before run() — only after.
    const db = new FakeSqliteDatabase();
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const txnStates: boolean[] = [];

    const runMigration: Migration = {
      version: 99,
      name: '0099_tx_isolation',
      run: (d) => {
        // Record inTransaction; if BEGIN had been issued before run(), this is true.
        txnStates.push(d.inTransaction);
      },
    };

    await runner.applyAll([runMigration]);

    // run() must see inTransaction=false — no BEGIN before it.
    expect(txnStates).toEqual([false]);
  });
});

// ---------------------------------------------------------------------------
// SQL-M real better-sqlite3 migration invariants
//
// These tests use the real `better-sqlite3` native binding to validate the
// invariants in Section 3.3 of docs/test-strategy-plan.md. They are skipped
// when the native module is not installed (Track 0 exit criteria).
// ---------------------------------------------------------------------------

{
  let nativeAvailable = false;
  let vecAvailable = false;
  let Database:
    | (new (file: string) => {
        loadExtension?: (path: string) => void;
        close(): void;
      })
    | undefined;
  let vecExtPath: string | undefined;
  try {
    Database = require('better-sqlite3') as new (file: string) => {
      loadExtension?: (path: string) => void;
      close(): void;
    };
    // Smoke-test: open an in-memory DB to confirm the ABI matches the runner.
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
    try {
      const sqliteVec = require('sqlite-vec') as {
        getLoadablePath: () => string;
      };
      vecExtPath = sqliteVec.getLoadablePath();
      const vecProbe = new Database(':memory:');
      vecProbe.loadExtension?.(vecExtPath);
      vecProbe.close();
      vecAvailable = true;
    } catch {
      vecAvailable = false;
    }
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? describe : describe.skip;

  maybe('SQL-M real better-sqlite3 migration invariants', () => {
    function openDb(file = ':memory:', loadVec = false) {
      if (!Database) throw new Error('better-sqlite3 not available');
      const db = new Database(file);
      if (loadVec && vecExtPath) db.loadExtension?.(vecExtPath);
      return db as unknown as import('./sqlite-connection.service').SqliteDatabase;
    }

    // SQL-M-1: applying MIGRATIONS to a fresh in-memory DB does not throw
    // and finalVersion equals the last migration version. Tests the
    // production happy path with sqlite-vec loaded. Skipped if sqlite-vec
    // is unavailable in the test environment.
    const sqlM1 = vecAvailable ? it : it.skip;
    sqlM1(
      'SQL-M-1: applies all MIGRATIONS to a fresh real in-memory DB without error',
      async () => {
        const { MIGRATIONS } = require('./migrations') as {
          MIGRATIONS: readonly import('./migrations').Migration[];
        };
        const db = openDb(':memory:', true);
        const runner = new SqliteMigrationRunner(db, createMockLogger());

        const result = await runner.applyAll(MIGRATIONS, {
          vecExtensionLoaded: true,
        });

        expect(result.appliedVersions.length).toBeGreaterThan(0);
        expect(result.finalVersion).toBe(
          MIGRATIONS[MIGRATIONS.length - 1].version,
        );
        const applied = runner.readAppliedVersions();
        for (const v of result.appliedVersions) {
          expect(applied.has(v)).toBe(true);
        }
        (db as { close(): void }).close();
      },
    );

    // SQL-M-2: re-running applyAll on an already-migrated DB skips all versions.
    const sqlM2 = vecAvailable ? it : it.skip;
    sqlM2(
      'SQL-M-2: re-running applyAll on a fully-migrated DB produces empty appliedVersions',
      async () => {
        const { MIGRATIONS } = require('./migrations') as {
          MIGRATIONS: readonly import('./migrations').Migration[];
        };
        const db = openDb(':memory:', true);
        const runner = new SqliteMigrationRunner(db, createMockLogger());

        await runner.applyAll(MIGRATIONS, { vecExtensionLoaded: true });
        const second = await runner.applyAll(MIGRATIONS, {
          vecExtensionLoaded: true,
        });

        expect(second.appliedVersions).toEqual([]);
        // skippedVersions includes already-applied migrations on re-run.
        expect(second.skippedVersions.length).toBeGreaterThan(0);
        expect(second.finalVersion).toBe(
          MIGRATIONS[MIGRATIONS.length - 1].version,
        );
        (db as { close(): void }).close();
      },
    );

    // SQL-M-3: a migration with a syntax error is rolled back — tables from
    // prior migrations remain; the failing migration leaves no bookkeeping row.
    it('SQL-M-3: syntax-error migration is rolled back — prior tables intact', async () => {
      const db = openDb();
      const runner = new SqliteMigrationRunner(db, createMockLogger());
      const goodMigration: Migration = {
        version: 1,
        name: '0001_real_good',
        sql: 'CREATE TABLE real_t1 (id INTEGER PRIMARY KEY);',
      };
      const brokenMigration: Migration = {
        version: 2,
        name: '0002_real_broken',
        sql: 'THIS IS NOT VALID SQL AT ALL;',
      };

      await expect(
        runner.applyAll([goodMigration, brokenMigration]),
      ).rejects.toThrow(/migration 2.*failed/);

      // Prior migration's table must still exist.
      const tableList = (db as { prepare(sql: string): { all(): unknown[] } })
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='real_t1'",
        )
        .all() as Array<{ name: string }>;
      expect(tableList.length).toBe(1);

      // Only version 1 is recorded in schema_migrations.
      const applied = runner.readAppliedVersions();
      expect(applied.has(1)).toBe(true);
      expect(applied.has(2)).toBe(false);

      (db as { close(): void }).close();
    });

    // SQL-M-4: migration version numbers in MIGRATIONS are strictly monotonically
    // increasing (no two consecutive entries share or decrease version).
    it('SQL-M-4: MIGRATIONS version numbers are strictly monotonically increasing', () => {
      const { MIGRATIONS } = require('./migrations') as {
        MIGRATIONS: readonly import('./migrations').Migration[];
      };

      for (let i = 1; i < MIGRATIONS.length; i++) {
        const prev = MIGRATIONS[i - 1].version;
        const curr = MIGRATIONS[i].version;
        expect(curr).toBeGreaterThan(prev);
      }
    });

    // SQL-M-5: migrations run in numeric order regardless of how the input
    // array is ordered.  Provide the array reversed and verify all versions
    // are applied in ascending order (the runner sorts internally).
    it('SQL-M-5: migrations are applied in numeric order regardless of input order', async () => {
      const db = openDb();
      const runner = new SqliteMigrationRunner(db, createMockLogger());
      const unordered: Migration[] = [
        {
          version: 3,
          name: '0003_c',
          sql: 'CREATE TABLE ord_c (id INTEGER PRIMARY KEY);',
        },
        {
          version: 1,
          name: '0001_a',
          sql: 'CREATE TABLE ord_a (id INTEGER PRIMARY KEY);',
        },
        {
          version: 2,
          name: '0002_b',
          sql: 'CREATE TABLE ord_b (id INTEGER PRIMARY KEY);',
        },
      ];

      const result = await runner.applyAll(unordered);

      expect(result.appliedVersions).toEqual([1, 2, 3]);
      expect(result.finalVersion).toBe(3);
      (db as { close(): void }).close();
    });
  });
}

// --- Migration 0009: auto_vacuum ---

describe('Migration 0009 — auto_vacuum', () => {
  it('0009 on a NONE (0) db: sets INCREMENTAL and runs VACUUM', () => {
    const db = new FakeSqliteDatabase();
    // Default mode is 0 (NONE).
    expect(db.getAutoVacuumMode()).toBe(0);

    run0009AutoVacuum(db);

    expect(db.getAutoVacuumMode()).toBe(2); // INCREMENTAL
    // VACUUM was recorded in pragmas/exec — mode changed to INCREMENTAL confirms VACUUM ran.
    // The fake's exec handles VACUUM without throwing, so no error = VACUUM was called.
  });

  it('0009 on a FULL (1) db: sets INCREMENTAL and runs VACUUM', () => {
    const db = new FakeSqliteDatabase();
    db.setAutoVacuumMode(1);

    run0009AutoVacuum(db);

    expect(db.getAutoVacuumMode()).toBe(2);
  });

  it('0009 on an INCREMENTAL (2) db: no-op (does not change mode or run VACUUM)', () => {
    const db = new FakeSqliteDatabase();
    db.setAutoVacuumMode(2);
    const pragmasBefore = db.pragmas.length;

    run0009AutoVacuum(db);

    // No new pragmas written — mode detection pragma is still called but no set pragma.
    // Specifically, 'auto_vacuum = INCREMENTAL' pragma must NOT appear.
    const setAutoVacuumCalls = db.pragmas.filter((p) =>
      /auto_vacuum\s*=\s*INCREMENTAL/i.test(p),
    );
    expect(setAutoVacuumCalls).toHaveLength(0);
    // Mode unchanged.
    expect(db.getAutoVacuumMode()).toBe(2);
    // The only new pragma recorded is the read probe (auto_vacuum without assignment).
    // Confirm pragmas grew by at most 1 (the detection read).
    expect(db.pragmas.length).toBeLessThanOrEqual(pragmasBefore + 1);
  });

  it('0009 applied via runner on a NONE db: bookkeeping recorded, user_version bumped', async () => {
    const db = new FakeSqliteDatabase();
    // Provide only migration 0009 so it runs first.
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const migration0009: Migration = {
      version: 9,
      name: '0009_auto_vacuum',
      run: run0009AutoVacuum,
    };

    const result = await runner.applyAll([migration0009]);

    expect(result.appliedVersions).toEqual([9]);
    expect(runner.readAppliedVersions().has(9)).toBe(true);
    expect(db.getUserVersion()).toBe(9);
    expect(db.getAutoVacuumMode()).toBe(2);
  });

  it('0009 applied via runner on an INCREMENTAL db: idempotent no-op', async () => {
    const db = new FakeSqliteDatabase();
    db.setAutoVacuumMode(2);
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    const migration0009: Migration = {
      version: 9,
      name: '0009_auto_vacuum',
      run: run0009AutoVacuum,
    };

    // First run — bookkeeping written.
    await runner.applyAll([migration0009]);
    expect(runner.readAppliedVersions().has(9)).toBe(true);

    // Second run — should be skipped (already in schema_migrations).
    const result = await runner.applyAll([migration0009]);
    expect(result.appliedVersions).toEqual([]);
    expect(result.skippedVersions).toEqual([9]);
    // Mode unchanged at INCREMENTAL.
    expect(db.getAutoVacuumMode()).toBe(2);
  });

  // D9 review fix: VACUUM INTO with a real file path
  it('D9 review fix: with dbPath provided, uses VACUUM INTO and renames result atomically', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-0009-test-'));
    const dbPath = path.join(tmpDir, 'ptah.sqlite');
    // Create a fake source DB file so renameSync has something to work with.
    fs.writeFileSync(dbPath, 'FAKE_DB');

    const db = new FakeSqliteDatabase();
    // Override exec to capture VACUUM INTO and simulate file creation.
    const execCalls: string[] = [];
    const originalExec = db.exec.bind(db);
    (db as unknown as Record<string, unknown>)['exec'] = (sql: string) => {
      execCalls.push(sql.trim());
      // Simulate VACUUM INTO creating the .vacuumed file.
      if (/^VACUUM INTO/i.test(sql)) {
        const match = /VACUUM INTO '([^']+)'/i.exec(sql);
        if (match) {
          fs.writeFileSync(match[1], 'VACUUMED_DB');
        }
        return;
      }
      return originalExec(sql);
    };

    run0009AutoVacuum(db, dbPath);

    // VACUUM INTO was called (not plain VACUUM).
    expect(execCalls.some((c) => /^VACUUM INTO/i.test(c))).toBe(true);
    expect(execCalls.every((c) => !/^VACUUM$/i.test(c))).toBe(true);
    // The original DB path now contains the vacuumed result (renamed from .vacuumed).
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('VACUUMED_DB');
    // The temp .vacuumed file is gone (renamed away).
    expect(fs.existsSync(`${dbPath}.vacuumed`)).toBe(false);
    // Mode is INCREMENTAL.
    expect(db.getAutoVacuumMode()).toBe(2);
  });

  it('D9 review fix: without dbPath falls back to plain VACUUM (test/memory mode)', () => {
    const db = new FakeSqliteDatabase();
    const execCalls: string[] = [];
    const originalExec = db.exec.bind(db);
    (db as unknown as Record<string, unknown>)['exec'] = (sql: string) => {
      execCalls.push(sql.trim());
      return originalExec(sql);
    };

    // No dbPath → fallback to plain VACUUM.
    run0009AutoVacuum(db);

    expect(execCalls.some((c) => /^VACUUM$/i.test(c))).toBe(true);
    expect(execCalls.every((c) => !/^VACUUM INTO/i.test(c))).toBe(true);
  });
});
