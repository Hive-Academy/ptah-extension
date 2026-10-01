import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';
import {
  DEFAULT_GIT_TIMEOUT_MS,
  TOKENS,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  CARRIER_FILE,
  type TaskSpecSummary,
  type TaskSweepCandidate,
  type TasksSweepResult,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import {
  SDK_PROCESS_SPAWNER_TOKEN,
  VISIBILITY_EXEC_GIT_TOKEN,
  type ExecGitFn,
} from './git-task-folder-visibility.service';

const MS_PER_DAY = 86_400_000;

/**
 * `git ls-tree -r --name-only -z HEAD -- .ptah/specs/` → the folders whose
 * carrier git has. Only `.ptah/specs/<id>/task.md` counts: a folder that git
 * holds a review file for, but no carrier, has nothing `git show` could restore.
 */
export function trackedCarrierFolders(stdout: string): Set<string> {
  const folders = new Set<string>();
  for (const entry of stdout.split('\0')) {
    const parts = entry.split('/');
    if (
      parts.length === 4 &&
      parts[0] === '.ptah' &&
      parts[1] === 'specs' &&
      parts[3] === CARRIER_FILE
    ) {
      folders.add(parts[2]);
    }
  }
  return folders;
}

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
    @inject(VISIBILITY_EXEC_GIT_TOKEN) private readonly exec: ExecGitFn,
    @inject(SDK_PROCESS_SPAWNER_TOKEN, { isOptional: true })
    private readonly spawner: IProcessSpawner | null = null,
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

    const aged: Array<{ task: TaskSpecSummary; updatedMs: number }> = [];
    for (const task of tasks) {
      if (task.status !== 'done' && task.status !== 'cancelled') continue;
      const updatedMs = this.parseUpdated(task.updated);
      if (updatedMs === null || updatedMs > cutoff) continue;
      aged.push({ task, updatedMs });
    }

    // One git process for the whole run, not one per candidate: a spawn costs
    // seconds on some Windows machines, and ninety of them in sequence blew the
    // RPC timeout long before the preview could answer.
    const tracked = aged.length > 0 ? await this.trackedCarriers(root) : null;

    const candidates: TaskSweepCandidate[] = aged.map(
      ({ task, updatedMs }) => ({
        taskId: task.id,
        status: task.status,
        updated: task.updated,
        ageDays: Math.floor((now - updatedMs) / MS_PER_DAY),
        committed: tracked?.has(task.id) ?? false,
      }),
    );

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
   * The folder names whose carrier is in `HEAD`.
   *
   * `null` when git fails — outside a repo, or with git unavailable, NOTHING is
   * committed and therefore nothing is deletable, which is the safe direction
   * to fail in.
   */
  private async trackedCarriers(root: string): Promise<Set<string> | null> {
    try {
      // POSIX pathspec: git does not accept backslashes on Windows.
      const result = await this.exec(
        ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', '.ptah/specs/'],
        root,
        {
          timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
          spawner: this.spawner ?? undefined,
        },
      );
      if (result.exitCode !== 0) {
        this.logger.warn('[task-specs] sweep git probe failed', {
          exitCode: result.exitCode,
          stderr: result.stderr.trim(),
        });
        return null;
      }
      return trackedCarrierFolders(result.stdout);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] sweep git probe failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** `null` for absent, empty or unparseable — never a guessed age. */
  private parseUpdated(updated: string | null): number | null {
    if (updated === null || updated.length === 0) return null;
    const ms = new Date(updated).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
}
