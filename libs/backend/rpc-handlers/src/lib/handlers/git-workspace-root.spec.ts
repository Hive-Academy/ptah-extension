import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  findRegisteredWorkspaceFolder,
  findRegisteredWorktree,
  type WorktreeRootProbe,
} from './git-workspace-root';

function workspaceWith(folders: string[]): IWorkspaceProvider {
  return {
    getWorkspaceFolders: () => folders,
  } as unknown as IWorkspaceProvider;
}

describe('findRegisteredWorkspaceFolder', () => {
  it('returns the registered spelling, not the caller one, on win32', () => {
    const workspace = workspaceWith(['D:\\Work\\Repo']);
    expect(
      findRegisteredWorkspaceFolder(workspace, 'd:/work/repo/', 'win32'),
    ).toBe('D:\\Work\\Repo');
  });

  it('ignores case on darwin', () => {
    const workspace = workspaceWith(['/Users/me/Repo']);
    expect(
      findRegisteredWorkspaceFolder(workspace, '/users/me/repo', 'darwin'),
    ).toBe('/Users/me/Repo');
  });

  it('keeps case on linux, where /work/Repo and /work/repo differ', () => {
    const workspace = workspaceWith(['/work/Repo']);
    expect(
      findRegisteredWorkspaceFolder(workspace, '/work/repo', 'linux'),
    ).toBeUndefined();
    expect(
      findRegisteredWorkspaceFolder(workspace, '/work/Repo//', 'linux'),
    ).toBe('/work/Repo');
  });

  it('finds nothing for an unregistered folder', () => {
    const workspace = workspaceWith(['/work/a', '/work/b']);
    expect(
      findRegisteredWorkspaceFolder(workspace, '/work/c', 'linux'),
    ).toBeUndefined();
  });
});

describe('findRegisteredWorktree', () => {
  const WT = '/work/repo/.claude-worktrees/feature';

  function probe(
    overrides: Partial<WorktreeRootProbe> = {},
  ): jest.Mocked<WorktreeRootProbe> {
    return {
      listWorktrees: jest.fn(async () => [
        { path: '/work/repo' },
        { path: WT },
      ]),
      commonDir: jest.fn(async () => '/work/repo/.git'),
      directoryExists: jest.fn(async () => true),
      ...overrides,
    } as jest.Mocked<WorktreeRootProbe>;
  }

  it('accepts a live listed worktree sharing the open folder common dir', async () => {
    await expect(
      findRegisteredWorktree(
        workspaceWith(['/work/repo']),
        probe(),
        `${WT}/`,
        'linux',
      ),
    ).resolves.toBe(WT);
  });

  it('compares common dirs separator- and case-insensitively on win32', async () => {
    const p = probe({
      listWorktrees: jest.fn(async () => [{ path: 'D:/Repo/wt' }]),
      commonDir: jest.fn(async (dir: string) =>
        dir === 'D:/Repo/wt' ? 'd:\\repo\\.git' : 'D:/Repo/.git',
      ),
    });
    await expect(
      findRegisteredWorktree(
        workspaceWith(['D:\\Repo']),
        p,
        'd:\\repo\\wt',
        'win32',
      ),
    ).resolves.toBe('D:/Repo/wt');
  });

  it('refuses a listed worktree whose common dir is another repository', async () => {
    const p = probe({
      commonDir: jest.fn(async (dir: string) =>
        dir === WT ? '/elsewhere/.git' : '/work/repo/.git',
      ),
    });
    await expect(
      findRegisteredWorktree(workspaceWith(['/work/repo']), p, WT, 'linux'),
    ).resolves.toBeUndefined();
  });

  it('refuses when either common dir cannot be read', async () => {
    const p = probe({
      commonDir: jest.fn(async (dir: string) =>
        dir === WT ? null : '/work/repo/.git',
      ),
    });
    await expect(
      findRegisteredWorktree(workspaceWith(['/work/repo']), p, WT, 'linux'),
    ).resolves.toBeUndefined();
  });

  it('refuses a prunable entry and a missing directory without asking git', async () => {
    const prunable = probe({
      listWorktrees: jest.fn(async () => [{ path: WT, prunable: true }]),
    });
    await expect(
      findRegisteredWorktree(workspaceWith(['/work/repo']), prunable, WT, 'linux'),
    ).resolves.toBeUndefined();

    const missing = probe({ directoryExists: jest.fn(async () => false) });
    await expect(
      findRegisteredWorktree(workspaceWith(['/work/repo']), missing, WT, 'linux'),
    ).resolves.toBeUndefined();
    expect(missing.commonDir).not.toHaveBeenCalled();
  });

  it('refuses a UNC path and a folder whose list cannot be read', async () => {
    const unc = probe({
      listWorktrees: jest.fn(async () => [{ path: '//server/share/wt' }]),
    });
    await expect(
      findRegisteredWorktree(
        workspaceWith(['/work/repo']),
        unc,
        '//server/share/wt',
        'linux',
      ),
    ).resolves.toBeUndefined();

    const broken = probe({
      listWorktrees: jest.fn(async () => {
        throw new Error('git failed');
      }),
    });
    await expect(
      findRegisteredWorktree(workspaceWith(['/work/repo']), broken, WT, 'linux'),
    ).resolves.toBeUndefined();
  });
});
