import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { findRegisteredWorkspaceFolder } from './git-workspace-root';

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
