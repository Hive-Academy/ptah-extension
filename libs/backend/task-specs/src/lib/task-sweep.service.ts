import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CARRIER_FILE,
  type TaskSpecSummary,
  type TaskSweepCandidate,
  type TasksSweepResult,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';

/** The `git show HEAD:<path>` probe, narrowed to what this service needs. */
export interface ISweepGitProbe {
  showFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<{ content: string }>;
}

const MS_PER_DAY = 86_400_000;

/**
 * TaskSweepService
 *
 * Deletes FINISHED task folders that have aged out of the board.
 *
 * ## The policy, stated once
 *
 * A folder is a candidate when all three hold:
 *   1. its status is `done` or `cancelled` — live work is never a candidate;
 *   2. its `updated` stamp parses AND is at least `olderThanDays` old;
 *   3. its carrier exists in `HEAD`.
 *
 * (2) refuses a task with no usable stamp rather than guessing its age. There
 * is no safe default there: treating an absent date as "old" deletes the
 * carriers whose frontmatter is already damaged, which are exactly the ones a
 * user is most likely to want to look at.
 *
 * ## (3) is the one that makes this reversible
 *
 * `.ptah/specs` is tracked, so a committed folder survives its own deletion —
 * `git show HEAD:.ptah/specs/<id>/task.md` brings it back. A folder git has
 * never seen has no such copy, and deleting it destroys work outright. Those
 * are REPORTED as skipped rather than deleted, and rather than silently passed
 * over: a sweep that quietly leaves things behind is one the user cannot reason
 * about, and this one is already asking to be trusted with a delete.
 *
 * ## Preview and delete are one call
 *
 * `apply: false` runs the identical scan and returns the identical candidate
 * list, having written nothing. Two code paths would let the plan the user
 * confirmed drift from the act that follows it, and on a delete that is the
 * only drift that matters.
 */
@injectable()
export class TaskSweepService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.GIT_INFO_SERVICE)
    private readonly git: ISweepGitProbe,
  ) {}

  /**
   * @param tasks the CURRENT board summaries — the caller already has them, and
   *   re-scanning here would let the sweep act on a different set from the one
   *   the user was shown.
   * @param now injected so the age boundary is testable without a clock.
   */
  public async sweep(
    workspaceRoot: string,
    tasks: readonly TaskSpecSummary[],
    olderThanDays: number,
    apply: boolean,
    now: number = Date.now(),
  ): Promise<TasksSweepResult> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const cutoff = now - olderThanDays * MS_PER_DAY;

    const candidates: TaskSweepCandidate[] = [];
    for (const task of tasks) {
      if (task.status !== 'done' && task.status !== 'cancelled') continue;
      const updatedMs = this.parseUpdated(task.updated);
      if (updatedMs === null || updatedMs > cutoff) continue;

      candidates.push({
        taskId: task.id,
        status: task.status,
        updated: task.updated,
        ageDays: Math.floor((now - updatedMs) / MS_PER_DAY),
        committed: await this.isCommitted(root, task.id),
      });
    }

    // Newest first, so the preview's top row is the closest call the policy
    // made — that is the one a user checks before agreeing to the rest.
    candidates.sort((a, b) => a.ageDays - b.ageDays);

    if (!apply) {
      return { candidates, deleted: [], skipped: [], previewOnly: true };
    }

    const deleted: string[] = [];
    const skipped: TasksSweepResult['skipped'] = [];
    for (const candidate of candidates) {
      if (!candidate.committed) {
        skipped.push({ taskId: candidate.taskId, reason: 'uncommitted' });
        continue;
      }
      const folder = path.join(root, '.ptah', 'specs', candidate.taskId);
      try {
        await this.fs.delete(folder, { recursive: true });
        deleted.push(candidate.taskId);
      } catch (error: unknown) {
        // One folder's failure never aborts the run: a locked file in task 30
        // of 60 must not leave the other 30 unswept with no way to tell which.
        this.logger.warn('[task-specs] sweep delete failed', {
          taskId: candidate.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
        skipped.push({ taskId: candidate.taskId, reason: 'delete_failed' });
      }
    }

    return { candidates, deleted, skipped, previewOnly: false };
  }

  /**
   * Is this folder's carrier in `HEAD`?
   *
   * `showFile` resolves `{ content: '' }` for a path git does not have, so
   * empty content IS the negative answer. A throw is treated the same way —
   * outside a repo, or with git unavailable, NOTHING is committed and therefore
   * nothing is deletable, which is the safe direction to fail in.
   */
  private async isCommitted(root: string, taskId: string): Promise<boolean> {
    // POSIX separators: this is a git pathspec, not a filesystem path, and git
    // does not accept backslashes on Windows.
    const relative = `.ptah/specs/${taskId}/${CARRIER_FILE}`;
    try {
      const result = await this.git.showFile(root, relative);
      return result.content.length > 0;
    } catch (error: unknown) {
      this.logger.warn('[task-specs] sweep git probe failed', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** `null` for absent, empty or unparseable — never a guessed age. */
  private parseUpdated(updated: string | null): number | null {
    if (updated === null || updated.length === 0) return null;
    const ms = new Date(updated).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
}
