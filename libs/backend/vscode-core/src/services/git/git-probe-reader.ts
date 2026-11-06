import { parseWorktreeList } from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import {
  DEFAULT_GIT_TIMEOUT_MS,
  GIT_STATUS_TIMEOUT_MS,
} from '../../utils/exec-git';
import type { GitWriteRunner } from './git-write-lock';
import {
  isNotAGitRepository,
  toError,
  type CommonDirRead,
  type WorktreeListRead,
} from './git-probe-outcome';

export interface GitProbeReaderDeps {
  /** The service's `execGit` (the probe commands are non-mutating). */
  readonly exec: GitWriteRunner;
  readonly logger: Pick<Logger, 'error'>;
}

/** The two uncached reads {@link GitFolderProbe} shares and caches. */
export type GitProbeReads = Pick<
  GitProbeReader,
  'readWorktreeList' | 'readCommonDir'
>;

type ProbeRun =
  | { readonly kind: 'ok'; readonly stdout: string }
  | { readonly kind: 'not-a-repo' }
  | { readonly kind: 'failed'; readonly cause: Error };

/**
 * Runs the worktree-root probe commands and classifies each answer: git's
 * own "not a repository" is a confirmed `not-a-repo`; a timeout, queue
 * deadline, cancellation, spawn error or any other non-zero exit is
 * `failed`, never a negative answer.
 */
export class GitProbeReader {
  constructor(private readonly deps: GitProbeReaderDeps) {}

  /** Uncached `git worktree list --porcelain -z` in `folder`. */
  async readWorktreeList(
    folder: string,
    signal?: AbortSignal,
  ): Promise<WorktreeListRead> {
    const run = await this.run(
      ['worktree', 'list', '--porcelain', '-z'],
      folder,
      DEFAULT_GIT_TIMEOUT_MS,
      'worktree list',
      signal,
    );
    if (run.kind !== 'ok') return run;
    return { kind: 'listed', worktrees: parseWorktreeList(run.stdout) };
  }

  /** Uncached absolute `git rev-parse --git-common-dir` in `dir`. */
  async readCommonDir(
    dir: string,
    signal?: AbortSignal,
  ): Promise<CommonDirRead> {
    const run = await this.run(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      dir,
      GIT_STATUS_TIMEOUT_MS,
      'common-dir',
      signal,
    );
    if (run.kind !== 'ok') return run;
    const path = run.stdout.trim();
    if (path) return { kind: 'dir', path };
    return this.failed('common-dir', new Error('git returned an empty path'));
  }

  private async run(
    args: string[],
    cwd: string,
    timeoutMs: number,
    label: string,
    signal: AbortSignal | undefined,
  ): Promise<ProbeRun> {
    try {
      const result = await this.deps.exec(args, cwd, { timeoutMs, signal });
      if (result.exitCode === 0) return { kind: 'ok', stdout: result.stdout };
      if (isNotAGitRepository(result.exitCode, result.stderr)) {
        return { kind: 'not-a-repo' };
      }
      return this.failed(
        label,
        new Error(
          `git ${label} exited ${result.exitCode}: ${result.stderr.trim()}`,
        ),
      );
    } catch (error: unknown) {
      return this.failed(label, toError(error));
    }
  }

  private failed(
    label: string,
    cause: Error,
  ): { readonly kind: 'failed'; readonly cause: Error } {
    this.deps.logger.error(`[GitInfoService] ${label} probe failed`, cause);
    return { kind: 'failed', cause };
  }
}
