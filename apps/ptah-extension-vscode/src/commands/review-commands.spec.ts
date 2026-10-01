import * as path from 'path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

const executeCommand = jest.fn();
const registerCommand = jest.fn();
const getExtension = jest.fn();
const workspaceState: {
  workspaceFolders: Array<{
    index: number;
    name: string;
    uri: { scheme: string; fsPath: string };
  }>;
} = { workspaceFolders: [] };

jest.mock('vscode', () => ({
  Uri: {
    file: (p: string) => ({ scheme: 'file', fsPath: p, path: p }),
    from: (c: { scheme: string; path: string; query: string }) => ({ ...c }),
  },
  workspace: {
    get workspaceFolders() {
      return workspaceState.workspaceFolders;
    },
  },
  commands: {
    executeCommand: (...args: unknown[]) => executeCommand(...args),
    registerCommand: (...args: unknown[]) => registerCommand(...args),
  },
  extensions: { getExtension: (id: string) => getExtension(id) },
}));

import type { Logger } from '@ptah-extension/vscode-core';
import {
  MAX_REVIEW_FILES,
  OUTSIDE_WORKSPACE_MESSAGE,
  ReviewCommands,
} from './review-commands';

const logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('ReviewCommands', () => {
  let base: string;
  let root: string;
  let outside: string;
  let commands: ReviewCommands;

  beforeAll(async () => {
    base = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-review-')),
    );
    root = path.join(base, 'ws');
    outside = path.join(base, 'outside');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'a');
    await fs.writeFile(path.join(root, 'src', 'new.ts'), 'n');
    await fs.writeFile(path.join(outside, 'secret.txt'), 's');
    // A junction needs no elevation on Windows; elsewhere it is a dir symlink.
    await fs.symlink(outside, path.join(root, 'escape'), 'junction');
  });

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    executeCommand.mockResolvedValue(undefined);
    workspaceState.workspaceFolders = [
      { index: 0, name: 'other', uri: { scheme: 'file', fsPath: outside } },
      { index: 1, name: 'ws', uri: { scheme: 'file', fsPath: root } },
    ];
    commands = new ReviewCommands(logger);
  });

  function headUri(rel: string, index = 1) {
    return { scheme: 'ptah-git-head', path: `/${rel}`, query: `root=${index}` };
  }
  function fileUri(rel: string) {
    const p = path.join(root, ...rel.split('/'));
    return { scheme: 'file', fsPath: p, path: p };
  }

  it('registers the four review commands', () => {
    const context = { subscriptions: [] as unknown[] };
    registerCommand.mockReturnValue({ dispose: jest.fn() });
    commands.registerCommands(
      context as unknown as import('vscode').ExtensionContext,
    );
    expect(registerCommand.mock.calls.map((c) => c[0])).toEqual([
      'ptah.review.openChanges',
      'ptah.review.openDiff',
      'ptah.review.openMerge',
      'ptah.review.openScm',
    ]);
    expect(context.subscriptions).toHaveLength(4);
  });

  describe('openChanges', () => {
    it('opens vscode.changes with HEAD and working-tree sides; undefined for added and deleted', async () => {
      await commands.openChanges({
        workspaceRoot: root,
        files: [
          { path: 'src/a.ts', status: 'M' },
          { path: 'src/new.ts', status: 'A' },
          { path: 'src/gone.ts', status: 'D' },
          { path: 'src/a.ts', origPath: 'src/old.ts', status: 'R' },
        ],
      });

      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).toHaveBeenCalledWith(
        'vscode.changes',
        'Agent changes (4 files)',
        [
          [fileUri('src/a.ts'), headUri('src/a.ts'), fileUri('src/a.ts')],
          [fileUri('src/new.ts'), undefined, fileUri('src/new.ts')],
          [fileUri('src/gone.ts'), headUri('src/gone.ts'), undefined],
          [fileUri('src/a.ts'), headUri('src/old.ts'), fileUri('src/a.ts')],
        ],
      );
    });

    it('accepts a workspaceRoot that differs only by a trailing separator', async () => {
      await commands.openChanges({
        workspaceRoot: root + path.sep,
        files: [{ path: 'src/a.ts', status: 'M' }],
      });
      expect(executeCommand).toHaveBeenCalledWith(
        'vscode.changes',
        'Agent changes (1 file)',
        expect.any(Array),
      );
    });

    it('falls back to per-file diff and open, in order, when vscode.changes rejects', async () => {
      executeCommand.mockImplementation(async (id: string) => {
        if (id === 'vscode.changes') throw new Error('command not found');
      });

      await commands.openChanges({
        workspaceRoot: root,
        files: [
          { path: 'src/a.ts', status: 'M' },
          { path: 'src/new.ts', status: 'A' },
          { path: 'src/gone.ts', status: 'D' },
        ],
      });

      expect(executeCommand.mock.calls.slice(1)).toEqual([
        [
          'vscode.diff',
          headUri('src/a.ts'),
          fileUri('src/a.ts'),
          'a.ts (HEAD ↔ Working Tree)',
          { preview: false },
        ],
        ['vscode.open', fileUri('src/new.ts'), { preview: false }],
        ['vscode.open', headUri('src/gone.ts'), { preview: false }],
      ]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it.each<[string, () => string]>([
      ['a parent-directory escape', () => '../outside/secret.txt'],
      [
        'an absolute path outside the root',
        () => path.join(base, 'outside', 'x'),
      ],
      ['a symlink that leaves the root', () => 'escape/secret.txt'],
      [
        'a missing file under an escaping symlink',
        () => 'escape/nope/new.txt',
      ],
      ['the root itself', () => '.'],
    ])('refuses %s', async (_label, candidate) => {
      await expect(
        commands.openChanges({
          workspaceRoot: root,
          files: [{ path: candidate(), status: 'M' }],
        }),
      ).rejects.toThrow(OUTSIDE_WORKSPACE_MESSAGE);
      expect(executeCommand).not.toHaveBeenCalled();
    });

    it('refuses a rename whose origPath escapes', async () => {
      await expect(
        commands.openChanges({
          workspaceRoot: root,
          files: [{ path: 'src/a.ts', origPath: '../x', status: 'R' }],
        }),
      ).rejects.toThrow(OUTSIDE_WORKSPACE_MESSAGE);
    });

    it('refuses a workspaceRoot that is not an open workspace folder', async () => {
      await expect(
        commands.openChanges({
          workspaceRoot: path.join(root, 'src'),
          files: [{ path: 'a.ts', status: 'M' }],
        }),
      ).rejects.toThrow(OUTSIDE_WORKSPACE_MESSAGE);
      await expect(
        commands.openChanges({
          workspaceRoot: 'ws',
          files: [{ path: 'a.ts', status: 'M' }],
        }),
      ).rejects.toThrow(OUTSIDE_WORKSPACE_MESSAGE);
    });

    it('never puts the absolute path in the refusal', async () => {
      const error = await commands
        .openChanges({
          workspaceRoot: root,
          files: [{ path: '../outside/secret.txt', status: 'M' }],
        })
        .catch((e: Error) => e);
      expect((error as Error).message).toBe(OUTSIDE_WORKSPACE_MESSAGE);
    });

    it('rejects more than the file bound and malformed args', async () => {
      const files = Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, i) => ({
        path: `f${i}.ts`,
        status: 'M',
      }));
      await expect(
        commands.openChanges({ workspaceRoot: root, files }),
      ).rejects.toThrow('Invalid review command arguments.');
      await expect(commands.openChanges(undefined)).rejects.toThrow(
        'Invalid review command arguments.',
      );
      await expect(
        commands.openChanges({
          workspaceRoot: root,
          files: [{ path: 'a.ts', status: 'X' }],
        }),
      ).rejects.toThrow('Invalid review command arguments.');
    });
  });

  describe('openDiff', () => {
    it('diffs HEAD against the working tree, as a preview', async () => {
      await commands.openDiff({ workspaceRoot: root, path: 'src/a.ts' });
      expect(executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        headUri('src/a.ts'),
        fileUri('src/a.ts'),
        'a.ts (HEAD ↔ Working Tree)',
        { preview: true },
      );
    });

    it('refuses an outside path', async () => {
      await expect(
        commands.openDiff({ workspaceRoot: root, path: '../x.ts' }),
      ).rejects.toThrow(OUTSIDE_WORKSPACE_MESSAGE);
    });
  });

  describe('openMerge', () => {
    it('runs git.openMergeEditor when the git extension is present', async () => {
      getExtension.mockReturnValue({ id: 'vscode.git' });
      await commands.openMerge({ workspaceRoot: root, path: 'src/a.ts' });
      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).toHaveBeenCalledWith(
        'git.openMergeEditor',
        fileUri('src/a.ts'),
      );
    });

    it('falls back to vscode.open when git.openMergeEditor throws', async () => {
      getExtension.mockReturnValue({ id: 'vscode.git' });
      executeCommand.mockImplementation(async (id: string) => {
        if (id === 'git.openMergeEditor') throw new Error('no conflicts');
      });
      await commands.openMerge({ workspaceRoot: root, path: 'src/a.ts' });
      expect(executeCommand).toHaveBeenLastCalledWith(
        'vscode.open',
        fileUri('src/a.ts'),
      );
    });

    it('falls back to vscode.open when the git extension is missing', async () => {
      getExtension.mockReturnValue(undefined);
      await commands.openMerge({ workspaceRoot: root, path: 'src/a.ts' });
      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).toHaveBeenCalledWith(
        'vscode.open',
        fileUri('src/a.ts'),
      );
    });

    it('refuses an outside path before touching git', async () => {
      await expect(
        commands.openMerge({ workspaceRoot: root, path: 'escape/secret.txt' }),
      ).rejects.toThrow(OUTSIDE_WORKSPACE_MESSAGE);
      expect(executeCommand).not.toHaveBeenCalled();
    });
  });

  it('openScm reveals the Source Control view', async () => {
    await commands.openScm();
    expect(executeCommand).toHaveBeenCalledWith('workbench.view.scm');
  });
});
