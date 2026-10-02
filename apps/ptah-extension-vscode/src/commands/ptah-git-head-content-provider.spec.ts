const setStatusBarMessage = jest.fn();

interface FolderUri {
  fsPath: string;
  toString(): string;
}

function folderUri(fsPath: string): FolderUri {
  return { fsPath, toString: () => `file://${fsPath}` };
}

const workspaceState: {
  workspaceFolders: Array<{ index: number; uri: FolderUri }>;
} = { workspaceFolders: [] };

jest.mock('vscode', () => ({
  Uri: {
    from: (c: { scheme: string; path: string; query: string }) => ({ ...c }),
  },
  workspace: {
    get workspaceFolders() {
      return workspaceState.workspaceFolders;
    },
  },
  window: {
    setStatusBarMessage: (...args: unknown[]) => setStatusBarMessage(...args),
  },
}));

import type { Uri } from 'vscode';
import type { Logger } from '@ptah-extension/vscode-core';
import type { GitBlobRead } from '@ptah-extension/shared';
import {
  PTAH_GIT_HEAD_SCHEME,
  PtahGitHeadContentProvider,
  toGitHeadUri,
} from './ptah-git-head-content-provider';

const logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('PtahGitHeadContentProvider', () => {
  const readHeadText = jest.fn<Promise<GitBlobRead>, [string, string]>();
  const ws0 = folderUri('/ws0');
  const ws1 = folderUri('/ws1');
  let provider: PtahGitHeadContentProvider;

  function head(rel: string, folder: FolderUri): Uri {
    return toGitHeadUri(rel, folder as unknown as Uri) as unknown as Uri;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    workspaceState.workspaceFolders = [
      { index: 0, uri: ws0 },
      { index: 1, uri: ws1 },
    ];
    provider = new PtahGitHeadContentProvider({ readHeadText }, logger);
  });

  it('builds ptah-git-head:/<rel>?root=<folderUri>', () => {
    expect(toGitHeadUri('src/a b.ts', ws1 as unknown as Uri)).toEqual({
      scheme: PTAH_GIT_HEAD_SCHEME,
      path: '/src/a b.ts',
      query: 'root=file%3A%2F%2F%2Fws1',
    });
  });

  it('serves the HEAD text of the file in the pinned folder', async () => {
    readHeadText.mockResolvedValue({ outcome: 'content', content: 'old\n' });
    await expect(
      provider.provideTextDocumentContent(head('src/a.ts', ws1)),
    ).resolves.toBe('old\n');
    expect(readHeadText).toHaveBeenCalledWith('/ws1', 'src/a.ts');
  });

  it('follows the pinned folder after the folders are reordered', async () => {
    readHeadText.mockResolvedValue({ outcome: 'content', content: 'old\n' });
    const uri = head('src/a.ts', ws1);
    workspaceState.workspaceFolders = [
      { index: 0, uri: folderUri('/added') },
      { index: 1, uri: ws1 },
      { index: 2, uri: ws0 },
    ];
    await provider.provideTextDocumentContent(uri);
    expect(readHeadText).toHaveBeenCalledWith('/ws1', 'src/a.ts');
  });

  it('refuses cleanly when the pinned folder is no longer open', async () => {
    const uri = head('src/a.ts', ws1);
    workspaceState.workspaceFolders = [{ index: 0, uri: ws0 }];
    await expect(provider.provideTextDocumentContent(uri)).resolves.toMatch(
      /no longer open/,
    );
    expect(readHeadText).not.toHaveBeenCalled();
  });

  it.each<[GitBlobRead, RegExp]>([
    [{ outcome: 'absent' }, /does not exist at HEAD/],
    [{ outcome: 'binary', byteLength: 12 }, /Binary file at HEAD \(12 bytes\)/],
    [{ outcome: 'too-large', byteLength: 3_000_000 }, /too large/],
    [{ outcome: 'lfs-pointer', oid: 'abc', size: 99 }, /Git LFS object/],
  ])('explains %o instead of serving bytes', async (read, expected) => {
    readHeadText.mockResolvedValue(read);
    const text = await provider.provideTextDocumentContent(head('a.bin', ws0));
    expect(text).toMatch(expected);
    expect(setStatusBarMessage).not.toHaveBeenCalled();
  });

  it('returns empty content with a status-bar warning on a read error', async () => {
    readHeadText.mockResolvedValue({
      outcome: 'error',
      code: 'timeout',
      message: 'git timed out',
    });
    await expect(
      provider.provideTextDocumentContent(head('a.ts', ws0)),
    ).resolves.toBe('');
    expect(setStatusBarMessage).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns empty content with a status-bar warning when the read throws', async () => {
    readHeadText.mockRejectedValue(new Error('path must not escape'));
    await expect(
      provider.provideTextDocumentContent(head('../x', ws0)),
    ).resolves.toBe('');
    expect(setStatusBarMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a folder that is not open', 'root=file%3A%2F%2F%2Fgone'],
    ['a folder index (the old form)', 'root=1'],
    ['no folder', ''],
  ])('does not read git for %s', async (_label, query) => {
    const text = await provider.provideTextDocumentContent({
      scheme: PTAH_GIT_HEAD_SCHEME,
      path: '/a.ts',
      query,
    } as unknown as Uri);
    expect(text).toMatch(/not available/);
    expect(readHeadText).not.toHaveBeenCalled();
  });
});
