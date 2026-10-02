import {
  SESSION_LIST_GROUPS,
  SESSION_LIST_SORTS,
  SESSION_ORGANIZATION_DEFAULTS,
  SESSION_PRIORITIES,
  SESSION_PR_LINK_SOURCES,
  SESSION_PR_STATES,
  SESSION_STARTED_BY,
  SESSION_TASK_LINK_ROLES,
  SESSION_TASK_LINK_SOURCES,
  SESSION_WORKFLOW_STATUSES,
} from './session-organization.types';

describe('session organization tuples', () => {
  // Order is part of the contract: priority and status sort and group by
  // tuple index, so a reorder is a behaviour change, not a refactor.
  it.each([
    [
      'SESSION_PRIORITIES',
      SESSION_PRIORITIES,
      ['urgent', 'high', 'normal', 'low'],
    ],
    [
      'SESSION_WORKFLOW_STATUSES',
      SESSION_WORKFLOW_STATUSES,
      ['active', 'waiting', 'in_review', 'done', 'archived'],
    ],
    [
      'SESSION_TASK_LINK_ROLES',
      SESSION_TASK_LINK_ROLES,
      ['primary', 'related'],
    ],
    [
      'SESSION_TASK_LINK_SOURCES',
      SESSION_TASK_LINK_SOURCES,
      ['board-start', 'agent', 'user'],
    ],
    ['SESSION_PR_LINK_SOURCES', SESSION_PR_LINK_SOURCES, ['agent', 'user']],
    [
      'SESSION_PR_STATES',
      SESSION_PR_STATES,
      ['open', 'draft', 'merged', 'closed'],
    ],
    ['SESSION_STARTED_BY', SESSION_STARTED_BY, ['user', 'agent']],
    [
      'SESSION_LIST_SORTS',
      SESSION_LIST_SORTS,
      ['lastActive', 'priority', 'created', 'name'],
    ],
    [
      'SESSION_LIST_GROUPS',
      SESSION_LIST_GROUPS,
      ['none', 'status', 'task', 'parent'],
    ],
  ] as const)(
    '%s pins its members and their order',
    (_name, tuple, expected) => {
      expect([...tuple]).toEqual([...expected]);
    },
  );

  it.each([
    ['SESSION_PRIORITIES', SESSION_PRIORITIES],
    ['SESSION_WORKFLOW_STATUSES', SESSION_WORKFLOW_STATUSES],
    ['SESSION_TASK_LINK_ROLES', SESSION_TASK_LINK_ROLES],
    ['SESSION_TASK_LINK_SOURCES', SESSION_TASK_LINK_SOURCES],
    ['SESSION_PR_LINK_SOURCES', SESSION_PR_LINK_SOURCES],
    ['SESSION_PR_STATES', SESSION_PR_STATES],
    ['SESSION_STARTED_BY', SESSION_STARTED_BY],
    ['SESSION_LIST_SORTS', SESSION_LIST_SORTS],
    ['SESSION_LIST_GROUPS', SESSION_LIST_GROUPS],
  ] as const)('%s has no duplicate members', (_name, tuple) => {
    expect(new Set(tuple).size).toBe(tuple.length);
  });
});

describe('SESSION_ORGANIZATION_DEFAULTS', () => {
  it('is normal priority, active status, unpinned, started by the user', () => {
    expect(SESSION_ORGANIZATION_DEFAULTS).toEqual({
      priority: 'normal',
      status: 'active',
      pinned: false,
      startedBy: 'user',
    });
  });

  it('only uses values from the tuples', () => {
    expect(SESSION_PRIORITIES).toContain(
      SESSION_ORGANIZATION_DEFAULTS.priority,
    );
    expect(SESSION_WORKFLOW_STATUSES).toContain(
      SESSION_ORGANIZATION_DEFAULTS.status,
    );
    expect(SESSION_STARTED_BY).toContain(
      SESSION_ORGANIZATION_DEFAULTS.startedBy,
    );
  });
});
