import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { FileType } from '@ptah-extension/platform-core';
import {
  checkLinkedPathForm,
  resolveLinkedFilePath,
  resolveWorkspaceFilePath,
} from './workspace-file-path';

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

describe('checkLinkedPathForm', () => {
  it.each([
    ['a relative path', 'src/a.ts'],
    ['a nested relative path', './docs/readme.md'],
  ])('accepts %s on any platform', (_label, value) => {
    expect(checkLinkedPathForm(value, 'linux').ok).toBe(true);
    expect(checkLinkedPathForm(value, 'win32').ok).toBe(true);
  });

  it('accepts a drive-absolute path on win32', () => {
    expect(checkLinkedPathForm('C:\\ws\\a.ts', 'win32').ok).toBe(true);
    expect(checkLinkedPathForm('C:/ws/a.ts', 'win32').ok).toBe(true);
  });

  it('accepts a root-absolute path on posix', () => {
    expect(checkLinkedPathForm('/ws/a.ts', 'linux').ok).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(checkLinkedPathForm('', 'linux').ok).toBe(false);
  });

  it.each([
    ['NUL', 'a\u0000.ts'],
    ['a C0 control character', 'a\u0001.ts'],
    ['a newline', 'a\n.ts'],
    ['DEL', 'a\u007f.ts'],
  ])('rejects %s on every platform', (_label, value) => {
    expect(checkLinkedPathForm(value, 'linux').ok).toBe(false);
    expect(checkLinkedPathForm(value, 'win32').ok).toBe(false);
  });

  it.each([
    ['a UNC share', '\\\\server\\share\\a.ts'],
    ['an extended-length prefix', '\\\\?\\C:\\a.ts'],
    ['a device namespace path', '\\\\.\\PhysicalDrive0'],
    ['a forward-slash UNC', '//server/share/a.ts'],
  ])('rejects %s on every platform', (_label, value) => {
    expect(checkLinkedPathForm(value, 'linux').ok).toBe(false);
    expect(checkLinkedPathForm(value, 'win32').ok).toBe(false);
  });

  it.each([
    ['drive-relative', 'C:a.ts'],
    ['root-relative backslash', '\\ws\\a.ts'],
    ['root-relative slash', '/ws/a.ts'],
    ['an alternate data stream', 'a.ts:stream'],
    ['a drive path with a trailing line suffix', 'C:\\a.ts:12'],
    ['a drive path with line and column', 'C:\\a.ts:12:3'],
  ])('rejects %s on win32 only', (_label, value) => {
    expect(checkLinkedPathForm(value, 'win32').ok).toBe(false);
  });

  /**
   * The colon rules are win32-only on purpose: a colon is an ordinary,
   * legal character in a POSIX file name, so folding the win32 rule in
   * everywhere would refuse real files.
   */
  it('allows a colon in a POSIX file name', () => {
    expect(checkLinkedPathForm('notes:12', 'linux').ok).toBe(true);
  });
});

