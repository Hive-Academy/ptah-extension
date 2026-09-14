/**
 * SqlitePageReclaimer — real SQLite, temp files only (TASK_2026_440).
 *
 * What is asserted:
 * - on an `auto_vacuum = INCREMENTAL` file with a populated freelist, one
 *   bounded step hands back exactly the pages it reports (page_count drops by
 *   the same number) and never more than `maxPages`;
 * - a mode-0 file reports 0 and does not throw;
 * - an invalid `maxPages` (0, 1.5, NaN, Infinity, 1e9, negative) runs NO SQL;
 * - an open transaction and a closed connection both return zeros;
 * - no statement this class issues is a full `VACUUM`;
 * - `registerPersistenceSqliteServices` registers `SQLITE_PAGE_RECLAIMER`
 *   (the DI-reach half of the retention reachability proof).
 *
 * The opener falls back from better-sqlite3 (whose prebuilt binary is rebuilt
 * for Electron's ABI and often does not load under Jest) to `node:sqlite`.
 * When NEITHER loads this spec FAILS rather than skipping: a skipped reclaimer
 * spec is a green tick for page-reclaim code that never ran.
 *
 * Nothing here opens `~/.ptah`.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { container } from 'tsyringe';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import { SqlitePageReclaimer } from './sqlite-page-reclaimer';
import { PERSISTENCE_TOKENS } from './di/tokens';
import { registerPersistenceSqliteServices } from './di/register';
import { createMockLogger } from './testing/mock-logger';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from './sqlite-connection.service';

interface RawStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
  pragma?: (sql: string, options?: { simple?: boolean }) => unknown;
  inTransaction?: boolean;
  isTransaction?: boolean;
}

function resolveOpener(): ((file: string) => RawDb) | null {
  try {
    const Database = require('better-sqlite3') as new (file: string) => RawDb;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => RawDb;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

/**
 * A `SqliteDatabase` over either driver that records every pragma issued.
 *
 * better-sqlite3 has a native `pragma()`; `node:sqlite` does not, so the
 * adapter runs `PRAGMA <text>` through `prepare().all()`, which — like
 * better-sqlite3's `pragma()` — steps the statement to completion.
 */
function adapt(raw: RawDb, issued: string[]): SqliteDatabase {
  const pragma = (text: string, options?: { simple?: boolean }): unknown => {
    issued.push(text);
    if (typeof raw.pragma === 'function') {
      return raw.pragma(text, options);
    }
    const rows = raw.prepare(`PRAGMA ${text}`).all() as Array<
      Record<string, unknown>
    >;
    if (options?.simple) {
      const first = rows[0];
      return first === undefined ? undefined : Object.values(first)[0];
    }
    return rows;
  };
  return {
    exec: (sql: string) => {
      issued.push(sql);
      raw.exec(sql);
    },
    prepare: (sql: string) => {
      issued.push(sql);
      return raw.prepare(sql) as never;
    },
    pragma,
    close: () => raw.close(),
    open: true,
    get inTransaction(): boolean {
      return Boolean(raw.inTransaction ?? raw.isTransaction);
    },
    transaction: (() => {
      throw new Error('not used by the reclaimer');
    }) as never,
  };
}

const tempDirs: string[] = [];

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-reclaimer-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'reclaim.db');
}

function simple(raw: RawDb, name: string): number {
  const row = raw.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  return Number(Object.values(row)[0]);
}

