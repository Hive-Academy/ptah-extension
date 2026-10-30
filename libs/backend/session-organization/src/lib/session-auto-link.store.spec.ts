/**
 * SessionAutoLinkStore + its participation in the main store's transactions
 * (decisions.md RR1-3), on real SQLite (migrations 1..50 and 0063).
 */
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  asConnectionService,
  openTestConnection,
  rowsOf,
  sqliteAvailable,
  type TestConnection,
} from '../testing/sqlite-test-db';
import { SessionAutoLinkStore } from './session-auto-link.store';
import type { SessionOrganizationSideTables } from './session-organization-side-tables';
import { SessionOrganizationStore } from './session-organization.store';

const WS = 'd:/projects/ws-a';
const WS_B = 'd:/projects/ws-b';
const OLD = 'old-session';
const NEW = 'new-session';
const TASK = 'TASK_2026_101';
const TASK_2 = 'TASK_2026_102';
const TODO = { done: 1, total: 3, inProgress: 'Writing', updatedAt: 7 };

interface Harness {
  connection: TestConnection;
  auto: SessionAutoLinkStore;
  store: SessionOrganizationStore;
}

function makeHarness(sideTables?: SessionOrganizationSideTables): Harness {
  const connection = openTestConnection();
  const auto = new SessionAutoLinkStore(asConnectionService(connection));
  const output: Pick<IOutputChannel, 'appendLine'> = { appendLine: jest.fn() };
  const store = new SessionOrganizationStore(
    asConnectionService(connection),
    output as IOutputChannel,
    sideTables ?? auto,
  );
  return { connection, auto, store };
}

/** Every row of the four tables, for before/after comparisons. */
function snapshot(h: Harness): unknown {
  const db = h.connection.db;
  return {
    org: rowsOf(db, 'SELECT * FROM session_organization ORDER BY workspace_root, session_id'),
    links: rowsOf(db, 'SELECT * FROM session_task_links ORDER BY workspace_root, session_id, task_id'),
    suppressions: rowsOf(db, 'SELECT * FROM session_task_link_suppressions ORDER BY workspace_root, session_id, task_id'),
    todos: rowsOf(db, 'SELECT * FROM session_todo_progress ORDER BY workspace_root, session_id'),
  };
}

/** Seed one session with an auto link, a suppression and a todo row. */
function seed(h: Harness, root: string, sessionId: string): void {
  h.store.applyAutoLinkPlan(
    root,
    sessionId,
    () => [
      {
        kind: 'upsert',
        taskId: TASK,
        role: 'primary',
        source: 'worktree',
        autoRule: 'R4',
        autoEvidence: 'wt\u0000b',
      },
    ],
    1,
  );
  h.store.unlinkTask(root, sessionId, TASK_2, 2, { suppress: true });
  h.store.upsertTodoProgress(root, sessionId, TODO, 3);
}

/** A participant that delegates to the real one but throws on `method`. */
function throwingOn(
  real: SessionAutoLinkStore,
  method: keyof SessionOrganizationSideTables,
  afterCalls = 0,
): SessionOrganizationSideTables {
  let calls = 0;
  const fail = <T>(name: keyof SessionOrganizationSideTables, run: () => T): T => {
    if (name === method && calls++ >= afterCalls) {
      throw new Error(`${name} failed`);
    }
    return run();
  };
  return {
    rootsOf: (id) => fail('rootsOf', () => real.rootsOf(id)),
    deleteSession: (root, id) => fail('deleteSession', () => real.deleteSession(root, id)),
    rekeySession: (root, a, b) => fail('rekeySession', () => real.rekeySession(root, a, b)),
    suppress: (root, id, task, now) => fail('suppress', () => real.suppress(root, id, task, now)),
    clearSuppression: (root, id, task) =>
      fail('clearSuppression', () => real.clearSuppression(root, id, task)),
    listSuppressed: (root, id) => fail('listSuppressed', () => real.listSuppressed(root, id)),
    listTodoProgress: (root) => fail('listTodoProgress', () => real.listTodoProgress(root)),
    getTodoProgress: (root, id) => fail('getTodoProgress', () => real.getTodoProgress(root, id)),
    upsertTodoProgress: (root, id, p) =>
      fail('upsertTodoProgress', () => real.upsertTodoProgress(root, id, p)),
  };
}

