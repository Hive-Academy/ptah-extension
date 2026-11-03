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
  Pick<GitInfoService, 'getWorktrees' | 'getCommonDir'>
>;
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
    getWorktrees: jest.fn().mockResolvedValue([
      { path: FOLDER, branch: 'main', head: 'a', isMain: true, isBare: false },
      {
        path: WORKTREE,
        branch: 'feature',
        head: 'b',
        isMain: false,
        isBare: false,
      },
    ]),
    getCommonDir: jest.fn().mockResolvedValue('/workspace/.git'),
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