describe('resolveLinkedFilePath', () => {
  let base: string;
  let workspace: string;
  let sibling: string;
  const noWorktrees = { listWorktrees: async () => [] as readonly string[] };

  beforeAll(async () => {
    // Realpath the temp base: `os.tmpdir()` is a symlink on macOS, and the
    // resolver re-checks containment AFTER realpath.
    base = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-linked-')),
    );
    workspace = path.join(base, 'ws');
    // Sibling-prefix trap: `ws2` must not be reachable from `ws`.
    sibling = path.join(base, 'ws2');
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
    await fs.mkdir(sibling, { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'a.ts'), 'hello', 'utf8');
    await fs.writeFile(path.join(sibling, 'secret.ts'), 'nope', 'utf8');
  });

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it('resolves a relative path against an authorized workspace hint', async () => {
    const result = await resolveLinkedFilePath(
      { path: 'src/a.ts', workspaceRoot: workspace },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result).toMatchObject({
      kind: 'file',
      lexicalPath: path.join(workspace, 'src', 'a.ts'),
      root: workspace,
      sizeBytes: 5,
    });
  });

  it('resolves an absolute path inside a registered root', async () => {
    const result = await resolveLinkedFilePath(
      { path: path.join(workspace, 'src', 'a.ts') },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result.kind).toBe('file');
  });

  it('refuses parent traversal out of the root', async () => {
    const result = await resolveLinkedFilePath(
      { path: '../ws2/secret.ts', workspaceRoot: workspace },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result).toMatchObject({ kind: 'rejected', reason: 'outside-roots' });
  });

  it('refuses a sibling root sharing a name prefix', async () => {
    const result = await resolveLinkedFilePath(
      { path: path.join(sibling, 'secret.ts') },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result).toMatchObject({ kind: 'rejected', reason: 'outside-roots' });
  });

  it('refuses an unregistered workspace hint', async () => {
    const result = await resolveLinkedFilePath(
      { path: 'secret.ts', workspaceRoot: sibling },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result).toMatchObject({ kind: 'rejected', reason: 'root-not-open' });
  });

  it('refuses a relative path with no base at all', async () => {
    const result = await resolveLinkedFilePath(
      { path: 'src/a.ts' },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result).toMatchObject({ kind: 'rejected', reason: 'no-base-root' });
  });

  it('resolves a link relative to an authorized document directory', async () => {
    const result = await resolveLinkedFilePath(
      {
        path: 'a.ts',
        documentPath: path.join(workspace, 'src', 'readme.md'),
      },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result).toMatchObject({
      kind: 'file',
      lexicalPath: path.join(workspace, 'src', 'a.ts'),
    });
  });

  it('authorizes a worktree of a registered root, consulted lazily', async () => {
    const worktree = path.join(base, 'wt');
    await fs.mkdir(worktree, { recursive: true });
    await fs.writeFile(path.join(worktree, 'b.ts'), 'x', 'utf8');
    const listWorktrees = jest.fn(async () => [worktree]);

    const hit = await resolveLinkedFilePath(
      { path: path.join(workspace, 'src', 'a.ts') },
      { registered: [workspace], listWorktrees },
    );
    expect(hit.kind).toBe('file');
    // A lexical hit inside a registered root must not shell out to git.
    expect(listWorktrees).not.toHaveBeenCalled();

    const miss = await resolveLinkedFilePath(
      { path: path.join(worktree, 'b.ts') },
      { registered: [workspace], listWorktrees },
    );
    expect(miss).toMatchObject({ kind: 'file', root: worktree });
    expect(listWorktrees).toHaveBeenCalledWith(workspace);
  });

  it('refuses a directory unless allowDirectory is set', async () => {
    const target = path.join(workspace, 'src');
    await expect(
      resolveLinkedFilePath(
        { path: target },
        { registered: [workspace], ...noWorktrees },
      ),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'not-a-file' });

    await expect(
      resolveLinkedFilePath(
        { path: target },
        { registered: [workspace], ...noWorktrees },
        { allowDirectory: true },
      ),
    ).resolves.toMatchObject({ kind: 'directory', lexicalPath: target });
  });

  it('refuses a file that no longer exists', async () => {
    const result = await resolveLinkedFilePath(
      { path: path.join(workspace, 'gone.ts') },
      { registered: [workspace], ...noWorktrees },
    );
    expect(result).toMatchObject({ kind: 'rejected', reason: 'not-found' });
  });

  it('enforces the size cap at the boundary', async () => {
    const target = path.join(workspace, 'src', 'a.ts');
    await expect(
      resolveLinkedFilePath(
        { path: target },
        { registered: [workspace], ...noWorktrees },
        { maxBytes: 5 },
      ),
    ).resolves.toMatchObject({ kind: 'file', sizeBytes: 5 });

    await expect(
      resolveLinkedFilePath(
        { path: target },
        { registered: [workspace], ...noWorktrees },
        { maxBytes: 4 },
      ),
    ).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'too-large',
      sizeBytes: 5,
      lexicalPath: target,
    });
  });

  /**
   * The form gate must run before ANY filesystem call, so a device or UNC
   * string never reaches `realpath`. Spying on the injected fs surface is the
   * only way to prove a negative here.
   */
  it.each([
    ['a UNC share', '\\\\server\\share\\a.ts'],
    ['a device path', '\\\\.\\PhysicalDrive0'],
    ['an extended-length prefix', '\\\\?\\C:\\a.ts'],
    ['a NUL byte', 'a\u0000.ts'],
  ])('rejects %s without touching the filesystem', async (_label, value) => {
    const spyFs = {
      realpath: jest.fn(async (p: string) => p),
      stat: jest.fn(),
    };
    const result = await resolveLinkedFilePath(
      { path: value },
      { registered: [workspace], ...noWorktrees },
      { fs: spyFs as never },
    );
    expect(result).toMatchObject({
      kind: 'rejected',
      reason: 'unsupported-path',
    });
    expect(spyFs.realpath).not.toHaveBeenCalled();
    expect(spyFs.stat).not.toHaveBeenCalled();
  });

  describe('symlink containment', () => {
    /**
     * Windows needs either Developer Mode or elevation to create a FILE
     * symlink, so these skip rather than fail on an unprivileged host. A
     * directory junction needs no privilege and is used where it suffices.
     */
    async function trySymlink(
      target: string,
      linkPath: string,
      type: 'file' | 'junction',
    ): Promise<boolean> {
      try {
        await fs.symlink(target, linkPath, type);
        return true;
      } catch {
        return false;
      }
    }

    it('refuses a symlink escaping the authorized roots, and offers no lexical path', async () => {
      const link = path.join(workspace, 'escape.ts');
      const created = await trySymlink(
        path.join(sibling, 'secret.ts'),
        link,
        'file',
      );
      if (!created) return;

      const result = await resolveLinkedFilePath(
        { path: link },
        { registered: [workspace], ...noWorktrees },
      );
      expect(result).toMatchObject({
        kind: 'rejected',
        reason: 'outside-roots',
      });
      // No lexicalPath: an escape must never be offered for external open.
      expect(result).not.toHaveProperty('lexicalPath');
      await fs.rm(link, { force: true });
    });

    it('refuses a junction escaping the authorized roots', async () => {
      const link = path.join(workspace, 'escape-dir');
      const created = await trySymlink(sibling, link, 'junction');
      if (!created) return;

      const result = await resolveLinkedFilePath(
        { path: path.join(link, 'secret.ts') },
        { registered: [workspace], ...noWorktrees },
      );
      expect(result).toMatchObject({
        kind: 'rejected',
        reason: 'outside-roots',
      });
      expect(result).not.toHaveProperty('lexicalPath');
      await fs.rm(link, { recursive: true, force: true });
    });

    it('allows a symlink between two AUTHORIZED roots', async () => {
      const link = path.join(workspace, 'to-sibling');
      const created = await trySymlink(sibling, link, 'junction');
      if (!created) return;

      const result = await resolveLinkedFilePath(
        { path: path.join(link, 'secret.ts') },
        // Both roots authorized this time, so the escape lands in-bounds.
        { registered: [workspace, sibling], ...noWorktrees },
      );
      expect(result).toMatchObject({ kind: 'file' });
      await fs.rm(link, { recursive: true, force: true });
    });
  });
});
