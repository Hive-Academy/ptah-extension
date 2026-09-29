import { AsyncLocalStorage } from 'async_hooks';
import {
  GIT_INDEX_LOCK_RETRY_DELAYS_MS,
  GIT_LOCKED_MESSAGE,
} from '@ptah-extension/shared';
import {
  execGit,
  isIndexLockFailure,
  type ExecGitOptions,
  type ExecGitResult,
} from '../../utils/exec-git';

/**
 * Thrown synchronously by {@link GitRepoWriteLock.run} when the calling async
 * context already holds the lock for the same repository. Waiting would
 * deadlock (the outer body cannot finish until the inner one runs), so the
 * violation is made loud instead: a locked body may call only private helpers
 * and read methods, never another locked public method.
 */
export class GitReentrantLockError extends Error {
  readonly code = 'GIT_REENTRANT_LOCK' as const;

  constructor(readonly workspacePath: string) {
    super(`git write lock for ${workspacePath} is already held by this call`);
    this.name = 'GitReentrantLockError';
  }
}

/** A write whose git child ran to completion (with any exit code). */
export interface GitWriteCompleted extends ExecGitResult {
  readonly code: 'COMPLETED';
}

/**
 * A write that still found `index.lock` held after every retry. Carries only
 * the fixed user-facing text; git's stderr is deliberately dropped.
 */
export interface GitWriteLocked {
  readonly code: 'LOCKED';
  readonly message: typeof GIT_LOCKED_MESSAGE;
}

export type GitWriteResult = GitWriteCompleted | GitWriteLocked;

/** The git runner {@link GitRepoWriteLock.execWrite} spawns through. */
export type GitWriteRunner = (
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
) => Promise<ExecGitResult>;

export interface GitRepoWriteLockDeps {
  /** Defaults to {@link execGit}. */
  readonly exec?: GitWriteRunner;
  /** Waits between index.lock retries. Defaults to an `unref()`'d timeout. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Retry wait that never keeps the process alive on its own. */
function unrefSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Case- and separator-folded repository key, the same folding
 * `git-rpc.handlers.ts` uses to match workspace folders. On a case-sensitive
 * filesystem two repositories differing only in case share a key; the cost is
 * needless serialization between them, never a missed one.
 */
function repoKey(workspacePath: string): string {
  return workspacePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const noop = (): void => undefined;

/**
 * Serializes Ptah's git mutations per repository (TASK_2026_576, RC6) and
 * absorbs short `index.lock` contention from other git processes.
 *
 * - {@link run}: a FIFO promise chain per repository key. Bodies for the same
 *   repository run one after another in call order; different repositories
 *   run concurrently. A rejected body rejects its own caller only — the chain
 *   continues with the next body.
 * - Reentrance is refused: `AsyncLocalStorage` records the keys held by the
 *   current async context, and a nested `run` on one of them throws
 *   {@link GitReentrantLockError} synchronously.
 * - {@link execWrite}: one mutating spawn, retried only when git reports that
 *   `index.lock` exists, per `GIT_INDEX_LOCK_RETRY_DELAYS_MS`.
 *
 * Internal to vscode-core; not exported from the library barrel.
 */
export class GitRepoWriteLock {
  /** Settled-or-pending tail of each repository's chain. */
  private readonly tails = new Map<string, Promise<void>>();
  private readonly held = new AsyncLocalStorage<ReadonlySet<string>>();
  private readonly exec: GitWriteRunner;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: GitRepoWriteLockDeps = {}) {
    this.exec = deps.exec ?? execGit;
    this.sleep = deps.sleep ?? unrefSleep;
  }

  /**
   * Run `body` once every earlier body for the same repository has settled.
   * The returned promise settles exactly as `body` does.
   *
   * @throws {GitReentrantLockError} synchronously, when called from inside a
   *   body already holding this repository's lock.
   */
  run<T>(workspacePath: string, body: () => Promise<T>): Promise<T> {
    const key = repoKey(workspacePath);
    const heldKeys = this.held.getStore();
    if (heldKeys?.has(key)) throw new GitReentrantLockError(workspacePath);

    const bodyKeys = new Set(heldKeys);
    bodyKeys.add(key);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(() => this.held.run(bodyKeys, body));
    // The chain waits on the body's settlement, never on its outcome, so a
    // rejection reaches this caller and nobody queued behind it.
    const tail = result.then(noop, noop);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /**
   * Run one mutating git command, retrying while another process holds
   * `index.lock`. Any other outcome — success, a different non-zero exit, or
   * a rejection such as a timeout or cancellation — is returned or thrown
   * after the first attempt, unretried.
   */
  async execWrite(
    args: string[],
    cwd: string,
    options?: ExecGitOptions,
  ): Promise<GitWriteResult> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.exec(args, cwd, options);
      if (result.exitCode === 0 || !isIndexLockFailure(result.stderr)) {
        return { code: 'COMPLETED', ...result };
      }
      const delay = GIT_INDEX_LOCK_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        return { code: 'LOCKED', message: GIT_LOCKED_MESSAGE };
      }
      await this.sleep(delay);
    }
  }
}
