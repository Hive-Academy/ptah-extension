import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, LoggingService, RpcResult } from '@ptah-extension/core';
import {
  SessionId,
  type ChatSessionSummary,
  type SessionListParams,
  type SessionListResult,
} from '@ptah-extension/shared';
import { RecentSessionsStore } from './recent-sessions.store';

type Reply = RpcResult<SessionListResult>;

function row(name: string, lastActivityAt: number): ChatSessionSummary {
  return {
    id: SessionId.create(),
    name,
    createdAt: 1,
    lastActivityAt,
    messageCount: 1,
    isActive: false,
  };
}

function ok(sessions: ChatSessionSummary[]): Reply {
  return new RpcResult(true, {
    sessions,
    total: sessions.length,
    hasMore: false,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('RecentSessionsStore', () => {
  let call: jest.Mock<Promise<Reply>, [string, SessionListParams]>;
  let logger: { error: jest.Mock };
  let store: RecentSessionsStore;

  beforeEach(() => {
    call = jest.fn();
    logger = { error: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: logger },
      ],
    });
    store = TestBed.inject(RecentSessionsStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('combines pinned and unpinned rows into the true newest three', async () => {
    const olderPinned = row('older pinned', 1);
    const latestPinned = row('latest pinned', 6);
    const newest = row('newest unpinned', 9);
    const next = row('next unpinned', 8);
    const third = row('third unpinned', 7);
    call.mockImplementation(async (_method, params) =>
      params.pinned ? ok([latestPinned, olderPinned]) : ok([newest, next, third]),
    );

    await store.load('/workspace');

    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith('session:list', {
      workspacePath: '/workspace', pinned: true, limit: 3, offset: 0, sort: 'lastActive',
    });
    expect(call).toHaveBeenCalledWith('session:list', {
      workspacePath: '/workspace', pinned: false, limit: 3, offset: 0, sort: 'lastActive',
    });
    expect(store.sessions()).toEqual([newest, next, third]);
    expect(store.confirmed()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('does not request archived rows from an organization host', async () => {
    const active = row('active', 2);
    const archived = row('archived', 20);
    call.mockImplementation(async (_method, params) => {
      // Organization query mode excludes archived before paging.
      const hostRows = [active, archived].filter((item) => item !== archived);
      return params.pinned ? ok(hostRows) : ok([]);
    });

    await store.load('/workspace');

    expect(store.sessions()).toEqual([active]);
    expect(call.mock.calls.every(([, params]) => params.status === undefined)).toBe(true);
  });

  it('deduplicates no-organization responses and breaks activity ties by ID', async () => {
    const first = row('first', 5);
    const second = row('second', 5);
    call.mockResolvedValue(ok([second, first]));

    await store.load('/workspace');

    expect(store.sessions()).toEqual(
      [first, second].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('uses no Previous-sessions state and refreshes its own workspace query', async () => {
    const item = row('independent', 3);
    call.mockResolvedValue(ok([item]));

    await store.load('/workspace');
    await store.refresh();

    expect(store.workspacePath()).toBe('/workspace');
    expect(call).toHaveBeenCalledTimes(4);
    expect(store.sessions()).toEqual([item]);
  });

  it('keeps confirmed cards visible while reloading the same workspace and clears them on workspace change', async () => {
    const item = row('recent', 3);
    call.mockResolvedValue(ok([item]));
    await store.load('/workspace');

    const pending = deferred<Reply>();
    call.mockImplementation(() => pending.promise);
    const reload = store.load('/workspace');
    expect(store.loading()).toBe(true);
    expect(store.confirmed()).toBe(true);
    expect(store.sessions()).toEqual([item]);
    pending.resolve(ok([item]));
    await reload;

    const switched = deferred<Reply>();
    call.mockImplementation(() => switched.promise);
    const next = store.load('/other');
    expect(store.sessions()).toEqual([]);
    expect(store.confirmed()).toBe(false);
    switched.resolve(ok([]));
    await next;
  });

  it('drops an older workspace response after switching away and back', async () => {
    const oldA = deferred<Reply>();
    const oldB = deferred<Reply>();
    let count = 0;
    call.mockImplementation(async () => {
      count += 1;
      if (count === 1) return oldA.promise;
      if (count === 2) return oldB.promise;
      return ok([row('current', 10)]);
    });

    const stale = store.load('/workspace-a');
    await store.load('/workspace-b');
    await store.load('/workspace-a');
    oldA.resolve(ok([row('stale', 99)]));
    oldB.resolve(ok([row('stale', 99)]));
    await stale;

    expect(store.workspacePath()).toBe('/workspace-a');
    expect(store.sessions().every((item) => item.name === 'current')).toBe(true);
    expect(store.confirmed()).toBe(true);
  });

  it('reports RPC failure without confirming history', async () => {
    call.mockResolvedValue(new RpcResult<SessionListResult>(false, undefined, 'host failure'));

    await store.load('/workspace');

    expect(store.sessions()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.confirmed()).toBe(false);
    expect(store.error()).toBe('Unable to load recent sessions.');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
