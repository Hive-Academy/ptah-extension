/**
 * Tasks RPC Handlers — the `tasks:` namespace (TASK_2026_157).
 *
 * Serves the standalone Tasks board on all hosts (VS Code, Electron, CLI) via
 * `SHARED_HANDLERS`. Methods:
 *   - tasks:list             - filtered summaries + excluded count
 *   - tasks:get              - single task detail (body + artifacts)
 *   - tasks:create           - create a new TASK_YYYY_NNN folder + task.md
 *   - tasks:updateStatus     - byte-preserving status transition
 *   - tasks:generateRegistry - (re)write the derived registry.md
 *   - tasks:board            - all six status columns
 *   - tasks:reindex          - full rebuild of the derived index
 *
 * Every method:
 *   1. Zod-parses params (tasks-rpc.schema.ts) → RpcUserError('INVALID_PARAMS').
 *   2. Resolves + normalizes the workspace root (param ?? active workspace).
 *   3. Warms the index lazily (`index.ensureStarted`).
 *   4. Delegates to the index / writer / registry generator.
 *   5. Sanitizes failures — never forwards raw fs error messages (which carry
 *      absolute paths) to the client (R4.4).
 *
 * The constructor subscribes to `index.onDidChangeIndex` and rebroadcasts every
 * change as a `tasks:changed` push (git:worktreeChanged precedent).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  TASK_SPECS_TOKENS,
  normalizeWorkspaceRoot,
  type TaskIndexService,
  type TaskIndexChangeEvent,
  type TaskWriterService,
  type RegistryGeneratorService,
} from '@ptah-extension/task-specs';
import {
  TASK_STATUSES,
  type RpcMethodName,
  type TaskSpecSummary,
  type TaskStatus,
  type TasksListParams,
  type TasksListResult,
  type TasksGetParams,
  type TasksGetResult,
  type TasksCreateParams,
  type TasksCreateResult,
  type TasksUpdateStatusParams,
  type TasksUpdateStatusResult,
  type TasksGenerateRegistryParams,
  type TasksGenerateRegistryResult,
  type TasksBoardParams,
  type TasksBoardResult,
  type TasksReindexParams,
  type TasksReindexResult,
} from '@ptah-extension/shared';
import {
  TasksListParamsSchema,
  TasksGetParamsSchema,
  TasksCreateParamsSchema,
  TasksUpdateStatusParamsSchema,
  TasksGenerateRegistryParamsSchema,
  TasksBoardParamsSchema,
  TasksReindexParamsSchema,
} from './tasks-rpc.schema';

@injectable()
export class TasksRpcHandlers {
  /** RPC methods owned by this handler (SHARED_HANDLERS coverage invariant). */
  static readonly METHODS = [
    'tasks:list',
    'tasks:get',
    'tasks:create',
    'tasks:updateStatus',
    'tasks:generateRegistry',
    'tasks:board',
    'tasks:reindex',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TASK_SPECS_TOKENS.TASK_INDEX_SERVICE)
    private readonly index: TaskIndexService,
    @inject(TASK_SPECS_TOKENS.TASK_WRITER)
    private readonly writer: TaskWriterService,
    @inject(TASK_SPECS_TOKENS.REGISTRY_GENERATOR)
    private readonly registry: RegistryGeneratorService,
  ) {
    // Push every derived-index change to all webviews.
    this.index.onDidChangeIndex((event) => {
      void this.broadcastChanged(event);
    });
  }

  register(): void {
    this.registerList();
    this.registerGet();
    this.registerCreate();
    this.registerUpdateStatus();
    this.registerGenerateRegistry();
    this.registerBoard();
    this.registerReindex();
  }

  private registerList(): void {
    this.rpcHandler.registerMethod<TasksListParams, TasksListResult>(
      'tasks:list',
      async (params) => {
        const parsed = this.parse(TasksListParamsSchema, params);
        const root = this.resolveRoot(parsed.workspaceRoot);
        try {
          await this.index.ensureStarted(root);
          return await this.index.list(root, {
            status: parsed.status,
            type: parsed.type,
          });
        } catch (error: unknown) {
          throw this.sanitize(error, 'tasks:list', 'Failed to list tasks.');
        }
      },
    );
  }

  private registerGet(): void {
    this.rpcHandler.registerMethod<TasksGetParams, TasksGetResult>(
      'tasks:get',
      async (params) => {
        const parsed = this.parse(TasksGetParamsSchema, params);
        const root = this.resolveRoot(parsed.workspaceRoot);
        try {
          await this.index.ensureStarted(root);
          const task = await this.index.getDetail(root, parsed.taskId);
          return { task };
        } catch (error: unknown) {
          throw this.sanitize(error, 'tasks:get', 'Failed to read task.');
        }
      },
    );
  }

  private registerCreate(): void {
    this.rpcHandler.registerMethod<TasksCreateParams, TasksCreateResult>(
      'tasks:create',
      async (params) => {
        const parsed = this.parse(TasksCreateParamsSchema, params);
        const root = this.resolveRoot(parsed.workspaceRoot);
        try {
          await this.index.ensureStarted(root);
          const result = await this.writer.create(root, {
            title: parsed.title,
            type: parsed.type,
            description: parsed.description,
            dependsOn: parsed.dependsOn,
            executor: parsed.executor,
          });
          return result.success
            ? { success: true, task: result.task }
            : { success: false, error: result.error };
        } catch (error: unknown) {
          throw this.sanitize(error, 'tasks:create', 'Failed to create task.');
        }
      },
    );
  }

  private registerUpdateStatus(): void {
    this.rpcHandler.registerMethod<
      TasksUpdateStatusParams,
      TasksUpdateStatusResult
    >('tasks:updateStatus', async (params) => {
      const parsed = this.parse(TasksUpdateStatusParamsSchema, params);
      const root = this.resolveRoot(parsed.workspaceRoot);
      try {
        await this.index.ensureStarted(root);
        const result = await this.writer.updateStatus(
          root,
          parsed.taskId,
          parsed.status,
        );
        return result.success
          ? { success: true, task: result.task }
          : { success: false, error: result.error };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'tasks:updateStatus',
          'Failed to update task status.',
        );
      }
    });
  }

  private registerGenerateRegistry(): void {
    this.rpcHandler.registerMethod<
      TasksGenerateRegistryParams,
      TasksGenerateRegistryResult
    >('tasks:generateRegistry', async (params) => {
      const parsed = this.parse(TasksGenerateRegistryParamsSchema, params);
      const root = this.resolveRoot(parsed.workspaceRoot);
      try {
        const result = await this.registry.generate(root);
        return {
          success: true,
          includedCount: result.includedCount,
          excludedCount: result.excludedCount,
          registryPath: result.registryPath,
        };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'tasks:generateRegistry',
          'Failed to generate registry.',
        );
      }
    });
  }

  private registerBoard(): void {
    this.rpcHandler.registerMethod<TasksBoardParams, TasksBoardResult>(
      'tasks:board',
      async (params) => {
        const parsed = this.parse(TasksBoardParamsSchema, params);
        const root = this.resolveRoot(parsed.workspaceRoot);
        try {
          await this.index.ensureStarted(root);
          const { tasks, excludedCount, specsDirExists } =
            await this.index.list(root);
          return {
            columns: this.groupByStatus(tasks),
            excludedCount,
            specsDirExists,
          };
        } catch (error: unknown) {
          throw this.sanitize(error, 'tasks:board', 'Failed to load board.');
        }
      },
    );
  }

  private registerReindex(): void {
    this.rpcHandler.registerMethod<TasksReindexParams, TasksReindexResult>(
      'tasks:reindex',
      async (params) => {
        const parsed = this.parse(TasksReindexParamsSchema, params);
        const root = this.resolveRoot(parsed.workspaceRoot);
        try {
          const result = await this.index.reindex(root);
          return {
            success: true,
            indexedCount: result.indexedCount,
            excludedCount: result.excludedCount,
            durationMs: result.durationMs,
          };
        } catch (error: unknown) {
          throw this.sanitize(error, 'tasks:reindex', 'Failed to reindex.');
        }
      },
    );
  }

  /** Group summaries into the six always-present status columns (B1 order). */
  private groupByStatus(
    tasks: TaskSpecSummary[],
  ): Record<TaskStatus, TaskSpecSummary[]> {
    const columns = {} as Record<TaskStatus, TaskSpecSummary[]>;
    for (const status of TASK_STATUSES) {
      columns[status] = [];
    }
    for (const task of tasks) {
      (columns[task.status] ??= []).push(task);
    }
    return columns;
  }

  /**
   * Resolve + normalize the workspace root. Throws a typed user error rather
   * than leaking when no workspace is open.
   */
  private resolveRoot(requested: string | undefined): string {
    const root = requested ?? this.workspace.getWorkspaceRoot();
    if (!root) {
      throw new RpcUserError('No workspace folder open.', 'WORKSPACE_NOT_OPEN');
    }
    return normalizeWorkspaceRoot(root);
  }

  /** Zod-parse or throw a structured INVALID_PARAMS user error. */
  private parse<T>(
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    params: unknown,
  ): T {
    const result = schema.safeParse(params ?? {});
    if (!result.success || result.data === undefined) {
      throw new RpcUserError(
        'Invalid task request parameters.',
        'INVALID_PARAMS',
      );
    }
    return result.data;
  }

  /**
   * Convert an unexpected internal failure into a sanitized error. Preserves
   * typed user errors; logs the raw error (with its path) server-side only and
   * surfaces a generic message so no absolute path reaches the client (R4.4).
   */
  private sanitize(error: unknown, method: string, message: string): Error {
    if (error instanceof RpcUserError) return error;
    this.logger.error(
      `[TasksRpc] ${method} failed`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return new Error(message);
  }

  private broadcastChanged(event: TaskIndexChangeEvent): Promise<void> {
    return this.webviewManager
      .broadcastMessage('tasks:changed', {
        workspaceRoot: event.workspaceRoot,
        reason: event.reason,
        folderNames: event.folderNames,
      })
      .catch((error: unknown) => {
        this.logger.error(
          '[TasksRpc] Failed to broadcast tasks:changed',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }
}
