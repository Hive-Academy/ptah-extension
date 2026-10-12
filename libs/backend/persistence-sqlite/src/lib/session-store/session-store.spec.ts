import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionRecord } from '@ptah-extension/platform-core';
import type { SqliteDatabase } from '../sqlite-connection.service';
import { resolveSessionStoreDbPath } from './session-store-db-path';
import { SessionStoreDatabase } from './session-store-database';
import { SqliteSessionRecordRepository } from './sqlite-session-record-repository';
import { SESSION_STORE_MIGRATIONS } from './session-store-migrations';

interface RawDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

/** Real better-sqlite3 when it loads under Jest, else node:sqlite. */
function resolveFactory(): ((file: string) => SqliteDatabase) | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => RawDatabase;
    new Database(':memory:').close();
    return (file) => new Database(file) as unknown as SqliteDatabase;
  } catch {
    // Electron's native ABI may not load in Jest.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => RawDatabase;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file) as unknown as SqliteDatabase;
  } catch {
    return null;
  }
}

const factory = resolveFactory();
const describeDb = factory ? describe : describe.skip;
/** Only called inside describeDb, which is skipped when no driver loads. */
const openDb = (file: string): SqliteDatabase => {
  if (!factory) throw new Error('no SQLite driver');
  return factory(file);
};

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const sessionId =
    overrides.sessionId ?? '11111111-1111-4111-8111-111111111111';
  return {
    sessionId,
    workspacePath: '/work/alpha',
    host: 'electron',
    name: 'Session',
    createdAt: 1000,
    lastActiveAt: 2000,
    isChild: false,
    summary: { sessionId, name: 'Session' },
    detail: { sessionId, name: 'Session', workingDirectory: '/work/alpha' },
    ...overrides,
  };
}

describe('resolveSessionStoreDbPath', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('uses a file of its own next to ptah.sqlite, per profile', () => {
    delete process.env['PTAH_SESSIONS_DB_PATH'];
    const state = path.join(os.homedir(), '.ptah', 'state');
    expect(resolveSessionStoreDbPath({ isDev: false })).toBe(
      path.join(state, 'sessions.sqlite'),
    );
    expect(resolveSessionStoreDbPath({ isDev: true })).toBe(
      path.join(state, 'sessions-dev.sqlite'),
    );
  });

  it('honours PTAH_SESSIONS_DB_PATH over everything', () => {
    process.env['PTAH_SESSIONS_DB_PATH'] = ' /tmp/x/sessions-e2e.sqlite ';
    expect(resolveSessionStoreDbPath({ isDev: true })).toBe(
      path.resolve('/tmp/x/sessions-e2e.sqlite'),
    );
  });
});

describeDb('SessionStoreDatabase', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-session-store-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates its own file and ledger, and opening twice is a no-op', async () => {
    const file = path.join(dir, 'nested', 'sessions.sqlite');
    const store = new SessionStoreDatabase(file, logger, openDb);
    const db = await store.ready();
    await store.ready();

    expect(fs.existsSync(file)).toBe(true);
    const versions = (
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as {
        version: number;
      }[]
    ).map((r) => r.version);
    expect(versions).toEqual(SESSION_STORE_MIGRATIONS.map((m) => m.version));
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(['sessions', 'session_migration_sources']),
    );
    store.close();
  });

  it('is independent of ptah.sqlite: a newer main schema does not block it', async () => {
    const main = openDb(path.join(dir, 'ptah.sqlite'));
    main.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER);' +
        "INSERT INTO schema_migrations VALUES (999, 'from_a_newer_build', 0);",
    );
    (main as unknown as RawDatabase).close();

    const store = new SessionStoreDatabase(
      path.join(dir, 'sessions.sqlite'),
      logger,
      openDb,
    );
    await expect(store.ready()).resolves.toBeDefined();
    store.close();
  });
});

