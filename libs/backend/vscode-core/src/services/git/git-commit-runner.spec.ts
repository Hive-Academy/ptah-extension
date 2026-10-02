import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  GitCommitKillGuard,
  GitCommitRunner,
  GitOutputTail,
  type GitCommitRunnerDeps,
} from './git-commit-runner';
import type { GitRepoWriteLock } from './git-write-lock';
import type { Logger } from '../../logging';
import type { ExecGitOptions, ExecGitResult } from '../../utils/exec-git';

describe('GitOutputTail', () => {
  it('keeps everything, in arrival order, while under the limit', () => {
    const tail = new GitOutputTail(64);
    tail.push('one\n');
    tail.push('two\n');
    expect(tail.text()).toBe('one\ntwo\n');
  });

  it('keeps only the newest bytes after a truncation line', () => {
    const tail = new GitOutputTail(8);
    tail.push('aaaa');
    tail.push('bbbb');
    tail.push('cccc');
    const text = tail.text();
    expect(text.startsWith('[Earlier output truncated;')).toBe(true);
    expect(text.endsWith('\nbbbbcccc')).toBe(true);
  });

  it('never starts the kept text inside a multi-byte character', () => {
    const tail = new GitOutputTail(5);
    tail.push('é'.repeat(4)); // 8 bytes; the cut lands mid-character
    expect(tail.text().split('\n')[1]).toBe('éé');
  });

  it('stays bounded however many chunks arrive', () => {
    const tail = new GitOutputTail(256 * 1024);
    for (let i = 0; i < 5_000; i++) tail.push('x'.repeat(1024));
    const kept = tail.text().split('\n')[1];
    expect(kept.length).toBe(256 * 1024);
  });
});

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
      execWrite: jest.fn(
        async (_args: string[], _cwd: string, options?: ExecGitOptions) => {
          // Real git streams; the order the chunks arrive in is kept.
          options?.onOutput?.('stderr', 'hook stderr\n');
          options?.onOutput?.('stdout', 'hook stdout\n');
          return {
            code: 'COMPLETED' as const,
            exitCode: 1,
            stdout: 'hook stdout\n',
            stderr: 'hook stderr\n',
          };
        },
      ),
    } as unknown as jest.Mocked<GitRepoWriteLock>;

    const deps: GitCommitRunnerDeps = {
      exec: execMock,
      writeLock: writeLockMock,
      logger: makeLogger(),
    };

    const runner = new GitCommitRunner(deps);
    const streamed: string[] = [];
    const result = await runner.run(ws, 'feat: something', {
      onOutput: (stream, chunk) => streamed.push(`${stream}:${chunk}`),
    });

    expect(streamed).toEqual(['stderr:hook stderr\n', 'stdout:hook stdout\n']);
    expect(result).toEqual({
      success: false,
      code: 'HOOK_FAILED',
      exitCode: 1,
      hookOutput: 'hook stderr\nhook stdout\n',
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
    const result = await runner.run(ws, 'feat: something');

    expect(result).toEqual({
      success: false,
      code: 'GIT_ERROR',
      exitCode: 1,
      error: 'nothing to commit',
    });
  });
});
