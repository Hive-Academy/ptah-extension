import {
  GIT_FETCH_TIMEOUT_MS,
  GIT_HOOK_TIMEOUT_MS,
  type GitFetchResult,
  type GitPullResult,
  type GitPushResult,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import type {
  GitRepoWriteLock,
  GitWriteResult,
  GitWriteRunner,
} from './git-write-lock';
import {
  thrownOutcome,
  writeOutcome,
  type MutationOutcome,
} from './git-mutation-outcome';

type RemoteVerb = 'push' | 'pull' | 'fetch';

const AUTH_REQUIRED = 'Authentication is required for this remote.';

/** Never ask a terminal for credentials: fail fast instead. */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' };

/**
 * Detect whether git stderr or error message indicates an authentication failure.
 *
 * When GIT_TERMINAL_PROMPT=0 is passed, git fails fast with "terminal prompts disabled"
 * or "could not read Username/Password". Other failures report "Authentication failed"
 * or "Permission denied".
 */
export function isGitAuthFailure(text: string): boolean {
  return /terminal prompts disabled|authentication failed|could not read (?:username|password)|permission denied.*publickey|permission denied \(|logon failed|invalid credentials/i.test(
    text,
  );
}

export interface GitRemoteSyncDeps {
  /** The service's cache-invalidating `execGit`. */
  readonly exec: GitWriteRunner;
  /** The service's write lock; `pull` runs inside it. */
  readonly writeLock: GitRepoWriteLock;
  readonly logger: Logger;
}

/**
 * Push, pull and fetch for `GitInfoService` (TASK_2026_576 RC2, RC6).
 *
 * - `push` and `pull` run hooks (pre-push, post-merge), so they get
 *   `GIT_HOOK_TIMEOUT_MS`; `fetch` gets `GIT_FETCH_TIMEOUT_MS`.
 * - Only `pull` is locked: it writes the index. Push and fetch write refs only,
 *   and a network round trip must not hold up staging.
 * - An authentication failure reads as one fixed message; a timeout keeps its
 *   `TIMEOUT` code.
 */
export class GitRemoteSync {
  constructor(private readonly deps: GitRemoteSyncDeps) {}

  /**
   * Push the current branch. With an upstream: `git push`. Without one:
   * `git push -u <remote> HEAD`, where `<remote>` is `origin` when it exists,
   * otherwise the repository's only remote. `HEAD` rather than the branch
   * name keeps a user-controlled string out of the argv.
   */
  async push(workspacePath: string): Promise<GitPushResult> {
    const { exec } = this.deps;
    try {
      const upstream = await exec(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        workspacePath,
      );
      let args: string[] = ['push'];
      if (upstream.exitCode !== 0) {
        const target = await this.resolvePushRemote(workspacePath);
        if ('error' in target) return { success: false, error: target.error };
        args = ['push', '-u', target.remote, 'HEAD'];
      }
      const run = await exec(args, workspacePath, {
        timeoutMs: GIT_HOOK_TIMEOUT_MS,
        env: NO_PROMPT,
      });
      return this.outcome({ code: 'COMPLETED', ...run }, 'push');
    } catch (error) {
      return this.threw(error, workspacePath, 'push');
    }
  }

  /** `git pull --ff-only`: a diverged branch fails with git's own reason. */
  async pull(workspacePath: string): Promise<GitPullResult> {
    const { writeLock } = this.deps;
    try {
      return await writeLock.run(workspacePath, async () =>
        this.outcome(
          await writeLock.execWrite(['pull', '--ff-only'], workspacePath, {
            timeoutMs: GIT_HOOK_TIMEOUT_MS,
            env: NO_PROMPT,
          }),
          'pull',
        ),
      );
    } catch (error) {
      return this.threw(error, workspacePath, 'pull');
    }
  }

  /** `git fetch --prune`: update remote-tracking refs, drop deleted ones. */
  async fetch(workspacePath: string): Promise<GitFetchResult> {
    try {
      const run = await this.deps.exec(['fetch', '--prune'], workspacePath, {
        timeoutMs: GIT_FETCH_TIMEOUT_MS,
        env: NO_PROMPT,
      });
      return this.outcome({ code: 'COMPLETED', ...run }, 'fetch');
    } catch (error) {
      return this.threw(error, workspacePath, 'fetch');
    }
  }

  /**
   * The remote a first push of an upstream-less branch goes to, or why there
   * is none. A detached HEAD has no branch to track, so it is refused.
   */
  private async resolvePushRemote(
    workspacePath: string,
  ): Promise<{ remote: string } | { error: string }> {
    const { exec } = this.deps;
    const head = await exec(
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      workspacePath,
    );
    if (head.exitCode !== 0) {
      return {
        error: 'Cannot push a detached HEAD. Check out a branch first.',
      };
    }

    const listed = await exec(['remote'], workspacePath);
    const remotes =
      listed.exitCode === 0
        ? listed.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((name) => name.length > 0 && !name.startsWith('-'))
        : [];
    if (remotes.includes('origin')) return { remote: 'origin' };
    if (remotes.length === 1) return { remote: remotes[0] };
    return remotes.length === 0
      ? { error: 'No remote is configured for this repository.' }
      : {
          error:
            'This branch has no upstream and no "origin" remote exists to push to.',
        };
  }

  private outcome(run: GitWriteResult, verb: RemoteVerb): MutationOutcome {
    if (run.code === 'COMPLETED' && run.exitCode !== 0) {
      if (isGitAuthFailure(run.stderr)) {
        return { success: false, error: AUTH_REQUIRED };
      }
      return {
        success: false,
        error: run.stderr.trim() || `git ${verb} failed`,
      };
    }
    return writeOutcome(run, `git ${verb} failed`);
  }

  private threw(
    error: unknown,
    workspacePath: string,
    verb: RemoteVerb,
  ): MutationOutcome {
    const outcome = thrownOutcome(error);
    if (isGitAuthFailure(outcome.error ?? '')) {
      return { success: false, error: AUTH_REQUIRED };
    }
    this.deps.logger.error(`[GitInfoService] ${verb} failed`, {
      workspacePath,
      error: outcome.error,
    } as unknown as Error);
    return outcome;
  }
}