describeDb('SqliteSessionRecordRepository', () => {
  let dir: string;
  let store: SessionStoreDatabase;
  let electron: SqliteSessionRecordRepository;
  let cli: SqliteSessionRecordRepository;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-session-repo-'));
    store = new SessionStoreDatabase(
      path.join(dir, 'sessions.sqlite'),
      logger,
      openDb,
    );
    electron = new SqliteSessionRecordRepository(store, 'electron');
    cli = new SqliteSessionRecordRepository(store, 'cli');
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a record by id and replaces it on upsert', async () => {
    const first = record();
    await electron.upsert(first);
    expect(await electron.get(first.sessionId)).toEqual(first);

    const renamed = record({
      name: 'Renamed',
      lastActiveAt: 3000,
      detail: { sessionId: first.sessionId, name: 'Renamed' },
    });
    await electron.upsert(renamed);
    expect(await electron.get(first.sessionId)).toEqual(renamed);
  });

  it('returns null for an unknown id and forgets a deleted one', async () => {
    expect(
      await electron.get('22222222-2222-4222-8222-222222222222'),
    ).toBeNull();
    const r = record();
    await electron.upsert(r);
    await electron.delete(r.sessionId);
    expect(await electron.get(r.sessionId)).toBeNull();
  });

  it('lists one project newest first, whatever spelling the path has', async () => {
    await electron.upsert(
      record({
        sessionId: 'a-old',
        workspacePath: '/work/alpha',
        lastActiveAt: 10,
      }),
    );
    await electron.upsert(
      record({
        sessionId: 'a-new',
        workspacePath: '/work/alpha/',
        lastActiveAt: 30,
      }),
    );
    await electron.upsert(
      record({ sessionId: 'b', workspacePath: '/work/beta', lastActiveAt: 20 }),
    );

    const alpha = await electron.listForWorkspace('/work/alpha//');
    expect(alpha.map((r) => r.sessionId)).toEqual(['a-new', 'a-old']);
    const all = await electron.listAll();
    expect(all.map((r) => r.sessionId)).toEqual(['a-new', 'b', 'a-old']);
  });

  it('hides child sessions unless asked', async () => {
    await electron.upsert(record({ sessionId: 'parent' }));
    await electron.upsert(record({ sessionId: 'child', isChild: true }));
    expect(
      (await electron.listForWorkspace('/work/alpha')).map((r) => r.sessionId),
    ).toEqual(['parent']);
    expect(
      (
        await electron.listForWorkspace('/work/alpha', {
          includeChildren: true,
        })
      ).length,
    ).toBe(2);
  });

  it('stamps its own host, lists only that host, and reads any host by id', async () => {
    await electron.upsert(record({ sessionId: 'desk', host: 'cli' }));
    expect((await electron.get('desk'))?.host).toBe('electron');
    await cli.upsert(record({ sessionId: 'term', host: 'cli' }));
    expect((await electron.get('term'))?.host).toBe('cli');

    expect((await electron.listAll()).map((r) => r.sessionId)).toEqual([
      'desk',
    ]);
    expect((await cli.listAll()).map((r) => r.sessionId)).toEqual(['term']);
    expect(await electron.get('term')).not.toBeNull();
  });

  it('keeps migration receipts per host, source and fingerprint', async () => {
    expect(await electron.hasMigrationSource('/ws/a', 'f1')).toBe(false);
    await electron.recordMigrationSource('/ws/a', 'f1', 3);
    await electron.recordMigrationSource('/ws/a', 'f1', 3);
    expect(await electron.hasMigrationSource('/ws/a', 'f1')).toBe(true);
    expect(await electron.hasMigrationSource('/ws/a', 'f2')).toBe(false);
    expect(await cli.hasMigrationSource('/ws/a', 'f1')).toBe(false);
  });

  it('keeps a projectless session out of project lists but in listAll', async () => {
    await electron.upsert(
      record({ sessionId: 'orchestrator', workspacePath: null }),
    );
    expect(await electron.listForWorkspace('/work/alpha')).toEqual([]);
    expect((await electron.listAll()).map((r) => r.sessionId)).toEqual([
      'orchestrator',
    ]);
  });
});
