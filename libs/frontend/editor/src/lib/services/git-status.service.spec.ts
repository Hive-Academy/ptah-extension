/**
 * GitStatusService — switch-freshness specs (F2, TASK_2026_154).
 *
 * Focus: `switchWorkspace` should NOT re-fetch `git:info` when the restored
 * cache entry was fetched within the freshness window; it MUST still fetch when
 * the entry is missing or stale. Watcher pushes and the initial listen fetch
 * are unaffected.
 *
 * `rpcCall` is mocked at the module boundary; VSCodeService is a minimal stub.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import type { GitInfoResult } from '@ptah-extension/shared';
import { GitStatusService } from './git-status.service';

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

function makeVscodeStub() {
  const _config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
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

function gitInfo(overrides: Partial<GitInfoResult> = {}): GitInfoResult {
  return {
    branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
    files: [{ path: 'a.ts', status: 'M', staged: false, isDirectory: false }],
    isGitRepo: true,
    ...overrides,
  } as GitInfoResult;
}

function rpcOk(data: GitInfoResult) {
  return { success: true, data };
}

describe('GitStatusService.switchWorkspace freshness (F2)', () => {
  let service: GitStatusService;

  beforeEach(() => {
    mockRpcCall.mockReset();
    TestBed.configureTestingModule({
      providers: [
        GitStatusService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });
    service = TestBed.inject(GitStatusService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('fetches git:info on first switch to an uncached workspace', async () => {
    mockRpcCall.mockResolvedValue(rpcOk(gitInfo()));
    service.switchWorkspace('/ws/a');
    await Promise.resolve();
    expect(mockRpcCall).toHaveBeenCalledWith(expect.anything(), 'git:info', {
      workspaceRoot: '/ws/a',
    });
  });

  it('skips the eager fetch when switching back within the freshness window', async () => {
    // Populate /ws/a with freshly fetched data.
    mockRpcCall.mockResolvedValue(rpcOk(gitInfo()));
    service.switchWorkspace('/ws/a');
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRpcCall).toHaveBeenCalledTimes(1);

    // Switch to B (uncached → fetch), then back to A (fresh → skip).
    mockRpcCall.mockClear();
    mockRpcCall.mockResolvedValue(rpcOk(gitInfo({ isGitRepo: true })));
    service.switchWorkspace('/ws/b');
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRpcCall).toHaveBeenCalledTimes(1); // B fetched

    mockRpcCall.mockClear();
    service.switchWorkspace('/ws/a');
    await Promise.resolve();
    // A was fetched < 5s ago → no redundant fetch.
    expect(mockRpcCall).not.toHaveBeenCalled();

    // Cached signals are restored.
    expect(service.isGitRepo()).toBe(true);
    expect(service.branchName()).toBe('main');
  });

  it('fetches again when the cached entry is stale (older than the TTL)', async () => {
    mockRpcCall.mockResolvedValue(rpcOk(gitInfo()));
    service.switchWorkspace('/ws/a');
    await Promise.resolve();
    await Promise.resolve();

    // Move to B.
    service.switchWorkspace('/ws/b');
    await Promise.resolve();
    await Promise.resolve();

    // Simulate time passing beyond the freshness TTL (5s).
    const realNow = Date.now;
    const advanced = realNow() + 6_000;
    jest.spyOn(Date, 'now').mockReturnValue(advanced);

    mockRpcCall.mockClear();
    service.switchWorkspace('/ws/a');
    await Promise.resolve();
    expect(mockRpcCall).toHaveBeenCalledWith(expect.anything(), 'git:info', {
      workspaceRoot: '/ws/a',
    });

    (Date.now as jest.Mock).mockRestore();
  });

  it('a git:status-update push refreshes the fresh cache so switch-back still skips', async () => {
    mockRpcCall.mockResolvedValue(rpcOk(gitInfo()));
    service.startListening(); // active = null until switch; fires initial fetch
    await Promise.resolve();

    service.switchWorkspace('/ws/a');
    await Promise.resolve();
    await Promise.resolve();

    // A push for /ws/a keeps it fresh.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'git:status-update',
          payload: {
            ...gitInfo({ isGitRepo: true }),
            workspaceRoot: '/ws/a',
          },
        },
      }),
    );
    await Promise.resolve();

    service.switchWorkspace('/ws/b');
    await Promise.resolve();
    await Promise.resolve();
    mockRpcCall.mockClear();

    service.switchWorkspace('/ws/a');
    await Promise.resolve();
    expect(mockRpcCall).not.toHaveBeenCalled();

    service.stopListening();
  });
});
