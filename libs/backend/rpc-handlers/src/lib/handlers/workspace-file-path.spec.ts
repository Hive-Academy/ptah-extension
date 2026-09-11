import * as path from 'node:path';
import { FileType } from '@ptah-extension/platform-core';
import { resolveWorkspaceFilePath } from './workspace-file-path';

const fileStat = {
  type: FileType.File,
  ctime: 0,
  mtime: 0,
  size: 1,
};

describe('resolveWorkspaceFilePath', () => {
  const root = path.resolve('workspace-file-path-root');
  const outside = path.resolve('workspace-file-path-outside', 'file.ts');
  let stat: jest.Mock;

  beforeEach(() => {
    stat = jest.fn().mockResolvedValue(fileStat);
  });

  it('resolves a file beneath a registered root', async () => {
    await expect(
      resolveWorkspaceFilePath(
        { workspaceRoot: root, path: 'src/file.ts' },
        [root],
        { stat } as never,
      ),
    ).resolves.toEqual({
      success: true,
      path: path.resolve(root, 'src/file.ts'),
    });
  });

  it('rejects an unregistered explicit root', async () => {
    const result = await resolveWorkspaceFilePath(
      { workspaceRoot: path.resolve('other-root'), path: 'file.ts' },
      [root],
      { stat } as never,
    );
    expect(result).toEqual({
      success: false,
      error: 'Workspace root is not registered',
    });
    expect(stat).not.toHaveBeenCalled();
  });

  it('rejects a relative path without an explicit root', async () => {
    await expect(
      resolveWorkspaceFilePath({ path: 'file.ts' }, [root], { stat } as never),
    ).resolves.toEqual({
      success: false,
      error: 'A workspace root is required for a relative path',
    });
  });

  it('rejects parent traversal beyond the registered root', async () => {
    await expect(
      resolveWorkspaceFilePath(
        { workspaceRoot: root, path: '../outside.ts' },
        [root],
        { stat } as never,
      ),
    ).resolves.toEqual({
      success: false,
      error: 'Path is outside the workspace',
    });
  });

  it('rejects an absolute path outside every registered root', async () => {
    await expect(
      resolveWorkspaceFilePath({ path: outside }, [root], { stat } as never),
    ).resolves.toEqual({
      success: false,
      error: 'Path is outside the workspace',
    });
  });

  it('matches Windows drive roots case-insensitively', async () => {
    if (process.platform !== 'win32') return;
    await expect(
      resolveWorkspaceFilePath(
        { workspaceRoot: 'c:\\workspace', path: 'src\\file.ts' },
        ['C:\\Workspace'],
        { stat } as never,
      ),
    ).resolves.toEqual({
      success: true,
      path: path.resolve('C:\\Workspace', 'src\\file.ts'),
    });
  });

  it.each([
    ['UNC', '\\\\server\\share\\file.ts'],
    ['extended-length', '\\\\?\\C:\\outside\\file.ts'],
  ])('rejects an outside %s input', async (_label, candidate) => {
    const result = await resolveWorkspaceFilePath({ path: candidate }, [root], {
      stat,
    } as never);
    expect(result.success).toBe(false);
    expect(stat).not.toHaveBeenCalled();
  });

  it('rejects directories', async () => {
    stat.mockResolvedValue({ ...fileStat, type: FileType.Directory });
    await expect(
      resolveWorkspaceFilePath({ workspaceRoot: root, path: 'src' }, [root], {
        stat,
      } as never),
    ).resolves.toEqual({ success: false, error: 'Path is a directory' });
  });

  it('rejects missing or unreadable files', async () => {
    stat.mockRejectedValue(new Error('ENOENT'));
    await expect(
      resolveWorkspaceFilePath(
        { workspaceRoot: root, path: 'missing.ts' },
        [root],
        { stat } as never,
      ),
    ).resolves.toEqual({
      success: false,
      error: 'File does not exist or is unreadable',
    });
  });
});
