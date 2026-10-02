/**
 * `ChangeSetStore` — persisted load, push merge, reconcile, and the
 * "no card for zero files" rule (TASK_2026_576, Component 20).
 *
 * `rpcCall` is mocked at the `@ptah-extension/core` boundary, as in
 * `file-link-router.service.spec.ts`; fake timers drive the 1 s debounce.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  MESSAGE_TYPES,
  type GitFileStatus,
  type GitInfoResult,
  type TurnChangeSet,
} from '@ptah-extension/shared';
import {
  ChangeSetStore,
  RECONCILE_DEBOUNCE_MS,
  RECONCILE_FRESHNESS_MS,
} from './change-set.store';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return { ...actual, rpcCall: (...args: unknown[]) => mockRpcCall(...args) };
});

const ROOT = 'D:/repo';

function changeSet(overrides: Partial<TurnChangeSet> = {}): TurnChangeSet {
  return {
    sessionId: 's1',
    workspaceRoot: ROOT,
    turnStartedAt: 100,
    turnEndedAt: 200,
    files: [
      { path: 'src/a.ts', status: 'M', additions: 3, deletions: 1 },
      { path: 'src/b.ts', status: 'A', additions: 10, deletions: 0 },
    ],
    truncatedCount: 0,
    totals: { files: 2, additions: 13, deletions: 1 },
    countsUnavailable: false,
    ...overrides,
  };
}

function status(
  files: Partial<GitFileStatus>[],
  extra: Partial<GitInfoResult> = {},
): GitInfoResult {
  return {
    branch: {} as GitInfoResult['branch'],
    isGitRepo: true,
    files: files.map((file) => ({
      path: '',
      status: 'M',
      staged: false,
      ...file,
    })) as GitFileStatus[],
    ...extra,
  };
}

describe('ChangeSetStore', () => {
  let activeSessionId: ReturnType<typeof signal<string | null>>;
  let persisted: unknown[] | null;
  let gitInfo: GitInfoResult | null;
  let warn: jest.SpyInstance;

  function rpcCallsFor(method: string): unknown[][] {
    return mockRpcCall.mock.calls.filter((call) => call[1] === method);
  }

  function createStore(): ChangeSetStore {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VSCodeService,
          useValue: {
            isElectron: true,
            config: () => ({ workspaceRoot: ROOT }),
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeTabSessionId: activeSessionId.asReadonly() },
        },
      ],
    });
    return TestBed.inject(ChangeSetStore);
  }

  /** Run the session-switch effect and let the load settle. */
  async function openSession(sessionId: string): Promise<void> {
    activeSessionId.set(sessionId);
    TestBed.tick();
    await jest.advanceTimersByTimeAsync(0);
  }

  async function passDebounce(): Promise<void> {
    await jest.advanceTimersByTimeAsync(RECONCILE_DEBOUNCE_MS);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    activeSessionId = signal<string | null>(null);
    persisted = [changeSet()];
    gitInfo = status([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]);
    mockRpcCall.mockImplementation(async (_vscode, method: string) => {
      if (method === 'git:turnChangeSets') {
        return persisted
          ? { success: true, data: { changeSets: persisted } }
          : { success: false, error: 'storage unavailable' };
      }
      if (method === 'git:info') {
        return gitInfo
          ? { success: true, data: gitInfo }
          : { success: false, error: 'git failed' };
      }
      throw new Error(`unexpected ${method}`);
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
    warn.mockRestore();
  });

  describe('loading', () => {
    it('reads the persisted sets once per session switch', async () => {
      const store = createStore();
      await openSession('s1');

      expect(rpcCallsFor('git:turnChangeSets')).toEqual([
        [expect.anything(), 'git:turnChangeSets', { sessionId: 's1' }, 30_000],
      ]);
      expect(store.changeSetsFor('s1')).toHaveLength(1);
      expect(store.changeSetsFor('other')).toEqual([]);
      expect(store.changeSetsFor(null)).toEqual([]);
    });

    it('drops malformed records, zero-file sets and other sessions', async () => {
      persisted = [
        changeSet(),
        changeSet({ turnStartedAt: 300, turnEndedAt: 400, files: [] }),
        changeSet({ turnStartedAt: 500, turnEndedAt: 600, sessionId: 's2' }),
        { sessionId: 's1', files: 'nope' },
        null,
      ];
      const store = createStore();
      await openSession('s1');

      expect(store.changeSetsFor('s1').map((set) => set.turnEndedAt)).toEqual([
        200,
      ]);
    });

    it('keeps live sets only, and logs, when the read fails', async () => {
      persisted = null;
      const store = createStore();
      await openSession('s1');
      store.handleMessage({
        type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
        payload: { changeSet: changeSet({ turnEndedAt: 900 }) },
      });

      expect(store.changeSetsFor('s1').map((set) => set.turnEndedAt)).toEqual([
        900,
      ]);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('push merge', () => {
    it('merges a pushed set into the open session, oldest first, once', async () => {
      const store = createStore();
      await openSession('s1');
      const pushed = changeSet({ turnStartedAt: 250, turnEndedAt: 300 });

      store.handleMessage({
        type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
        payload: { changeSet: pushed },
      });
      store.handleMessage({
        type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
        payload: { changeSet: { ...pushed } },
      });

      expect(store.changeSetsFor('s1').map((set) => set.turnEndedAt)).toEqual([
        200, 300,
      ]);
    });

    it('ignores a push for a session nobody opened, and a zero-file push', async () => {
      const store = createStore();
      await openSession('s1');

      store.handleMessage({
        type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
        payload: { changeSet: changeSet({ sessionId: 'background' }) },
      });
      store.handleMessage({
        type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
        payload: { changeSet: changeSet({ turnEndedAt: 999, files: [] }) },
      });
      store.handleMessage({
        type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
        payload: undefined,
      });

      expect(store.changeSetsFor('background')).toEqual([]);
      expect(store.changeSetsFor('s1')).toHaveLength(1);
    });
  });

  describe('reconcile', () => {
    it('marks files absent from status reconciled and U files conflicted', async () => {
      gitInfo = status([
        { path: 'src/a.ts', status: 'U' },
        { path: 'other.ts' },
      ]);
      const store = createStore();
      await openSession('s1');
      const [set] = store.changeSetsFor('s1');

      expect(store.marksFor(set).reconciled.size).toBe(0);
      await passDebounce();

      expect(rpcCallsFor('git:info')).toEqual([
        [expect.anything(), 'git:info', { workspaceRoot: ROOT }, 30_000],
      ]);
      expect([...store.marksFor(set).reconciled]).toEqual(['src/b.ts']);
      expect([...store.marksFor(set).conflicted]).toEqual(['src/a.ts']);
    });

    it('keeps a file inside a collapsed untracked directory changed', async () => {
      persisted = [
        changeSet({
          files: [{ path: 'new/dir/x.ts', status: 'A', additions: 1, deletions: 0 }],
        }),
      ];
      gitInfo = status([{ path: 'new/', status: '??', isDirectory: true }]);
      const store = createStore();
      await openSession('s1');
      await passDebounce();

      expect(store.marksFor(store.changeSetsFor('s1')[0]).reconciled.size).toBe(
        0,
      );
    });

    it('coalesces triggers into one read and reuses a fresh one', async () => {
      const store = createStore();
      await openSession('s1');
      store.handleMessage({
        type: MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
        payload: { changeSet: changeSet({ turnEndedAt: 300 }) },
      });
      await passDebounce();
      expect(rpcCallsFor('git:info')).toHaveLength(1);

      // Session re-opened within the freshness window: no second read.
      await openSession('s2');
      await openSession('s1');
      await passDebounce();
      expect(rpcCallsFor('git:info')).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(RECONCILE_FRESHNESS_MS);
      await openSession('s2');
      await openSession('s1');
      await passDebounce();
      expect(rpcCallsFor('git:info')).toHaveLength(2);
    });

    it('re-reads on session:turnEnded even when the last read is fresh', async () => {
      const store = createStore();
      await openSession('s1');
      await passDebounce();
      gitInfo = status([{ path: 'src/a.ts' }]);

      store.handleMessage({
        type: MESSAGE_TYPES.SESSION_TURN_ENDED,
        payload: { sessionId: 's1' },
      });
      await passDebounce();

      expect(rpcCallsFor('git:info')).toHaveLength(2);
      expect([
        ...store.marksFor(store.changeSetsFor('s1')[0]).reconciled,
      ]).toEqual(['src/b.ts']);
    });

    it('uses a git:status-update for the session tree instead of an RPC', async () => {
      const store = createStore();
      await openSession('s1');
      await passDebounce();
      expect(rpcCallsFor('git:info')).toHaveLength(1);

      store.handleMessage({
        type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
        payload: { ...status([]), workspaceRoot: 'd:\\repo\\' },
      });
      await passDebounce();

      expect(rpcCallsFor('git:info')).toHaveLength(1);
      expect(store.marksFor(store.changeSetsFor('s1')[0]).reconciled.size).toBe(
        2,
      );
    });

    it('ignores a git:status-update for another tree', async () => {
      const store = createStore();
      await openSession('s1');
      await passDebounce();

      store.handleMessage({
        type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
        payload: { ...status([]), workspaceRoot: 'D:/elsewhere' },
      });
      await passDebounce();

      expect(store.marksFor(store.changeSetsFor('s1')[0]).reconciled.size).toBe(
        0,
      );
    });

    it.each([
      ['the read fails', null],
      ['the status is unavailable', status([], { statusUnavailable: 'timeout' })],
      ['the tree is not a repository', status([], { isGitRepo: false })],
    ])('shows no marks and keeps counts when %s', async (_label, info) => {
      const store = createStore();
      await openSession('s1');
      await passDebounce();
      gitInfo = status([]);
      store.handleMessage({
        type: MESSAGE_TYPES.SESSION_TURN_ENDED,
        payload: { sessionId: 's1' },
      });
      await passDebounce();
      const [set] = store.changeSetsFor('s1');
      expect(store.marksFor(set).reconciled.size).toBe(2);

      gitInfo = info;
      store.handleMessage({
        type: MESSAGE_TYPES.SESSION_TURN_ENDED,
        payload: { sessionId: 's1' },
      });
      await passDebounce();

      expect(store.marksFor(set).reconciled.size).toBe(0);
      expect(store.marksFor(set).conflicted.size).toBe(0);
      expect(store.changeSetsFor('s1')[0].totals).toEqual({
        files: 2,
        additions: 13,
        deletions: 1,
      });
    });

    it('does not read status for a session without cards', async () => {
      persisted = [];
      const store = createStore();
      await openSession('s1');
      store.handleMessage({
        type: MESSAGE_TYPES.SESSION_TURN_ENDED,
        payload: { sessionId: 's1' },
      });
      await passDebounce();

      expect(rpcCallsFor('git:info')).toHaveLength(0);
    });

    it('clears its pending timer when destroyed', async () => {
      createStore();
      await openSession('s1');
      expect(jest.getTimerCount()).toBe(1);

      TestBed.resetTestingModule();

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
