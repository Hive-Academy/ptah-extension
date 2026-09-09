/**
 * WorktreeService — unit specs for the `MessageHandler` conversion.
 *
 * The service used to own a raw `window.addEventListener('message', …)`.
 * Dispatch now belongs to `MessageRouterService`, which routes
 * `git:worktreeChanged` by literal type string — the message is deliberately
 * NOT a member of `MESSAGE_TYPES`, and the wire contract must not move.
 *
 * `rpcCall` is mocked at the module boundary; `VSCodeService` and
 * `ElectronLayoutService` are provided as minimal stubs.
 *
 * Source-under-test:
 *   libs/frontend/git-ui/src/lib/services/worktree.service.ts
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import {
  WORKTREE_CHANGED_MESSAGE_TYPE,
  WorktreeService,
} from './worktree.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

function makeVscodeStub(platform = 'linux') {
  return {
    config: signal({
      isVSCode: false,
      theme: 'dark',
      workspaceRoot: '/test-workspace',
      workspaceName: 'test',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: '',
      isElectron: true,
      platform,
    }).asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
  };
}

function makeLayoutStub() {
  return {
    workspaceFolders: signal<{ path: string; name: string }[]>([]),
    addFolderByPath: jest.fn().mockResolvedValue(undefined),
    removeFolder: jest.fn().mockResolvedValue(true),
  };
}

describe('WorktreeService as a MessageHandler', () => {
  let service: WorktreeService;
  let layout: ReturnType<typeof makeLayoutStub>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRpcCall.mockReset();
    layout = makeLayoutStub();

    TestBed.configureTestingModule({
      providers: [
        WorktreeService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
        { provide: ElectronLayoutService, useValue: layout },
      ],
    });

    service = TestBed.inject(WorktreeService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('declares the literal git:worktreeChanged type', () => {
    expect(service.handledMessageTypes).toEqual(['git:worktreeChanged']);
    expect(WORKTREE_CHANGED_MESSAGE_TYPE).toBe('git:worktreeChanged');
  });

  it('registers NO global message listener at construction', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        WorktreeService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
        { provide: ElectronLayoutService, useValue: makeLayoutStub() },
      ],
    });
    TestBed.inject(WorktreeService);

    expect(
      addSpy.mock.calls.filter(([type]) => type === 'message'),
    ).toHaveLength(0);
    addSpy.mockRestore();
  });

  it('refreshes a synchronous UI creation without opening the folder', async () => {
    mockRpcCall.mockImplementation((_vscode, method: string) => {
      if (method === 'git:addWorktree') {
        return Promise.resolve({
          success: true,
          data: {
            success: true,
            worktreePath: '/repo/.claude-worktrees/feature-x',
          },
        });
      }
      return Promise.resolve({ success: true, data: { worktrees: [] } });
    });

    await expect(service.addWorktree('feature/x')).resolves.toEqual({
      success: true,
    });

    expect(layout.addFolderByPath).not.toHaveBeenCalled();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:worktrees',
      {},
    );
  });
  it('resolves a correlated created push and refreshes without opening the folder', async () => {
    // The backend acks the RPC as pending, then completes it out of band.
    mockRpcCall.mockImplementation((_vscode, method: string) => {
      if (method === 'git:addWorktree') {
        return Promise.resolve({
          success: true,
          data: { success: true, pending: true },
        });
      }
      // git:worktrees — the post-completion reconcile.
      return Promise.resolve({ success: true, data: { worktrees: [] } });
    });

    const addPromise = service.addWorktree('feature/x');

    // Let the ack settle so the pending op is registered.
    await Promise.resolve();
    await Promise.resolve();

    const addCall = mockRpcCall.mock.calls.find(
      ([, method]) => method === 'git:addWorktree',
    );
    const operationId = (addCall?.[2] as { operationId: string }).operationId;
    expect(operationId).toBeTruthy();

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: {
        action: 'created',
        operationId,
        success: true,
        path: '/repo/.worktrees/feature-x',
      },
    });

    await expect(addPromise).resolves.toEqual({ success: true });
    expect(layout.addFolderByPath).not.toHaveBeenCalled();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:worktrees',
      {},
    );
    expect(service.isLoading()).toBe(false);
  });

  it('refreshes an unknown correlated created push without opening the folder', async () => {
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { worktrees: [] },
    });

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: {
        action: 'created',
        operationId: 'created-by-another-renderer',
        path: '/repo/.claude-worktrees/background-agent',
      },
    });
    await Promise.resolve();

    expect(layout.addFolderByPath).not.toHaveBeenCalled();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:worktrees',
      {},
    );
  });
  it('refreshes an uncorrelated created push without opening or switching workspaces', async () => {
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { worktrees: [] },
    });

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: {
        action: 'created',
        path: '/repo/.claude-worktrees/background-agent',
      },
    });
    await Promise.resolve();

    expect(layout.addFolderByPath).not.toHaveBeenCalled();
    expect(layout.removeFolder).not.toHaveBeenCalled();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:worktrees',
      {},
    );
  });

  it('reports partial failure when Git removes an open worktree but workspace close is cancelled', async () => {
    layout.workspaceFolders.set([
      { path: '/repo/.claude-worktrees/open', name: 'open' },
    ]);
    layout.removeFolder.mockResolvedValue(false);
    mockRpcCall.mockImplementation((_vscode, method: string) => {
      if (method === 'git:removeWorktree') {
        return Promise.resolve({
          success: true,
          data: { success: true, pending: false },
        });
      }
      return Promise.resolve({ success: true, data: { worktrees: [] } });
    });

    await expect(
      service.removeWorktree('/repo/.claude-worktrees/open'),
    ).resolves.toEqual({
      success: false,
      error:
        'Open worktree workspace could not be closed; Git removal was cancelled.',
    });
  });

  it('reports partial failure when workspace removal throws', async () => {
    layout.workspaceFolders.set([
      { path: '/repo/.claude-worktrees/open', name: 'open' },
    ]);
    layout.removeFolder.mockRejectedValue(new Error('workspace RPC failed'));
    mockRpcCall.mockImplementation((_vscode, method: string) => {
      if (method === 'git:removeWorktree') {
        return Promise.resolve({
          success: true,
          data: { success: true, pending: false },
        });
      }
      return Promise.resolve({ success: true, data: { worktrees: [] } });
    });

    await expect(
      service.removeWorktree('/repo/.claude-worktrees/open'),
    ).resolves.toEqual({ success: false, error: 'workspace RPC failed' });
  });

  it('keeps an already-deleted open worktree registered when notification cleanup is cancelled', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    layout.workspaceFolders.set([
      { path: '/repo/.claude-worktrees/open', name: 'open' },
    ]);
    layout.removeFolder.mockResolvedValue(false);
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { worktrees: [] },
    });

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: {
        action: 'removed',
        path: '/repo/.claude-worktrees/open',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(layout.removeFolder).toHaveBeenCalledWith(0);
    expect(layout.workspaceFolders()).toEqual([
      { path: '/repo/.claude-worktrees/open', name: 'open' },
    ]);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:worktrees',
      {},
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[WorktreeService] Failed to close removed worktree workspace',
      expect.objectContaining({
        message:
          'Open worktree workspace could not be closed; Git removal was cancelled.',
      }),
    );
    consoleError.mockRestore();
  });
  it('ignores an unknown failed removal event without unregistering a valid folder', async () => {
    layout.workspaceFolders.set([
      { path: '/repo/.claude-worktrees/valid', name: 'valid' },
    ]);

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: {
        action: 'removed',
        operationId: 'unknown-operation',
        success: false,
        path: '/repo/.claude-worktrees/valid',
      },
    });
    await Promise.resolve();

    expect(layout.removeFolder).not.toHaveBeenCalled();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('keeps POSIX paths case-sensitive when reconciling removal', async () => {
    TestBed.resetTestingModule();
    layout = makeLayoutStub();
    layout.workspaceFolders.set([{ path: '/repo/Open', name: 'Open' }]);
    TestBed.configureTestingModule({
      providers: [
        WorktreeService,
        { provide: VSCodeService, useValue: makeVscodeStub('linux') },
        { provide: ElectronLayoutService, useValue: layout },
      ],
    });
    service = TestBed.inject(WorktreeService);
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { worktrees: [] },
    });

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: { action: 'removed', path: '/repo/open' },
    });
    await Promise.resolve();

    expect(layout.removeFolder).not.toHaveBeenCalled();
  });

  it('matches Windows paths case- and separator-insensitively', async () => {
    TestBed.resetTestingModule();
    layout = makeLayoutStub();
    layout.workspaceFolders.set([{ path: 'D:\\Repo\\Open', name: 'Open' }]);
    TestBed.configureTestingModule({
      providers: [
        WorktreeService,
        { provide: VSCodeService, useValue: makeVscodeStub('win32') },
        { provide: ElectronLayoutService, useValue: layout },
      ],
    });
    service = TestBed.inject(WorktreeService);
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { worktrees: [] },
    });

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: { action: 'removed', path: 'd:/repo/open/' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(layout.removeFolder).toHaveBeenCalledWith(0);
  });
  it('unregisters an uncorrelated removed worktree only when it is open', async () => {
    layout.workspaceFolders.set([
      { path: '/repo', name: 'repo' },
      { path: '/repo/.claude-worktrees/open', name: 'open' },
    ]);
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { worktrees: [] },
    });

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: {
        action: 'removed',
        path: '/repo/.claude-worktrees/open/',
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(layout.removeFolder).toHaveBeenCalledWith(1);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:worktrees',
      {},
    );
  });

  it('does not unregister an uncorrelated removed worktree that was never opened', async () => {
    layout.workspaceFolders.set([{ path: '/repo', name: 'repo' }]);
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { worktrees: [] },
    });

    service.handleMessage({
      type: WORKTREE_CHANGED_MESSAGE_TYPE,
      payload: {
        action: 'removed',
        path: '/repo/.claude-worktrees/unopened',
      },
    });
    await Promise.resolve();

    expect(layout.removeFolder).not.toHaveBeenCalled();
  });
  it('ignores an unrelated message type', () => {
    service.handleMessage({
      type: 'git:status-update',
      payload: { action: 'created', path: '/repo/wt' },
    });

    expect(layout.addFolderByPath).not.toHaveBeenCalled();
    expect(mockRpcCall).not.toHaveBeenCalled();
  });
});