describe('SqlitePageReclaimer (real SQLite)', () => {
  const opener = resolveOpener();
  const open: Array<RawDb> = [];

  afterEach(() => {
    for (const db of open.splice(0)) {
      try {
        db.close();
      } catch {
        // Already closed by the test.
      }
    }
  });

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  /**
   * A temp DB in the requested auto-vacuum mode holding ~2.5 MB of blobs that
   * were then deleted, so the freelist is populated.
   */
  function seedFreelist(mode: 'INCREMENTAL' | 'NONE'): {
    raw: RawDb;
    issued: string[];
    reclaimer: SqlitePageReclaimer;
    logger: ReturnType<typeof createMockLogger>;
  } {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const raw = opener(makeTempDbPath());
    open.push(raw);
    // auto_vacuum only takes effect when set before the first table exists.
    raw.exec(`PRAGMA auto_vacuum = ${mode}`);
    raw.exec('CREATE TABLE blobs (id INTEGER PRIMARY KEY, payload BLOB)');
    const insert = raw.prepare(
      'INSERT INTO blobs (payload) VALUES (randomblob(10000))',
    );
    for (let i = 0; i < 250; i += 1) insert.run();
    raw.exec('DELETE FROM blobs');

    const issued: string[] = [];
    const db = adapt(raw, issued);
    const connection = { db } as unknown as SqliteConnectionService;
    const logger = createMockLogger();
    return {
      raw,
      issued,
      reclaimer: new SqlitePageReclaimer(logger, connection),
      logger,
    };
  }

  it('reads page stats matching the pragmas', () => {
    const { raw, reclaimer } = seedFreelist('INCREMENTAL');
    const stats = reclaimer.readPageStats();
    expect(stats).toEqual({
      pageSize: simple(raw, 'page_size'),
      pageCount: simple(raw, 'page_count'),
      freelistCount: simple(raw, 'freelist_count'),
      autoVacuumMode: 2,
    });
    expect(stats.freelistCount).toBeGreaterThan(64);
  });

  it('reclaimStep(64) reduces page_count by exactly the pages it reports', () => {
    const { raw, reclaimer } = seedFreelist('INCREMENTAL');
    const pageCountBefore = simple(raw, 'page_count');
    const freelistBefore = simple(raw, 'freelist_count');

    const result = reclaimer.reclaimStep(64);

    expect(result.pagesReclaimed).toBe(64);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(pageCountBefore - simple(raw, 'page_count')).toBe(
      result.pagesReclaimed,
    );
    expect(freelistBefore - simple(raw, 'freelist_count')).toBe(64);
  });

  it('never asks for more pages than the freelist holds', () => {
    const { raw, issued, reclaimer } = seedFreelist('INCREMENTAL');
    const freelist = simple(raw, 'freelist_count');

    const result = reclaimer.reclaimStep(65_536);

    expect(issued).toContain(`incremental_vacuum(${freelist})`);
    expect(result.pagesReclaimed).toBe(freelist);
    expect(simple(raw, 'freelist_count')).toBe(0);
    // An empty freelist is a no-op step, not a failure.
    expect(reclaimer.reclaimStep(64).pagesReclaimed).toBe(0);
  });

  it('reports 0 on a mode-0 (auto_vacuum NONE) file and does not throw', () => {
    const { raw, issued, reclaimer } = seedFreelist('NONE');
    const pageCountBefore = simple(raw, 'page_count');
    expect(reclaimer.readPageStats().autoVacuumMode).toBe(0);

    expect(() => reclaimer.reclaimStep(64)).not.toThrow();
    expect(reclaimer.reclaimStep(64).pagesReclaimed).toBe(0);
    expect(issued.some((s) => /incremental_vacuum/i.test(s))).toBe(false);
    expect(simple(raw, 'page_count')).toBe(pageCountBefore);
  });

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9, -5, 65_537])(
    'refuses maxPages=%p without executing any SQL',
    (maxPages) => {
      const { raw, issued, reclaimer } = seedFreelist('INCREMENTAL');
      const pageCountBefore = simple(raw, 'page_count');

      const result = reclaimer.reclaimStep(maxPages);

      expect(result).toEqual({ pagesReclaimed: 0, durationMs: 0 });
      expect(issued).toEqual([]);
      expect(simple(raw, 'page_count')).toBe(pageCountBefore);
    },
  );

  it('reclaims nothing while a transaction is open on the connection', () => {
    const { raw, issued, reclaimer } = seedFreelist('INCREMENTAL');
    raw.exec('BEGIN');
    try {
      expect(reclaimer.reclaimStep(64)).toEqual({
        pagesReclaimed: 0,
        durationMs: 0,
      });
      expect(issued.some((s) => /incremental_vacuum/i.test(s))).toBe(false);
    } finally {
      raw.exec('ROLLBACK');
    }
  });

  it('checkpointPassive issues a PASSIVE checkpoint and does not throw', () => {
    const { raw, issued, reclaimer } = seedFreelist('INCREMENTAL');
    raw.exec('PRAGMA journal_mode = WAL');
    expect(() => reclaimer.checkpointPassive()).not.toThrow();
    expect(issued).toEqual(['wal_checkpoint(PASSIVE)']);
  });

  it('never issues a full VACUUM statement', () => {
    const { issued, reclaimer } = seedFreelist('INCREMENTAL');
    reclaimer.readPageStats();
    reclaimer.reclaimStep(128);
    reclaimer.checkpointPassive();

    expect(issued.length).toBeGreaterThan(0);
    for (const statement of issued) {
      expect(statement).not.toMatch(/^\s*VACUUM\b/i);
    }
    // The source carries no VACUUM statement literal either.
    const source = fs.readFileSync(
      path.join(__dirname, 'sqlite-page-reclaimer.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/['"`]\s*VACUUM\b/i);
  });
});

