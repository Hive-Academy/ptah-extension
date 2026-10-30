/**
 * `groupSessionRows`, the pure grouping behind the previous-sessions list
 * headers (TASK_2026_679, moved from `app-shell.organization.spec.ts`).
 */
import type {
  ChatSessionSummary,
  SessionOrganizationSummary,
} from '@ptah-extension/shared';
import { groupSessionRows } from './session-row-groups';

function organization(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    priority: 'normal',
    status: 'active',
    pinned: false,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: 'user',
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: null,
    todos: null,
    ...overrides,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 2, 12).getTime();

function session(
  id: string,
  name: string,
  extra: Partial<ChatSessionSummary> = {},
): ChatSessionSummary {
  return {
    id,
    name,
    createdAt: NOW - 3 * DAY,
    lastActivityAt: NOW,
    messageCount: 0,
    isActive: false,
    ...extra,
  } as ChatSessionSummary;
}

describe('groupSessionRows', () => {
  const org = organization;

  it('returns no group for no rows', () => {
    expect(groupSessionRows([], 'status')).toEqual([]);
    expect(groupSessionRows([], 'none')).toEqual([]);
  });

  it('reads a missing list as empty instead of throwing (runs in change detection)', () => {
    expect(groupSessionRows(undefined, 'none')).toEqual([]);
    expect(groupSessionRows(null, 'parent')).toEqual([]);
  });

  it('groups by primary task, then first task, then "No task", in arrival order', () => {
    const groups = groupSessionRows(
      [
        session('a', 'A'),
        session('b', 'B', {
          organization: org({
            tasks: [
              {
                taskId: 'T1',
                role: 'related',
                source: 'user',
                createdAt: 0,
                missing: false,
              },
              {
                taskId: 'T2',
                role: 'primary',
                source: 'user',
                createdAt: 0,
                missing: false,
              },
            ],
          }),
        }),
        session('c', 'C', {
          organization: org({
            tasks: [
              {
                taskId: 'T1',
                role: 'related',
                source: 'agent',
                createdAt: 0,
                missing: true,
              },
            ],
          }),
        }),
      ],
      'task',
    );

    expect(
      groups.map((g) => [g.label, g.rows.map((r) => r.session.id)]),
    ).toEqual([
      ['No task', ['a']],
      ['T2', ['b']],
      ['T1', ['c']],
    ]);
  });

  it('keeps a child whose parent is not loaded at the top, and survives a cycle', () => {
    const rows = groupSessionRows(
      [
        session('orphan', 'Orphan', {
          organization: org({ parentSessionId: 'gone' }),
        }),
        session('x', 'X', { organization: org({ parentSessionId: 'y' }) }),
        session('y', 'Y', { organization: org({ parentSessionId: 'x' }) }),
      ],
      'parent',
    )[0].rows;

    expect(rows.map((r) => [r.session.id, r.depth])).toEqual([
      ['orphan', 0],
      ['x', 0],
      ['y', 1],
    ]);
  });
});
