import { statSync, unlinkSync } from 'fs';
import { stat } from 'fs/promises';
import * as path from 'path';
import {
  GIT_HOOK_TIMEOUT_MS,
  type GitCommitResult,
  type GitOperationOutputStream,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import type {
  GitRepoWriteLock,
  GitWriteCompleted,
  GitWriteRunner,
} from './git-write-lock';

/** Hooks that run inside `git commit` and can reject it. */
const COMMIT_HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg'];

/** The newest commit output kept for `hookOutput`. */
export const HOOK_OUTPUT_TAIL_BYTES = 256 * 1024;

/** First line of a `hookOutput` whose start was dropped. */
const HOOK_OUTPUT_TRUNCATED_NOTE = `[Earlier output truncated; the last ${HOOK_OUTPUT_TAIL_BYTES / 1024} KiB follows.]\n`;

/** Observer for a commit's live stdout / stderr, chunk by chunk. */
export type GitOutputListener = (
  stream: GitOperationOutputStream,
  chunk: string,
) => void;

export interface GitCommitRunOptions {
  /** Aborting it stops the commit → `CANCELLED`. */
  readonly signal?: AbortSignal;
  /**
   * Live output of the commit, hooks included, as git produces it. Errors it
   * throws are ignored; it never changes the result.
   */
  readonly onOutput?: GitOutputListener;
}

/**
 * The last `limit` UTF-8 bytes of a stream of chunks, in arrival order.
 * Memory stays bounded however much a hook prints.
 */
export class GitOutputTail {
  private chunks: Buffer[] = [];
  private head = 0;
  private bytes = 0;
  private dropped = false;

  constructor(private readonly limit: number) {}

  push(chunk: string): void {
    const data = Buffer.from(chunk, 'utf8');
    this.chunks.push(data);
    this.bytes += data.length;
    while (this.bytes > this.limit) {
      const first = this.chunks[this.head];
      const excess = this.bytes - this.limit;
      this.dropped = true;
      if (first.length <= excess) {
        this.head++;
        this.bytes -= first.length;
      } else {
        this.chunks[this.head] = first.subarray(excess);
        this.bytes -= excess;
      }
    }
    if (this.head > 1024) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  /** The kept text; prefixed with a truncation line when bytes were dropped. */
  text(): string {
    const kept = Buffer.concat(this.chunks.slice(this.head));
    if (!this.dropped) return kept.toString('utf8');
    // The cut may land inside a character: skip its continuation bytes.
    let start = 0;
    while (start < kept.length && (kept[start] & 0xc0) === 0x80) start++;
    return HOOK_OUTPUT_TRUNCATED_NOTE + kept.subarray(start).toString('utf8');
  }
}

/** A git path printed by `rev-parse`, minus its line ending (never trimmed). */
function gitPathOutput(workspacePath: string, stdout: string): string {
  return path.resolve(workspacePath, stdout.replace(/\r?\n$/, ''));
}

/** Why Ptah stopped a commit that was still running. */
export type GitCommitKillReason = 'TIMEOUT' | 'CANCELLED';

/**
 * How long recovery waits to see the killed git process exit. The exec-git
 * kill grace is 2 s before SIGKILL; past this bound the lock is left alone,
 * because a live git may still own it.
 */
const EXIT_WAIT_MS = 5_000;

/**
 * Slack for "written after this commit started": file times come from a
 * coarser clock than `Date.now()` (a ~15.6 ms tick on Windows, 1 s on HFS+),
 * so a lock git wrote just after the start can carry an earlier stamp.
 */
const MTIME_GRANULARITY_MS = 1_000n;

/**
 * Identity of one `index.lock` file (TASK_2026_576 V7). Windows can report
 * `ino` as 0 or truncate it in number form, so it is read as a bigint and
 * compared only when both sides are non-zero; `mtimeMs` and `size` always
 * count.
 */
export interface IndexLockFingerprint {
  readonly mtimeMs: bigint;
  readonly size: bigint;
  readonly ino: bigint;
}

/** The lock's fingerprint, or null when it does not exist (or cannot be read). */
export function readIndexLockFingerprint(
  lockPath: string,
): IndexLockFingerprint | null {
  try {
    const stats = statSync(lockPath, { bigint: true });
    return { mtimeMs: stats.mtimeMs, size: stats.size, ino: stats.ino };
  } catch {
    // degradation-audit: optional-capability - no readable lock means there is
    // nothing Ptah could recover; recovery simply does not run.
    return null;
  }
}

/** True when both fingerprints name the same, unchanged file. */
export function isSameIndexLock(
  a: IndexLockFingerprint,
  b: IndexLockFingerprint,
): boolean {
  if (a.mtimeMs !== b.mtimeMs || a.size !== b.size) return false;
  return a.ino === 0n || b.ino === 0n || a.ino === b.ino;
}

/**
 * The kill switch for one `git commit` (TASK_2026_576 RC2), and the only code
 * that may delete an `index.lock`.
 *
 * A commit killed while its git holds `index.lock` on Windows (forced
 * termination runs no cleanup) leaves that lock behind, and every later git
 * write fails. git holds it while refreshing the index and, for `commit -a`
 * and pathspec commits, through the whole pre-commit / commit-msg hook run;
 * a plain `commit -m` releases it before the hooks (verified against real git
 * in `git-info.service.hooks.real-git.spec.ts`). POSIX git removes its lock
 * itself on SIGTERM. Recovery removes the file only when all of these hold:
 *
 * 1. Ptah killed the commit (its time budget ran out or the caller aborted),
 *    and the lock existed at that moment — fingerprinted before the kill.
 * 2. No earlier attempt had exited: the killed child was the first spawn, so
 *    the commit never retried against someone else's lock.
 * 3. The lock was last written after this commit started (within
 *    {@link MTIME_GRANULARITY_MS}); an older one belongs to another process.
 * 4. The killed git process was seen to exit (`onExit`), within
 *    {@link EXIT_WAIT_MS}: nothing of Ptah's still owns the lock.
 * 5. The lock still has the fingerprint it had at the kill.
 *
 * Anything else leaves the file in place and logs why.
 */
export class GitCommitKillGuard {
  private readonly controller = new AbortController();
  private readonly startedAtMs = BigInt(Date.now());
  private readonly timer: ReturnType<typeof setTimeout>;
  private exits = 0;
  private exitWaiter: (() => void) | undefined;
  private killed:
    | {
        readonly reason: GitCommitKillReason;
        readonly lock: IndexLockFingerprint | null;
        readonly exitsBefore: number;
      }
    | undefined;

  constructor(
    private readonly lockPath: string | null,
    timeoutMs: number,
    private readonly callerSignal?: AbortSignal,
  ) {
    this.timer = setTimeout(() => this.kill('TIMEOUT'), timeoutMs);
    this.timer.unref?.();
    if (callerSignal?.aborted) {
      this.kill('CANCELLED');
    } else {
      callerSignal?.addEventListener('abort', this.onCallerAbort, {
        once: true,
      });
    }
  }

  /** Pass as `ExecGitOptions.signal`. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Set once Ptah has killed the commit. */
  get reason(): GitCommitKillReason | undefined {
    return this.killed?.reason;
  }

  /** Pass as `ExecGitOptions.onExit`: counts children seen to close. */
  readonly onExit = (): void => {
    this.exits++;
    this.exitWaiter?.();
  };

  private readonly onCallerAbort = (): void => this.kill('CANCELLED');

  private kill(reason: GitCommitKillReason): void {
    if (this.killed) return;
    // Fingerprint first: after the abort the child may already be dying.
    this.killed = {
      reason,
      lock: this.lockPath ? readIndexLockFingerprint(this.lockPath) : null,
      exitsBefore: this.exits,
    };
    this.controller.abort();
  }

  /** Stop the time budget and the caller listener. Idempotent. */
  dispose(): void {
    clearTimeout(this.timer);
    this.callerSignal?.removeEventListener('abort', this.onCallerAbort);
  }

  /** Remove the killed commit's own `index.lock`, per the rules above. */
  async recoverIndexLock(logger: Logger): Promise<void> {
    const killed = this.killed;
    const lockPath = this.lockPath;
    if (!killed || !lockPath || !killed.lock) return;
    const leave = (why: string): void =>
      logger.warn(`[GitCommitKillGuard] left ${lockPath} in place: ${why}`);
    if (killed.exitsBefore > 0) {
      return leave('the commit had retried against an existing lock');
    }
    if (killed.lock.mtimeMs + MTIME_GRANULARITY_MS < this.startedAtMs) {
      return leave('it predates this commit');
    }
    const exited = await this.waitForExit(killed.exitsBefore);
    const now = readIndexLockFingerprint(lockPath);
    if (!now) return; // git removed its own lock on the way out (POSIX)
    if (!exited) return leave('the killed git process was not seen to exit');
    if (!isSameIndexLock(killed.lock, now)) {
      return leave('it changed after the kill');
    }
    try {
      unlinkSync(lockPath);
      logger.warn(
        `[GitCommitKillGuard] removed ${lockPath} left by a commit Ptah stopped (${killed.reason})`,
      );
    } catch (error: unknown) {
      leave(error instanceof Error ? error.message : String(error));
    }
  }

  private waitForExit(exitsBefore: number): Promise<boolean> {
    if (this.exits > exitsBefore) return Promise.resolve(true);
    return new Promise((resolve) => {
      const settle = (exited: boolean): void => {
        clearTimeout(timer);
        this.exitWaiter = undefined;
        resolve(exited);
      };
      const timer = setTimeout(() => settle(false), EXIT_WAIT_MS);
      timer.unref?.();
      this.exitWaiter = () => settle(true);
    });
  }
}

export interface GitCommitRunnerDeps {
  /** Read runner (the service's cache-invalidating `execGit`). */
  readonly exec: GitWriteRunner;
  /** The service's write lock; its `execWrite` spawns the commit. */
  readonly writeLock: GitRepoWriteLock;
  readonly logger: Logger;
}

/**
 * `git commit` for `GitInfoService.commit` (TASK_2026_576 RC1, RC2). Called
 * inside the caller's `writeLock.run()` body; every spawn is awaited.
 *
 * - Hooks get {@link GIT_HOOK_TIMEOUT_MS}; the budget and a caller abort both
 *   kill through {@link GitCommitKillGuard}, which then recovers the commit's
 *   own leftover `index.lock` → `TIMEOUT` / `CANCELLED`.
 * - Output streams to the caller's `onOutput` as it arrives, and its last
 *   {@link HOOK_OUTPUT_TAIL_BYTES} (stdout and stderr interleaved) are kept.
 * - A non-zero exit with a commit hook installed is `HOOK_FAILED` with that
 *   kept output verbatim and git's exit code; otherwise `GIT_ERROR`.
 * - On success the hash and subject are read back from git
 *   (`rev-parse --short HEAD`, `log -1 --format=%s`), not parsed from output.
 */
export class GitCommitRunner {
  /** `index.lock` path per workspace, from `rev-parse --git-path`. */
  private readonly indexLockPaths = new Map<string, string>();

  constructor(private readonly deps: GitCommitRunnerDeps) {}

  async run(
    workspacePath: string,
    message: string,
    options: GitCommitRunOptions = {},
  ): Promise<GitCommitResult> {
    const { exec, writeLock, logger } = this.deps;
    const guard = new GitCommitKillGuard(
      await this.indexLockPath(workspacePath),
      GIT_HOOK_TIMEOUT_MS,
      options.signal,
    );
    const tail = new GitOutputTail(HOOK_OUTPUT_TAIL_BYTES);
    const onOutput = options.onOutput;
    try {
      const run = await writeLock.execWrite(
        ['commit', '-m', message],
        workspacePath,
        {
          timeoutMs: GIT_HOOK_TIMEOUT_MS,
          signal: guard.signal,
          onExit: guard.onExit,
          onOutput: (stream, chunk) => {
            tail.push(chunk);
            onOutput?.(stream, chunk);
          },
        },
      );
      if (run.code === 'LOCKED') {
        return { success: false, code: 'LOCKED', error: run.message };
      }
      if (run.exitCode !== 0) {
        return await this.failure(workspacePath, run, tail.text());
      }
      const [hash, subject] = await Promise.all([
        exec(['rev-parse', '--short', 'HEAD'], workspacePath),
        exec(['log', '-1', '--format=%s'], workspacePath),
      ]);
      return {
        success: true,
        commitHash: (hash.exitCode === 0 && hash.stdout.trim()) || undefined,
        subject: (subject.exitCode === 0 && subject.stdout.trim()) || undefined,
      };
    } catch (error: unknown) {
      const reason = guard.reason;
      if (!reason) throw error;
      await guard.recoverIndexLock(logger);
      return {
        success: false,
        code: reason,
        error:
          reason === 'TIMEOUT'
            ? `The commit did not finish within ${GIT_HOOK_TIMEOUT_MS / 60_000} minutes and was stopped.`
            : 'Commit cancelled.',
      };
    } finally {
      guard.dispose();
    }
  }

  /** A commit git refused: a hook's verdict when one is installed. */
  private async failure(
    workspacePath: string,
    run: GitWriteCompleted,
    output: string,
  ): Promise<GitCommitResult> {
    const { exitCode, stdout, stderr } = run;
    if (!(await this.hasCommitHook(workspacePath))) {
      return {
        success: false,
        code: 'GIT_ERROR',
        exitCode,
        error: stderr.trim() || stdout.trim() || 'Failed to create commit',
      };
    }
    return {
      success: false,
      code: 'HOOK_FAILED',
      exitCode,
      hookOutput: output,
      error: `git refused the commit (exit code ${exitCode}); a commit hook may have rejected it. See the output below.`,
    };
  }

  /** True when git would run a commit hook (`core.hooksPath` honoured). */
  private async hasCommitHook(workspacePath: string): Promise<boolean> {
    const hooks = await this.deps.exec(
      ['rev-parse', '--git-path', 'hooks'],
      workspacePath,
    );
    if (hooks.exitCode !== 0) return false;
    const dir = gitPathOutput(workspacePath, hooks.stdout);
    const found = await Promise.all(
      COMMIT_HOOKS.map((name) =>
        stat(path.join(dir, name)).then(
          // git runs a hook on POSIX only when it is executable; Git for
          // Windows ignores the mode.
          (stats) =>
            stats.isFile() &&
            (process.platform === 'win32' || (stats.mode & 0o111) !== 0),
          () => false,
        ),
      ),
    );
    return found.includes(true);
  }

  /** `index.lock` for `workspacePath`, resolved once; null when unknown. */
  private async indexLockPath(workspacePath: string): Promise<string | null> {
    const cached = this.indexLockPaths.get(workspacePath);
    if (cached) return cached;
    try {
      const { stdout, exitCode } = await this.deps.exec(
        ['rev-parse', '--git-path', 'index.lock'],
        workspacePath,
      );
      if (exitCode !== 0) return null;
      const lockPath = gitPathOutput(workspacePath, stdout);
      this.indexLockPaths.set(workspacePath, lockPath);
      return lockPath;
    } catch {
      // degradation-audit: optional-capability - without the path a killed
      // commit's leftover lock is not recovered; the commit itself still runs.
      return null;
    }
  }
}
