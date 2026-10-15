import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import { MESSAGE_TYPES, type GitInfoResult } from '@ptah-extension/shared';
import {
  SessionGitStatsStore,
  sessionBranch,
  sessionWorkingRoot,
} from './session-git-stats.store';

jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual('@ptah-extension/core');
  return { ...actual, rpcCall: jest.fn() };
});

const call = jest.mocked(rpcCall);
const info = (
  files: GitInfoResult['files'] = [],
  extras: Partial<GitInfoResult> = {},
): GitInfoResult => ({
  isGitRepo: true,
  files,
  branch: {} as GitInfoResult['branch'],
  ...extras,
});
const success = (data: GitInfoResult) => ({ success: true as const, data });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe(SessionGitStatsStore.name, () => {
  let store: SessionGitStatsStore;
  const tabs = new Map<string, { tab: { claudeSessionId: string | null } }>();
  beforeEach(() => {
    jest.useFakeTimers();
    call.mockReset();
    tabs.clear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/fallback' }) },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: (id: string) => tabs.get(id) ?? null,
          },
        },
      ],
    });
    store = TestBed.inject(SessionGitStatsStore);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });
  const tick = async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();
  };
  const turn = (
    sessionId: string,
    type: string = MESSAGE_TYPES.SESSION_TURN_ENDED,
  ) => store.handleMessage({ type, payload: { sessionId } });
  const push = (root: string, data: GitInfoResult) =>
    store.handleMessage({
      type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
      payload: { ...data, workspaceRoot: root },
    });

  it('declares all three message types', () => {
    expect(store.handledMessageTypes).toEqual([
      MESSAGE_TYPES.GIT_STATUS_UPDATE,
      MESSAGE_TYPES.SESSION_TURN_ENDED,
      MESSAGE_TYPES.SESSION_TURN_FAILED,
    ]);
  });

  it('selects the worktree, partition, then fallback root', () => {
    const tab = { agentOrigin: { worktreePath: '/child' } } as Parameters<
      typeof sessionWorkingRoot
    >[0];
    expect(sessionWorkingRoot(tab, '/partition', '/fallback')).toBe('/child');
    expect(
      sessionWorkingRoot(
        { agentOrigin: null } as Parameters<typeof sessionWorkingRoot>[0],
        '/partition',
        '/fallback',
      ),
    ).toBe('/partition');
    expect(
      sessionWorkingRoot(
        { agentOrigin: null } as Parameters<typeof sessionWorkingRoot>[0],
        null,
        '/fallback',
      ),
    ).toBe('/fallback');
  });

  it('sums file counts, ignores directories, and marks null or binary counts partial', async () => {
    call.mockResolvedValue(
      success(
        info([
          { path: 'a', status: 'M', staged: true, additions: 3, deletions: 2 },
          {
            path: 'b',
            status: 'M',
            staged: false,
            additions: null,
            deletions: 4,
          },
          {
            path: 'c',
            status: '??',
            staged: false,
            additions: null,
            deletions: null,
            binary: true,
          },
          {
            path: 'dir',
            status: '??',
            staged: false,
            isDirectory: true,
            additions: 99,
            deletions: 99,
          },
        ]),
      ),
    );
    store.track('/a', 'one');
    await tick();
    expect(store.stateFor('/a')).toEqual({
      kind: 'known',
      additions: 3,
      deletions: 6,
      partial: true,
      branch: null,
    });
  });

  it('maps non-repositories to none', async () => {
    call.mockResolvedValue(success(info([], { isGitRepo: false })));
    store.track('/a', 'one');
    await tick();
    expect(store.stateFor('/a')).toEqual({ kind: 'none' });
  });

  it('keeps the same state object when git numbers are unchanged', () => {
    store.track('/a', 'one');
    const data = info([
      { path: 'a', status: 'M', staged: false, additions: 2, deletions: 1 },
    ]);
    push('/a', data);
    const first = store.stateFor('/a');
    push('/a', data);
    expect(store.stateFor('/a')).toBe(first);
  });

  it('keeps the branch in the known state and publishes a checkout alone', () => {
    store.track('/a', 'one');
    const branch = (name: string) =>
      ({ branch: name, upstream: null, ahead: 0, behind: 0 }) as const;
    push('/a', info([], { branch: branch('main') }));
    const first = store.stateFor('/a');
    expect(first).toEqual({
      kind: 'known',
      additions: 0,
      deletions: 0,
      partial: false,
      branch: 'main',
    });
    push('/a', info([], { branch: branch('feat/x') }));
    expect(store.stateFor('/a')).not.toBe(first);
    expect(sessionBranch(null, store.stateFor('/a'))).toBe('feat/x');
    expect(
      sessionBranch(
        { agentOrigin: { branch: 'child' } } as Parameters<
          typeof sessionBranch
        >[0],
        store.stateFor('/a'),
      ),
    ).toBe('child');
    expect(sessionBranch(null, { kind: 'none' })).toBeNull();
  });

  it('replaces old counts after failure and unavailable, then recovers on push and turn end', async () => {
    tabs.set('one', { tab: { claudeSessionId: 'session' } });
    call
      .mockResolvedValueOnce(
        success(
          info([
            {
              path: 'a',
              status: 'M',
              staged: false,
              additions: 2,
              deletions: 1,
            },
          ]),
        ),
      )
      .mockResolvedValueOnce({ success: false, error: 'offline' })
      .mockResolvedValueOnce(
        success(info([], { statusUnavailable: 'timeout' })),
      );
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    store.track('/a', 'one');
    await tick();
    expect(store.stateFor('/a').kind).toBe('known');
    turn('session');
    await tick();
    expect(store.stateFor('/a')).toEqual({ kind: 'unknown', reason: 'failed' });
    push(
      '/a',
      info([
        { path: 'b', status: 'M', staged: false, additions: 7, deletions: 0 },
      ]),
    );
    expect(store.stateFor('/a')).toEqual({
      kind: 'known',
      additions: 7,
      deletions: 0,
      partial: false,
      branch: null,
    });
    turn('session', MESSAGE_TYPES.SESSION_TURN_FAILED);
    await tick();
    expect(store.stateFor('/a')).toEqual({
      kind: 'unknown',
      reason: 'unavailable',
    });
    call.mockResolvedValueOnce(success(info()));
    turn('session');
    await tick();
    expect(store.stateFor('/a')).toEqual({
      kind: 'known',
      additions: 0,
      deletions: 0,
      partial: false,
      branch: null,
    });
    push(
      '/a',
      info([
        { path: 'c', status: 'M', staged: false, additions: 1, deletions: 0 },
      ]),
    );
    expect(store.stateFor('/a').kind).toBe('known');
    warn.mockRestore();
  });

  it('limits nine roots to two concurrent reads and coalesces a queued root', async () => {
    const pending = Array.from({ length: 9 }, () =>
      deferred<ReturnType<typeof success>>(),
    );
    let started = 0;
    call.mockImplementation(() => pending[started++].promise);
    for (let i = 0; i < 9; i++) store.track(`/root${i}`, `tab${i}`);
    await tick();
    expect(call).toHaveBeenCalledTimes(2);
    tabs.set('tab8', { tab: { claudeSessionId: 'last' } });
    turn('last');
    for (let i = 0; i < 9; i++) {
      pending[i].resolve(success(info()));
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(call).toHaveBeenCalledTimes(9);
    expect(store.stateFor('/root8').kind).toBe('known');
  });

  it('applies a matching push without RPC and discards an in-flight result', async () => {
    const pending = deferred<ReturnType<typeof success>>();
    call.mockReturnValue(pending.promise);
    store.track('C:\\Work\\repo', 'one');
    await tick();
    push(
      'c:/work/repo/',
      info([
        { path: 'new', status: 'M', staged: false, additions: 5, deletions: 0 },
      ]),
    );
    pending.resolve(success(info()));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.stateFor('C:/Work/repo')).toEqual({
      kind: 'known',
      additions: 5,
      deletions: 0,
      partial: false,
      branch: null,
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('resolves a draft tab session id when the turn ends', async () => {
    tabs.set('one', { tab: { claudeSessionId: null } });
    call.mockResolvedValue(success(info()));
    store.track('/a', 'one');
    await tick();
    tabs.set('one', { tab: { claudeSessionId: 'assigned' } });
    turn('assigned');
    await tick();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('shares one root read across two tabs and drops state after both release', async () => {
    const pending = deferred<ReturnType<typeof success>>();
    call.mockReturnValue(pending.promise);
    const one = store.track('/a', 'one');
    const two = store.track('/a/', 'two');
    await tick();
    expect(call).toHaveBeenCalledTimes(1);
    one();
    expect(store.stateFor('/a')).toEqual({ kind: 'none' });
    two();
    pending.resolve(success(info()));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.stateFor('/a')).toEqual({ kind: 'none' });
  });

  it('keeps a root tracked when two views register the same tab id', async () => {
    call.mockResolvedValue(success(info()));
    const card = store.track('/a', 'one');
    const detail = store.track('/a', 'one');
    await tick();
    card();
    expect(store.stateFor('/a').kind).toBe('known');
    detail();
    expect(store.stateFor('/a')).toEqual({ kind: 'none' });
  });

  it('discards the old entry read after release and retrack (A2)', async () => {
    const old = deferred<ReturnType<typeof success>>();
    const fresh = deferred<ReturnType<typeof success>>();
    call.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const release = store.track('/a', 'one');
    await tick();
    release();
    store.track('/a', 'two');
    await tick();
    old.resolve(
      success(
        info([
          {
            path: 'stale',
            status: 'M',
            staged: false,
            additions: 100,
            deletions: 0,
          },
        ]),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(store.stateFor('/a')).toEqual({ kind: 'none' });
    fresh.resolve(success(info()));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.stateFor('/a').kind).toBe('known');
  });
});
