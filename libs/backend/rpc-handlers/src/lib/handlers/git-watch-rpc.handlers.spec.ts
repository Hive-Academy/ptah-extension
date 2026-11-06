/**
 * GitWatchRpcHandlers — unit specs (TASK_2026_855 component 4).
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/git-watch-rpc.handlers.ts
 */

import 'reflect-metadata';

import type {
  GitInfoService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { FileType } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IGitRootWatchRegistry,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { GitWatchRootsResult } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { GitWatchRpcHandlers } from './git-watch-rpc.handlers';

const FOLDER = '/workspace';
const WORKTREE = '/workspace/.claude-worktrees/feature';

type MockGitInfo = jest.Mocked<
  Pick<
    GitInfoService,
    | 'probeWorktreeList'
    | 'probeCommonDir'
    | 'probeEpoch'
    | 'invalidateProbeReadCache'
  >
>;
type WorktreeListRead = Awaited<
  ReturnType<GitInfoService['probeWorktreeList']>
>;

const LISTED: WorktreeListRead = {
  kind: 'listed',
  worktrees: [
    { path: FOLDER, branch: 'main', head: 'a', isMain: true, isBare: false },
    {
      path: WORKTREE,
      branch: 'feature',
      head: 'b',
      isMain: false,
      isBare: false,
    },
  ],
};
const FAILED: WorktreeListRead = {
  kind: 'failed',
  cause: new Error('git timed out'),
};
type MockRegistry = jest.Mocked<IGitRootWatchRegistry>;

interface Suite {
  rpc: MockRpcHandler;
  registry: MockRegistry;
  logger: MockLogger;
  gitInfo: MockGitInfo;
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider({ folders: [FOLDER] });
  const gitInfo: MockGitInfo = {
    probeWorktreeList: jest.fn().mockResolvedValue(LISTED),
    probeCommonDir: jest
      .fn()
      .mockResolvedValue({ kind: 'dir', path: '/workspace/.git' }),
    probeEpoch: jest.fn(() => 0),
    invalidateProbeReadCache: jest.fn(),
  };
  const fileSystem = createMockFileSystemProvider();
  fileSystem.stat.mockResolvedValue({
    type: FileType.Directory,
    ctime: 0,
    mtime: 0,
    size: 0,
  });
  const registry: MockRegistry = {
    setLease: jest.fn((_leaseId: string, roots: readonly string[]) => ({
      watched: roots,
      evicted: [],
    })),
  };
  new GitWatchRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    workspace as unknown as IWorkspaceProvider,
    gitInfo as unknown as GitInfoService,
    fileSystem as unknown as IFileSystemProvider,
    registry,
  ).register();
  return { rpc, registry, logger, gitInfo };
}

function watchRoots(
  rpc: MockRpcHandler,
): (params: unknown) => Promise<GitWatchRootsResult> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<GitWatchRootsResult>]
  >;
  const match = calls.find(([name]) => name === 'git:watchRoots');
  if (!match) throw new Error('git:watchRoots was not registered');
  return match[1];
}

