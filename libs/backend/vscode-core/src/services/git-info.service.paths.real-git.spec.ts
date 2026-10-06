/**
 * GitInfoService path handling against REAL git (TASK_2026_576 RC4,
 * Requirements 1.5 and 1.6).
 *
 * `git status --porcelain=v2` without `-z` C-quotes any path with a byte
 * outside printable ASCII, a `"` or a `\` (under the default
 * `core.quotepath=true`), and the old parser then trimmed what was left. The
 * quoted name matched no numstat key and no file on disk, so stage, unstage
 * and discard failed on it. Every name below goes through the whole loop:
 * status, numstat, diffFile, stage, unstage, discard.
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards; `core.quotepath` is left at git's default on purpose.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { GitInfoService } from './git-info.service';
import type { WorktreeFileReader } from './git-info.service';
import type { Logger } from '../logging';

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

const createdRepos: string[] = [];

function makeRepo(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-paths-')),
  );
  createdRepos.push(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const fileReader: WorktreeFileReader = {
  async readFileBytes(filePath: string): Promise<Uint8Array> {
    return fsp.readFile(filePath);
  },
  async exists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * The names under test. NTFS forbids `"` and treats `\` as a separator, and
 * Win32 strips a trailing space, so those three run on POSIX only.
 */
const NAMES: string[] = [
  'café.txt',
  '研究.txt',
  'ملف.txt',
  ' leading space.txt',
  ...(process.platform === 'win32'
    ? []
    : ['a"b.txt', 'a\\b.txt', 'trailing space.txt ']),
];

