/**
 * applySessionListQuery — the `session:list` organization query
 * (TASK_2026_580, L3/L4/L5).
 *
 * Pure function, so every case builds rows and an organization map inline.
 * Rows arrive in `getForWorkspace` order (`lastActiveAt` descending).
 */
import type { StoredOrganization } from '@ptah-extension/session-organization';
import {
  applySessionListQuery,
  isSessionListQueryMode,
  type SessionListQueryRow,
} from './session-list-query';
import { SessionListQueryParamsSchema } from './session-organization-rpc.schema';

function row(
  sessionId: string,
  lastActiveAt: number,
  overrides: Partial<SessionListQueryRow> = {},
): SessionListQueryRow {
  return {
    sessionId,
    name: `Session ${sessionId}`,
    createdAt: lastActiveAt,
    lastActiveAt,
    ...overrides,
  };
}

function org(
  sessionId: string,
  overrides: Partial<StoredOrganization> = {},
): StoredOrganization {
  return {
    sessionId,
    priority: 'normal',
    status: 'active',
    pinned: false,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: 'user',
    updatedAt: 1,
    tasks: [],
    prLinks: [],
    ...overrides,
  };
}

function mapOf(...orgs: StoredOrganization[]): Map<string, StoredOrganization> {
  return new Map(orgs.map((o) => [o.sessionId, o]));
}

const ids = (result: { rows: SessionListQueryRow[] }): string[] =>
  result.rows.map((r) => r.sessionId);

/** Today's order: newest first. `b` is archived, `c` is pinned. */
const ROWS = [row('a', 400), row('b', 300), row('c', 200), row('d', 100)];
const MAP = mapOf(
  org('b', { status: 'archived' }),
  org('c', { pinned: true }),
  org('d', { priority: 'urgent', status: 'waiting' }),
);

describe('isSessionListQueryMode', () => {
  it('is false without any query field', () => {
    expect(isSessionListQueryMode({})).toBe(false);
  });

  it.each([
    { status: [] },
    { priority: ['high' as const] },
    { taskId: 'TASK_2026_001' },
    { pinned: false },
    { hasPr: true },
    { text: '' },
    { sort: 'lastActive' as const },
    { groupBy: 'none' as const },
  ])('is true for %o', (query) => {
    expect(isSessionListQueryMode(query)).toBe(true);
  });
});

