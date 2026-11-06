import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GitWorktreeInfo } from '@ptah-extension/shared';
import {
  findRegisteredWorkspaceFolder,
  probeRegisteredWorktree,
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

describe('probeRegisteredWorktree', () => {
  const WT = '/work/repo/.claude-worktrees/feature';

  function listed(...paths: Array<string | Partial<GitWorktreeInfo>>) {
    const worktrees = paths.map((entry) => ({
      path: '',
      head: 'a',
      branch: 'b',
      isMain: false,
      isBare: false,
      ...(typeof entry === 'string' ? { path: entry } : entry),
    }));
    return { kind: 'listed' as const, worktrees };
  }

  function probe(
    overrides: Partial<WorktreeRootProbe> = {},
  ): jest.Mocked<WorktreeRootProbe> {
    return {
      listWorktrees: jest.fn(async () => listed('/work/repo', WT)),
      commonDir: jest.fn(async () => ({
        kind: 'dir' as const,
        path: '/work/repo/.git',
      })),
      directory: jest.fn(async () => ({ kind: 'exists' as const })),
      invalidate: jest.fn(),
      ...overrides,
    } as jest.Mocked<WorktreeRootProbe>;
  }

  const confirmed = (path: string) => ({ kind: 'confirmed-worktree', path });
  const refused = { kind: 'confirmed-not-worktree' };

  it('classifies a timeout as probe-failed rather than a missing worktree', async () => {
    const cause = new Error('git timed out');
    const result = await probeRegisteredWorktree(
      workspaceWith(['/work/repo']),
      probe({
        listWorktrees: jest.fn(async () => ({
          kind: 'failed' as const,
          cause,
        })),
      }),
      WT,
      'linux',
    );
    expect(result).toEqual({ kind: 'probe-failed', cause });
  });

  it('accepts a live listed worktree sharing the open folder common dir', async () => {
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['/work/repo']),
        probe(),
        `${WT}/`,
        'linux',
      ),
    ).resolves.toEqual(confirmed(WT));
  });

  it('compares common dirs separator- and case-insensitively on win32', async () => {
    const p = probe({
      listWorktrees: jest.fn(async () => listed('D:/Repo/wt')),
      commonDir: jest.fn(async (dir: string) => ({
        kind: 'dir' as const,
        path: dir === 'D:/Repo/wt' ? 'd:\\repo\\.git' : 'D:/Repo/.git',
      })),
    });
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['D:\\Repo']),
        p,
        'd:\\repo\\wt',
        'win32',
      ),
    ).resolves.toEqual(confirmed('D:/Repo/wt'));
  });

  it('refuses a listed worktree whose common dir is another repository or not a repository', async () => {
    const other = probe({
      commonDir: jest.fn(async (dir: string) => ({
        kind: 'dir' as const,
        path: dir === WT ? '/elsewhere/.git' : '/work/repo/.git',
      })),
    });
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['/work/repo']),
        other,
        WT,
        'linux',
      ),
    ).resolves.toEqual(refused);

    const none = probe({
      commonDir: jest.fn(async (dir: string) =>
        dir === WT
          ? { kind: 'not-a-repo' as const }
          : { kind: 'dir' as const, path: '/work/repo/.git' },
      ),
    });
    await expect(
      probeRegisteredWorktree(workspaceWith(['/work/repo']), none, WT, 'linux'),
    ).resolves.toEqual(refused);
  });

  it('reads a common dir that cannot be read as retryable', async () => {
    const cause = new Error('rev-parse timed out');
    const p = probe({
      commonDir: jest.fn(async () => ({ kind: 'failed' as const, cause })),
    });
    await expect(
      probeRegisteredWorktree(workspaceWith(['/work/repo']), p, WT, 'linux'),
    ).resolves.toEqual({ kind: 'probe-failed', cause });
  });

  it('refuses a prunable entry and a missing directory; a missing one never reaches git', async () => {
    const prunable = probe({
      listWorktrees: jest.fn(async () => listed({ path: WT, prunable: true })),
    });
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['/work/repo']),
        prunable,
        WT,
        'linux',
      ),
    ).resolves.toEqual(refused);

    const missing = probe({
      directory: jest.fn(async () => ({ kind: 'absent' as const })),
    });
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['/work/repo']),
        missing,
        WT,
        'linux',
      ),
    ).resolves.toEqual(refused);
    expect(missing.listWorktrees).not.toHaveBeenCalled();
    expect(missing.commonDir).not.toHaveBeenCalled();
  });

  it('reads a stat error other than absence as retryable', async () => {
    const cause = new Error('EACCES');
    const p = probe({
      directory: jest.fn(async () => ({ kind: 'failed' as const, cause })),
    });
    await expect(
      probeRegisteredWorktree(workspaceWith(['/work/repo']), p, WT, 'linux'),
    ).resolves.toEqual({ kind: 'probe-failed', cause });
  });

  it('refuses a UNC path before any stat or git call', async () => {
    const unc = probe({
      listWorktrees: jest.fn(async () => listed('//server/share/wt')),
    });
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['/work/repo']),
        unc,
        '//server/share/wt',
        'linux',
      ),
    ).resolves.toEqual(refused);
    expect(unc.directory).not.toHaveBeenCalled();
    expect(unc.listWorktrees).not.toHaveBeenCalled();
  });

  // Review #6: one broken folder must not turn every gone worktree into a
  // retry loop.
  it('ignores the failure of a folder that cannot own the path', async () => {
    const p = probe({
      listWorktrees: jest.fn(async (folder: string) =>
        folder === '/mnt/offline/repo'
          ? { kind: 'failed' as const, cause: new Error('dubious ownership') }
          : listed('/work/repo'),
      ),
    });
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['/work/repo', '/mnt/offline/repo']),
        p,
        WT,
        'linux',
      ),
    ).resolves.toEqual(refused);
  });

  it('keeps the failure of a folder that contains the path, or is its sibling', async () => {
    const cause = new Error('timed out');
    const p = probe({
      listWorktrees: jest.fn(async (folder: string) =>
        folder === '/work/repo'
          ? { kind: 'failed' as const, cause }
          : listed('/other/repo'),
      ),
    });
    const workspace = workspaceWith(['/other/repo', '/work/repo']);
    await expect(
      probeRegisteredWorktree(workspace, p, WT, 'linux'),
    ).resolves.toEqual({ kind: 'probe-failed', cause });
    await expect(
      probeRegisteredWorktree(workspace, p, '/work/repo-feature', 'linux'),
    ).resolves.toEqual({ kind: 'probe-failed', cause });
  });

  it('prefers a confirmation from any folder over another folder failing', async () => {
    const p = probe({
      listWorktrees: jest.fn(async (folder: string) =>
        folder === '/work/repo'
          ? listed('/work/repo', WT)
          : { kind: 'failed' as const, cause: new Error('timed out') },
      ),
    });
    await expect(
      probeRegisteredWorktree(
        workspaceWith(['/work', '/work/repo']),
        p,
        WT,
        'linux',
      ),
    ).resolves.toEqual(confirmed(WT));
  });
});
