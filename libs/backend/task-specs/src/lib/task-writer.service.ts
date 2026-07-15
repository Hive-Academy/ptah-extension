import { inject, injectable } from 'tsyringe';
import * as path from 'path';
import matter from 'gray-matter';
import {
  PLATFORM_TOKENS,
  FileType,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { TaskSpecSummary, TaskType } from '@ptah-extension/shared';
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
        code: 'TASK_NOT_FOUND' | 'TASK_EXCLUDED' | 'WRITE_FAILED';
        message: string;
      };
    };

const CARRIER_FILE = 'task.md';

/**
 * Writes `task.md` carriers (R1.4/R1.5/R4.6/R6.3).
 *
 *  - `create`: id-alloc → existence guard → leaf mkdir → write full valid
 *    frontmatter → round-trip parse with zero issues before returning. Never
 *    overwrites: an existing target folder/carrier yields `TASK_FOLDER_EXISTS`.
 *  - `updateStatus`: read raw → byte-preserving `updateFrontmatter` → write →
 *    reparse. The file mutation is ALWAYS the first step (R3.5 write-order),
 *    then the narrow index notifier reparses that one folder.
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

      const content = this.renderTaskMd(id, input);
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

  private renderTaskMd(id: string, input: CreateTaskInput): string {
    const now = new Date().toISOString();
    const data: Record<string, unknown> = {
      id,
      status: 'backlog',
      type: input.type,
      title: input.title,
      depends_on: input.dependsOn ?? [],
      created: now,
      updated: now,
    };
    if (input.description !== undefined)
      data['description'] = input.description;
    if (input.executor !== undefined) data['executor'] = input.executor;

    const block = matter.stringify('', data);
    const bodyText = input.description ?? input.title;
    return `${block}\n## Description\n\n${bodyText}\n`;
  }
}
