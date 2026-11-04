import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { realpath as fsRealpath, stat as fsStat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  FileType,
  type FileStat,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import {
  checkDeliverable,
  containedDeliverablePath,
} from './deliverable-check';

type Fs = Pick<IFileSystemProvider, 'stat' | 'realpath'>;

interface TracedFs extends Fs {
  readonly statPaths: readonly string[];
  readonly realpathPaths: readonly string[];
}

const NOT_FOUND_CODES = [
  'ENOENT',
  'ENOTDIR',
  'FileNotFound',
  'FileNotADirectory',
] as const;

let dir: string;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function nodeStat(target: string): Promise<FileStat> {
  const stat = await fsStat(target);
  return {
    type: stat.isDirectory() ? FileType.Directory : FileType.File,
    ctime: stat.ctimeMs,
    mtime: stat.mtimeMs,
    size: stat.size,
  };
}

function nodeFs(): Fs {
  return {
    stat: nodeStat,
    realpath: (target: string) => fsRealpath(target),
  };
}

function tracing(inner: Fs): TracedFs {
  const statPaths: string[] = [];
  const realpathPaths: string[] = [];
  return {
    statPaths,
    realpathPaths,
    stat: async (target: string) => {
      statPaths.push(target);
      return inner.stat(target);
    },
    realpath: async (target: string) => {
      realpathPaths.push(target);
      return inner.realpath(target);
    },
  };
}

function coded(code: string, path: string): Error {
  return Object.assign(new Error(`failed ${path}`), { code });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ptah-deliverable-check-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('containedDeliverablePath', () => {
  it('accepts an absolute or relative entry inside the root', () => {
    const root = join(dir, 'repo');
    const file = join(root, 'sub', 'file.txt');
    expect(containedDeliverablePath(root, file)).toBe(file);
    expect(containedDeliverablePath(root, 'sub/file.txt')).toBe(file);
    expect(containedDeliverablePath(root, 'sub/../file.txt')).toBe(
      join(root, 'file.txt'),
    );
  });

  it('rejects traversal, a sibling prefix, and an absolute path outside', () => {
    const root = join(dir, 'repo');
    expect(containedDeliverablePath(root, '..')).toBeNull();
    expect(containedDeliverablePath(root, '../x')).toBeNull();
    expect(containedDeliverablePath(root, 'foo/../../x')).toBeNull();
    expect(containedDeliverablePath(root, join(dir, 'outside.txt'))).toBeNull();
    expect(containedDeliverablePath(root, join(dir, 'repo-evil', 'a'))).toBeNull();
  });

  it('rejects a Windows drive or UNC entry on POSIX', () => {
    const root = join(dir, 'repo');
    expect(containedDeliverablePath(root, 'C:/Windows/system.ini')).toBeNull();
    expect(containedDeliverablePath(root, 'C:\\Windows\\system.ini')).toBeNull();
    expect(containedDeliverablePath(root, 'C:foo')).toBeNull();
    expect(containedDeliverablePath(root, '\\\\server\\share\\file')).toBeNull();
  });
});

describe('checkDeliverable', () => {
  it('counts an in-root file from its real stat', async () => {
    const root = join(dir, 'repo');
    const file = join(root, 'a.txt');
    write(file, 'hello');
    const fs = tracing(nodeFs());
    const result = await checkDeliverable(fs, root, file);
    const stat = statSync(file);
    expect(result).toEqual({
      check: { exists: true, bytes: stat.size, mtimeMs: stat.mtimeMs },
    });
    expect(fs.statPaths).toEqual([await fsRealpath(file)]);
  });

  it('accepts a relative entry inside the root', async () => {
    const root = join(dir, 'repo');
    write(join(root, 'rel.txt'), 'xyz');
    const result = await checkDeliverable(nodeFs(), root, 'rel.txt');
    expect(result).toEqual({
      check: {
        exists: true,
        bytes: 3,
        mtimeMs: statSync(join(root, 'rel.txt')).mtimeMs,
      },
    });
  });

  it('counts a file under .claude-worktrees when the root is the checkout', async () => {
    const repo = join(dir, 'repo');
    const file = join(repo, '.claude-worktrees', 'wt', 'file.txt');
    write(file, 'worktree');
    const fs = tracing(nodeFs());
    const result = await checkDeliverable(fs, repo, file);
    expect(containedDeliverablePath(repo, file)).toBe(file);
    expect(result).toEqual({
      check: { exists: true, bytes: 8, mtimeMs: statSync(file).mtimeMs },
    });
  });

  it('rejects a parent-checkout file when the root is the worktree', async () => {
    const repo = join(dir, 'repo');
    const wt = join(repo, '.claude-worktrees', 'wt');
    const mainFile = join(repo, 'main.txt');
    write(mainFile, 'main');
    write(join(wt, 'file.txt'), 'worktree');
    const fs = tracing(nodeFs());
    expect(containedDeliverablePath(wt, mainFile)).toBeNull();
    await expect(checkDeliverable(fs, wt, mainFile)).resolves.toEqual({
      errorCode: 'outside-root',
    });
    expect(fs.statPaths).toEqual([]);
    expect(fs.realpathPaths).toEqual([]);
    expect(JSON.stringify({ errorCode: 'outside-root' })).not.toContain(mainFile);
  });

  it('rejects a sibling worktree and a same-prefix sibling directory', async () => {
    const repo = join(dir, 'repo');
    const wt = join(repo, '.claude-worktrees', 'wt');
    const sibling = join(repo, '.claude-worktrees', 'sibling', 'other.txt');
    const prefixed = join(repo, '.claude-worktrees', 'wt-extra', 'file.txt');
    write(join(wt, 'file.txt'), 'worktree');
    write(sibling, 'sibling');
    write(prefixed, 'extra');
    const fs = tracing(nodeFs());
    expect(containedDeliverablePath(wt, sibling)).toBeNull();
    expect(containedDeliverablePath(wt, prefixed)).toBeNull();
    await expect(checkDeliverable(fs, wt, sibling)).resolves.toEqual({
      errorCode: 'outside-root',
    });
    await expect(checkDeliverable(fs, wt, prefixed)).resolves.toEqual({
      errorCode: 'outside-root',
    });
    expect(fs.statPaths).toEqual([]);
    expect(fs.realpathPaths).toEqual([]);
  });

  it('rejects .. traversal and a drive entry without calling stat', async () => {
    const root = join(dir, 'repo');
    write(join(root, 'inside.txt'), 'in');
    const fs = tracing(nodeFs());
    await expect(checkDeliverable(fs, root, '../x')).resolves.toEqual({
      errorCode: 'outside-root',
    });
    await expect(checkDeliverable(fs, root, '..')).resolves.toEqual({
      errorCode: 'outside-root',
    });
    await expect(
      checkDeliverable(fs, root, 'C:/Windows/system.ini'),
    ).resolves.toEqual({ errorCode: 'outside-root' });
    await expect(
      checkDeliverable(fs, root, join(dir, 'outside.txt')),
    ).resolves.toEqual({ errorCode: 'outside-root' });
    expect(fs.statPaths).toEqual([]);
    expect(fs.realpathPaths).toEqual([]);
  });

  it('accepts an in-root symlink whose target stays in the root', async () => {
    const root = join(dir, 'repo');
    const target = join(root, 'target.txt');
    const link = join(root, 'link.txt');
    write(target, 'abcdef');
    symlinkSync(target, link);
    const fs = tracing(nodeFs());
    const result = await checkDeliverable(fs, root, link);
    expect(result).toEqual({
      check: { exists: true, bytes: 6, mtimeMs: statSync(target).mtimeMs },
    });
    expect(fs.statPaths).toEqual([await fsRealpath(target)]);
  });

  it('rejects an in-root symlink to an outside target without stat', async () => {
    const root = join(dir, 'repo');
    const outside = join(dir, 'secret.txt');
    const link = join(root, 'leak.txt');
    write(outside, 'secret');
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, link);
    const fs = tracing(nodeFs());
    const result = await checkDeliverable(fs, root, link);
    expect(result).toEqual({ errorCode: 'outside-root' });
    expect(fs.statPaths).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(outside);
    expect(fs.realpathPaths.some((path) => path === outside)).toBe(false);
  });

  it('treats a dangling symlink as not found and does not stat it', async () => {
    const root = join(dir, 'repo');
    const link = join(root, 'dangling.txt');
    mkdirSync(root, { recursive: true });
    symlinkSync(join(dir, 'missing-outside'), link);
    const fs = tracing(nodeFs());
    await expect(checkDeliverable(fs, root, link)).resolves.toEqual({
      check: { exists: false, bytes: 0, mtimeMs: null },
    });
    expect(fs.statPaths).toEqual([]);
    expect(JSON.stringify({ check: { exists: false } })).not.toContain(link);
  });

  it('uses the real root when the root itself is a symlink', async () => {
    const real = join(dir, 'real-root');
    const linkRoot = join(dir, 'link-root');
    const file = join(real, 'f.txt');
    write(file, 'z');
    symlinkSync(real, linkRoot);
    const fs = tracing(nodeFs());
    const result = await checkDeliverable(fs, linkRoot, join(linkRoot, 'f.txt'));
    expect(result).toEqual({
      check: { exists: true, bytes: 1, mtimeMs: statSync(file).mtimeMs },
    });
    expect(fs.statPaths).toEqual([await fsRealpath(file)]);
  });

  it('rejects a symlink escape even when the root is itself a symlink', async () => {
    const real = join(dir, 'real-root');
    const linkRoot = join(dir, 'link-root');
    const outside = join(dir, 'secret.txt');
    write(outside, 'secret');
    mkdirSync(real, { recursive: true });
    symlinkSync(real, linkRoot);
    symlinkSync(outside, join(real, 'leak.txt'));
    const fs = tracing(nodeFs());
    await expect(
      checkDeliverable(fs, linkRoot, join(linkRoot, 'leak.txt')),
    ).resolves.toEqual({ errorCode: 'outside-root' });
    expect(fs.statPaths).toEqual([]);
  });

  it('maps a missing file and a file-parent ENOTDIR to not found', async () => {
    const root = join(dir, 'repo');
    const file = join(root, 'a.txt');
    write(file, 'x');
    const fs = tracing(nodeFs());
    await expect(
      checkDeliverable(fs, root, join(root, 'missing.txt')),
    ).resolves.toEqual({
      check: { exists: false, bytes: 0, mtimeMs: null },
    });
    await expect(
      checkDeliverable(fs, root, join(file, 'child')),
    ).resolves.toEqual({
      check: { exists: false, bytes: 0, mtimeMs: null },
    });
    expect(fs.statPaths).toEqual([]);
  });

  it.each(NOT_FOUND_CODES)(
    'maps realpath %s to a missing file and does not stat',
    async (code) => {
      const root = join(dir, 'repo');
      const file = join(root, 'a.txt');
      write(file, 'x');
      const fs = tracing({
        stat: nodeStat,
        realpath: async (target: string) => {
          if (target === file) throw coded(code, file);
          return fsRealpath(target);
        },
      });
      await expect(checkDeliverable(fs, root, file)).resolves.toEqual({
        check: { exists: false, bytes: 0, mtimeMs: null },
      });
      expect(fs.statPaths).toEqual([]);
      expect(JSON.stringify(await checkDeliverable(fs, root, file))).not.toContain(
        file,
      );
    },
  );

  it.each(NOT_FOUND_CODES)(
    'maps stat %s to a missing file',
    async (code) => {
      const root = join(dir, 'repo');
      const file = join(root, 'a.txt');
      write(file, 'x');
      const fs = tracing({
        stat: async (target: string) => {
          throw coded(code, target);
        },
        realpath: (target: string) => fsRealpath(target),
      });
      const result = await checkDeliverable(fs, root, file);
      expect(result).toEqual({
        check: { exists: false, bytes: 0, mtimeMs: null },
      });
      expect(JSON.stringify(result)).not.toContain(file);
    },
  );

  it('returns the provider code for other realpath and stat failures', async () => {
    const root = join(dir, 'repo');
    const file = join(root, 'a.txt');
    write(file, 'x');
    const realpathDenied = tracing({
      stat: nodeStat,
      realpath: async (target: string) => {
        if (target === file) throw coded('EACCES', file);
        return fsRealpath(target);
      },
    });
    const realpathResult = await checkDeliverable(realpathDenied, root, file);
    expect(realpathResult).toEqual({ errorCode: 'EACCES' });
    expect(realpathDenied.statPaths).toEqual([]);
    expect(JSON.stringify(realpathResult)).not.toContain(file);

    const statDenied = tracing({
      stat: async (target: string) => {
        throw coded('EIO', target);
      },
      realpath: (target: string) => fsRealpath(target),
    });
    const statResult = await checkDeliverable(statDenied, root, file);
    expect(statResult).toEqual({ errorCode: 'EIO' });
    expect(JSON.stringify(statResult)).not.toContain(file);

    const unnamed = tracing({
      stat: async () => {
        throw new Error(`boom ${file}`);
      },
      realpath: (target: string) => fsRealpath(target),
    });
    const unnamedResult = await checkDeliverable(unnamed, root, file);
    expect(unnamedResult).toEqual({ errorCode: 'UNKNOWN' });
    expect(JSON.stringify(unnamedResult)).not.toContain(file);
  });
});
