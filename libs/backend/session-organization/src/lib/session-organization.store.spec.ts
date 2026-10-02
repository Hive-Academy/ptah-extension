/**
 * SessionOrganizationStore — contract spec on real SQLite.
 *
 * Every test opens an isolated `:memory:` database and applies the shipped
 * migrations 1..50 in order, so the store runs against the exact schema of
 * migration 0050 (partial unique primary index included). better-sqlite3 is
 * tried first; when its native ABI cannot load under Jest, Node's built-in
 * `node:sqlite` (same engine) is used, with `transaction` supplied the way
 * better-sqlite3 provides it. When NEITHER loads, the suite FAILS — it never
 * skips.
 */
import 'reflect-metadata';
import {
  MIGRATIONS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import { SessionOrganizationStore } from './session-organization.store';

interface TestStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): TestStatement;
  close(): void;
  transaction?: (fn: (...args: unknown[]) => unknown) => unknown;
}

type DbOpener = () => TestDatabase;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => TestDatabase;
    new Database(':memory:').close();
    return () => new Database(':memory:');
  } catch {
    // Electron's native ABI may not load in Jest; fall through to node:sqlite.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => TestDatabase;
    };
    new DatabaseSync(':memory:').close();
    return () => new DatabaseSync(':memory:');
  } catch {
    return null;
  }
}

/** better-sqlite3's `transaction` for the node:sqlite binding, which lacks it. */
function withTransaction(db: TestDatabase): TestDatabase {
  if (typeof db.transaction === 'function') return db;
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
    transaction:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        db.exec('BEGIN');
        try {
          const out = fn(...args);
          db.exec('COMMIT');
          return out;
        } catch (error: unknown) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
  };
}

const opener = resolveOpener();

const WS = 'd:/projects/ws-a';
const WS_B = 'd:/projects/ws-b';
const OLD = '0d6f1c2a-1111-4a6b-8c1d-000000000001';
const NEW = '0d6f1c2a-2222-4a6b-8c1d-000000000002';
const CHILD = '0d6f1c2a-3333-4a6b-8c1d-000000000003';

interface Harness {
  db: TestDatabase;
  store: SessionOrganizationStore;
  output: { appendLine: jest.Mock };
  connection: {
    db: TestDatabase;
    isOpen: boolean;
    lastMigrationVersion: number;
    onDidOpen: jest.Mock;
  };
}

const openDbs: TestDatabase[] = [];

function makeHarness(): Harness {
  if (!opener) {
    throw new Error(
      'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
    );
  }
  const db = withTransaction(opener());
  openDbs.push(db);
  for (const migration of MIGRATIONS.filter((m) => m.version <= 50)) {
    if (migration.sql) db.exec(migration.sql);
  }
  const connection = {
    db,
    isOpen: true,
    lastMigrationVersion: 50,
    onDidOpen: jest.fn(() => ({ dispose: jest.fn() })),
  };
  const output = { appendLine: jest.fn() };
  const store = new SessionOrganizationStore(
    connection as unknown as SqliteConnectionService,
    output as unknown as IOutputChannel,
  );
  return { db, store, output, connection };
}

function rows(db: TestDatabase, sql: string, ...params: unknown[]): unknown[] {
  return db
    .prepare(sql)
    .all(...params)
    .map((r) => ({ ...(r as object) }));
}

function primaries(db: TestDatabase, root: string, sessionId: string) {
  return rows(
    db,
    `SELECT task_id FROM session_task_links
      WHERE workspace_root = ? AND session_id = ? AND role = 'primary'`,
    root,
    sessionId,
  );
}

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close();
});

