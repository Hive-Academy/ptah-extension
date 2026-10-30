/**
 * SessionOrganizationCache (TASK_2026_854): the organization of any session
 * id for views that do not own the session list. Loaded row first, then one
 * `session:getOrganization` read; refresh on `session:organizationChanged`;
 * 64 ids at most; no RPC call when organization is unavailable (VS Code).
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  LoggingService,
  RpcResult,
} from '@ptah-extension/core';
import {
  SessionId,
  type ChatSessionSummary,
  type SessionGetOrganizationResult,
  type SessionOrganizationSummary,
} from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import {
  SESSION_ORGANIZATION_CACHE_MAX,
  SessionOrganizationCache,
} from './session-organization-cache.store';

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

function row(
  id: SessionId,
  org: SessionOrganizationSummary | undefined,
): ChatSessionSummary {
  return {
    id,
    name: 'Session',
    createdAt: 1,
    lastActivityAt: 2,
    messageCount: 3,
    isActive: false,
    organization: org,
  };
}

type Read = RpcResult<SessionGetOrganizationResult>;

function okRead(summary: SessionOrganizationSummary): Read {
  return new RpcResult<SessionGetOrganizationResult>(true, {
    ok: true,
    organization: summary,
  });
}

function notFound(): Read {
  return new RpcResult<SessionGetOrganizationResult>(true, {
    ok: false,
    reason: 'session-not-found',
    message: 'not found',
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let the scheduled read, awaited RPC results and the code after them run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

describe('SessionOrganizationCache', () => {
  const A = SessionId.create();
  const B = SessionId.create();

  let sessions: WritableSignal<readonly ChatSessionSummary[]>;
  let organizationAvailable: WritableSignal<boolean>;
  let call: jest.Mock<Promise<Read>, [string, { sessionId: string }]>;
  let logger: { warn: jest.Mock; error: jest.Mock };
  let cache: SessionOrganizationCache;

  beforeEach(() => {
    sessions = signal<readonly ChatSessionSummary[]>([]);
    organizationAvailable = signal(true);
    call = jest.fn();
    logger = { warn: jest.fn(), error: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatStore, useValue: { sessions, organizationAvailable } },
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: logger },
      ],
    });
    cache = TestBed.inject(SessionOrganizationCache);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('makes no RPC call when organization is unavailable', async () => {
    organizationAvailable.set(false);
    sessions.set([row(A, undefined)]);

    const view = cache.organizationFor(B);
    TestBed.tick();
    await settle();
    cache.onOrganizationChanged([B]);
    TestBed.tick();
    await settle();

    expect(view()).toBeNull();
    expect(cache.organizationFor(A)()).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('reads the loaded session:list row first, without an RPC call', async () => {
    const loaded = organization({ worktreePath: '/wt/a', branch: 'feat/a' });
    sessions.set([row(A, loaded)]);

    const view = cache.organizationFor(A);
    TestBed.tick();
    await settle();

    expect(view()).toBe(loaded);
    expect(call).not.toHaveBeenCalled();

    // The row follows the list reload.
    const reloaded = organization({ worktreePath: '/wt/a2' });
    sessions.set([row(A, reloaded)]);
    expect(view()).toBe(reloaded);
  });

  it('falls back to one session:getOrganization read for a session outside the list', async () => {
    const fetched = organization({ branch: 'feat/b' });
    call.mockResolvedValue(okRead(fetched));

    const view = cache.organizationFor(B);
    expect(view()).toBeNull();
    // Asking again while the read is in flight starts no second read.
    expect(cache.organizationFor(B)).toBe(view);
    await settle();
    TestBed.tick();
    await settle();

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('session:getOrganization', {
      sessionId: B,
    });
    expect(view()).toBe(fetched);

    // A list reload that does not carry B does not read it again.
    sessions.set([row(A, organization())]);
    TestBed.tick();
    await settle();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('reads a requested id once organization becomes available', async () => {
    organizationAvailable.set(false);
    call.mockResolvedValue(okRead(organization({ branch: 'late' })));
    const view = cache.organizationFor(B);
    await settle();
    expect(call).not.toHaveBeenCalled();

    organizationAvailable.set(true);
    TestBed.tick();
    await settle();

    expect(call).toHaveBeenCalledTimes(1);
    expect(view()?.branch).toBe('late');
  });

  it('reads a not-yet-persisted session as unknown and logs nothing', async () => {
    call.mockResolvedValue(notFound());
    const view = cache.organizationFor(B);
    await settle();

    expect(view()).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads a failed RPC as unknown and logs it', async () => {
    call.mockRejectedValue(new Error('boom'));
    const view = cache.organizationFor(B);
    await settle();

    expect(view()).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good value when a re-read fails, and retries on the next push', async () => {
    const good = organization({ worktreePath: '/wt/good' });
    const newer = organization({ worktreePath: '/wt/newer' });
    call
      .mockResolvedValueOnce(okRead(good))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okRead(newer));
    const view = cache.organizationFor(B);
    await settle();
    expect(view()).toBe(good);

    cache.onOrganizationChanged([B]);
    await settle();
    expect(call).toHaveBeenCalledTimes(2);
    expect(view()).toBe(good);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    cache.onOrganizationChanged([B]);
    await settle();
    expect(call).toHaveBeenCalledTimes(3);
    expect(view()).toBe(newer);
  });

  it('retries a first read that failed on the next push', async () => {
    call
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okRead(organization({ branch: 'retry' })));
    const view = cache.organizationFor(B);
    await settle();
    expect(view()).toBeNull();

    cache.onOrganizationChanged([B]);
    await settle();
    expect(call).toHaveBeenCalledTimes(2);
    expect(view()?.branch).toBe('retry');
  });

  it('re-reads a cached id on session:organizationChanged', async () => {
    call
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(okRead(organization({ worktreePath: '/wt/b' })));
    const view = cache.organizationFor(B);
    await settle();
    expect(view()).toBeNull();

    cache.onOrganizationChanged([A, B]);
    await settle();

    expect(call).toHaveBeenCalledTimes(2);
    expect(view()?.worktreePath).toBe('/wt/b');
  });

  it('ignores a change push for an id it does not cache', async () => {
    cache.onOrganizationChanged([A]);
    await settle();
    expect(call).not.toHaveBeenCalled();
  });

  it('reads again when a change push arrives while the read is in flight', async () => {
    const first = deferred<Read>();
    call
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(okRead(organization({ branch: 'fresh' })));
    const view = cache.organizationFor(B);
    await settle();
    expect(call).toHaveBeenCalledTimes(1);

    cache.onOrganizationChanged([B]);
    expect(call).toHaveBeenCalledTimes(1);
    first.resolve(okRead(organization({ branch: 'stale' })));
    await settle();

    expect(call).toHaveBeenCalledTimes(2);
    expect(view()?.branch).toBe('fresh');
  });

  it(`keeps at most ${SESSION_ORGANIZATION_CACHE_MAX} ids and drops the least recently asked`, async () => {
    call.mockImplementation(async (_method, params) =>
      okRead(organization({ branch: params.sessionId })),
    );
    const ids = Array.from(
      { length: SESSION_ORGANIZATION_CACHE_MAX },
      () => SessionId.create(),
    );
    const views = ids.map((id) => cache.organizationFor(id));
    await settle();
    expect(call).toHaveBeenCalledTimes(SESSION_ORGANIZATION_CACHE_MAX);

    // Touch the oldest so the second oldest becomes least recent.
    expect(cache.organizationFor(ids[0])).toBe(views[0]);
    cache.organizationFor(SessionId.create());
    await settle();
    expect(call).toHaveBeenCalledTimes(SESSION_ORGANIZATION_CACHE_MAX + 1);

    // The evicted id is no longer refreshed by a push ...
    cache.onOrganizationChanged([ids[1]]);
    await settle();
    expect(call).toHaveBeenCalledTimes(SESSION_ORGANIZATION_CACHE_MAX + 1);
    // ... and asking for it again starts a new entry with a new read.
    expect(cache.organizationFor(ids[1])).not.toBe(views[1]);
    // The touched oldest id is still cached.
    expect(cache.organizationFor(ids[0])).toBe(views[0]);
    await settle();
    expect(call).toHaveBeenCalledTimes(SESSION_ORGANIZATION_CACHE_MAX + 2);
  });

  it('returns null for an empty id without caching it', async () => {
    expect(cache.organizationFor('')()).toBeNull();
    await settle();
    expect(call).not.toHaveBeenCalled();
  });
});
