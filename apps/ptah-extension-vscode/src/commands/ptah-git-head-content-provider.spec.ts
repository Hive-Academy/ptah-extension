const setStatusBarMessage = jest.fn();
const workspaceState: {
  workspaceFolders: Array<{ index: number; uri: { fsPath: string } }>;
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
  let provider: PtahGitHeadContentProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    workspaceState.workspaceFolders = [
      { index: 0, uri: { fsPath: '/ws0' } },
      { index: 1, uri: { fsPath: '/ws1' } },
    ];
    provider = new PtahGitHeadContentProvider({ readHeadText }, logger);
  });

  it('builds ptah-git-head:/<rel>?root=<folderIndex>', () => {
    expect(toGitHeadUri('src/a b.ts', 1)).toEqual({
      scheme: PTAH_GIT_HEAD_SCHEME,
      path: '/src/a b.ts',
      query: 'root=1',
    });
  });

  it('serves the HEAD text of the file in the indexed folder', async () => {
    readHeadText.mockResolvedValue({ outcome: 'content', content: 'old\n' });
    await expect(
      provider.provideTextDocumentContent(
        toGitHeadUri('src/a.ts', 1) as unknown as Uri,
      ),
    ).resolves.toBe('old\n');
    expect(readHeadText).toHaveBeenCalledWith('/ws1', 'src/a.ts');
  });

  it.each<[GitBlobRead, RegExp]>([
    [{ outcome: 'absent' }, /does not exist at HEAD/],
    [{ outcome: 'binary', byteLength: 12 }, /Binary file at HEAD \(12 bytes\)/],
    [{ outcome: 'too-large', byteLength: 3_000_000 }, /too large/],
    [{ outcome: 'lfs-pointer', oid: 'abc', size: 99 }, /Git LFS object/],
  ])('explains %o instead of serving bytes', async (read, expected) => {
    readHeadText.mockResolvedValue(read);
    const text = await provider.provideTextDocumentContent(
      toGitHeadUri('a.bin', 0) as unknown as Uri,
    );
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
      provider.provideTextDocumentContent(
        toGitHeadUri('a.ts', 0) as unknown as Uri,
      ),
    ).resolves.toBe('');
    expect(setStatusBarMessage).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns empty content with a status-bar warning when the read throws', async () => {
    readHeadText.mockRejectedValue(new Error('path must not escape'));
    await expect(
      provider.provideTextDocumentContent(
        toGitHeadUri('../x', 0) as unknown as Uri,
      ),
    ).resolves.toBe('');
    expect(setStatusBarMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown folder index', 'root=7'],
    ['a non-numeric index', 'root=abc'],
    ['no index', ''],
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
