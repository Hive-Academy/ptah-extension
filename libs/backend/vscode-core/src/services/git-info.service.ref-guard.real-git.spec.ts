/**
 * GitInfoService ref guard against REAL git (TASK_2026_576 RC14).
 *
 * A ref from a webview request used to reach git's argv behind only a `..`
 * check, so `--output=<file>` made `git log` write a file and `-b` turned a
 * checkout into a branch creation. Each call site below is driven with a
 * refused value (nothing runs, nothing is written) and with a real value
 * (git accepts the `--end-of-options` / `--` argument shape).
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 *   libs/backend/vscode-core/src/services/git/git-ref-guard.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitInfoService } from './git-info.service';
import type { Logger } from '../logging';

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  createdDirs.push(dir);
  return dir;
}

/** A repository with two commits on `main` and a `feature` branch. */
function makeRepo(): string {
  const dir = makeTempDir('ptah-ref-guard-');
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'first');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  git(dir, 'commit', '-qam', 'second');
  git(dir, 'branch', 'feature');
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

function branches(repo: string): string[] {
  return git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')
    .split('\n')
    .filter(Boolean)
    .sort();
}

function worktreeCount(repo: string): number {
  return git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree ')).length;
}

describe('GitInfoService ref guard (real git)', () => {
  jest.setTimeout(120_000);

  let service: GitInfoService;
  let outFile: string;

  beforeAll(() => {
    const version = execFileSync('git', ['--version'], { encoding: 'utf8' });
    expect(version).toMatch(/^git version/);
  });

  beforeEach(() => {
    service = new GitInfoService(makeLogger());
    outFile = path.join(makeTempDir('ptah-ref-guard-out-'), 'x');
  });

  afterAll(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  describe('getLastCommit', () => {
    it('refuses --output=<file> and -b with the empty result, writing nothing', async () => {
      const repo = makeRepo();

      for (const ref of [`--output=${outFile}`, '-b']) {
        const result = await service.getLastCommit(repo, ref);
        expect(result).toEqual({
          hash: '',
          shortHash: '',
          subject: '',
          body: '',
          author: '',
          authorEmail: '',
          time: 0,
        });
      }
      expect(fs.existsSync(outFile)).toBe(false);
    });

    it('reads HEAD, a ~ suffix and a ^{commit} peel after --end-of-options', async () => {
      const repo = makeRepo();
      const head = git(repo, 'rev-parse', 'HEAD').trim();
      const parent = git(repo, 'rev-parse', 'HEAD~1').trim();

      expect((await service.getLastCommit(repo)).hash).toBe(head);
      const first = await service.getLastCommit(repo, 'HEAD~1');
      expect(first.hash).toBe(parent);
      expect(first.subject).toBe('first');
      expect((await service.getLastCommit(repo, 'main^{commit}')).hash).toBe(
        head,
      );
    });

    it('still reads the internally built stash@{N} ordinal', async () => {
      const repo = makeRepo();
      fs.writeFileSync(path.join(repo, 'a.txt'), 'stashed\n');
      git(repo, 'stash', 'push', '-q', '-m', 'wip');
      const stash = git(repo, 'rev-parse', 'stash@{0}').trim();

      expect((await service.getLastCommit(repo, 'stash@{0}')).hash).toBe(
        stash,
      );
    });
  });

  describe('checkout', () => {
    it('refuses -b and --output=<file>: no branch created, nothing written', async () => {
      const repo = makeRepo();
      const before = branches(repo);

      for (const branch of ['-b', `--output=${outFile}`]) {
        await expect(service.checkout(repo, branch)).resolves.toEqual({
          success: false,
          error: 'Invalid branch name',
        });
        await expect(service.checkout(repo, branch, true)).resolves.toEqual({
          success: false,
          error: 'Invalid branch name',
        });
      }

      expect(branches(repo)).toEqual(before);
      expect(git(repo, 'branch', '--show-current').trim()).toBe('main');
      expect(fs.existsSync(outFile)).toBe(false);
    });

    it('switches to an existing branch and creates a new one', async () => {
      const repo = makeRepo();

      await expect(service.checkout(repo, 'feature')).resolves.toEqual({
        success: true,
      });
      expect(git(repo, 'branch', '--show-current').trim()).toBe('feature');

      await expect(service.checkout(repo, 'fresh', true)).resolves.toEqual({
        success: true,
      });
      expect(git(repo, 'branch', '--show-current').trim()).toBe('fresh');
    });
  });

  describe('addWorktree', () => {
    it('refuses -b and --output=<file>: no worktree, no branch, nothing written', async () => {
      const repo = makeRepo();
      const before = branches(repo);

      for (const branch of ['-b', `--output=${outFile}`]) {
        for (const createBranch of [false, true]) {
          await expect(
            service.addWorktree(repo, { branch, createBranch }),
          ).resolves.toEqual({ success: false, error: 'Invalid branch name' });
        }
      }

      expect(worktreeCount(repo)).toBe(1);
      expect(branches(repo)).toEqual(before);
      expect(fs.existsSync(outFile)).toBe(false);
    });

    it('adds a worktree for an existing branch and for a new one', async () => {
      const repo = makeRepo();
      const existingPath = path.join(makeTempDir('ptah-wt-'), 'existing');
      const newPath = path.join(makeTempDir('ptah-wt-'), 'new');

      await expect(
        service.addWorktree(repo, { branch: 'feature', path: existingPath }),
      ).resolves.toEqual({ success: true, worktreePath: existingPath });
      expect(git(existingPath, 'branch', '--show-current').trim()).toBe(
        'feature',
      );

      await expect(
        service.addWorktree(repo, {
          branch: 'wt-new',
          path: newPath,
          createBranch: true,
        }),
      ).resolves.toEqual({ success: true, worktreePath: newPath });
      expect(git(newPath, 'branch', '--show-current').trim()).toBe('wt-new');
      expect(worktreeCount(repo)).toBe(3);
    });
  });

  describe('removeWorktree', () => {
    it('removes a worktree whose path starts with "-" (path follows --)', async () => {
      const repo = makeRepo();
      git(repo, 'worktree', 'add', '-q', '-b', 'dash', './-wt');
      expect(worktreeCount(repo)).toBe(2);

      await expect(service.removeWorktree(repo, '-wt')).resolves.toEqual({
        success: true,
      });
      expect(worktreeCount(repo)).toBe(1);
      expect(fs.existsSync(path.join(repo, '-wt'))).toBe(false);
    });

    it('removes a dirty worktree with force', async () => {
      const repo = makeRepo();
      const wtPath = path.join(makeTempDir('ptah-wt-'), 'dirty');
      git(repo, 'worktree', 'add', '-q', '-b', 'dirty', wtPath);
      fs.writeFileSync(path.join(wtPath, 'a.txt'), 'changed\n');

      const refused = await service.removeWorktree(repo, wtPath);
      expect(refused.success).toBe(false);

      await expect(
        service.removeWorktree(repo, wtPath, true),
      ).resolves.toEqual({ success: true });
      expect(worktreeCount(repo)).toBe(1);
    });
  });
});
