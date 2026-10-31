/**
 * GitRootResolver — unit specs (TASK_2026_855 component 3, D17).
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/git-root-resolver.ts
 */

import 'reflect-metadata';
import { FileType } from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';

import {
  GIT_ROOT_UNAVAILABLE_MESSAGE,
  GitRootResolver,
  READ_PROBE_TTL_MS,
  createWorktreeRootProbe,
} from './git-root-resolver';
import type { WorktreeRootProbe } from './git-workspace-root';

const FOLDER = '/workspace';
const WORKTREE = '/workspace/.claude-worktrees/feature';

type ProbeMock = {
  [K in keyof WorktreeRootProbe]: jest.MockedFunction<WorktreeRootProbe[K]>;
};

function createProbe(): ProbeMock {
  return {
    listWorktrees: jest.fn().mockResolvedValue([
      { path: FOLDER, prunable: false },
      { path: WORKTREE, prunable: false },
    ]),
    commonDir: jest.fn().mockResolvedValue('/workspace/.git'),
    directoryExists: jest.fn().mockResolvedValue(true),
  };
}

function build(
  folders: string[] = [FOLDER],
  now: () => number = () => 0,
): {
  resolver: GitRootResolver;
  probe: ProbeMock;
  warn: jest.Mock;
} {
  const probe = createProbe();
  const warn = jest.fn();
  const resolver = new GitRootResolver({
    workspace: createMockWorkspaceProvider({ folders }),
    probe,
    warn,
    platform: 'linux',
    now,
  });
  return { resolver, probe, warn };
}

describe('GitRootResolver', () => {
  it('returns the active workspace root when no root is named', async () => {
    const { resolver, probe } = build();

    await expect(
      resolver.resolve(undefined, 'git:info', 'folder-or-worktree'),
    ).resolves.toBe(FOLDER);
    expect(probe.listWorktrees).not.toHaveBeenCalled();
  });

  it.each(['folder', 'folder-or-worktree'] as const)(
    'accepts a registered folder under the %s policy, in its registered spelling',
    async (policy) => {
      const { resolver, probe } = build();

      await expect(
        resolver.resolve(`${FOLDER}/`, 'git:stage', policy),
      ).resolves.toBe(FOLDER);
      expect(probe.listWorktrees).not.toHaveBeenCalled();
    },
  );

  it('accepts a live worktree only under the folder-or-worktree policy', async () => {
    const { resolver } = build();

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
    await expect(
      resolver.resolve(WORKTREE, 'git:removeWorktree', 'folder'),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_UNAVAILABLE' });
  });

  it('refuses an unregistered path with a warn and no fallback', async () => {
    const { resolver, warn } = build();

    await expect(
      resolver.resolve('/elsewhere', 'git:commit', 'folder-or-worktree'),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_UNAVAILABLE' });
    expect(warn).toHaveBeenCalledWith(
      '[GitRoot] git:commit refused workspaceRoot',
      {
        method: 'git:commit',
        workspaceRoot: '/elsewhere',
        policy: 'folder-or-worktree',
      },
    );
  });

  it('re-validates on every call: a worktree removed between two calls is refused', async () => {
    const { resolver, probe } = build();

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
    probe.listWorktrees.mockResolvedValue([{ path: FOLDER, prunable: false }]);

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_UNAVAILABLE' });
    expect(probe.listWorktrees).toHaveBeenCalledTimes(2);
  });

  it('refuses a worktree replaced by a directory of another repository', async () => {
    const { resolver, probe } = build();
    probe.commonDir.mockImplementation(async (dir) =>
      dir === WORKTREE ? '/elsewhere/.git' : '/workspace/.git',
    );

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_UNAVAILABLE' });
  });

  it('reads a probe throw as "not a worktree"', async () => {
    const { resolver, probe, warn } = build();
    probe.listWorktrees.mockRejectedValue(new Error('git failed'));

    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_UNAVAILABLE' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('throws a coded GIT_ROOT_UNAVAILABLE error with the worktree message (S2)', async () => {
    const { resolver } = build();

    await expect(
      resolver.resolve('/elsewhere', 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject({
      name: 'RpcUserError',
      errorCode: 'GIT_ROOT_UNAVAILABLE',
      message: GIT_ROOT_UNAVAILABLE_MESSAGE,
    });
  });

  it('shares one worktree probe across concurrent and recent reads (M1)', async () => {
    let clock = 0;
    const { resolver, probe } = build([FOLDER], () => clock);

    await Promise.all([
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
      resolver.resolve(WORKTREE, 'git:diffFile', 'folder-or-worktree'),
    ]);
    await resolver.resolve(WORKTREE, 'git:reviewChanges', 'folder-or-worktree');
    expect(probe.listWorktrees).toHaveBeenCalledTimes(1);

    clock = READ_PROBE_TTL_MS + 1;
    await resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree');
    expect(probe.listWorktrees).toHaveBeenCalledTimes(2);
  });

  it('never reuses a read confirmation for a write (M1)', async () => {
    const { resolver, probe } = build();

    await resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree');
    probe.listWorktrees.mockResolvedValue([{ path: FOLDER, prunable: false }]);

    await expect(
      resolver.resolve(WORKTREE, 'git:stage', 'folder-or-worktree'),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_UNAVAILABLE' });
  });

  it('does not cache a refused read', async () => {
    const { resolver, probe } = build();
    probe.listWorktrees.mockResolvedValueOnce([
      { path: FOLDER, prunable: false },
    ]);

    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).rejects.toMatchObject({ errorCode: 'GIT_ROOT_UNAVAILABLE' });
    await expect(
      resolver.resolve(WORKTREE, 'git:info', 'folder-or-worktree'),
    ).resolves.toBe(WORKTREE);
  });

  it('returns undefined when no root is named and no folder is open', async () => {
    const { resolver } = build([]);

    await expect(
      resolver.resolve(undefined, 'git:info', 'folder-or-worktree'),
    ).resolves.toBeUndefined();
  });
});

describe('createWorktreeRootProbe', () => {
  it('delegates to git and maps a stat to directory existence', async () => {
    const gitInfo = {
      getWorktrees: jest.fn().mockResolvedValue([]),
      getCommonDir: jest.fn().mockResolvedValue('/workspace/.git'),
    };
    const fileSystem = createMockFileSystemProvider();
    fileSystem.stat.mockImplementation(async (dir: string) => {
      if (dir === '/missing') throw new Error('ENOENT');
      return {
        type: dir === '/file' ? FileType.File : FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
      };
    });
    const probe = createWorktreeRootProbe(gitInfo, fileSystem);

    await probe.listWorktrees(FOLDER);
    await probe.commonDir(WORKTREE);
    expect(gitInfo.getWorktrees).toHaveBeenCalledWith(FOLDER);
    expect(gitInfo.getCommonDir).toHaveBeenCalledWith(WORKTREE);
    await expect(probe.directoryExists('/dir')).resolves.toBe(true);
    await expect(probe.directoryExists('/file')).resolves.toBe(false);
    await expect(probe.directoryExists('/missing')).resolves.toBe(false);
  });
});
