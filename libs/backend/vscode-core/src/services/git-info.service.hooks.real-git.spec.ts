/**
 * GitInfoService.commit against REAL git and real hooks (TASK_2026_576 RC1,
 * RC2; risks R5, R6, V7).
 *
 * - A failing hook is `HOOK_FAILED` with the hook's stdout + stderr verbatim
 *   and git's exit code; nothing is committed and no `index.lock` is left.
 * - A passing hook commits; hash and subject are read back from git — also on
 *   a root commit and on a detached HEAD.
 * - A commit aborted mid-hook is `CANCELLED`, leaves no `index.lock` and the
 *   next commit succeeds; on Windows the hook itself is proven dead.
 * - `GitCommitKillGuard` with real git: a cancel or a budget timeout of
 *   `commit -a` mid-hook (git holds `index.lock` through that hook) kills the
 *   tree and ends with no lock; on Windows the removal is Ptah's and logged.
 *   On real files: its own unchanged lock is removed; a foreign, changed or
 *   unconfirmed one never is.
 * - R6: the delay from `commit()` to the hook starting is measured and logged.
 * - `[slow]`: a hook that sleeps 60 s still commits. Runs where `CI` is set
 *   (the `git-real-git` job excludes `[slow]` names on Windows and macOS).
 *
 * Every repository lives under the OS temp directory and is deleted after.
 * Each one pins `core.hooksPath` to a directory inside its own `.git`, so a
 * machine-wide `core.hooksPath` never leaks in.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git-info.service.ts
 *   libs/backend/vscode-core/src/services/git/git-commit-runner.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitInfoService } from './git-info.service';
import {
  GitCommitKillGuard,
  readIndexLockFingerprint,
} from './git/git-commit-runner';
import { execGit, GitCancelledError } from '../utils/exec-git';
import type { Logger } from '../logging';

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const NODE = process.execPath.replace(/\\/g, '/');

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
}

const createdDirs: string[] = [];

/** A repo with one committed file, `a.txt` modified and staged. */
function makeRepo(options: { initialCommit?: boolean } = {}): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-hooks-')),
  );
  createdDirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Ptah Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(hooksDir(dir), { recursive: true });
  git(dir, 'config', 'core.hooksPath', hooksDir(dir).replace(/\\/g, '/'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  if (options.initialCommit !== false) {
    git(dir, 'commit', '-qm', 'init', '--no-verify');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
    git(dir, 'add', 'a.txt');
  }
  return dir;
}

function hooksDir(repo: string): string {
  return path.join(repo, '.git', 'ptah-test-hooks');
}

/** LF-only shell hook; Git for Windows runs hooks through its bundled sh. */
function installHook(repo: string, name: string, lines: string[]): void {
  const hookPath = path.join(hooksDir(repo), name);
  fs.writeFileSync(hookPath, ['#!/bin/sh', ...lines, ''].join('\n'));
  fs.chmodSync(hookPath, 0o755);
}

function removeHooks(repo: string): void {
  for (const name of fs.readdirSync(hooksDir(repo))) {
    fs.rmSync(path.join(hooksDir(repo), name));
  }
}

/** A hook line that records the moment the hook started, in epoch ms. */
function markStart(marker: string): string {
  return `"${NODE}" -e "require('fs').writeFileSync(process.argv[1], String(Date.now()))" "${marker.replace(/\\/g, '/')}"`;
}

/**
 * A hook that records its start, sleeps, then records that it finished. A
 * killed tree never writes the second marker.
 */
function sleepingHook(
  repo: string,
  seconds: number,
): {
  started: string;
  finished: string;
} {
  const started = path.join(repo, '.git', 'hook-started');
  const finished = path.join(repo, '.git', 'hook-finished');
  installHook(repo, 'pre-commit', [
    markStart(started),
    `sleep ${seconds}`,
    markStart(finished),
    'exit 0',
  ]);
  return { started, finished };
}

/**
 * Windows: exec-git kills the tree (taskkill /T) before git.exe, so the hook
 * script dies and never reaches its second marker. (The `sleep` it had exec'd
 * is re-parented by MSYS and ends on its own; the script around it is dead.)
 * POSIX: git is not a process-group leader, so its hook may outlive the kill
 * (reported); nothing is asserted there.
 */
async function expectHookKilled(
  finished: string,
  seconds: number,
): Promise<void> {
  if (process.platform !== 'win32') return;
  await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1_000));
  expect(fs.existsSync(finished)).toBe(false);
}

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`${file} never appeared`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function indexLock(repo: string): string {
  return path.join(repo, '.git', 'index.lock');
}

function makeLogger(): Logger & { warn: jest.Mock } {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger & { warn: jest.Mock };
}

/** Runs where CI is set; the OS matrix drops `[slow]` names off Linux. */
const slowIt = process.env['CI'] ? it : it.skip;