describe('SqlitePageReclaimer — degraded connection', () => {
  function closedConnection(): SqliteConnectionService {
    return {
      get db(): SqliteDatabase {
        throw new RpcUserError(
          'Database is not open',
          'PERSISTENCE_UNAVAILABLE',
        );
      },
    } as unknown as SqliteConnectionService;
  }

  it('returns zeros for every method when the connection is closed', () => {
    const reclaimer = new SqlitePageReclaimer(
      createMockLogger(),
      closedConnection(),
    );
    expect(reclaimer.readPageStats()).toEqual({
      pageSize: 0,
      pageCount: 0,
      freelistCount: 0,
      autoVacuumMode: 0,
    });
    expect(reclaimer.reclaimStep(64)).toEqual({
      pagesReclaimed: 0,
      durationMs: 0,
    });
    expect(() => reclaimer.checkpointPassive()).not.toThrow();
  });

  it('returns 0 and logs a warn when the pragma throws (e.g. SQLITE_BUSY)', () => {
    const logger = createMockLogger();
    const db = {
      inTransaction: false,
      pragma: (text: string) => {
        if (text.startsWith('incremental_vacuum')) {
          throw Object.assign(new Error('database is locked'), {
            code: 'SQLITE_BUSY',
          });
        }
        if (text === 'auto_vacuum') return 2;
        if (text === 'freelist_count') return 500;
        return 4096;
      },
    };
    const reclaimer = new SqlitePageReclaimer(logger, {
      db,
    } as unknown as SqliteConnectionService);

    const result = reclaimer.reclaimStep(64);

    expect(result.pagesReclaimed).toBe(0);
    expect(logger.entries.some((e) => e.level === 'warn')).toBe(true);
  });
});

describe('registerPersistenceSqliteServices — page reclaimer reach', () => {
  it('registers SQLITE_PAGE_RECLAIMER as a singleton SqlitePageReclaimer', () => {
    const child = container.createChildContainer();
    const logger = createMockLogger();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-reclaimer-di-'));
    try {
      child.register(TOKENS.LOGGER, { useValue: logger });
      // Never opened: the connection stays closed, so resolving the graph
      // touches no file at this path.
      child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
        useValue: path.join(dir, 'never-opened.sqlite'),
      });

      registerPersistenceSqliteServices(child, logger);

      expect(child.isRegistered(PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER)).toBe(
        true,
      );
      const first = child.resolve<SqlitePageReclaimer>(
        PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER,
      );
      expect(first).toBeInstanceOf(SqlitePageReclaimer);
      expect(child.resolve(PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER)).toBe(
        first,
      );
      // Wired to the real, unopened connection: degrades to zeros.
      expect(first.readPageStats().pageCount).toBe(0);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      child.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