describe('SessionOrganizationStore (real SQLite, migrations 1..50)', () => {
  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  it('applies migration 0050 in the harness', () => {
    expect(MIGRATIONS.some((m) => m.version === 50)).toBe(true);
    const { db } = makeHarness();
    expect(
      rows(
        db,
        `SELECT name FROM sqlite_master WHERE name = 'ux_session_task_links_primary'`,
      ),
    ).toEqual([{ name: 'ux_session_task_links_primary' }]);
  });

  describe('isReady', () => {
    it('reads connection.isOpen live on every call', () => {
      const { store, connection } = makeHarness();
      expect(store.isReady()).toBe(true);
      connection.isOpen = false;
      expect(store.isReady()).toBe(false);
      connection.isOpen = true;
      expect(store.isReady()).toBe(true);
    });

    it('is not ready while the connection is open but its migration run has not finished (F1)', () => {
      // `openAndMigrate` assigns the handle (isOpen true) before the runner
      // applies anything and may await a pre-migration backup in between; a
      // read there hit "no such table" on a database without 0050 yet.
      const { store, connection } = makeHarness();
      connection.lastMigrationVersion = 0;
      expect(store.isReady()).toBe(false);
      connection.lastMigrationVersion = 50;
      expect(store.isReady()).toBe(true);
    });
  });

  describe('onDidOpen', () => {
    it('forwards the subscription to the connection and returns its disposable', () => {
      const { store, connection } = makeHarness();
      const listener = jest.fn();
      const handle = store.onDidOpen(listener);
      expect(connection.onDidOpen).toHaveBeenCalledWith(listener);
      expect(handle).toBe(connection.onDidOpen.mock.results[0].value);
    });
  });

  describe('upsertOrganization + listWorkspace', () => {
    it('returns an empty map for a workspace with no rows', () => {
      const { store } = makeHarness();
      expect(store.listWorkspace(WS).size).toBe(0);
    });

    it('creates the row lazily with defaults and changes only patched columns', () => {
      const { store } = makeHarness();
      store.upsertOrganization(WS, 's1', { priority: 'urgent' }, 1_000);

      expect(store.listWorkspace(WS).get('s1')).toEqual({
        sessionId: 's1',
        priority: 'urgent',
        status: 'active',
        pinned: false,
        worktreePath: null,
        branch: null,
        parentSessionId: null,
        forkOfSessionId: null,
        startedBy: 'user',
        updatedAt: 1_000,
        tasks: [],
        prLinks: [],
      });

      store.upsertOrganization(
        WS,
        's1',
        {
          status: 'in_review',
          pinned: true,
          worktreePath: '/wt/a',
          branch: 'b',
        },
        2_000,
      );
      const second = store.listWorkspace(WS).get('s1');
      expect(second).toMatchObject({
        priority: 'urgent',
        status: 'in_review',
        pinned: true,
        worktreePath: '/wt/a',
        branch: 'b',
        updatedAt: 2_000,
      });

      store.upsertOrganization(
        WS,
        's1',
        { worktreePath: null, pinned: false, startedBy: 'agent' },
        3_000,
      );
      expect(store.listWorkspace(WS).get('s1')).toMatchObject({
        priority: 'urgent',
        status: 'in_review',
        pinned: false,
        worktreePath: null,
        branch: 'b',
        startedBy: 'agent',
        updatedAt: 3_000,
      });
    });

    it('scopes rows by workspace root', () => {
      const { store } = makeHarness();
      store.upsertOrganization(WS, 's1', { priority: 'high' }, 1);
      store.upsertOrganization(WS_B, 's1', { priority: 'low' }, 1);
      expect(store.listWorkspace(WS).get('s1')?.priority).toBe('high');
      expect(store.listWorkspace(WS_B).get('s1')?.priority).toBe('low');
    });

    it('reads a session with only link rows as defaults with updatedAt null', () => {
      const { db, store } = makeHarness();
      db.prepare(
        `INSERT INTO session_task_links
           (workspace_root, session_id, task_id, role, source, created_at)
         VALUES (?, 'orphan', 'TASK_2026_001', 'related', 'user', 5)`,
      ).run(WS);
      expect(store.listWorkspace(WS).get('orphan')).toEqual({
        sessionId: 'orphan',
        priority: 'normal',
        status: 'active',
        pinned: false,
        worktreePath: null,
        branch: null,
        parentSessionId: null,
        forkOfSessionId: null,
        startedBy: 'user',
        updatedAt: null,
        tasks: [
          {
            taskId: 'TASK_2026_001',
            role: 'related',
            source: 'user',
            createdAt: 5,
          },
        ],
        prLinks: [],
      });
    });
  });

  describe('linkTask / unlinkTask / listTaskLinks', () => {
    it('links a task, creating the organization row lazily', () => {
      const { store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'TASK_2026_001', role: 'related', source: 'user' },
        10,
      );
      const org = store.listWorkspace(WS).get('s1');
      expect(org?.updatedAt).toBe(10);
      expect(org?.tasks).toEqual([
        {
          taskId: 'TASK_2026_001',
          role: 'related',
          source: 'user',
          createdAt: 10,
        },
      ]);
    });

    it('a new primary demotes the existing different primary in one transaction (L2)', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'TASK_2026_001', role: 'primary', source: 'board-start' },
        10,
      );
      store.linkTask(
        WS,
        's1',
        { taskId: 'TASK_2026_002', role: 'primary', source: 'user' },
        20,
      );

      expect(primaries(db, WS, 's1')).toEqual([{ task_id: 'TASK_2026_002' }]);
      const tasks = store.listWorkspace(WS).get('s1')?.tasks;
      expect(tasks).toEqual([
        {
          taskId: 'TASK_2026_001',
          role: 'related',
          source: 'board-start',
          createdAt: 10,
        },
        {
          taskId: 'TASK_2026_002',
          role: 'primary',
          source: 'user',
          createdAt: 20,
        },
      ]);
    });

    it('promotes an existing related link to primary, demoting the old primary', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        's1',
        { taskId: 'T2', role: 'related', source: 'agent' },
        2,
      );
      store.linkTask(
        WS,
        's1',
        { taskId: 'T2', role: 'primary', source: 'user' },
        3,
      );

      expect(primaries(db, WS, 's1')).toEqual([{ task_id: 'T2' }]);
      const t2 = store
        .listWorkspace(WS)
        .get('s1')
        ?.tasks.find((t) => t.taskId === 'T2');
      // The original created_at is kept on a re-link.
      expect(t2).toEqual({
        taskId: 'T2',
        role: 'primary',
        source: 'user',
        createdAt: 2,
      });
    });

    it('re-linking the current primary as primary keeps a single primary', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'agent' },
        2,
      );
      expect(primaries(db, WS, 's1')).toEqual([{ task_id: 'T1' }]);
    });

    it('another session keeps its own primary', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        's2',
        { taskId: 'T2', role: 'primary', source: 'user' },
        1,
      );
      expect(primaries(db, WS, 's1')).toEqual([{ task_id: 'T1' }]);
      expect(primaries(db, WS, 's2')).toEqual([{ task_id: 'T2' }]);
    });

    it('rolls back the demotion when the new primary upsert fails', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      db.exec(`
        CREATE TRIGGER fail_link_insert BEFORE INSERT ON session_task_links
        WHEN NEW.task_id = 'T2'
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
      `);

      expect(() =>
        store.linkTask(
          WS,
          's1',
          { taskId: 'T2', role: 'primary', source: 'user' },
          2,
        ),
      ).toThrow(/forced failure/);

      expect(primaries(db, WS, 's1')).toEqual([{ task_id: 'T1' }]);
      const org = store.listWorkspace(WS).get('s1');
      expect(org?.tasks).toEqual([
        { taskId: 'T1', role: 'primary', source: 'user', createdAt: 1 },
      ]);
      expect(org?.updatedAt).toBe(1);
    });

    it('unlinkTask removes one link and reports whether it did', () => {
      const { store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'related', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        's1',
        { taskId: 'T2', role: 'related', source: 'user' },
        1,
      );

      expect(store.unlinkTask(WS, 's1', 'T1', 50)).toBe(true);
      expect(store.unlinkTask(WS, 's1', 'T1', 60)).toBe(false);
      const org = store.listWorkspace(WS).get('s1');
      expect(org?.tasks.map((t) => t.taskId)).toEqual(['T2']);
      expect(org?.updatedAt).toBe(50);
    });

    it('listTaskLinks returns all links, or only those for the given task ids', () => {
      const { store } = makeHarness();
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        's2',
        { taskId: 'T1', role: 'related', source: 'agent' },
        2,
      );
      store.linkTask(
        WS,
        's2',
        { taskId: 'T2', role: 'primary', source: 'board-start' },
        3,
      );
      store.linkTask(
        WS_B,
        's9',
        { taskId: 'T1', role: 'primary', source: 'user' },
        4,
      );

      expect(store.listTaskLinks(WS)).toHaveLength(3);
      expect(store.listTaskLinks(WS, ['T1'])).toEqual([
        {
          sessionId: 's1',
          taskId: 'T1',
          role: 'primary',
          source: 'user',
          createdAt: 1,
        },
        {
          sessionId: 's2',
          taskId: 'T1',
          role: 'related',
          source: 'agent',
          createdAt: 2,
        },
      ]);
      expect(store.listTaskLinks(WS, ['T2', 'T-unknown'])).toEqual([
        {
          sessionId: 's2',
          taskId: 'T2',
          role: 'primary',
          source: 'board-start',
          createdAt: 3,
        },
      ]);
      expect(store.listTaskLinks(WS, [])).toEqual([]);
    });

    it('binds a task id containing SQL syntax as a value', () => {
      const { store } = makeHarness();
      const hostile = `T1') OR 1=1 --`;
      store.linkTask(
        WS,
        's1',
        { taskId: hostile, role: 'related', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        's1',
        { taskId: 'T2', role: 'related', source: 'user' },
        1,
      );
      expect(store.listTaskLinks(WS, [hostile]).map((l) => l.taskId)).toEqual([
        hostile,
      ]);
    });
  });

  describe('addPrLink / removePrLink', () => {
    const URL_A = 'https://github.com/acme/app/pull/7';

    it('stores the URL exactly as received and keys on it', () => {
      const { store } = makeHarness();
      store.addPrLink(
        WS,
        's1',
        {
          url: URL_A,
          number: 7,
          repo: 'acme/app',
          state: 'open',
          source: 'agent',
        },
        10,
      );
      // A different spelling is a different key: normalization is the service's job.
      store.addPrLink(
        WS,
        's1',
        {
          url: `${URL_A}/`,
          number: null,
          repo: null,
          state: null,
          source: 'user',
        },
        11,
      );
      const org = store.listWorkspace(WS).get('s1');
      expect(org?.updatedAt).toBe(11);
      expect(org?.prLinks).toEqual([
        {
          url: URL_A,
          number: 7,
          repo: 'acme/app',
          state: 'open',
          source: 'agent',
          createdAt: 10,
        },
        {
          url: `${URL_A}/`,
          number: null,
          repo: null,
          state: null,
          source: 'user',
          createdAt: 11,
        },
      ]);
    });

    it('upserts by url: keeps source and createdAt, refreshes known fields', () => {
      const { store } = makeHarness();
      store.addPrLink(
        WS,
        's1',
        {
          url: URL_A,
          number: 7,
          repo: 'acme/app',
          state: 'draft',
          source: 'agent',
        },
        10,
      );
      store.addPrLink(
        WS,
        's1',
        {
          url: URL_A,
          number: 7,
          repo: 'acme/app',
          state: 'open',
          source: 'user',
        },
        20,
      );
      store.addPrLink(
        WS,
        's1',
        { url: URL_A, number: null, repo: null, state: null, source: 'user' },
        30,
      );
      expect(store.listWorkspace(WS).get('s1')?.prLinks).toEqual([
        {
          url: URL_A,
          number: 7,
          repo: 'acme/app',
          state: 'open',
          source: 'agent',
          createdAt: 10,
        },
      ]);
    });

    it('removePrLink removes by exact url and reports whether it did', () => {
      const { store } = makeHarness();
      store.addPrLink(
        WS,
        's1',
        {
          url: URL_A,
          number: 7,
          repo: 'acme/app',
          state: 'open',
          source: 'user',
        },
        10,
      );
      expect(store.removePrLink(WS, 's1', `${URL_A}/`, 20)).toBe(false);
      expect(store.removePrLink(WS, 's1', URL_A, 30)).toBe(true);
      const org = store.listWorkspace(WS).get('s1');
      expect(org?.prLinks).toEqual([]);
      expect(org?.updatedAt).toBe(30);
    });
  });

  describe('recordAgentStartedSession', () => {
    it('records agent start, worktree, branch, parent and the primary task in one call', () => {
      const { store } = makeHarness();
      store.recordAgentStartedSession(
        {
          sessionId: CHILD,
          workspaceRoot: WS,
          parentSessionId: OLD,
          worktreePath: '/wt/child',
          branch: 'feat/child',
          taskId: 'TASK_2026_010',
        },
        100,
      );
      expect(store.listWorkspace(WS).get(CHILD)).toEqual({
        sessionId: CHILD,
        priority: 'normal',
        status: 'active',
        pinned: false,
        worktreePath: '/wt/child',
        branch: 'feat/child',
        parentSessionId: OLD,
        forkOfSessionId: null,
        startedBy: 'agent',
        updatedAt: 100,
        tasks: [
          {
            taskId: 'TASK_2026_010',
            role: 'primary',
            source: 'agent',
            createdAt: 100,
          },
        ],
        prLinks: [],
      });
    });

    it('demotes an existing primary and keeps user-set columns', () => {
      const { db, store } = makeHarness();
      store.upsertOrganization(
        WS,
        CHILD,
        { priority: 'high', parentSessionId: 'p0' },
        1,
      );
      store.linkTask(
        WS,
        CHILD,
        { taskId: 'T-old', role: 'primary', source: 'user' },
        1,
      );
      store.recordAgentStartedSession(
        {
          sessionId: CHILD,
          workspaceRoot: WS,
          worktreePath: '/wt/child',
          branch: 'feat/child',
          taskId: 'T-new',
        },
        2,
      );
      expect(primaries(db, WS, CHILD)).toEqual([{ task_id: 'T-new' }]);
      expect(store.listWorkspace(WS).get(CHILD)).toMatchObject({
        priority: 'high',
        parentSessionId: 'p0',
        startedBy: 'agent',
      });
    });

    it('records no task link when no task id is given', () => {
      const { store } = makeHarness();
      store.recordAgentStartedSession(
        {
          sessionId: CHILD,
          workspaceRoot: WS,
          worktreePath: '/wt',
          branch: 'b',
        },
        5,
      );
      const org = store.listWorkspace(WS).get(CHILD);
      expect(org?.tasks).toEqual([]);
      expect(org?.parentSessionId).toBeNull();
    });
  });

  describe('deleteSession', () => {
    function seed(store: SessionOrganizationStore): void {
      store.upsertOrganization(WS, 's1', { priority: 'high' }, 1);
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.addPrLink(
        WS,
        's1',
        {
          url: 'https://example.com/pr/1',
          number: null,
          repo: null,
          state: null,
          source: 'user',
        },
        1,
      );
      store.upsertOrganization(WS, 's2', { parentSessionId: 's1' }, 1);
      store.upsertOrganization(WS_B, 's1', { priority: 'low' }, 1);
    }

    it('removes the session from all three tables of that workspace only', () => {
      const { store } = makeHarness();
      seed(store);

      expect(store.deleteSession(WS, 's1')).toBe(true);
      const ws = store.listWorkspace(WS);
      expect(ws.has('s1')).toBe(false);
      expect(store.listTaskLinks(WS)).toEqual([]);
      // The child keeps its lineage; the other workspace is untouched.
      expect(ws.get('s2')?.parentSessionId).toBe('s1');
      expect(store.listWorkspace(WS_B).get('s1')?.priority).toBe('low');

      expect(store.deleteSession(WS, 's1')).toBe(false);
    });

    it('rolls back every table when a statement in the transaction fails', () => {
      const { db, store } = makeHarness();
      seed(store);
      db.exec(`
        CREATE TRIGGER fail_org_delete BEFORE DELETE ON session_organization
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
      `);

      expect(() => store.deleteSession(WS, 's1')).toThrow(/forced failure/);
      const org = store.listWorkspace(WS).get('s1');
      expect(org?.tasks.map((t) => t.taskId)).toEqual(['T1']);
      expect(org?.prLinks).toHaveLength(1);
      expect(org?.updatedAt).toBe(1);
    });
  });

  describe('countChildren', () => {
    it('counts sessions per parent id in one workspace', () => {
      const { store } = makeHarness();
      store.upsertOrganization(WS, 'c1', { parentSessionId: 'p1' }, 1);
      store.upsertOrganization(WS, 'c2', { parentSessionId: 'p1' }, 1);
      store.upsertOrganization(WS, 'c3', { parentSessionId: 'p2' }, 1);
      store.upsertOrganization(WS, 'p1', { priority: 'high' }, 1);
      store.upsertOrganization(WS_B, 'c4', { parentSessionId: 'p1' }, 1);

      expect(store.countChildren(WS)).toEqual(
        new Map([
          ['p1', 2],
          ['p2', 1],
        ]),
      );
      expect(store.countChildren('d:/projects/empty').size).toBe(0);
    });
  });

  describe('tolerant read (L1)', () => {
    it('maps unknown enum values to defaults and logs one line per list call', () => {
      const { db, store, output } = makeHarness();
      db.prepare(
        `INSERT INTO session_organization
           (workspace_root, session_id, priority, status, pinned, started_by, updated_at)
         VALUES (?, 's1', 'critical', 'paused', 1, 'robot', 7)`,
      ).run(WS);
      db.prepare(
        `INSERT INTO session_task_links
           (workspace_root, session_id, task_id, role, source, created_at)
         VALUES (?, 's1', 'T1', 'owner', 'import', 8)`,
      ).run(WS);
      db.prepare(
        `INSERT INTO session_pr_links
           (workspace_root, session_id, url, number, repo, state, source, created_at)
         VALUES (?, 's1', 'https://example.com/pr/1', NULL, NULL, 'queued', 'bot', 9)`,
      ).run(WS);

      expect(store.listWorkspace(WS).get('s1')).toEqual({
        sessionId: 's1',
        priority: 'normal',
        status: 'active',
        pinned: true,
        worktreePath: null,
        branch: null,
        parentSessionId: null,
        forkOfSessionId: null,
        startedBy: 'user',
        updatedAt: 7,
        tasks: [
          { taskId: 'T1', role: 'related', source: 'user', createdAt: 8 },
        ],
        prLinks: [
          {
            url: 'https://example.com/pr/1',
            number: null,
            repo: null,
            state: null,
            source: 'user',
            createdAt: 9,
          },
        ],
      });
      expect(output.appendLine).toHaveBeenCalledTimes(1);
      expect(output.appendLine.mock.calls[0][0]).toMatch(
        /^\[SessionOrganization\] listWorkspace: 7 unknown enum value\(s\)/,
      );

      expect(store.listTaskLinks(WS)).toEqual([
        {
          sessionId: 's1',
          taskId: 'T1',
          role: 'related',
          source: 'user',
          createdAt: 8,
        },
      ]);
      expect(output.appendLine).toHaveBeenCalledTimes(2);
    });

    it('logs nothing when every value is known', () => {
      const { store, output } = makeHarness();
      store.upsertOrganization(WS, 's1', { status: 'done' }, 1);
      store.linkTask(
        WS,
        's1',
        { taskId: 'T1', role: 'primary', source: 'agent' },
        1,
      );
      store.listWorkspace(WS);
      store.listTaskLinks(WS);
      expect(output.appendLine).not.toHaveBeenCalled();
    });
  });

  describe('rekeySession', () => {
    it('moves organization, task links and PR links in every workspace', () => {
      const { store, output } = makeHarness();
      store.upsertOrganization(
        WS,
        OLD,
        { priority: 'urgent', pinned: true },
        1,
      );
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T1', role: 'primary', source: 'board-start' },
        2,
      );
      store.addPrLink(
        WS,
        OLD,
        {
          url: 'https://github.com/acme/app/pull/1',
          number: 1,
          repo: 'acme/app',
          state: 'open',
          source: 'agent',
        },
        3,
      );
      store.linkTask(
        WS_B,
        OLD,
        { taskId: 'T9', role: 'related', source: 'user' },
        4,
      );

      expect(store.rekeySession(OLD, NEW)).toEqual([WS, WS_B]);

      const ws = store.listWorkspace(WS);
      expect(ws.has(OLD)).toBe(false);
      expect(ws.get(NEW)).toMatchObject({
        sessionId: NEW,
        priority: 'urgent',
        pinned: true,
        tasks: [
          {
            taskId: 'T1',
            role: 'primary',
            source: 'board-start',
            createdAt: 2,
          },
        ],
        prLinks: [{ url: 'https://github.com/acme/app/pull/1', createdAt: 3 }],
      });
      expect(
        store
          .listWorkspace(WS_B)
          .get(NEW)
          ?.tasks.map((t) => t.taskId),
      ).toEqual(['T9']);
      expect(store.listWorkspace(WS_B).has(OLD)).toBe(false);
      expect(output.appendLine).not.toHaveBeenCalled();
    });

    it('rewrites parent and fork references, and never makes a row point at itself', () => {
      const { store } = makeHarness();
      store.upsertOrganization(WS, OLD, { priority: 'high' }, 1);
      store.upsertOrganization(
        WS,
        CHILD,
        { parentSessionId: OLD, forkOfSessionId: OLD },
        1,
      );
      // Only a reference to OLD exists in WS_B: it is still rewritten.
      store.upsertOrganization(WS_B, 'other', { parentSessionId: OLD }, 1);
      // NEW already points at OLD: after the rekey that would be a self-loop.
      store.upsertOrganization(WS_B, NEW, { forkOfSessionId: OLD }, 1);

      expect(store.rekeySession(OLD, NEW)).toEqual([WS, WS_B]);

      expect(store.listWorkspace(WS).get(CHILD)).toMatchObject({
        parentSessionId: NEW,
        forkOfSessionId: NEW,
      });
      expect(store.listWorkspace(WS_B).get('other')?.parentSessionId).toBe(NEW);
      expect(store.listWorkspace(WS_B).get(NEW)?.forkOfSessionId).toBeNull();
      expect(store.countChildren(WS)).toEqual(new Map([[NEW, 1]]));
    });

    it('conflict: keeps the new row, moves only missing links, drops the rest, logs once', () => {
      const { db, store, output } = makeHarness();
      store.upsertOrganization(
        WS,
        OLD,
        { priority: 'urgent', status: 'waiting' },
        1,
      );
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T-shared', role: 'related', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T-old-primary', role: 'primary', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T-old-only', role: 'related', source: 'agent' },
        1,
      );
      store.addPrLink(
        WS,
        OLD,
        {
          url: 'https://example.com/pr/shared',
          number: null,
          repo: null,
          state: 'draft',
          source: 'agent',
        },
        1,
      );
      store.addPrLink(
        WS,
        OLD,
        {
          url: 'https://example.com/pr/old',
          number: null,
          repo: null,
          state: null,
          source: 'agent',
        },
        1,
      );

      store.upsertOrganization(WS, NEW, { priority: 'low' }, 2);
      store.linkTask(
        WS,
        NEW,
        { taskId: 'T-shared', role: 'related', source: 'board-start' },
        2,
      );
      store.linkTask(
        WS,
        NEW,
        { taskId: 'T-new-primary', role: 'primary', source: 'user' },
        2,
      );
      store.addPrLink(
        WS,
        NEW,
        {
          url: 'https://example.com/pr/shared',
          number: null,
          repo: null,
          state: 'open',
          source: 'user',
        },
        2,
      );

      expect(store.rekeySession(OLD, NEW)).toEqual([WS]);

      const org = store.listWorkspace(WS).get(NEW);
      expect(org).toMatchObject({
        priority: 'low',
        status: 'active',
        updatedAt: 2,
      });
      expect(
        org?.tasks
          .map((t) => [t.taskId, t.role, t.source])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ).toEqual([
        ['T-new-primary', 'primary', 'user'],
        ['T-old-only', 'related', 'agent'],
        ['T-old-primary', 'related', 'user'],
        ['T-shared', 'related', 'board-start'],
      ]);
      expect(primaries(db, WS, NEW)).toEqual([{ task_id: 'T-new-primary' }]);
      expect(
        org?.prLinks.map((p) => [p.url, p.state, p.source]).sort(),
      ).toEqual([
        ['https://example.com/pr/old', null, 'agent'],
        ['https://example.com/pr/shared', 'open', 'user'],
      ]);
      for (const table of [
        'session_organization',
        'session_task_links',
        'session_pr_links',
      ]) {
        expect(
          rows(db, `SELECT session_id FROM ${table} WHERE session_id = ?`, OLD),
        ).toEqual([]);
      }
      expect(output.appendLine).toHaveBeenCalledTimes(1);
      expect(output.appendLine.mock.calls[0][0]).toMatch(
        /^\[SessionOrganization\] rekeySession: /,
      );
    });

    it('moves the old primary when the new id has links but no primary', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        NEW,
        { taskId: 'T2', role: 'related', source: 'user' },
        2,
      );

      store.rekeySession(OLD, NEW);
      expect(primaries(db, WS, NEW)).toEqual([{ task_id: 'T1' }]);
    });

    it('conflict: promotes the new id link of the old primary task when the new id has no primary', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T1', role: 'primary', source: 'board-start' },
        1,
      );
      store.linkTask(
        WS,
        NEW,
        { taskId: 'T1', role: 'related', source: 'agent' },
        5,
      );
      store.linkTask(
        WS,
        NEW,
        { taskId: 'T2', role: 'related', source: 'user' },
        6,
      );

      store.rekeySession(OLD, NEW);

      expect(primaries(db, WS, NEW)).toEqual([{ task_id: 'T1' }]);
      // The new id's own link is kept: its source and created_at survive.
      expect(store.listWorkspace(WS).get(NEW)?.tasks).toEqual([
        { taskId: 'T1', role: 'primary', source: 'agent', createdAt: 5 },
        { taskId: 'T2', role: 'related', source: 'user', createdAt: 6 },
      ]);
      expect(
        rows(db, 'SELECT 1 FROM session_task_links WHERE session_id = ?', OLD),
      ).toEqual([]);
    });

    it('conflict: leaves the shared task related when the new id already has a different primary (L2)', () => {
      const { db, store } = makeHarness();
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.linkTask(
        WS,
        NEW,
        { taskId: 'T1', role: 'related', source: 'agent' },
        5,
      );
      store.linkTask(
        WS,
        NEW,
        { taskId: 'T2', role: 'primary', source: 'user' },
        6,
      );

      store.rekeySession(OLD, NEW);

      expect(primaries(db, WS, NEW)).toEqual([{ task_id: 'T2' }]);
      expect(store.listWorkspace(WS).get(NEW)?.tasks).toEqual([
        { taskId: 'T1', role: 'related', source: 'agent', createdAt: 5 },
        { taskId: 'T2', role: 'primary', source: 'user', createdAt: 6 },
      ]);
    });

    it('rolls back every workspace when the rekey fails in the second one', () => {
      const { db, store } = makeHarness();
      store.upsertOrganization(WS, OLD, { priority: 'urgent' }, 1);
      store.linkTask(
        WS,
        OLD,
        { taskId: 'T1', role: 'primary', source: 'user' },
        1,
      );
      store.addPrLink(
        WS,
        OLD,
        {
          url: 'https://example.com/pr/1',
          number: null,
          repo: null,
          state: null,
          source: 'user',
        },
        1,
      );
      store.upsertOrganization(WS_B, OLD, { priority: 'low' }, 1);
      // Fires only for the second workspace in the sorted root order.
      db.exec(`
        CREATE TRIGGER fail_rekey_ws_b BEFORE UPDATE ON session_organization
        WHEN OLD.workspace_root = '${WS_B}'
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END;
      `);

      expect(() => store.rekeySession(OLD, NEW)).toThrow(/forced failure/);

      const ws = store.listWorkspace(WS);
      expect(ws.has(NEW)).toBe(false);
      expect(ws.get(OLD)).toMatchObject({
        priority: 'urgent',
        tasks: [{ taskId: 'T1', role: 'primary' }],
        prLinks: [{ url: 'https://example.com/pr/1' }],
      });
      expect(primaries(db, WS, OLD)).toEqual([{ task_id: 'T1' }]);
      expect(store.listWorkspace(WS_B).get(OLD)?.priority).toBe('low');
    });

    it('is a no-op when the ids are equal', () => {
      const { store } = makeHarness();
      store.upsertOrganization(WS, OLD, { priority: 'high' }, 1);
      expect(store.rekeySession(OLD, OLD)).toEqual([]);
      expect(store.listWorkspace(WS).get(OLD)?.priority).toBe('high');
    });

    it('is a no-op when nothing owns or references the old id', () => {
      const { store, output } = makeHarness();
      store.upsertOrganization(WS, NEW, { priority: 'high' }, 1);
      expect(store.rekeySession(OLD, NEW)).toEqual([]);
      expect(store.listWorkspace(WS).get(NEW)).toMatchObject({
        priority: 'high',
        updatedAt: 1,
      });
      expect(output.appendLine).not.toHaveBeenCalled();
    });
  });
});
