/**
 * GitInfoService change-set delegates against REAL git (TASK_2026_576
 * Component 19 / 21).
 *
 * Proves what the unit mocks cannot: git accepts the argv shapes
 * (`diff --end-of-options <sha> -- :(top,literal)<path>`, `ls-files --others
 * --full-name`), an unborn branch exits 1 from `rev-parse --verify --quiet`
 * and diffs against the empty tree, and a path with glob characters is
 * matched literally.
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 *   libs/backend/vscode-core/src/services/git/git-change-set-numstat.reader.ts
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
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const createdDirs: string[] = [];

function makeRepo(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-change-set-')),
  );
  createdDirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

function write(repo: string, relativePath: string, content: string): void {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

afterAll(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('GitInfoService change-set delegates (real git)', () => {
  it('counts modified, deleted, glob-named, untracked and unchanged paths against HEAD', async () => {
    const repo = makeRepo();
    write(repo, 'src/a.ts', 'one\ntwo\n');
    write(repo, 'src/gone.ts', 'x\ny\nz\n');
    write(repo, 'app/[id].tsx', 'old\n');
    write(repo, 'app/i.tsx', 'decoy\n');
    write(repo, 'same.ts', 'same\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');

    write(repo, 'src/a.ts', 'one\nTWO\nthree\n');
    fs.rmSync(path.join(repo, 'src/gone.ts'));
    write(repo, 'app/[id].tsx', 'new\nnewer\n');
    write(repo, 'app/i.tsx', 'decoy changed\n');
    write(repo, 'fresh/new.ts', 'a\nb\nc\nd\n');
    const service = new GitInfoService(makeLogger());

    const counts = await service.readChangeSetNumstat(repo, [
      'src/a.ts',
      'src/gone.ts',
      'app/[id].tsx',
      'fresh/new.ts',
      'same.ts',
    ]);

    expect(Object.fromEntries(counts)).toEqual({
      'src/a.ts': { additions: 2, deletions: 1, binary: false },
      'src/gone.ts': { additions: 0, deletions: 3, binary: false },
      'app/[id].tsx': { additions: 2, deletions: 1, binary: false },
      'fresh/new.ts': { additions: 4, deletions: 0, binary: false },
      'same.ts': { additions: 0, deletions: 0, binary: false },
    });
  });

  it('counts against the empty tree on an unborn branch', async () => {
    const repo = makeRepo();
    write(repo, 'staged.ts', 'a\nb\n');
    git(repo, 'add', 'staged.ts');
    write(repo, 'loose.ts', 'c\n');
    const service = new GitInfoService(makeLogger());

    const counts = await service.readChangeSetNumstat(repo, [
      'staged.ts',
      'loose.ts',
    ]);

    expect(Object.fromEntries(counts)).toEqual({
      'staged.ts': { additions: 2, deletions: 0, binary: false },
      'loose.ts': { additions: 1, deletions: 0, binary: false },
    });
  });

  it('reads repository-root paths from a workspace that is a subdirectory', async () => {
    const repo = makeRepo();
    write(repo, 'pkg/src/a.ts', 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    write(repo, 'pkg/src/a.ts', 'one\ntwo\n');
    const service = new GitInfoService(makeLogger());

    const counts = await service.readChangeSetNumstat(path.join(repo, 'pkg'), [
      'pkg/src/a.ts',
    ]);

    expect(counts.get('pkg/src/a.ts')).toEqual({
      additions: 1,
      deletions: 0,
      binary: false,
    });
  });

  it('reads HEAD text, absent paths and the unborn branch', async () => {
    const unborn = makeRepo();
    write(unborn, 'a.ts', 'not committed\n');
    const service = new GitInfoService(makeLogger());

    await expect(service.readHeadText(unborn, 'a.ts')).resolves.toEqual({
      outcome: 'absent',
    });

    const repo = makeRepo();
    write(repo, 'a.ts', 'at head\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    write(repo, 'a.ts', 'in the worktree\n');

    await expect(service.readHeadText(repo, 'a.ts')).resolves.toEqual({
      outcome: 'content',
      content: 'at head\n',
    });
    await expect(service.readHeadText(repo, 'missing.ts')).resolves.toEqual({
      outcome: 'absent',
    });
  });

  it('refuses a HEAD side past the per-side cap as too-large', async () => {
    const repo = makeRepo();
    write(repo, 'big.txt', 'a'.repeat(3 * 1024 * 1024));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const service = new GitInfoService(makeLogger());

    await expect(service.readHeadText(repo, 'big.txt')).resolves.toEqual({
      outcome: 'too-large',
      byteLength: 3 * 1024 * 1024,
    });
  });
});