describe('applySessionListQuery', () => {
  describe('without query mode (Revision 1)', () => {
    it('keeps archived and pinned rows in their position, and total counts them', () => {
      const result = applySessionListQuery(ROWS, MAP, {});
      expect(ids(result)).toEqual(['a', 'b', 'c', 'd']);
      expect(result.total).toBe(4);
    });

    it('does not mutate the input array', () => {
      const input = [...ROWS];
      applySessionListQuery(input, MAP, { sort: 'name' });
      expect(ids({ rows: input })).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('query mode', () => {
    it('a single sort param excludes archived and puts pinned first', () => {
      const result = applySessionListQuery(ROWS, MAP, { sort: 'lastActive' });
      expect(ids(result)).toEqual(['c', 'a', 'd']);
      expect(result.total).toBe(3);
    });

    it("status: ['archived'] returns only archived rows", () => {
      const result = applySessionListQuery(ROWS, MAP, {
        status: ['archived'],
      });
      expect(ids(result)).toEqual(['b']);
      expect(result.total).toBe(1);
    });

    it('a status filter treats a row without a stored record as active', () => {
      const result = applySessionListQuery(ROWS, MAP, { status: ['active'] });
      expect(ids(result)).toEqual(['c', 'a']);
    });

    it('an empty status list filters nothing but still hides archived', () => {
      const result = applySessionListQuery(ROWS, MAP, { status: [] });
      expect(ids(result)).toEqual(['c', 'a', 'd']);
    });

    it('filters by priority, pinned, hasPr and taskId', () => {
      const rows = [row('p', 4), row('q', 3), row('r', 2), row('s', 1)];
      const map = mapOf(
        org('p', { priority: 'high', pinned: true }),
        org('q', {
          priority: 'high',
          prLinks: [
            {
              url: 'https://github.com/o/r/pull/1',
              number: 1,
              repo: 'o/r',
              state: 'open',
              source: 'agent',
              createdAt: 1,
            },
          ],
        }),
        org('r', {
          tasks: [
            {
              taskId: 'TASK_2026_001',
              role: 'primary',
              source: 'user',
              createdAt: 1,
            },
          ],
        }),
      );

      expect(
        ids(applySessionListQuery(rows, map, { priority: ['high'] })),
      ).toEqual(['p', 'q']);
      expect(ids(applySessionListQuery(rows, map, { pinned: false }))).toEqual([
        'q',
        'r',
        's',
      ]);
      expect(ids(applySessionListQuery(rows, map, { hasPr: true }))).toEqual([
        'q',
      ]);
      expect(ids(applySessionListQuery(rows, map, { hasPr: false }))).toEqual([
        'p',
        'r',
        's',
      ]);
      expect(
        ids(applySessionListQuery(rows, map, { taskId: 'TASK_2026_001' })),
      ).toEqual(['r']);
    });

    it('matches text as a case-insensitive substring of the name', () => {
      const rows = [
        row('x', 2, { name: 'Fix the LOGIN bug' }),
        row('y', 1, { name: 'Refactor store' }),
      ];
      const result = applySessionListQuery(rows, new Map(), { text: 'login' });
      expect(ids(result)).toEqual(['x']);
    });

    it('sorts by priority by tuple index, ties by lastActiveAt descending', () => {
      const rows = [row('l', 5), row('u1', 4), row('h', 3), row('u2', 2)];
      const map = mapOf(
        org('l', { priority: 'low' }),
        org('u1', { priority: 'urgent' }),
        org('h', { priority: 'high' }),
        org('u2', { priority: 'urgent' }),
      );
      const result = applySessionListQuery(rows, map, { sort: 'priority' });
      expect(ids(result)).toEqual(['u1', 'u2', 'h', 'l']);
    });

    it('keeps pinned rows first in every sort', () => {
      const rows = [row('u', 3), row('pinnedLow', 2)];
      const map = mapOf(
        org('u', { priority: 'urgent' }),
        org('pinnedLow', { priority: 'low', pinned: true }),
      );
      expect(
        ids(applySessionListQuery(rows, map, { sort: 'priority' })),
      ).toEqual(['pinnedLow', 'u']);
    });

    it('sorts by created (newest first) and by name (case-insensitive)', () => {
      const rows = [
        row('1', 30, { createdAt: 1, name: 'beta' }),
        row('2', 20, { createdAt: 3, name: 'Alpha' }),
        row('3', 10, { createdAt: 2, name: 'gamma' }),
      ];
      expect(
        ids(applySessionListQuery(rows, new Map(), { sort: 'created' })),
      ).toEqual(['2', '3', '1']);
      expect(
        ids(applySessionListQuery(rows, new Map(), { sort: 'name' })),
      ).toEqual(['2', '1', '3']);
    });

    it('groupBy status makes the status tuple index the primary key (L5)', () => {
      const rows = [row('d1', 4), row('a1', 3), row('w1', 2), row('a2', 1)];
      const map = mapOf(
        org('d1', { status: 'done' }),
        org('w1', { status: 'waiting', priority: 'urgent' }),
      );
      const result = applySessionListQuery(rows, map, {
        groupBy: 'status',
        sort: 'priority',
      });
      expect(ids(result)).toEqual(['a1', 'a2', 'w1', 'd1']);
    });

    it('groupBy task groups by primary task, unlinked rows last', () => {
      const link = (taskId: string, role: 'primary' | 'related') => ({
        taskId,
        role,
        source: 'user' as const,
        createdAt: 1,
      });
      const rows = [row('none', 4), row('t2', 3), row('t1', 2), row('t1b', 1)];
      const map = mapOf(
        org('t2', { tasks: [link('TASK_B', 'primary')] }),
        org('t1', {
          tasks: [link('TASK_B', 'related'), link('TASK_A', 'primary')],
        }),
        org('t1b', { tasks: [link('TASK_A', 'related')] }),
      );
      const result = applySessionListQuery(rows, map, { groupBy: 'task' });
      expect(ids(result)).toEqual(['t1', 't1b', 't2', 'none']);
    });

    it('groupBy parent keeps a parent and its children contiguous, parent first', () => {
      const rows = [row('child', 4), row('other', 3), row('parent', 2)];
      const map = mapOf(org('child', { parentSessionId: 'parent' }));
      const result = applySessionListQuery(rows, map, { groupBy: 'parent' });
      expect(ids(result)).toEqual(['other', 'parent', 'child']);
    });
  });

  describe('without an organization map (VS Code)', () => {
    it('applies neither archived exclusion nor pinned-first; sort lastActive is today', () => {
      const result = applySessionListQuery(ROWS, undefined, {
        sort: 'lastActive',
        status: ['archived'],
        groupBy: 'parent',
      });
      expect(ids(result)).toEqual(['a', 'b', 'c', 'd']);
      expect(result.total).toBe(4);
    });

    it('still applies the text filter', () => {
      const result = applySessionListQuery(ROWS, undefined, { text: 'c' });
      expect(ids(result)).toEqual(['c']);
    });
  });
});

describe('SessionListQueryParamsSchema', () => {
  it('accepts the documented query fields and strips the rest', () => {
    const parsed = SessionListQueryParamsSchema.parse({
      workspacePath: '/ws',
      status: ['active', 'waiting'],
      priority: ['urgent'],
      sort: 'priority',
      groupBy: 'status',
    });
    expect(parsed).toEqual({
      status: ['active', 'waiting'],
      priority: ['urgent'],
      sort: 'priority',
      groupBy: 'status',
    });
  });

  it.each([
    { status: ['paused'] },
    { priority: 'urgent' },
    { sort: 'random' },
    { groupBy: 'owner' },
    { taskId: '../escape' },
    { pinned: 'yes' },
    { text: 'x'.repeat(201) },
  ])('rejects %o', (params) => {
    expect(SessionListQueryParamsSchema.safeParse(params).success).toBe(false);
  });
});