describe('GitInfoService.commit with hooks (real git)', () => {
  jest.setTimeout(120_000);

  beforeAll(() => {
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toMatch(
      /^git version/,
    );
  });

  afterAll(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 1_000,
      });
    }
  });

  it('returns HOOK_FAILED with the hook output and exit code when pre-commit fails', async () => {
    const repo = makeRepo();
    installHook(repo, 'pre-commit', [
      'echo "hook-stdout: lint failed in a.txt"',
      'echo "hook-stderr: 1 problem" 1>&2',
      'exit 3',
    ]);
    const head = git(repo, 'rev-parse', 'HEAD');

    const result = await new GitInfoService(makeLogger()).commit(
      repo,
      'feat: scale',
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('HOOK_FAILED');
    expect(result.exitCode).toBe(1); // git's own exit code for a hook refusal
    expect(result.hookOutput).toContain('hook-stdout: lint failed in a.txt');
    expect(result.hookOutput).toContain('hook-stderr: 1 problem');
    expect(result.error).toBeTruthy();
    expect(result.commitHash).toBeUndefined();
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('a.txt');
    expect(fs.existsSync(indexLock(repo))).toBe(false);
  });

  it('returns HOOK_FAILED when commit-msg rejects the message', async () => {
    const repo = makeRepo();
    installHook(repo, 'commit-msg', ['echo "bad subject" 1>&2', 'exit 1']);

    const result = await new GitInfoService(makeLogger()).commit(repo, 'wip');

    expect(result).toMatchObject({ success: false, code: 'HOOK_FAILED' });
    expect(result.hookOutput).toContain('bad subject');
  });

  it('returns GIT_ERROR, not HOOK_FAILED, when no hook is installed', async () => {
    const repo = makeRepo();
    git(repo, 'reset', '-q'); // nothing staged: git refuses on its own

    const result = await new GitInfoService(makeLogger()).commit(repo, 'x');

    expect(result).toMatchObject({ success: false, code: 'GIT_ERROR' });
    expect(result.hookOutput).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  // git ignores a non-executable hook on POSIX; Git for Windows ignores modes.
  (process.platform === 'win32' ? it.skip : it)(
    'returns GIT_ERROR when the only hook is not executable (POSIX)',
    async () => {
      const repo = makeRepo();
      installHook(repo, 'pre-commit', ['exit 1']);
      fs.chmodSync(path.join(hooksDir(repo), 'pre-commit'), 0o644);
      git(repo, 'reset', '-q'); // nothing staged: git refuses on its own

      const result = await new GitInfoService(makeLogger()).commit(repo, 'x');

      expect(result).toMatchObject({ success: false, code: 'GIT_ERROR' });
      expect(result.hookOutput).toBeUndefined();
    },
  );

  it('commits through a passing hook and reads hash and subject back from git (R6 start delay logged)', async () => {
    const repo = makeRepo();
    const marker = path.join(repo, '.git', 'hook-started');
    installHook(repo, 'pre-commit', [markStart(marker), 'exit 0']);

    const calledAt = Date.now();
    const result = await new GitInfoService(makeLogger()).commit(
      repo,
      '  feat(calc): scale three values  ',
    );
    const startDelayMs = Number(fs.readFileSync(marker, 'utf8')) - calledAt;
    console.info(`[R6] commit -> hook start delay: ${startDelayMs} ms`);

    expect(result).toEqual({
      success: true,
      commitHash: git(repo, 'rev-parse', '--short', 'HEAD'),
      subject: 'feat(calc): scale three values',
    });
    expect(startDelayMs).toBeGreaterThanOrEqual(0);
    expect(startDelayMs).toBeLessThan(10_000);
  });

  it('reads hash and subject for a root commit', async () => {
    const repo = makeRepo({ initialCommit: false });

    const result = await new GitInfoService(makeLogger()).commit(repo, 'root');

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe(git(repo, 'rev-parse', '--short', 'HEAD'));
    expect(result.subject).toBe('root');
    expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('reads hash and subject for a commit on a detached HEAD', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '-q', '--detach');

    const result = await new GitInfoService(makeLogger()).commit(
      repo,
      'detached work',
    );

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe(git(repo, 'rev-parse', '--short', 'HEAD'));
    expect(result.subject).toBe('detached work');
  });

  it('an aborted commit mid-hook is CANCELLED, kills the hook and leaves no index.lock', async () => {
    const repo = makeRepo();
    const hook = sleepingHook(repo, 4);
    const head = git(repo, 'rev-parse', 'HEAD');
    const service = new GitInfoService(makeLogger());
    const controller = new AbortController();

    const pending = service.commit(repo, 'never lands', {
      signal: controller.signal,
    });
    await waitForFile(hook.started, 30_000);
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({ success: false, code: 'CANCELLED' });
    expect(fs.existsSync(indexLock(repo))).toBe(false);
    await expectHookKilled(hook.finished, 4);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);

    // The repository is usable straight away.
    removeHooks(repo);
    await expect(service.commit(repo, 'after abort')).resolves.toMatchObject({
      success: true,
      subject: 'after abort',
    });
  });

  it('refuses an already-aborted signal without spawning git', async () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');
    const controller = new AbortController();
    controller.abort();

    const result = await new GitInfoService(makeLogger()).commit(repo, 'no', {
      signal: controller.signal,
    });

    expect(result).toMatchObject({ success: false, code: 'CANCELLED' });
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
  });

  slowIt(
    '[slow] a hook that runs for 60 s still commits',
    async () => {
      const repo = makeRepo();
      installHook(repo, 'pre-commit', ['sleep 60', 'exit 0']);

      const result = await new GitInfoService(makeLogger()).commit(
        repo,
        'slow hook',
      );

      expect(result).toMatchObject({ success: true, subject: 'slow hook' });
    },
    150_000,
  );
});