describe('GitWatchRpcHandlers', () => {
  it('joins simultaneous renewals for the same lease', async () => {
    const { rpc, registry, gitInfo } = buildSuite();
    let release: (() => void) | undefined;
    let notifyStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    gitInfo.probeWorktreeList.mockImplementation(async () => {
      notifyStarted?.();
      await gate;
      return LISTED;
    });
    const send = watchRoots(rpc);
    const first = send({ leaseId: 'lease-1', roots: [WORKTREE] });
    const second = send({ leaseId: 'lease-1', roots: [WORKTREE] });
    await started;
    expect(gitInfo.probeWorktreeList).toHaveBeenCalledTimes(1);
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { watched: [WORKTREE], rejected: [], evicted: [] },
      { watched: [WORKTREE], rejected: [], evicted: [] },
    ]);
    expect(registry.setLease).toHaveBeenCalledTimes(1);
  });

  // Review #8: a renewal with other roots must not be answered by the
  // running call for the old set.
  it('runs a call with different roots after the running one, not inside it', async () => {
    const { rpc, registry, gitInfo } = buildSuite();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    gitInfo.probeWorktreeList.mockImplementationOnce(async () => {
      await gate;
      return LISTED;
    });
    const send = watchRoots(rpc);
    const first = send({ leaseId: 'lease-1', roots: [WORKTREE] });
    const second = send({ leaseId: 'lease-1', roots: [FOLDER] });
    await Promise.resolve();
    expect(registry.setLease).not.toHaveBeenCalled();
    release?.();

    await expect(first).resolves.toMatchObject({ watched: [WORKTREE] });
    await expect(second).resolves.toMatchObject({ watched: [FOLDER] });
    expect(registry.setLease.mock.calls).toEqual([
      ['lease-1', [WORKTREE]],
      ['lease-1', [FOLDER]],
    ]);
  });

  // Review #5: one root whose probe fails must not hold back the others.
  it('applies the roots that resolved and keeps a failed root only if the lease held it', async () => {
    const { rpc, registry, gitInfo, logger } = buildSuite();
    const send = watchRoots(rpc);
    await send({ leaseId: 'lease-1', roots: [WORKTREE] });
    gitInfo.probeWorktreeList.mockResolvedValue(FAILED);
    // A watcher event drops the cached confirmation.
    gitInfo.probeEpoch.mockReturnValue(1);

    await expect(
      send({ leaseId: 'lease-1', roots: [FOLDER, WORKTREE] }),
    ).resolves.toEqual({
      watched: [FOLDER, WORKTREE],
      rejected: [],
      evicted: [],
    });
    expect(registry.setLease).toHaveBeenLastCalledWith('lease-1', [
      FOLDER,
      WORKTREE,
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[GitWatchRpc] git:watchRoots probe failed; keeping those roots from the previous lease',
      expect.objectContaining({ leaseId: 'lease-1', failed: 1 }),
    );

    const other = '/workspace/.claude-worktrees/other';
    await expect(
      send({ leaseId: 'lease-1', roots: [FOLDER, other] }),
    ).resolves.toEqual({ watched: [FOLDER], rejected: [], evicted: [] });
    expect(registry.setLease).toHaveBeenLastCalledWith('lease-1', [FOLDER]);
  });

  it('answers the retryable error, keeping the held roots, when every root fails', async () => {
    const { rpc, registry, gitInfo } = buildSuite();
    const send = watchRoots(rpc);
    await send({ leaseId: 'lease-1', roots: [WORKTREE] });
    gitInfo.probeWorktreeList.mockResolvedValue(FAILED);
    // A watcher event drops the cached confirmation.
    gitInfo.probeEpoch.mockReturnValue(1);

    await expect(
      send({ leaseId: 'lease-1', roots: [WORKTREE] }),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_PROBE_FAILED' });
    expect(registry.setLease).toHaveBeenLastCalledWith('lease-1', [WORKTREE]);
  });

  it('caps the whole resolve below the renderer timeout', async () => {
    jest.useFakeTimers();
    try {
      const { rpc, gitInfo } = buildSuite();
      gitInfo.probeWorktreeList.mockImplementation(
        () => new Promise<WorktreeListRead>(() => undefined),
      );
      const pending = watchRoots(rpc)({
        leaseId: 'lease-1',
        roots: [WORKTREE],
      });
      jest.advanceTimersByTime(25_000);
      await expect(pending).rejects.toMatchObject({
        errorCode: 'GIT_ROOT_PROBE_FAILED',
      });
    } finally {
      jest.useRealTimers();
    }
  });
  it('owns exactly git:watchRoots', () => {
    const { rpc } = buildSuite();

    expect(GitWatchRpcHandlers.METHODS).toEqual(['git:watchRoots']);
    expect(
      (rpc.registerMethod as jest.Mock).mock.calls.map(([name]) => name),
    ).toEqual(['git:watchRoots']);
  });

  it('forwards validated roots in their canonical spelling, de-duplicated', async () => {
    const { rpc, registry } = buildSuite();

    const result = await watchRoots(rpc)({
      leaseId: 'lease-1',
      roots: [`${WORKTREE}/`, WORKTREE, `${FOLDER}/`],
    });

    expect(registry.setLease).toHaveBeenCalledWith('lease-1', [
      WORKTREE,
      FOLDER,
    ]);
    expect(result).toEqual({
      watched: [WORKTREE, FOLDER],
      rejected: [],
      evicted: [],
    });
  });

  it('rejects a foreign root and never forwards it', async () => {
    const { rpc, registry, logger } = buildSuite();

    const result = await watchRoots(rpc)({
      leaseId: 'lease-1',
      roots: ['/elsewhere', WORKTREE],
    });

    expect(registry.setLease).toHaveBeenCalledWith('lease-1', [WORKTREE]);
    expect(result.rejected).toEqual(['/elsewhere']);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reports the registry eviction outcome', async () => {
    const { rpc, registry } = buildSuite();
    registry.setLease.mockReturnValueOnce({
      watched: [WORKTREE],
      evicted: [FOLDER],
    });

    await expect(
      watchRoots(rpc)({ leaseId: 'lease-1', roots: [WORKTREE, FOLDER] }),
    ).resolves.toEqual({
      watched: [WORKTREE],
      rejected: [],
      evicted: [FOLDER],
    });
  });

  it('releases the lease with an empty set', async () => {
    const { rpc, registry } = buildSuite();

    await watchRoots(rpc)({ leaseId: 'lease-1', roots: [] });

    expect(registry.setLease).toHaveBeenCalledWith('lease-1', []);
  });

  it.each([
    ['no params', undefined, []],
    ['an empty lease id', { leaseId: '', roots: [FOLDER] }, [FOLDER]],
    [
      'an oversized lease id',
      { leaseId: 'x'.repeat(129), roots: [FOLDER] },
      [FOLDER],
    ],
    [
      'more than 8 roots',
      { leaseId: 'l', roots: Array.from({ length: 9 }, () => FOLDER) },
      Array.from({ length: 9 }, () => FOLDER),
    ],
    ['a non-array roots', { leaseId: 'l', roots: FOLDER }, []],
    [
      'an unknown key',
      { leaseId: 'l', roots: [FOLDER], force: true },
      [FOLDER],
    ],
  ])(
    'rejects %s without touching the registry',
    async (_label, params, rejected) => {
      const { rpc, registry, logger } = buildSuite();

      await expect(watchRoots(rpc)(params)).resolves.toEqual({
        watched: [],
        rejected,
        evicted: [],
      });
      expect(registry.setLease).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    },
  );

  it('answers an empty result when the registry throws', async () => {
    const { rpc, registry, logger } = buildSuite();
    registry.setLease.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(
      watchRoots(rpc)({ leaseId: 'lease-1', roots: [FOLDER] }),
    ).resolves.toEqual({ watched: [], rejected: [], evicted: [] });
    expect(logger.error).toHaveBeenCalledWith(
      '[GitWatchRpc] git:watchRoots lease update failed',
      expect.any(Error),
    );
  });
});
