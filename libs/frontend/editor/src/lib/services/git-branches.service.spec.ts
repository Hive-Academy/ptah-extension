/**
 * GitBranchesService — unit specs.
 *
 * Coverage:
 *   - Initial state: all signals empty/null/0/false
 *   - refreshBranches(): calls rpcCall for git:branches, git:stashList, git:lastCommit
 *     and updates the corresponding signals
 *   - recordVisitedBranch(): prepends to list, deduplicates, caps at 5
 *   - checkout(): passes GitCheckoutParams through; returns dirty:true from backend
 *   - startListening(): posting window message with type 'git:status-update' triggers refreshBranches()
 *
 * `rpcCall` is mocked at the module boundary.
 * VSCodeService is provided as a minimal stub.
 *
 * Source-under-test:
 *   libs/frontend/editor/src/lib/services/git-branches.service.ts
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { GitBranchesService } from './git-branches.service';

// ---------------------------------------------------------------------------
// Mock rpcCall from @ptah-extension/core
// ---------------------------------------------------------------------------
const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  // Preserve the original module's non-mocked exports (VSCodeService etc.)
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

// ---------------------------------------------------------------------------
// Minimal VSCodeService stub
// ---------------------------------------------------------------------------
function makeVscodeStub() {
  const _config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/test-workspace',
    workspaceName: 'test',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: false,
  });

  return {
    config: _config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeRpcSuccess<T>(data: T): Promise<{ success: boolean; data: T }> {
  return Promise.resolve({ success: true, data });
}

const EMPTY_BRANCHES = { current: '', local: [], remote: [] };
const EMPTY_STASH = { count: 0, entries: [] };
const EMPTY_COMMIT = {
  hash: '',
  shortHash: '',
  subject: '',
  body: '',
  author: '',
  authorEmail: '',
  time: 0,
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GitBranchesService (TASK_2026_111)', () => {
  let service: GitBranchesService;
  let vscode: ReturnType<typeof makeVscodeStub>;

  beforeEach(() => {
    jest.clearAllMocks();
    vscode = makeVscodeStub();

    // Default: all rpcCalls succeed with empty results
    mockRpcCall.mockResolvedValue({ success: true, data: EMPTY_BRANCHES });

    TestBed.configureTestingModule({
      providers: [
        GitBranchesService,
        { provide: VSCodeService, useValue: vscode },
      ],
    });

    service = TestBed.inject(GitBranchesService);
  });

  afterEach(() => {
    // Clean up any message listeners added during the test
    service.stopListening();
    TestBed.resetTestingModule();
  });

  // ==========================================================================
  // Initial state
  // ==========================================================================

  describe('initial state', () => {
    it('branches signal is empty', () => {
      expect(service.branches()).toEqual(EMPTY_BRANCHES);
    });

    it('stashCount signal is 0', () => {
      expect(service.stashCount()).toBe(0);
    });

    it('lastCommit signal is null', () => {
      expect(service.lastCommit()).toBeNull();
    });

    it('remotes signal is empty array', () => {
      expect(service.remotes()).toEqual([]);
    });

    it('isLoading signal is false', () => {
      expect(service.isLoading()).toBe(false);
    });

    it('recentBranches signal is empty array', () => {
      expect(service.recentBranches()).toEqual([]);
    });

    it('currentBranch computed returns empty string', () => {
      expect(service.currentBranch()).toBe('');
    });

    it('localBranches computed returns empty array', () => {
      expect(service.localBranches()).toEqual([]);
    });

    it('remoteBranches computed returns empty array', () => {
      expect(service.remoteBranches()).toEqual([]);
    });
  });

  // ==========================================================================
  // refreshBranches
  // ==========================================================================

  describe('refreshBranches()', () => {
    it('calls rpcCall for git:branches with includeRemote:true', async () => {
      mockRpcCall.mockResolvedValue({ success: true, data: EMPTY_BRANCHES });

      await service.refreshBranches();

      const branchesCall = mockRpcCall.mock.calls.find(
        ([, method]: [unknown, string]) => method === 'git:branches',
      );
      expect(branchesCall).toBeDefined();
      expect(branchesCall?.[2]).toMatchObject({ includeRemote: true });
    });

    it('calls rpcCall for git:stashList', async () => {
      mockRpcCall.mockResolvedValue({ success: true, data: EMPTY_STASH });

      await service.refreshBranches();

      const stashCall = mockRpcCall.mock.calls.find(
        ([, method]: [unknown, string]) => method === 'git:stashList',
      );
      expect(stashCall).toBeDefined();
    });

    it('calls rpcCall for git:lastCommit', async () => {
      mockRpcCall.mockResolvedValue({ success: true, data: EMPTY_COMMIT });

      await service.refreshBranches();

      const commitCall = mockRpcCall.mock.calls.find(
        ([, method]: [unknown, string]) => method === 'git:lastCommit',
      );
      expect(commitCall).toBeDefined();
    });

    it('updates _branches signal from git:branches result', async () => {
      const branchData = {
        current: 'feat/my-branch',
        local: [
          {
            name: 'feat/my-branch',
            isRemote: false,
            ahead: 1,
            behind: 0,
            isCurrent: true,
          },
        ],
        remote: [],
      };
      const stashData = { count: 2, entries: [] };

      mockRpcCall.mockImplementation((_vscode: unknown, method: string) => {
        if (method === 'git:branches') return makeRpcSuccess(branchData);
        if (method === 'git:stashList') return makeRpcSuccess(stashData);
        if (method === 'git:lastCommit') return makeRpcSuccess(EMPTY_COMMIT);
        return makeRpcSuccess(null);
      });

      await service.refreshBranches();

      expect(service.currentBranch()).toBe('feat/my-branch');
      expect(service.localBranches()).toHaveLength(1);
    });

    it('updates _stashCount signal from git:stashList result', async () => {
      const stashData = { count: 3, entries: [] };

      mockRpcCall.mockImplementation((_vscode: unknown, method: string) => {
        if (method === 'git:branches') return makeRpcSuccess(EMPTY_BRANCHES);
        if (method === 'git:stashList') return makeRpcSuccess(stashData);
        if (method === 'git:lastCommit') return makeRpcSuccess(EMPTY_COMMIT);
        return makeRpcSuccess(null);
      });

      await service.refreshBranches();

      expect(service.stashCount()).toBe(3);
    });

    it('updates _lastCommit signal from git:lastCommit result', async () => {
      const commitData = {
        hash: 'abc123',
        shortHash: 'abc123',
        subject: 'feat: branch picker',
        body: '',
        author: 'Dev',
        authorEmail: 'dev@example.com',
        time: 1700000000000,
      };

      mockRpcCall.mockImplementation((_vscode: unknown, method: string) => {
        if (method === 'git:branches') return makeRpcSuccess(EMPTY_BRANCHES);
        if (method === 'git:stashList') return makeRpcSuccess(EMPTY_STASH);
        if (method === 'git:lastCommit') return makeRpcSuccess(commitData);
        return makeRpcSuccess(null);
      });

      await service.refreshBranches();

      expect(service.lastCommit()?.subject).toBe('feat: branch picker');
      expect(service.lastCommit()?.time).toBe(1700000000000);
    });

    it('sets isLoading to true during refresh then false after', async () => {
      const loadingStates: boolean[] = [];

      // Intercept to capture loading state mid-flight
      let resolveAll!: () => void;
      const blocker = new Promise<void>((res) => {
        resolveAll = res;
      });

      mockRpcCall.mockImplementation(async () => {
        await blocker;
        return { success: true, data: EMPTY_BRANCHES };
      });

      const refreshPromise = service.refreshBranches();
      // At this point the refresh is in-flight
      loadingStates.push(service.isLoading());

      resolveAll();
      await refreshPromise;
      loadingStates.push(service.isLoading());

      expect(loadingStates).toEqual([true, false]);
    });

    it('does not throw when an RPC call fails (resilient)', async () => {
      mockRpcCall.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(service.refreshBranches()).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // recordVisitedBranch
  // ==========================================================================

  describe('recordVisitedBranch()', () => {
    it('adds branch to the front of the list', () => {
      service.recordVisitedBranch('feat/x');

      expect(service.recentBranches()[0]).toBe('feat/x');
    });

    it('deduplicates: calling twice with the same name yields one entry', () => {
      service.recordVisitedBranch('feat/x');
      service.recordVisitedBranch('feat/x');

      expect(service.recentBranches()).toHaveLength(1);
      expect(service.recentBranches()[0]).toBe('feat/x');
    });

    it('moves existing entry to front when re-recorded', () => {
      service.recordVisitedBranch('feat/a');
      service.recordVisitedBranch('feat/b');
      service.recordVisitedBranch('feat/a'); // re-record 'a'

      expect(service.recentBranches()[0]).toBe('feat/a');
      expect(service.recentBranches()[1]).toBe('feat/b');
      expect(service.recentBranches()).toHaveLength(2);
    });

    it('caps list at 5 entries (max recent branches)', () => {
      for (let i = 1; i <= 6; i++) {
        service.recordVisitedBranch(`feat/branch-${i}`);
      }

      expect(service.recentBranches()).toHaveLength(5);
      // Most recent (branch-6) should be first
      expect(service.recentBranches()[0]).toBe('feat/branch-6');
      // Oldest (branch-1) should be evicted
      expect(service.recentBranches()).not.toContain('feat/branch-1');
    });

    it('persists the updated list to VSCodeService state', () => {
      service.recordVisitedBranch('feat/x');

      expect(vscode.setState).toHaveBeenCalled();
    });

    it('ignores empty branch name', () => {
      service.recordVisitedBranch('');

      expect(service.recentBranches()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // checkout
  // ==========================================================================

  describe('checkout()', () => {
    it('returns { success: true } on successful checkout', async () => {
      mockRpcCall.mockResolvedValueOnce({
        success: true,
        data: { success: true },
      });

      const result = await service.checkout({ branch: 'main' });

      expect(result.success).toBe(true);
    });

    it('passes dirty:true through from backend without throwing', async () => {
      mockRpcCall.mockResolvedValueOnce({
        success: true,
        data: { success: false, dirty: true },
      });

      const result = await service.checkout({ branch: 'feat/x', force: false });

      expect(result.success).toBe(false);
      expect(result.dirty).toBe(true);
    });

    it('returns { success: false, error } when RPC transport fails', async () => {
      mockRpcCall.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.checkout({ branch: 'main' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  // ==========================================================================
  // startListening / window message dispatch
  // ==========================================================================

  describe('startListening()', () => {
    it('triggers refreshBranches() when git:status-update message is dispatched', async () => {
      // Spy on refreshBranches
      const refreshSpy = jest
        .spyOn(service, 'refreshBranches')
        .mockResolvedValue();

      service.startListening();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'git:status-update', payload: {} },
        }),
      );

      // Allow the microtask from the event handler to flush
      await Promise.resolve();

      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT trigger refreshBranches() for unrelated message types', async () => {
      const refreshSpy = jest
        .spyOn(service, 'refreshBranches')
        .mockResolvedValue();

      service.startListening();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'file:content-changed', payload: {} },
        }),
      );

      await Promise.resolve();

      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('is idempotent: calling startListening() twice does not double-register', async () => {
      const refreshSpy = jest
        .spyOn(service, 'refreshBranches')
        .mockResolvedValue();

      service.startListening();
      service.startListening(); // second call is no-op

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'git:status-update' },
        }),
      );

      await Promise.resolve();

      // Should only fire once despite two startListening() calls
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('stopListening() removes the listener so subsequent messages are ignored', async () => {
      const refreshSpy = jest
        .spyOn(service, 'refreshBranches')
        .mockResolvedValue();

      service.startListening();
      service.stopListening();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'git:status-update' },
        }),
      );

      await Promise.resolve();

      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });
});
