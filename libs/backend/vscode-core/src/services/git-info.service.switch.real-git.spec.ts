/**
 * GitInfoService.checkout against REAL git: `git switch` semantics with
 * stash, force and track (TASK_2026_576 RC9).
 *
 * Covers: a new branch carries untracked files; an overwrite refusal gives
 * `dirty` plus git's own path list (no `status --porcelain` pre-check);
 * stash & switch; a failed switch pops the stash back; a failed pop keeps the
 * stash and reports both errors; remote tracking never detaches HEAD.
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards. Each pins `core.hooksPath` to a directory inside its own `.git`
 * so a machine-wide hook never runs.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
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
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}

function hooksDir(repo: string): string {
  return path.join(repo, '.git', 'ptah-test-hooks');
}

function configure(repo: string): void {
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Ptah Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(hooksDir(repo), { recursive: true });
  git(repo, 'config', 'core.hooksPath', hooksDir(repo).replace(/\\/g, '/'));
}

/**
 * `main` and `feature` differ in `a.txt`; `feature` also adds `f.txt`, so a
 * local edit of `a.txt` on `main` blocks a plain switch to `feature`.
 */
function makeRepo(): string {
  const dir = makeTempDir('ptah-switch-');
  git(dir, 'init', '-q', '-b', 'main', '.');
  configure(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'first');
  git(dir, 'switch', '-q', '-c', 'feature');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'feature\n');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'f\n');
  git(dir, 'add', 'a.txt', 'f.txt');
  git(dir, 'commit', '-qm', 'feature');
  git(dir, 'switch', '-q', 'main');
  return dir;
}

/** A clone of {@link makeRepo}: `origin/feature` exists, local `feature` does not. */
function makeClone(): string {
  const origin = makeRepo();
  const parent = makeTempDir('ptah-switch-clone-');
  const clone = path.join(parent, 'clone');
  // The checkout must use the same autocrlf as `configure`, or every file
  // reads as modified afterwards.
  execFileSync(
    'git',
    ['clone', '-q', '-c', 'core.autocrlf=false', origin, clone],
    { env: GIT_ENV },
  );
  configure(clone);
  return clone;
}

