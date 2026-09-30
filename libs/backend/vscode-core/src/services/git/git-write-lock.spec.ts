import {
  GIT_INDEX_LOCK_RETRY_DELAYS_MS,
  GIT_LOCKED_MESSAGE,
} from '@ptah-extension/shared';
import type { ExecGitResult } from '../../utils/exec-git';
import {
  GitReentrantLockError,
  GitRepoWriteLock,
  type GitWriteRunner,
} from './git-write-lock';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every queued microtask (promise continuation) run. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const LOCK_STDERR =
  "fatal: Unable to create 'C:/repo/.git/index.lock': File exists.\n\n" +
  'Another git process seems to be running in this repository.';

const locked: ExecGitResult = {
  stdout: '',
  stderr: LOCK_STDERR,
  exitCode: 128,
};
const ok: ExecGitResult = { stdout: 'done', stderr: '', exitCode: 0 };

describe('GitRepoWriteLock.run', () => {
  it('runs two concurrent bodies for the same repository one after another, in call order', async () => {
    const lock = new GitRepoWriteLock();
    const events: string[] = [];
    const first = deferred<string>();

    const a = lock.run('C:\\repo', async () => {
      events.push('a:start');
      const value = await first.promise;
      events.push('a:end');
      return value;
    });
    const b = lock.run('C:\\repo', async () => {
      events.push('b:start');
      return 'b';
    });

    await flushMicrotasks();
    expect(events).toEqual(['a:start']);

    first.resolve('a');
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
    expect(events).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('folds case, separators and trailing slashes into one queue', async () => {
    const lock = new GitRepoWriteLock();
    const events: string[] = [];
    const first = deferred<void>();

    const a = lock.run('C:\\Repo\\', async () => {
      events.push('a');
      await first.promise;
    });
    const b = lock.run('c:/repo', async () => {
      events.push('b');
    });

    await flushMicrotasks();
    expect(events).toEqual(['a']);
    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(['a', 'b']);
  });

  it('runs bodies for different repositories concurrently', async () => {
    const lock = new GitRepoWriteLock();
    const events: string[] = [];
    const first = deferred<void>();

    const a = lock.run('/repo-a', async () => {
      events.push('a:start');
      await first.promise;
      events.push('a:end');
    });
    const b = lock.run('/repo-b', async () => {
      events.push('b:start');
    });

    await b;
    expect(events).toEqual(['a:start', 'b:start']);
    first.resolve();
    await a;
  });

  it('does not let a rejected body poison the chain', async () => {
    const lock = new GitRepoWriteLock();
    const failure = new Error('apply failed');

    const a = lock.run('/repo', async () => {
      throw failure;
    });
    const b = lock.run('/repo', () => {
      throw new Error('sync throw inside body');
    });
    const c = lock.run('/repo', async () => 'c');

    await expect(a).rejects.toBe(failure);
    await expect(b).rejects.toThrow('sync throw inside body');
    await expect(c).resolves.toBe('c');
    await expect(lock.run('/repo', async () => 'd')).resolves.toBe('d');
  });

  it('throws GitReentrantLockError synchronously for a nested run on the same repository', async () => {
    const lock = new GitRepoWriteLock();
    let nestedCallReturned = false;
    let caught: unknown;

    await lock.run('/repo', async () => {
      await Promise.resolve();
      try {
        void lock.run('/REPO/', async () => undefined);
        nestedCallReturned = true;
      } catch (error: unknown) {
        caught = error;
      }
    });

    expect(nestedCallReturned).toBe(false);
    expect(caught).toBeInstanceOf(GitReentrantLockError);
    expect((caught as GitReentrantLockError).code).toBe('GIT_REENTRANT_LOCK');
    // The lock is free again afterwards.
    await expect(lock.run('/repo', async () => 'next')).resolves.toBe('next');
  });

  it('allows a nested run for a different repository', async () => {
    const lock = new GitRepoWriteLock();

    const value = await lock.run('/repo-a', () =>
      lock.run('/repo-b', async () => 'inner'),
    );

    expect(value).toBe('inner');
  });

  it('does not treat a queued caller outside any body as reentrant', async () => {
    const lock = new GitRepoWriteLock();
    const first = deferred<void>();

    const a = lock.run('/repo', () => first.promise);
    // Called from the test's own context while `a` holds the lock: must queue.
    const b = lock.run('/repo', async () => 'b');

    first.resolve();
    await a;
    await expect(b).resolves.toBe('b');
  });
});

describe('GitRepoWriteLock.execWrite', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a completed result without retrying on success', async () => {
    const exec = jest.fn<
      ReturnType<GitWriteRunner>,
      Parameters<GitWriteRunner>
    >(async () => ok);
    const lock = new GitRepoWriteLock({ exec });

    await expect(
      lock.execWrite(['add', '--', 'a.ts'], '/repo', { timeoutMs: 5 }),
    ).resolves.toEqual({ code: 'COMPLETED', ...ok });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(['add', '--', 'a.ts'], '/repo', {
      timeoutMs: 5,
    });
  });

  it('retries an index.lock failure on the configured schedule and then succeeds', async () => {
    const exec = jest
      .fn<ReturnType<GitWriteRunner>, Parameters<GitWriteRunner>>()
      .mockResolvedValueOnce(locked)
      .mockResolvedValueOnce(locked)
      .mockResolvedValueOnce(ok);
    const lock = new GitRepoWriteLock({ exec });

    const pending = lock.execWrite(['commit', '-m', 'x'], '/repo');
    await flushMicrotasks();
    expect(exec).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(GIT_INDEX_LOCK_RETRY_DELAYS_MS[0] - 1);
    expect(exec).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(exec).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(GIT_INDEX_LOCK_RETRY_DELAYS_MS[1] - 1);
    expect(exec).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(exec).toHaveBeenCalledTimes(3);

    await expect(pending).resolves.toEqual({ code: 'COMPLETED', ...ok });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns LOCKED with the fixed message and no stderr once the lock persists', async () => {
    const exec = jest.fn<
      ReturnType<GitWriteRunner>,
      Parameters<GitWriteRunner>
    >(async () => locked);
    const lock = new GitRepoWriteLock({ exec });

    const pending = lock.execWrite(['stash', 'pop'], '/repo');
    const total = GIT_INDEX_LOCK_RETRY_DELAYS_MS.reduce((s, d) => s + d, 0);
    await jest.advanceTimersByTimeAsync(total - 1);
    expect(exec).toHaveBeenCalledTimes(GIT_INDEX_LOCK_RETRY_DELAYS_MS.length);
    await jest.advanceTimersByTimeAsync(1);

    const result = await pending;
    expect(result).toEqual({ code: 'LOCKED', message: GIT_LOCKED_MESSAGE });
    expect(JSON.stringify(result)).not.toContain('index.lock');
    expect(exec).toHaveBeenCalledTimes(
      GIT_INDEX_LOCK_RETRY_DELAYS_MS.length + 1,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits through the injected sleep with each delay in order', async () => {
    const sleep = jest.fn(async (_ms: number) => undefined);
    const exec = jest.fn<
      ReturnType<GitWriteRunner>,
      Parameters<GitWriteRunner>
    >(async () => locked);
    const lock = new GitRepoWriteLock({ exec, sleep });

    await expect(lock.execWrite(['add', '-A'], '/repo')).resolves.toEqual({
      code: 'LOCKED',
      message: GIT_LOCKED_MESSAGE,
    });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      ...GIT_INDEX_LOCK_RETRY_DELAYS_MS,
    ]);
  });

  it('does not retry a non-lock failure', async () => {
    const failed: ExecGitResult = {
      stdout: '',
      stderr: 'error: pathspec did not match any file(s) known to git',
      exitCode: 1,
    };
    const sleep = jest.fn(async (_ms: number) => undefined);
    const exec = jest.fn<
      ReturnType<GitWriteRunner>,
      Parameters<GitWriteRunner>
    >(async () => failed);
    const lock = new GitRepoWriteLock({ exec, sleep });

    await expect(lock.execWrite(['add', 'nope'], '/repo')).resolves.toEqual({
      code: 'COMPLETED',
      ...failed,
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a rejected spawn (timeout, cancellation)', async () => {
    const timeout = new Error('git commit timed out after 5ms');
    const sleep = jest.fn(async (_ms: number) => undefined);
    const exec = jest
      .fn<ReturnType<GitWriteRunner>, Parameters<GitWriteRunner>>()
      .mockRejectedValue(timeout);
    const lock = new GitRepoWriteLock({ exec, sleep });

    await expect(lock.execWrite(['commit'], '/repo')).rejects.toBe(timeout);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
