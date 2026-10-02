/**
 * GitInfoService write lock against REAL git (TASK_2026_576 RC6, risk R4).
 *
 * - Two `applyHunks` on one file, started together, both succeed: the second
 *   runs only after the first has finished its whole ladder. Run the other
 *   way round, or interleaved, the second's snapshot would be stale.
 * - Parallel `stageFiles` calls on one repository all land.
 * - A `.git/index.lock` held by another process gives `LOCKED` with the fixed
 *   message after the ~3.1 s retry window, leaves that lock alone, and the
 *   next stage succeeds once the lock is gone.
 *
 * Every repository lives under the OS temp directory and is deleted after.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 *   libs/backend/vscode-core/src/services/git/git-write-lock.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { GIT_LOCKED_MESSAGE } from '@ptah-extension/shared';
import { GitInfoService } from './git-info.service';
import type { WorktreeFileAccess } from './git-info.service';
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-write-lock-')),
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

const fileSystem: WorktreeFileAccess = {
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
  async writeFileBytes(filePath: string, content: Uint8Array): Promise<void> {
    await fsp.writeFile(filePath, content);
  },
};

const lines = (edit: (next: string[]) => void): string => {
  const next = Array.from({ length: 40 }, (_, i) => `L${i + 1}`);
  edit(next);
  return next.join('\n') + '\n';
};

describe('GitInfoService write lock (real git)', () => {
  jest.setTimeout(60_000);

  afterAll(() => {
    for (const dir of createdRepos.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('runs two parallel applyHunks on one file one after the other; both succeed', async () => {
    const repo = makeRepo();
    const file = path.join(repo, 'f.txt');
    fs.writeFileSync(
      file,
      lines(() => undefined),
    );
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-qm', 'init');
    // Staged: line 2. Worktree only: line 35.
    fs.writeFileSync(
      file,
      lines((n) => (n[1] = 'L2-STAGED')),
    );
    git(repo, 'add', 'f.txt');
    fs.writeFileSync(
      file,
      lines((n) => {
        n[1] = 'L2-STAGED';
        n[34] = 'L35-WORKTREE';
      }),
    );

    const service = new GitInfoService(makeLogger());
    const worktree = await service.diffFile(
      repo,
      { path: 'f.txt', comparison: 'worktree' },
      fileSystem,
    );
    const staged = await service.diffFile(
      repo,
      { path: 'f.txt', comparison: 'staged' },
      fileSystem,
    );
    expect(worktree.hunks).toHaveLength(1);
    expect(staged.hunks).toHaveLength(1);

    // Started together, in this order. The unstage rewrites the index, which
    // the revert's worktree snapshot depends on: only a revert that finished
    // before the unstage started can still match its token.
    const [revert, unstage] = await Promise.all([
      service.applyHunks(
        repo,
        {
          path: 'f.txt',
          comparison: 'worktree',
          operation: 'revert',
          hunkIndices: [0],
          snapshotToken: worktree.snapshotToken,
        },
        fileSystem,
      ),
      service.applyHunks(
        repo,
        {
          path: 'f.txt',
          comparison: 'staged',
          operation: 'unstage',
          hunkIndices: [0],
          snapshotToken: staged.snapshotToken,
        },
        fileSystem,
      ),
    ]);

    expect(revert).toMatchObject({ success: true });
    expect(unstage).toMatchObject({ success: true });
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toBe(
      lines((n) => (n[1] = 'L2-STAGED')),
    );
  });

  it('lands every one of several parallel stageFiles calls', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
    git(repo, 'add', 'seed.txt');
    git(repo, 'commit', '-qm', 'init');
    const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt'];
    for (const name of names) fs.writeFileSync(path.join(repo, name), name);

    const service = new GitInfoService(makeLogger());
    const results = await Promise.all(
      names.map((name) => service.stageFiles(repo, [name])),
    );

    expect(results).toEqual(names.map(() => ({ success: true })));
    expect(git(repo, 'diff', '--cached', '--name-only').split('\n')).toEqual([
      ...names,
      '',
    ]);
  });

  it('reports LOCKED after the retry window for a held index.lock, then stages once it is gone', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
    const lock = path.join(repo, '.git', 'index.lock');
    fs.writeFileSync(lock, 'held by another process');

    const service = new GitInfoService(makeLogger());
    const startedAt = Date.now();
    const locked = await service.stageFiles(repo, ['a.txt']);
    const elapsedMs = Date.now() - startedAt;

    expect(locked).toEqual({
      success: false,
      code: 'LOCKED',
      error: GIT_LOCKED_MESSAGE,
    });
    // 100 + 200 + 400 + 800 + 1600 ms of backoff between six attempts.
    expect(elapsedMs).toBeGreaterThanOrEqual(3_100);
    expect(fs.readFileSync(lock, 'utf8')).toBe('held by another process');
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');

    fs.rmSync(lock);
    await expect(service.stageFiles(repo, ['a.txt'])).resolves.toEqual({
      success: true,
    });
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('a.txt\n');
  });
});