/** LF-only shell hook; Git for Windows runs hooks through its bundled sh. */
function writeHook(repo: string, name: string, lines: string[]): void {
  const hookPath = path.join(hooksDir(repo), name);
  fs.writeFileSync(hookPath, ['#!/bin/sh', ...lines, ''].join('\n'));
  fs.chmodSync(hookPath, 0o755);
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function currentBranch(repo: string): string {
  return git(repo, 'branch', '--show-current').trim();
}

/** Throws (failing the test) when HEAD is detached. */
function symbolicHead(repo: string): string {
  return git(repo, 'symbolic-ref', 'HEAD').trim();
}

function stashShas(repo: string): string[] {
  return git(repo, 'stash', 'list', '--format=%H').split('\n').filter(Boolean);
}

function read(repo: string, file: string): string {
  return fs.readFileSync(path.join(repo, file), 'utf8');
}

describe('GitInfoService.checkout switch semantics (real git)', () => {
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
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('creates a branch carrying modified and untracked files', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
    fs.writeFileSync(path.join(repo, 'u.txt'), 'untracked\n');

    await expect(service.checkout(repo, 'fresh', true)).resolves.toEqual({
      success: true,
    });

    expect(symbolicHead(repo)).toBe('refs/heads/fresh');
    expect(read(repo, 'a.txt')).toBe('edited\n');
    expect(read(repo, 'u.txt')).toBe('untracked\n');
  });

  it('switches with an unrelated local change instead of refusing on a dirty tree', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'u.txt'), 'untracked\n');

    await expect(service.checkout(repo, 'feature')).resolves.toEqual({
      success: true,
    });

    expect(currentBranch(repo)).toBe('feature');
    expect(read(repo, 'u.txt')).toBe('untracked\n');
  });

  it('reports dirty with git’s conflicting paths when a change would be overwritten', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'untracked clash\n');

    const result = await service.checkout(repo, 'feature');

    expect(result.success).toBe(false);
    expect(result.dirty).toBe(true);
    expect([...(result.conflictingPaths ?? [])].sort()).toEqual([
      'a.txt',
      'f.txt',
    ]);
    expect(currentBranch(repo)).toBe('main');
    expect(read(repo, 'a.txt')).toBe('edited\n');
  });

  it('discards local changes with force', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');

    await expect(
      service.checkout(repo, 'feature', false, true),
    ).resolves.toEqual({ success: true });

    expect(currentBranch(repo)).toBe('feature');
    expect(read(repo, 'a.txt')).toBe('feature\n');
  });

  it('reports an untracked blocker of force as dirty and never deletes it', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'untracked clash\n');

    const result = await service.checkout(repo, 'feature', false, true);

    expect(result).toMatchObject({
      success: false,
      dirty: true,
      conflictingPaths: ['f.txt'],
    });
    expect(result.error).toMatch(
      /^Untracked files block this switch: f\.txt\./,
    );
    expect(currentBranch(repo)).toBe('main');
    expect(read(repo, 'f.txt')).toBe('untracked clash\n');
  });

  it('stashes (untracked included) and switches, returning the stash SHA', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
    fs.writeFileSync(path.join(repo, 'u.txt'), 'untracked\n');

    const result = await service.checkout(repo, 'feature', false, false, {
      stash: true,
    });

    expect(result.success).toBe(true);
    expect(currentBranch(repo)).toBe('feature');
    expect(read(repo, 'a.txt')).toBe('feature\n');
    expect(fs.existsSync(path.join(repo, 'u.txt'))).toBe(false);
    expect(result.stashRef).toBe(git(repo, 'rev-parse', 'stash@{0}').trim());
    expect(git(repo, 'stash', 'list', '--format=%s')).toContain(
      'ptah: before switching to feature',
    );
  });

  it('creates no stash entry and no stashRef for a clean tree', async () => {
    const repo = makeRepo();

    await expect(
      service.checkout(repo, 'feature', false, false, { stash: true }),
    ).resolves.toEqual({ success: true });

    expect(currentBranch(repo)).toBe('feature');
    expect(stashShas(repo)).toEqual([]);
  });

  it('pops the stash back when the switch fails', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'edited\n');
    fs.writeFileSync(path.join(repo, 'u.txt'), 'untracked\n');

    const result = await service.checkout(
      repo,
      'no-such-branch',
      false,
      false,
      {
        stash: true,
      },
    );

    expect(result.success).toBe(false);
    expect(result.stashRef).toBeUndefined();
    expect(currentBranch(repo)).toBe('main');
    expect(read(repo, 'a.txt')).toBe('edited\n');
    expect(read(repo, 'u.txt')).toBe('untracked\n');
    expect(stashShas(repo)).toEqual([]);
  });

  it('keeps the stash and reports both errors when the pop fails too', async () => {
    const repo = makeRepo();
    // post-checkout makes `git switch` exit non-zero and recreates u.txt, so
    // popping the stashed untracked u.txt back is refused.
    writeHook(repo, 'post-checkout', [
      "printf 'hook copy\\n' > u.txt",
      "echo 'post-checkout refused' >&2",
      'exit 1',
    ]);
    fs.writeFileSync(path.join(repo, 'u.txt'), 'untracked\n');

    const result = await service.checkout(repo, 'feature', false, false, {
      stash: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('post-checkout refused');
    expect(result.error).toContain(
      'Restoring your stashed changes also failed',
    );
    expect(stashShas(repo)).toEqual([result.stashRef]);
    expect(git(repo, 'show', `${result.stashRef ?? ''}^3:u.txt`)).toBe(
      'untracked\n',
    );
  });

  it('track: creates a local branch tracking origin/x without detaching HEAD', async () => {
    const clone = makeClone();

    await expect(
      service.checkout(clone, 'origin/feature', false, false, { track: true }),
    ).resolves.toEqual({ success: true });

    expect(symbolicHead(clone)).toBe('refs/heads/feature');
    expect(
      git(clone, 'rev-parse', '--abbrev-ref', 'feature@{upstream}').trim(),
    ).toBe('origin/feature');
  });

  it('track: switches to the existing local branch for origin/x', async () => {
    const clone = makeClone();
    git(clone, 'switch', '-q', '-c', 'feature', '--track', 'origin/feature');
    git(clone, 'switch', '-q', 'main');
    const before = git(
      clone,
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
    );

    await expect(
      service.checkout(clone, 'origin/feature', false, false, { track: true }),
    ).resolves.toEqual({ success: true });

    expect(symbolicHead(clone)).toBe('refs/heads/feature');
    expect(
      git(clone, 'for-each-ref', '--format=%(refname)', 'refs/heads'),
    ).toBe(before);
  });

  it('without track, a remote ref is refused rather than detaching HEAD', async () => {
    const clone = makeClone();

    const result = await service.checkout(clone, 'origin/feature');

    expect(result.success).toBe(false);
    expect(symbolicHead(clone)).toBe('refs/heads/main');
  });

  it('refuses option-shaped refs before any git operation, for every mode', async () => {
    const repo = makeRepo();
    for (const options of [{}, { stash: true }, { track: true }]) {
      await expect(
        service.checkout(repo, '--orphan=x', false, false, options),
      ).resolves.toEqual({ success: false, error: 'Invalid branch name' });
    }
    expect(symbolicHead(repo)).toBe('refs/heads/main');
    expect(stashShas(repo)).toEqual([]);
  });
});