describe('SessionAutoLinkStore (real SQLite)', () => {
  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(sqliteAvailable).toBe(true);
  });

  it('stores the rule columns of an automatic link and reads them back', () => {
    const h = makeHarness();
    seed(h, WS, OLD);
    expect(h.store.getOrganization(WS, OLD)?.tasks).toEqual([
      expect.objectContaining({
        taskId: TASK,
        source: 'worktree',
        autoRule: 'R4',
        autoEvidence: 'wt\u0000b',
      }),
    ]);
    expect(h.store.getOrganization(WS, OLD)?.todos).toEqual(TODO);
  });

  it('an explicit write over an automatic link nulls the rule (adoption)', () => {
    const h = makeHarness();
    seed(h, WS, OLD);
    h.store.linkTask(WS, OLD, { taskId: TASK, role: 'related', source: 'user' }, 9);
    expect(h.store.getOrganization(WS, OLD)?.tasks).toEqual([
      expect.objectContaining({ taskId: TASK, role: 'related', source: 'user', autoRule: null, autoEvidence: null }),
    ]);
  });

  it('a user unlink suppresses the pair; an explicit link lifts it', () => {
    const h = makeHarness();
    seed(h, WS, OLD);
    expect(h.store.unlinkTask(WS, OLD, TASK, 5, { suppress: true })).toBe(true);
    expect([...h.auto.listSuppressed(WS, OLD)].sort()).toEqual([TASK, TASK_2]);
    h.store.linkTask(WS, OLD, { taskId: TASK, role: 'primary', source: 'user' }, 6);
    expect([...h.auto.listSuppressed(WS, OLD)]).toEqual([TASK_2]);
  });

  it('a todo snapshot is written only when it changed', () => {
    const h = makeHarness();
    expect(h.store.upsertTodoProgress(WS, OLD, TODO, 1)).toBe(true);
    expect(h.store.upsertTodoProgress(WS, OLD, { ...TODO, updatedAt: 99 }, 2)).toBe(false);
    expect(h.store.upsertTodoProgress(WS, OLD, { ...TODO, done: 2 }, 3)).toBe(true);
    expect(h.store.listWorkspace(WS).get(OLD)?.todos).toEqual({ ...TODO, done: 2 });
  });

  it('rekey moves suppressions, todos and the rule columns in every workspace', () => {
    const h = makeHarness();
    seed(h, WS, OLD);
    seed(h, WS_B, OLD);
    expect(h.store.rekeySession(OLD, NEW)).toEqual([WS, WS_B]);
    for (const root of [WS, WS_B]) {
      expect(h.auto.listSuppressed(root, NEW)).toEqual(new Set([TASK_2]));
      expect(h.auto.getTodoProgress(root, NEW)).toEqual(TODO);
      expect(h.store.getOrganization(root, NEW)?.tasks[0]).toEqual(
        expect.objectContaining({ autoRule: 'R4' }),
      );
      expect(h.auto.rootsOf(OLD)).toEqual([]);
    }
  });

  it('rekey keeps the new id todo snapshot over the old one', () => {
    const h = makeHarness();
    h.store.upsertTodoProgress(WS, OLD, TODO, 1);
    h.store.upsertTodoProgress(WS, NEW, { ...TODO, done: 3 }, 2);
    h.store.rekeySession(OLD, NEW);
    expect(h.auto.getTodoProgress(WS, NEW)?.done).toBe(3);
  });

  it('a session with only side-table rows is still rekeyed', () => {
    const h = makeHarness();
    h.auto.suppress(WS, OLD, TASK, 1);
    expect(h.store.rekeySession(OLD, NEW)).toEqual([WS]);
    expect(h.auto.listSuppressed(WS, NEW)).toEqual(new Set([TASK]));
  });

  it('delete removes the side-table rows with the session', () => {
    const h = makeHarness();
    seed(h, WS, OLD);
    expect(h.store.deleteSession(WS, OLD)).toBe(true);
    expect(snapshot(h)).toEqual({ org: [], links: [], suppressions: [], todos: [] });
  });

  it('findSessionsNamingTask is scoped by root and bounded', () => {
    const h = makeHarness();
    for (let i = 0; i < 3; i++) {
      h.store.upsertOrganization(WS, `s${i}`, { worktreePath: `/wt/${TASK}-${i}` }, 1);
    }
    h.store.upsertOrganization(WS, 'b', { branch: `feat/${TASK}` }, 1);
    h.store.upsertOrganization(WS_B, 'other', { worktreePath: `/wt/${TASK}` }, 1);
    expect(h.auto.findSessionsNamingTask(WS, TASK)).toEqual(['b', 's0', 's1', 's2']);
    expect(h.auto.findSessionsNamingTask(WS, TASK, 2)).toEqual(['b', 's0']);
    expect(h.auto.findSessionsNamingTask(WS, TASK_2)).toEqual([]);
  });

  describe('a failing participant rolls back every table (RR1-3)', () => {
    function setup(method: keyof SessionOrganizationSideTables, afterCalls = 0) {
      const base = makeHarness();
      seed(base, WS, OLD);
      seed(base, WS_B, OLD);
      const store = new SessionOrganizationStore(
        asConnectionService(base.connection),
        { appendLine: jest.fn() } as Pick<IOutputChannel, 'appendLine'> as IOutputChannel,
        throwingOn(base.auto, method, afterCalls),
      );
      return { h: { ...base, store }, before: snapshot(base) };
    }

    it('in deleteSession', () => {
      const { h, before } = setup('deleteSession');
      expect(() => h.store.deleteSession(WS, OLD)).toThrow('deleteSession failed');
      expect(snapshot(h)).toEqual(before);
    });

    it('in rekeySession, first root', () => {
      const { h, before } = setup('rekeySession');
      expect(() => h.store.rekeySession(OLD, NEW)).toThrow('rekeySession failed');
      expect(snapshot(h)).toEqual(before);
    });

    it('in rekeySession, second root', () => {
      const { h, before } = setup('rekeySession', 1);
      expect(() => h.store.rekeySession(OLD, NEW)).toThrow('rekeySession failed');
      expect(snapshot(h)).toEqual(before);
    });

    it("in unlinkTask's suppress", () => {
      const { h, before } = setup('suppress');
      expect(() => h.store.unlinkTask(WS, OLD, TASK, 9, { suppress: true })).toThrow(
        'suppress failed',
      );
      expect(snapshot(h)).toEqual(before);
    });

    it("in an explicit link's suppression clear", () => {
      const { h, before } = setup('clearSuppression');
      expect(() =>
        h.store.linkTask(WS, OLD, { taskId: TASK_2, role: 'primary', source: 'user' }, 9),
      ).toThrow('clearSuppression failed');
      expect(snapshot(h)).toEqual(before);
    });

    it('in the todo upsert', () => {
      const { h, before } = setup('upsertTodoProgress');
      expect(() =>
        h.store.upsertTodoProgress(WS, 'fresh', { ...TODO, done: 2 }, 9),
      ).toThrow('upsertTodoProgress failed');
      expect(snapshot(h)).toEqual(before);
    });

    it('in a reconcile whose plan throws after a write', () => {
      const { h, before } = setup('listSuppressed');
      const failing = throwingOn(h.auto, 'listSuppressed');
      expect(() =>
        h.store.applyAutoLinkPlan(
          WS,
          OLD,
          () => {
            h.connection.db
              .prepare('DELETE FROM session_task_links WHERE session_id = ?')
              .run(OLD);
            failing.listSuppressed(WS, OLD);
            return [];
          },
          9,
        ),
      ).toThrow('listSuppressed failed');
      expect(snapshot(h)).toEqual(before);
    });
  });
});