describe('GitCommitKillGuard (real git, real files)', () => {
  jest.setTimeout(60_000);

  afterAll(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 1_000,
      });
    }
  });

  it('a cancel of `commit -a` mid-hook kills the tree and Ptah removes the lock it left', async () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');
    // `commit -a` holds index.lock for the whole hook run.
    const hook = sleepingHook(repo, 4);
    const logger = makeLogger();
    const caller = new AbortController();
    const guard = new GitCommitKillGuard(
      indexLock(repo),
      60_000,
      caller.signal,
    );

    try {
      const commit = execGit(['commit', '-a', '-m', 'x'], repo, {
        timeoutMs: 60_000,
        signal: guard.signal,
        onExit: guard.onExit,
      });
      await waitForFile(hook.started, 30_000);
      expect(fs.existsSync(indexLock(repo))).toBe(true);
      caller.abort();
      await expect(commit).rejects.toBeInstanceOf(GitCancelledError);
      expect(guard.reason).toBe('CANCELLED');
      await guard.recoverIndexLock(logger);
    } finally {
      guard.dispose();
    }

    expect(fs.existsSync(indexLock(repo))).toBe(false);
    if (process.platform === 'win32') {
      // Forced termination runs no cleanup on Windows: the removal was ours,
      // and it happened because the killed tree was seen to exit.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('left by a commit Ptah stopped (CANCELLED)'),
      );
    }
    await expectHookKilled(hook.finished, 4);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('a budget timeout of `commit -a` mid-hook is TIMEOUT, kills the tree and leaves no lock', async () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');
    const hook = sleepingHook(repo, 8);
    const guard = new GitCommitKillGuard(indexLock(repo), 4_000);

    try {
      const commit = execGit(['commit', '-a', '-m', 'x'], repo, {
        timeoutMs: 60_000,
        signal: guard.signal,
        onExit: guard.onExit,
      });
      await expect(commit).rejects.toBeInstanceOf(GitCancelledError);
      expect(guard.reason).toBe('TIMEOUT');
      await guard.recoverIndexLock(makeLogger());
    } finally {
      guard.dispose();
    }

    expect(fs.existsSync(hook.started)).toBe(true);
    expect(fs.existsSync(indexLock(repo))).toBe(false);
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(fs.existsSync(hook.finished)).toBe(false);
    }
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('never removes a lock that predates the commit (foreign)', async () => {
    const repo = makeRepo();
    const lock = indexLock(repo);
    fs.writeFileSync(lock, 'someone else');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, past, past);
    const logger = makeLogger();
    const guard = new GitCommitKillGuard(lock, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(guard.reason).toBe('TIMEOUT');
    await guard.recoverIndexLock(logger);
    guard.dispose();

    expect(fs.readFileSync(lock, 'utf8')).toBe('someone else');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('predates this commit'),
    );
  });

  it('never removes a lock when no killed git process was seen to exit', async () => {
    const repo = makeRepo();
    const lock = indexLock(repo);
    const guard = new GitCommitKillGuard(lock, 10);
    // Written after the guard started, but no child of ours ever ran.
    fs.writeFileSync(lock, 'someone else');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readIndexLockFingerprint(lock)).not.toBeNull();
    const logger = makeLogger();
    await guard.recoverIndexLock(logger);
    guard.dispose();

    expect(fs.existsSync(lock)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not seen to exit'),
    );
  }, 15_000);

  it('removes its own unchanged lock once the killed child exited, and logs it', async () => {
    const repo = makeRepo();
    const lock = indexLock(repo);
    const guard = new GitCommitKillGuard(lock, 10);
    fs.writeFileSync(lock, 'ours at kill');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(guard.reason).toBe('TIMEOUT'); // the 10 ms budget ran out
    guard.onExit(); // the killed child closed
    const logger = makeLogger();
    await guard.recoverIndexLock(logger);
    guard.dispose();

    expect(fs.existsSync(lock)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('left by a commit Ptah stopped (TIMEOUT)'),
    );
  });

  it('never removes a lock that changed after the kill', async () => {
    const repo = makeRepo();
    const lock = indexLock(repo);
    const guard = new GitCommitKillGuard(lock, 10);
    fs.writeFileSync(lock, 'ours at kill');

    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.writeFileSync(lock, 'rewritten by another process');
    guard.onExit(); // the killed child closed
    const logger = makeLogger();
    await guard.recoverIndexLock(logger);
    guard.dispose();

    expect(fs.readFileSync(lock, 'utf8')).toBe('rewritten by another process');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('changed after the kill'),
    );
  });
});
