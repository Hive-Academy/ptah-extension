/**
 * SessionListViewStore (TASK_2026_679, Batch 4 Task 4.1).
 *
 * Covers the client filters moved from the shell: the local name filter
 * (B-1), the inclusive whole-day date range (B-14), clearFilters keeping sort
 * and grouping (B-15), server filters only on organization hosts, and query
 * state that survives the modal closing and reopening without a new
 * `session:list` (Req 2.9 / A-11 / B-16).
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionId, type ChatSessionSummary } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import type { SessionListQuery } from '../chat-store/session-loader.service';
import { SessionListViewStore } from './session-list-view.store';

function row(name: string, lastActivityAt: number): ChatSessionSummary {
  return {
    id: SessionId.create(),
    name,
    createdAt: lastActivityAt,
    lastActivityAt,
    messageCount: 1,
    isActive: false,
  };
}

/** Local-time timestamp, as the date inputs are read in local time. */
function at(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
): number {
  return new Date(year, month - 1, day, hours, minutes, seconds, ms).getTime();
}

describe('SessionListViewStore', () => {
  let sessions: WritableSignal<readonly ChatSessionSummary[]>;
  let listQuery: WritableSignal<SessionListQuery>;
  let organizationAvailable: WritableSignal<boolean>;
  let setListQuery: jest.Mock<void, [SessionListQuery]>;
  let store: SessionListViewStore;

  beforeEach(() => {
    sessions = signal<readonly ChatSessionSummary[]>([]);
    listQuery = signal<SessionListQuery>({ sort: 'lastActive' });
    organizationAvailable = signal(false);
    setListQuery = jest.fn((query: SessionListQuery) => listQuery.set(query));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ChatStore,
          useValue: {
            sessions,
            listQuery,
            organizationAvailable,
            setListQuery,
          },
        },
      ],
    });
    store = TestBed.inject(SessionListViewStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('local name filter (B-1)', () => {
    it('filters the loaded rows by name, case-insensitively and trimmed', () => {
      sessions.set([
        row('Fix login bug', 1),
        row('Write docs', 2),
        row('LOGIN refactor', 3),
      ]);

      store.setSearchQuery('  Login ');

      expect(store.filteredSessions().map((s) => s.name)).toEqual([
        'Fix login bug',
        'LOGIN refactor',
      ]);
      expect(store.hasClientFilters()).toBe(true);
      expect(store.hasActiveFilters()).toBe(true);
      expect(setListQuery).not.toHaveBeenCalled();
    });

    it('returns the loaded rows unchanged when no client filter is set', () => {
      const rows = [row('Alpha', 1), row('Beta', 2)];
      sessions.set(rows);

      expect(store.filteredSessions()).toBe(rows);
      expect(store.hasClientFilters()).toBe(false);
      expect(store.hasActiveFilters()).toBe(false);
    });

    it('leaves the search text to the server on organization hosts', () => {
      organizationAvailable.set(true);
      sessions.set([row('Alpha', 1), row('Beta', 2)]);

      store.setSearchQuery('alpha');

      expect(store.filteredSessions()).toHaveLength(2);
      expect(store.hasClientFilters()).toBe(false);
    });
  });

  describe('date range (B-14)', () => {
    it('includes the whole first and last day and excludes the days outside', () => {
      sessions.set([
        row('before', at(2026, 3, 9, 23, 59, 59, 999)),
        row('first-day-start', at(2026, 3, 10, 0, 0, 0, 0)),
        row('middle', at(2026, 3, 11, 12)),
        row('last-day-end', at(2026, 3, 12, 23, 59, 59, 999)),
        row('after', at(2026, 3, 13, 0, 0, 0, 0)),
      ]);

      store.setDateFrom('2026-03-10');
      store.setDateTo('2026-03-12');

      expect(store.filteredSessions().map((s) => s.name)).toEqual([
        'first-day-start',
        'middle',
        'last-day-end',
      ]);
      expect(store.hasClientFilters()).toBe(true);
    });

    it('applies an open-ended range from one side only', () => {
      sessions.set([
        row('old', at(2026, 1, 1, 8)),
        row('new', at(2026, 6, 1, 8)),
      ]);

      store.setDateFrom('2026-03-01');
      expect(store.filteredSessions().map((s) => s.name)).toEqual(['new']);

      store.setDateFrom('');
      store.setDateTo('2026-03-01');
      expect(store.filteredSessions().map((s) => s.name)).toEqual(['old']);
    });

    it('counts the date range as a client filter on organization hosts', () => {
      organizationAvailable.set(true);
      store.setDateTo('2026-03-01');
      expect(store.hasClientFilters()).toBe(true);
    });
  });

  describe('date panel', () => {
    it('toggles open and closed', () => {
      expect(store.dateFilterOpen()).toBe(false);
      store.toggleDateFilter();
      expect(store.dateFilterOpen()).toBe(true);
      store.toggleDateFilter();
      expect(store.dateFilterOpen()).toBe(false);
    });
  });

  describe('server filters', () => {
    it('is false when organization is unavailable, whatever the query holds', () => {
      listQuery.set({ sort: 'lastActive', status: ['active'], text: 'x' });

      expect(store.hasServerFilters()).toBe(false);
      expect(store.hasActiveFilters()).toBe(false);
    });

    it.each<[string, SessionListQuery]>([
      ['status', { status: ['active'] }],
      ['priority', { priority: ['high'] }],
      ['taskId', { taskId: 'TASK-1' }],
      ['pinned', { pinned: false }],
      ['hasPr', { hasPr: true }],
      ['text', { text: 'login' }],
    ])('is true on organization hosts for a %s filter', (_field, query) => {
      organizationAvailable.set(true);
      listQuery.set({ sort: 'lastActive', ...query });

      expect(store.hasServerFilters()).toBe(true);
      expect(store.hasActiveFilters()).toBe(true);
    });

    it('is false on organization hosts for sort and grouping alone', () => {
      organizationAvailable.set(true);
      listQuery.set({ sort: 'priority', groupBy: 'status' });

      expect(store.hasServerFilters()).toBe(false);
    });

    it('passes a settled query to the chat store', () => {
      const query: SessionListQuery = { sort: 'name', pinned: true };
      store.setListQuery(query);

      expect(setListQuery).toHaveBeenCalledTimes(1);
      expect(setListQuery).toHaveBeenCalledWith(query);
      expect(store.listQuery()).toEqual(query);
    });
  });

  describe('clearFilters (B-15)', () => {
    it('clears the inputs, closes the date panel and keeps sort and grouping', () => {
      organizationAvailable.set(true);
      listQuery.set({
        sort: 'priority',
        groupBy: 'task',
        status: ['active'],
        text: 'login',
      });
      store.setSearchQuery('login');
      store.setDateFrom('2026-03-10');
      store.setDateTo('2026-03-12');
      store.toggleDateFilter();

      store.clearFilters();

      expect(store.searchQuery()).toBe('');
      expect(store.dateFrom()).toBe('');
      expect(store.dateTo()).toBe('');
      expect(store.dateFilterOpen()).toBe(false);
      expect(setListQuery).toHaveBeenCalledTimes(1);
      expect(setListQuery).toHaveBeenCalledWith({
        sort: 'priority',
        groupBy: 'task',
      });
      expect(store.hasActiveFilters()).toBe(false);
    });

    it('keeps the sort without adding a groupBy the query did not have', () => {
      organizationAvailable.set(true);
      listQuery.set({ sort: 'created', pinned: true });

      store.clearFilters();

      expect(setListQuery).toHaveBeenCalledWith({ sort: 'created' });
    });

    it('asks for no new page when only client filters were set', () => {
      store.setSearchQuery('alpha');
      store.setDateFrom('2026-03-10');
      store.toggleDateFilter();

      store.clearFilters();

      expect(store.searchQuery()).toBe('');
      expect(store.dateFrom()).toBe('');
      expect(store.dateFilterOpen()).toBe(false);
      expect(setListQuery).not.toHaveBeenCalled();
    });
  });

  describe('state across close and reopen (Req 2.9 / A-11 / B-16)', () => {
    it('keeps the query state and sends no new list query when the modal reopens', () => {
      organizationAvailable.set(true);
      sessions.set([
        row('kept', at(2026, 3, 11, 12)),
        row('dropped', at(2026, 1, 1, 12)),
      ]);
      store.setSearchQuery('kept');
      store.setDateFrom('2026-03-10');
      store.toggleDateFilter();
      const firstRead = store.filteredSessions();

      // The modal closes and reopens: a new consumer injects the root store.
      const reopened = TestBed.inject(SessionListViewStore);

      expect(reopened).toBe(store);
      expect(reopened.searchQuery()).toBe('kept');
      expect(reopened.dateFrom()).toBe('2026-03-10');
      expect(reopened.dateFilterOpen()).toBe(true);
      expect(reopened.filteredSessions()).toBe(firstRead);
      expect(reopened.filteredSessions().map((s) => s.name)).toEqual(['kept']);
      expect(setListQuery).not.toHaveBeenCalled();
    });
  });
});
