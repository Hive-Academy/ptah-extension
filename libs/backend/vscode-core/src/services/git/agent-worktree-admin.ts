import * as path from 'path';
import { appendFile, mkdir, readFile } from 'fs/promises';
import {
  AGENT_WORKTREE_DIR,
  parseWorktreeList,
  type GitWorktreeInfo,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import { WORKTREE_GIT_TIMEOUT_MS } from '../../utils/exec-git';
import { resolveWorktreePath } from '../../utils/worktree-path';
import type { GitRepoWriteLock, GitWriteRunner } from './git-write-lock';
import { assertSafeRef } from './git-ref-guard';
import {
  thrownOutcome,
  writeOutcome,
  type MutationOutcome,
} from './git-mutation-outcome';

export interface AgentWorktreeAdminDeps {
  /** The service's cache-invalidating `execGit`. */
  readonly exec: GitWriteRunner;
  /** The service's write lock; the exclude write and `prune` run inside it. */
  readonly writeLock: GitRepoWriteLock;
  readonly logger: Logger;
}

export interface AddWorktreeRequest {
  branch: string;
  path?: string;
  createBranch?: boolean;
}

/**
 * Escape the gitignore glob characters in a literal path segment, so a
 * directory named `a[1]` is excluded as itself and not as a character class.
 */
function escapeIgnorePattern(literal: string): string {
  return literal.replace(/[\\*?[]/g, (c) => `\\${c}`);
}

/**
 * Case- and separator-folded path for comparing a caller's worktree path with
 * the one `git worktree list` prints (forward slashes on every platform).
 */
function comparablePath(p: string): string {
  const folded = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? folded.toLowerCase() : folded;
}

/**
 * Worktree administration for `GitInfoService` (TASK_2026_576 RC10): list,
 * add, remove and prune, plus keeping `.claude-worktrees/` out of the parent
 * repository's status.
 *
 * - **Exclude on create.** After a successful add whose target lies under
 *   `<workspace>/.claude-worktrees/`, {@link ensureExcluded} appends an
 *   anchored `/.claude-worktrees/` line to the file
 *   `git rev-parse --git-path info/exclude` names — the common directory's
 *   exclude, so one line covers the main worktree and every linked one. It
 *   writes nothing when git already ignores the directory, and never writes
 *   the line twice. A failure is warned and never fails the add.
 * - **Remove.** `git worktree remove [--force] -- <path>`. A forced removal of
 *   a worktree git lists as locked is refused before git runs: a lock means
 *   someone asked for that worktree to be kept.
 * - **Prune.** `git worktree prune` drops the admin entries of worktrees whose
 *   directory is gone (those {@link list} labels `prunable`).
 *
 * Add and remove are not taken under the write lock: a worktree checkout can
 * run for as long as `WORKTREE_GIT_TIMEOUT_MS` and touches none of the parent
 * repository's index, so it must not hold up staging. The exclude
 * read-modify-write and `prune` are short and do take it, which keeps two
 * concurrent adds from appending the exclude line twice.
 */
export class AgentWorktreeAdmin {
  constructor(private readonly deps: AgentWorktreeAdminDeps) {}

  async list(workspacePath: string): Promise<GitWorktreeInfo[]> {
    try {
      const { stdout, exitCode } = await this.deps.exec(
        ['worktree', 'list', '--porcelain', '-z'],
        workspacePath,
        { timeoutMs: WORKTREE_GIT_TIMEOUT_MS },
      );
      if (exitCode !== 0) return [];
      return parseWorktreeList(stdout);
    } catch (error: unknown) {
      this.deps.logger.error('[GitInfoService] getWorktrees failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async add(
    workspacePath: string,
    params: AddWorktreeRequest,
  ): Promise<{ success: boolean; worktreePath?: string; error?: string }> {
    try {
      assertSafeRef(params.branch);
    } catch {
      return { success: false, error: 'Invalid branch name' };
    }
    try {
      const worktreePath = resolveWorktreePath(
        workspacePath,
        params.branch,
        params.path,
      );

      // `-b` binds the branch as its value; `--end-of-options` keeps the
      // positional path and branch from being read as options.
      const args = ['worktree', 'add'];
      if (params.createBranch) {
        args.push('-b', params.branch, '--end-of-options', worktreePath);
      } else {
        args.push('--end-of-options', worktreePath, params.branch);
      }

      const { exitCode, stderr } = await this.deps.exec(args, workspacePath, {
        timeoutMs: WORKTREE_GIT_TIMEOUT_MS,
      });
      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr.trim() || 'Failed to add worktree',
        };
      }

      if (this.isUnderAgentDir(workspacePath, worktreePath)) {
        await this.ensureExcluded(workspacePath);
      }
      return { success: true, worktreePath };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error('[GitInfoService] addWorktree failed', {
        workspacePath,
        branch: params.branch,
        error: message,
      });
      return { success: false, error: message };
    }
  }

  async remove(
    workspacePath: string,
    worktreePath: string,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (force) {
        const locked = await this.findLocked(workspacePath, worktreePath);
        if (locked) {
          this.deps.logger.warn(
            '[GitInfoService] removeWorktree refused a forced removal of a locked worktree',
            { workspacePath, worktreePath, lockReason: locked.lockReason },
          );
          return {
            success: false,
            error: locked.lockReason
              ? `Worktree is locked (${locked.lockReason}); unlock it before removing it.`
              : 'Worktree is locked; unlock it before removing it.',
          };
        }
      }

      const args = ['worktree', 'remove'];
      if (force) args.push('--force');
      args.push('--', worktreePath);

      const { exitCode, stderr } = await this.deps.exec(args, workspacePath, {
        timeoutMs: WORKTREE_GIT_TIMEOUT_MS,
      });
      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr.trim() || 'Failed to remove worktree',
        };
      }
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error('[GitInfoService] removeWorktree failed', {
        workspacePath,
        worktreePath,
        error: message,
      });
      return { success: false, error: message };
    }
  }

  /** `git worktree prune`: drop the admin entries of vanished worktrees. */
  async prune(workspacePath: string): Promise<MutationOutcome> {
    try {
      return await this.deps.writeLock.run(workspacePath, async () =>
        writeOutcome(
          await this.deps.writeLock.execWrite(
            ['worktree', 'prune'],
            workspacePath,
            { timeoutMs: WORKTREE_GIT_TIMEOUT_MS },
          ),
          'Failed to prune worktrees',
        ),
      );
    } catch (error: unknown) {
      this.deps.logger.error('[GitInfoService] pruneWorktrees failed', {
        workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return thrownOutcome(error);
    }
  }

  /**
   * Make sure `<workspace>/.claude-worktrees/` is ignored, appending an
   * anchored line to the commondir-aware `info/exclude` when it is not.
   * Never throws: a failure is warned and the caller carries on.
   */
  async ensureExcluded(workspacePath: string): Promise<void> {
    try {
      await this.deps.writeLock.run(workspacePath, () =>
        this.writeExcludeLine(workspacePath),
      );
    } catch (error: unknown) {
      this.deps.logger.warn(
        '[GitInfoService] could not exclude the agent worktree directory; it may show up as untracked',
        {
          workspacePath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async writeExcludeLine(workspacePath: string): Promise<void> {
    const { exec } = this.deps;
    const ignored = await exec(
      ['check-ignore', '-q', '--', `${AGENT_WORKTREE_DIR}/`],
      workspacePath,
    );
    // 0: already ignored. 1: not ignored. Anything else: git could not tell.
    if (ignored.exitCode === 0) return;
    if (ignored.exitCode !== 1) {
      throw new Error(
        `git check-ignore exited ${ignored.exitCode}: ${ignored.stderr.trim()}`,
      );
    }

    const [prefix, excludePath] = await Promise.all([
      this.revParseLine(workspacePath, ['--show-prefix']),
      this.revParseLine(workspacePath, ['--git-path', 'info/exclude']),
    ]);
    const line = `/${escapeIgnorePattern(prefix)}${AGENT_WORKTREE_DIR}/`;
    const file = path.resolve(workspacePath, excludePath);

    let current = '';
    try {
      current = await readFile(file, 'utf8');
    } catch (error: unknown) {
      const missing =
        error instanceof Error && 'code' in error && error.code === 'ENOENT';
      if (!missing) throw error;
    }
    if (current.split(/\r?\n/).some((l) => l.trim() === line)) return;

    await mkdir(path.dirname(file), { recursive: true });
    const separator = current === '' || current.endsWith('\n') ? '' : '\n';
    await appendFile(file, `${separator}${line}\n`, 'utf8');
    this.deps.logger.info('[GitInfoService] excluded agent worktrees', {
      workspacePath,
      excludeFile: file,
    });
  }

  /** One `git rev-parse` value, without its trailing newline. */
  private async revParseLine(
    workspacePath: string,
    args: string[],
  ): Promise<string> {
    const result = await this.deps.exec(['rev-parse', ...args], workspacePath);
    if (result.exitCode !== 0) {
      throw new Error(
        `git rev-parse ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`,
      );
    }
    return result.stdout.replace(/\r?\n$/, '');
  }

  /** Whether `worktreePath` lies inside `<workspace>/.claude-worktrees/`. */
  private isUnderAgentDir(
    workspacePath: string,
    worktreePath: string,
  ): boolean {
    const relative = path.relative(
      path.join(workspacePath, AGENT_WORKTREE_DIR),
      worktreePath,
    );
    return (
      relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }

  /** The listed worktree at `worktreePath`, when git reports it locked. */
  private async findLocked(
    workspacePath: string,
    worktreePath: string,
  ): Promise<GitWorktreeInfo | undefined> {
    const target = comparablePath(path.resolve(workspacePath, worktreePath));
    const worktrees = await this.list(workspacePath);
    return worktrees.find(
      (wt) => wt.locked === true && comparablePath(wt.path) === target,
    );
  }
}
