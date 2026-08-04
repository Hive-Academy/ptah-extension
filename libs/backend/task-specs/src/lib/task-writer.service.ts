import { inject, injectable } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  FileType,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CARRIER_FILE,
  renderTaskMd,
  type TaskSpecSummary,
  type TaskType,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { allocateTaskId } from './id-allocator';
import { parseTaskFile } from './task-frontmatter';
import { updateFrontmatter } from './task-frontmatter';
import {
  TASK_INDEX_NOTIFIER_TOKEN,
  type ITaskIndexNotifier,
} from './task-index.port';

export interface CreateTaskInput {
  title: string;
  type: TaskType;
  description?: string;
  dependsOn?: string[];
  executor?: string;
}

export type CreateTaskResult =
  | { success: true; task: TaskSpecSummary }
  | {
      success: false;
      error: {
        code: 'TASK_FOLDER_EXISTS' | 'WRITE_FAILED' | 'INVALID_PARAMS';
        message: string;
      };
    };

export type UpdateStatusResult =
  | { success: true; task: TaskSpecSummary }
  | {
      success: false;
      error: {
        /**
         * `TASK_CONFLICT` (TASK_2026_179, step 4): the carrier changed on disk
         * between our read and our write. We REFUSE the write rather than
         * clobber the other writer — `.ptah/**` is gitignored, so a clobbered
         * status has no undo. The caller should re-read and retry.
         */
        code:
          | 'TASK_NOT_FOUND'
          | 'TASK_EXCLUDED'
          | 'WRITE_FAILED'
          | 'TASK_CONFLICT';
        message: string;
      };
    };

/**
 * Writes `task.md` carriers (R1.4/R1.5/R4.6/R6.3).
 *
 *  - `create`: id-alloc → existence guard → leaf mkdir → write full valid
 *    frontmatter → round-trip parse with zero issues before returning. Never
 *    overwrites: an existing target folder/carrier yields `TASK_FOLDER_EXISTS`.
 *  - `updateStatus`: read raw → byte-preserving `updateFrontmatter` →
 *    PRE-WRITE RE-READ → write → reparse. The file mutation is ALWAYS the first
 *    step (R3.5 write-order), then the narrow index notifier reparses that one
 *    folder.
 *
 * The carrier BODY is rendered by the shared contract module
 * (`renderTaskMd` in `@ptah-extension/shared`) so the Tasks board, the CLI and
 * this writer all agree on one carrier shape. Note the asymmetry, which is
 * deliberate: the WRITE path uses the contract module's dependency-free YAML
 * emitter (it must stay importable from the frontend), while the READ path
 * still goes through `gray-matter` inside `parseTaskFile` / `updateFrontmatter`.
 * Every `create` round-trips its own output through `parseTaskFile` before
 * returning, which is what keeps the two halves honest.
 */
