import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  GitCommitKillGuard,
  GitCommitRunner,
  type GitCommitRunnerDeps,
} from './git-commit-runner';
import type { GitRepoWriteLock } from './git-write-lock';
import type { Logger } from '../../logging';
import type { ExecGitResult } from '../../utils/exec-git';

describe('GitCommitKillGuard', () => {
  it('kills immediately with CANCELLED when callerSignal is already aborted before construction', () => {
    const caller = new AbortController();
    caller.abort();

    const guard = new GitCommitKillGuard(null, 60_000, caller.signal);

    expect(guard.signal.aborted).toBe(true);
    expect(guard.reason).toBe('CANCELLED');
    guard.dispose();
  });

  it('kills with CANCELLED when callerSignal aborts after construction', () => {
    const caller = new AbortController();
    const guard = new GitCommitKillGuard(null, 60_000, caller.signal);

    expect(guard.signal.aborted).toBe(false);
    caller.abort();
    expect(guard.signal.aborted).toBe(true);
    expect(guard.reason).toBe('CANCELLED');
    guard.dispose();
  });

  it('kills with TIMEOUT when timeout expires', () => {
    jest.useFakeTimers();
    try {
      const guard = new GitCommitKillGuard(null, 5_000);
      expect(guard.signal.aborted).toBe(false);

      jest.advanceTimersByTime(5_000);

      expect(guard.signal.aborted).toBe(true);
      expect(guard.reason).toBe('TIMEOUT');
      guard.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('GitCommitRunner', () => {
  const tempDirs: string[] = [];

  function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeLogger(): Logger {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
  }

  it('returns HOOK_FAILED with neutral refusal message when a commit hook exists and git exits non-zero', async () => {
    const ws = tempDir('runner-hook-');
    const hooksDir = path.join(ws, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Executable, because git runs a POSIX hook only when it has the x bit.
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });

    const execMock = jest.fn(async (args: string[]): Promise<ExecGitResult> => {
      if (args[0] === 'rev-parse' && args[2] === 'index.lock') {
        return { exitCode: 0, stdout: '.git/index.lock\n', stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[2] === 'hooks') {
        return { exitCode: 0, stdout: '.git/hooks\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const writeLockMock: jest.Mocked<GitRepoWriteLock> = {
      run: jest.fn(),
      execWrite: jest.fn(async () => ({
        code: 'COMPLETED' as const,
        exitCode: 1,
        stdout: 'hook stdout\n',
        stderr: 'hook stderr\n',
      })),
    } as unknown as jest.Mocked<GitRepoWriteLock>;

    const deps: GitCommitRunnerDeps = {
      exec: execMock,
      writeLock: writeLockMock,
      logger: makeLogger(),
    };

    const runner = new GitCommitRunner(deps);
    const result = await runner.run(ws, 'feat: something', undefined);

    expect(result).toEqual({
      success: false,
      code: 'HOOK_FAILED',
      exitCode: 1,
      hookOutput: 'hook stdout\nhook stderr\n',
      error:
        'git refused the commit (exit code 1); a commit hook may have rejected it. See the output below.',
    });
  });

  it('returns GIT_ERROR when no commit hook exists and git exits non-zero', async () => {
    const ws = tempDir('runner-nohook-');
    const hooksDir = path.join(ws, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const execMock = jest.fn(async (args: string[]): Promise<ExecGitResult> => {
      if (args[0] === 'rev-parse' && args[2] === 'index.lock') {
        return { exitCode: 0, stdout: '.git/index.lock\n', stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[2] === 'hooks') {
        return { exitCode: 0, stdout: '.git/hooks\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const writeLockMock: jest.Mocked<GitRepoWriteLock> = {
      run: jest.fn(),
      execWrite: jest.fn(async () => ({
        code: 'COMPLETED' as const,
        exitCode: 1,
        stdout: '',
        stderr: 'nothing to commit\n',
      })),
    } as unknown as jest.Mocked<GitRepoWriteLock>;

    const deps: GitCommitRunnerDeps = {
      exec: execMock,
      writeLock: writeLockMock,
      logger: makeLogger(),
    };

    const runner = new GitCommitRunner(deps);
    const result = await runner.run(ws, 'feat: something', undefined);

    expect(result).toEqual({
      success: false,
      code: 'GIT_ERROR',
      exitCode: 1,
      error: 'nothing to commit',
    });
  });
});