describe('GitInfoService paths (real git)', () => {
  jest.setTimeout(120_000);

  let service: GitInfoService;

  beforeAll(() => {
    const version = execFileSync('git', ['--version'], { encoding: 'utf8' });
    expect(version).toMatch(/^git version/);
  });

  beforeEach(() => {
    service = new GitInfoService(makeLogger());
  });

  afterAll(() => {
    for (const dir of createdRepos.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  function repoWithModified(name: string): string {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, name), 'one\n');
    git(repo, 'add', '--', name);
    git(repo, 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(repo, name), 'one\ntwo\n');
    return repo;
  }

  it.each(NAMES)(
    'status, numstat, diff, stage, unstage, discard: %j',
    async (name) => {
      const repo = repoWithModified(name);

      const before = await service.getGitInfo(repo);
      expect(before.statusUnavailable).toBeUndefined();
      expect(before.files).toEqual([
        {
          path: name,
          status: 'M',
          staged: false,
          additions: 1,
          deletions: 0,
          binary: false,
        },
      ]);

      const diff = await service.diffFile(
        repo,
        { path: name, comparison: 'worktree' },
        fileReader,
      );
      expect(diff.patch).not.toBeNull();
      expect(diff.hunks).toHaveLength(1);

      await expect(service.stageFiles(repo, [name])).resolves.toEqual({
        success: true,
      });
      const staged = await service.getGitInfo(repo);
      expect(staged.files).toEqual([
        expect.objectContaining({ path: name, staged: true, additions: 1 }),
      ]);

      await expect(service.unstageFiles(repo, [name])).resolves.toEqual({
        success: true,
      });
      const unstaged = await service.getGitInfo(repo);
      expect(unstaged.files).toEqual([
        expect.objectContaining({ path: name, staged: false }),
      ]);

      await expect(service.discardChanges(repo, [name])).resolves.toEqual({
        success: true,
      });
      expect(fs.readFileSync(path.join(repo, name), 'utf8')).toBe('one\n');
      expect((await service.getGitInfo(repo)).files).toEqual([]);
    },
  );

  it.each(NAMES)('discards an untracked file: %j', async (name) => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'keep.txt'), 'k\n');
    git(repo, 'add', 'keep.txt');
    git(repo, 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(repo, name), 'new\n');

    const info = await service.getGitInfo(repo);
    expect(info.files).toEqual([
      expect.objectContaining({ path: name, status: '??', additions: 1 }),
    ]);

    await expect(service.discardChanges(repo, [name])).resolves.toEqual({
      success: true,
    });
    expect(fs.existsSync(path.join(repo, name))).toBe(false);
  });

  it('discards a staged rename named by its new path: old restored, new gone', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'old name.txt'), 'hello\nworld\n');
    git(repo, 'add', '--', 'old name.txt');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'mv', 'old name.txt', 'new café.txt');
    fs.appendFileSync(path.join(repo, 'new café.txt'), 'extra\n');

    const info = await service.getGitInfo(repo);
    expect(info.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'new café.txt',
          status: 'R',
          staged: true,
          origPath: 'old name.txt',
        }),
      ]),
    );

    await expect(
      service.discardChanges(repo, ['new café.txt']),
    ).resolves.toEqual({ success: true });

    expect(fs.readFileSync(path.join(repo, 'old name.txt'), 'utf8')).toBe(
      'hello\nworld\n',
    );
    expect(fs.existsSync(path.join(repo, 'new café.txt'))).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('discard all (worktreeOnly) keeps a staged rename and drops only its worktree edit', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'old name.txt'), 'hello\nworld\n');
    git(repo, 'add', '--', 'old name.txt');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'mv', 'old name.txt', 'new café.txt');
    fs.appendFileSync(path.join(repo, 'new café.txt'), 'extra\n');
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'tmp\n');

    await expect(
      service.discardChanges(repo, ['new café.txt', 'scratch.txt'], {
        worktreeOnly: true,
      }),
    ).resolves.toEqual({ success: true });

    expect(fs.readFileSync(path.join(repo, 'new café.txt'), 'utf8')).toBe(
      'hello\nworld\n',
    );
    expect(fs.existsSync(path.join(repo, 'old name.txt'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'scratch.txt'))).toBe(false);
    // The rename is still staged, with nothing left unstaged.
    const files = (await service.getGitInfo(repo)).files;
    expect(files).toEqual([
      expect.objectContaining({
        path: 'new café.txt',
        status: 'R',
        staged: true,
        origPath: 'old name.txt',
      }),
    ]);
  });

  it('discard all (worktreeOnly) skips a conflicted path and still discards the rest', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'c.txt'), 'base\n');
    fs.writeFileSync(path.join(repo, 'e.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'checkout', '-qb', 'side');
    fs.writeFileSync(path.join(repo, 'c.txt'), 'side\n');
    git(repo, 'commit', '-qam', 'side');
    git(repo, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'c.txt'), 'main\n');
    git(repo, 'commit', '-qam', 'main');
    try {
      git(repo, 'merge', '-q', 'side');
    } catch {
      // expected: the merge stops on the conflict
    }
    fs.writeFileSync(path.join(repo, 'e.txt'), 'edited\n');
    const conflicted = fs.readFileSync(path.join(repo, 'c.txt'), 'utf8');

    await expect(
      service.discardChanges(repo, ['c.txt', 'e.txt'], { worktreeOnly: true }),
    ).resolves.toEqual({ success: true });

    expect(fs.readFileSync(path.join(repo, 'e.txt'), 'utf8')).toBe('base\n');
    expect(fs.readFileSync(path.join(repo, 'c.txt'), 'utf8')).toBe(conflicted);
  });

  it('refuses a worktree read through a link that escapes the repository', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'keep.txt'), 'k\n');
    git(repo, 'add', 'keep.txt');
    git(repo, 'commit', '-qm', 'init');
    const outside = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-outside-')),
    );
    createdRepos.push(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret\n');
    // A junction needs no privilege on Windows; elsewhere it is a symlink.
    fs.symlinkSync(outside, path.join(repo, 'link'), 'junction');

    const diff = await service.diffFile(
      repo,
      { path: 'link/secret.txt', comparison: 'worktree' },
      fileReader,
    );

    expect(diff.modified).toEqual(
      expect.objectContaining({ outcome: 'error', code: 'permission-denied' }),
    );
    expect(JSON.stringify(diff)).not.toContain('secret\\n');
  });

  it('fails a staged-rename discard, touching nothing, when the rename lookup read fails', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'old.txt'), 'hello\n');
    git(repo, 'add', 'old.txt');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'mv', 'old.txt', 'new.txt');
    fs.appendFileSync(path.join(repo, 'new.txt'), 'extra\n');
    const statusBefore = git(repo, 'status', '--porcelain=v2');

    // Real git for every call except the unfiltered rename lookup, which
    // fails as it would behind another process's index.lock.
    const seam = service as unknown as {
      execGit: (args: string[], cwd: string, options?: unknown) => unknown;
    };
    const realExecGit = seam.execGit.bind(service);
    jest
      .spyOn(seam, 'execGit')
      .mockImplementation((args: string[], cwd: string, options?: unknown) =>
        args[0] === 'status' && args.includes('--untracked-files=no')
          ? Promise.resolve({
              stdout: '',
              stderr: `fatal: Unable to create '${repo}/.git/index.lock': File exists.\n`,
              exitCode: 128,
            })
          : realExecGit(args, cwd, options),
      );

    await expect(service.discardChanges(repo, ['new.txt'])).resolves.toEqual({
      success: false,
      code: 'LOCKED',
      error: 'Another git process is using this repository.',
    });

    expect(git(repo, 'status', '--porcelain=v2')).toBe(statusBefore);
    expect(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8')).toBe(
      'hello\nextra\n',
    );
    expect(fs.existsSync(path.join(repo, 'old.txt'))).toBe(false);
  });

  it('never lists an ignored file, even when git reports it', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(repo, 'debug.log'), 'noise\n');

    // Ask git itself for the ignored record the parser keeps as `!`.
    const raw = git(repo, 'status', '--porcelain=v2', '-z', '--ignored');
    expect(raw).toContain('! debug.log\0');

    expect((await service.getGitInfo(repo)).files).toEqual([]);
    await expect(service.discardChanges(repo, ['debug.log'])).resolves.toEqual({
      success: true,
    });
    expect(fs.existsSync(path.join(repo, 'debug.log'))).toBe(true);
  });
});