@injectable()
export class TaskWriterService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TASK_INDEX_NOTIFIER_TOKEN)
    private readonly indexNotifier: ITaskIndexNotifier,
  ) {}

  async create(
    workspaceRoot: string,
    input: CreateTaskInput,
  ): Promise<CreateTaskResult> {
    if (!input.title || input.title.trim().length === 0) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'title is required.' },
      };
    }

    const root = normalizeWorkspaceRoot(workspaceRoot);
    const specsDir = path.join(root, '.ptah', 'specs');

    const existingFolders = await this.listFolderNames(specsDir);
    const id = allocateTaskId(existingFolders);
    const folderPath = path.join(specsDir, id);
    const carrier = path.join(folderPath, CARRIER_FILE);

    try {
      if (await this.fs.exists(folderPath)) {
        return {
          success: false,
          error: {
            code: 'TASK_FOLDER_EXISTS',
            message: `Task folder '${id}' already exists.`,
          },
        };
      }

      // createDirectory is recursive per the port — this materializes
      // `.ptah/specs/<id>` (and `.ptah/specs` if absent) in one call.
      await this.fs.createDirectory(folderPath);

      // Defensive against a race: never overwrite an existing carrier.
      if (await this.fs.exists(carrier)) {
        return {
          success: false,
          error: {
            code: 'TASK_FOLDER_EXISTS',
            message: `Task carrier '${id}/task.md' already exists.`,
          },
        };
      }

      const content = renderTaskMd({
        id,
        title: input.title,
        type: input.type,
        description: input.description,
        dependsOn: input.dependsOn,
        executor: input.executor,
      });
      await this.fs.writeFile(carrier, content);

      const parsed = parseTaskFile(id, content);
      if (parsed.kind !== 'task' || parsed.task.validationIssues.length > 0) {
        return {
          success: false,
          error: {
            code: 'WRITE_FAILED',
            message: 'Generated task.md failed round-trip validation.',
          },
        };
      }

      await this.notify(root, id);
      return { success: true, task: parsed.task };
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] create failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to write task.md.' },
      };
    }
  }

  async updateStatus(
    workspaceRoot: string,
    taskId: string,
    status: TaskSpecSummary['status'],
  ): Promise<UpdateStatusResult> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const carrier = path.join(root, '.ptah', 'specs', taskId, CARRIER_FILE);

    let raw: string;
    try {
      if (!(await this.fs.exists(carrier))) {
        return {
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: `Task '${taskId}' not found.`,
          },
        };
      }
      raw = await this.fs.readFile(carrier);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] updateStatus read failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to read task.md.' },
      };
    }

    const parsed = parseTaskFile(taskId, raw);
    if (parsed.kind === 'excluded') {
      return {
        success: false,
        error: {
          code: 'TASK_EXCLUDED',
          message: `Task '${taskId}' has invalid frontmatter and cannot be mutated.`,
        },
      };
    }

    const nextRaw = updateFrontmatter(raw, {
      status,
      updated: new Date().toISOString(),
    });

    // Pre-write re-read (TASK_2026_179, step 4). `.ptah/**` is gitignored, so a
    // clobbered carrier has no undo — if anything changed the file since our
    // snapshot (an agent's `Edit`, another host, a second board), REFUSE the
    // write and report the conflict instead of silently discarding their
    // change. This is a plain content comparison rather than a hash: it is the
    // collision-free form of the same check, and the file is small.
    //
    // This narrows the loss window; it does not close it. There is still a gap
    // between this read and the write below, and no cross-process lock can shut
    // it (an external `Edit` would not honour one). Closing it entirely needs a
    // real CAS, which the port does not have.
    let current: string;
    try {
      current = await this.fs.readFile(carrier);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] updateStatus re-read failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to read task.md.' },
      };
    }

    if (current !== raw) {
      this.logger.warn('[task-specs] updateStatus conflict — write refused', {
        taskId,
      });
      return {
        success: false,
        error: {
          code: 'TASK_CONFLICT',
          message: `Task '${taskId}' changed on disk during the update; nothing was written. Reload and try again.`,
        },
      };
    }

    try {
      await this.fs.writeFile(carrier, nextRaw);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] updateStatus write failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to write task.md.' },
      };
    }

    // File mutated first (R3.5) — now let the index reparse this folder.
    await this.notify(root, taskId);

    const reparsed = parseTaskFile(taskId, nextRaw);
    const task = reparsed.kind === 'task' ? reparsed.task : parsed.task;
    return { success: true, task };
  }

  private async notify(root: string, folderName: string): Promise<void> {
    try {
      await this.indexNotifier.applyFolderChange(root, folderName);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] index notify failed', {
        folderName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async listFolderNames(specsDir: string): Promise<string[]> {
    try {
      if (!(await this.fs.exists(specsDir))) return [];
      const entries = await this.fs.readDirectory(specsDir);
      return entries
        .filter((e) => e.type === FileType.Directory)
        .map((e) => e.name);
    } catch {
      return [];
    }
  }
}
