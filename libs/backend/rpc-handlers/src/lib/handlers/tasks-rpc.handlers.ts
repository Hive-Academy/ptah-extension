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
 *   - tasks:getViews         - per-user saved board views, malformed ones skipped
 *   - tasks:saveViews        - whole-list replace of the saved views
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
  type TaskDoctorService,
  type DoctorAction,
  type RegistryGeneratorService,
} from '@ptah-extension/task-specs';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { TasksSettings } from '@ptah-extension/settings-core';
import {
  MAX_SAVED_TASK_VIEWS,
  SavedTaskViewSchema,
  TASK_STATUSES,
  type RpcMethodName,
  type SavedTaskView,
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
  type TasksUpdateMetadataParams,
  type TasksUpdateMetadataResult,
  type TasksGenerateRegistryParams,
  type TasksGenerateRegistryResult,
  type TasksBoardParams,
  type TasksBoardResult,
  type TasksReindexParams,
  type TasksReindexResult,
  type TasksAdoptParams,
  type TasksAdoptResult,
  type TasksDoctorPlanParams,
  type TasksDoctorPlanResult,
  type TasksDoctorAction,
  type TasksGetViewsParams,
  type TasksGetViewsResult,
  type TasksSaveViewsParams,
  type TasksSaveViewsResult,
} from '@ptah-extension/shared';
import {
  TasksListParamsSchema,
  TasksGetParamsSchema,
  TasksCreateParamsSchema,
  TasksUpdateStatusParamsSchema,
  TasksUpdateMetadataParamsSchema,
  TasksGenerateRegistryParamsSchema,
  TasksBoardParamsSchema,
  TasksReindexParamsSchema,
  TasksAdoptParamsSchema,
  TasksDoctorPlanParamsSchema,
  TasksGetViewsParamsSchema,
  TasksSaveViewsParamsSchema,
} from './tasks-rpc.schema';

/**
 * Last path segment, for either separator.
 *
 * Hand-rolled rather than `path.basename` because the doctor builds its paths
 * with `path.join` on the HOST, and a Windows-authored plan carries `\`
 * separators that POSIX `path.basename` would not split. This runs on the
 * result of that join, so it must understand both.
 */
function baseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] ?? filePath;
}

/**
 * Project a doctor action onto its wire shape.
 *
 * The switch is exhaustive by construction: `assertNever` on the default branch
 * means adding a third `DoctorAction` kind fails typecheck HERE, rather than
 * silently reaching the webview as an action the UI has no case for.
 */
function toWireAction(action: DoctorAction): TasksDoctorAction {
  switch (action.kind) {
    case 'adopt':
      return {
        kind: 'adopt',
        folderName: action.folderName,
        title: action.title,
        type: action.type,
        status: action.status,
        inferredFrom: action.inferredFrom,
      };
    case 'renameLegacyBatches':
      return {
        kind: 'renameLegacyBatches',
        folderName: action.folderName,
        from: baseName(action.from),
        to: baseName(action.to),
      };
    default:
      return assertNever(action);
  }
}

/** Compile-time exhaustiveness guard. */
function assertNever(value: never): never {
  throw new Error(`Unhandled doctor action: ${JSON.stringify(value)}`);
}

@injectable()
export class TasksRpcHandlers {
  /** RPC methods owned by this handler (SHARED_HANDLERS coverage invariant). */
  static readonly METHODS = [
    'tasks:list',
    'tasks:get',
    'tasks:create',
    'tasks:updateStatus',
    'tasks:updateMetadata',
    'tasks:generateRegistry',
    'tasks:board',
    'tasks:reindex',
    'tasks:adopt',
    'tasks:doctorPlan',
    'tasks:getViews',
    'tasks:saveViews',
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
    @inject(TASK_SPECS_TOKENS.TASK_DOCTOR)
    private readonly doctor: TaskDoctorService,
    @inject(SETTINGS_TOKENS.TASKS_SETTINGS)
    private readonly tasksSettings: TasksSettings,
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
    this.registerUpdateMetadata();
    this.registerGenerateRegistry();
    this.registerBoard();
    this.registerReindex();
    this.registerAdopt();
    this.registerDoctorPlan();
    this.registerGetViews();
    this.registerSaveViews();
  }

  /**
   * `tasks:getViews` — read the saved views, dropping only what is unreadable.
   *
   * ## This method does not fail
   *
   * The board opens on this call, so every failure mode short of a programming
   * error resolves to a rendered board with fewer views, never to an error the
   * user cannot act on (NFR-11). Three distinct failures collapse here:
   *
   *  - ONE malformed entry — skipped, counted, the rest load. This is the half
   *    the permissive settings schema exists to make possible: `handleFor()`
   *    `safeParse`s the whole array and falls back to `[]` on failure, so a
   *    strict per-item schema down in settings-core would have turned one bad
   *    view into no views at all (FR-C2.3, BR-4).
   *  - The stored value is not an array — the settings schema itself rejects
   *    it and hands back `[]`. Nothing was parseable, so nothing was skipped.
   *  - The store cannot be read at all — caught below, `[]` again.
   *
   * `workspaceRoot` is parsed and resolved like every other method in this
   * class even though views are PER-USER (D2/Q3) and not scoped by it: the
   * board's call carries the parameter, and accepting-then-ignoring it silently
   * would be worse than rejecting a request made with no workspace open.
   */
  private registerGetViews(): void {
    this.rpcHandler.registerMethod<TasksGetViewsParams, TasksGetViewsResult>(
      'tasks:getViews',
      async (params) => {
        const parsed = this.parse(TasksGetViewsParamsSchema, params);
        this.resolveRoot(parsed.workspaceRoot);
        return this.readViews();
      },
    );
  }

  /**
   * `tasks:saveViews` — replace the whole list.
   *
   * Create, rename, update, delete and reorder (FR-C2.5) are all this one
   * method: the client does the arithmetic on the list it already holds and
   * sends the result, exactly as `PTAH_CLI_AGENTS_DEF` is written. There is no
   * read-modify-write here, because a settings file gives no way to make one
   * atomic.
   */
  private registerSaveViews(): void {
    this.rpcHandler.registerMethod<TasksSaveViewsParams, TasksSaveViewsResult>(
      'tasks:saveViews',
      async (params) => {
        const parsed = this.parse(TasksSaveViewsParamsSchema, params);
        this.resolveRoot(parsed.workspaceRoot);

        if (parsed.views.length > MAX_SAVED_TASK_VIEWS) {
          return {
            success: false,
            error: {
              code: 'CAP_EXCEEDED',
              message:
                `You can save at most ${MAX_SAVED_TASK_VIEWS} views. ` +
                `This request carried ${parsed.views.length}. ` +
                `Nothing was saved — delete a view and try again.`,
            },
          };
        }

        const views = parsed.views;
        // `undefined` means "leave the stored value alone"; `null` clears it.
        const requested =
          parsed.activeViewId === undefined
            ? this.readActiveViewId()
            : (parsed.activeViewId ?? '');
        // Reconcile rather than reject: an active id naming no view in the new
        // list is what DELETING the active view looks like, which is a normal
        // action rather than a bad request. Storing it anyway would leave the
        // board reporting an active view it cannot show.
        const activeViewId = views.some((view) => view.id === requested)
          ? requested
          : '';

        // The two keys are two whole-file writes and cannot be made one atomic
        // act, so they are attempted — and reported — SEPARATELY. Collapsing
        // them into one try block reports a `savedViews` write that genuinely
        // landed as a failure whenever the second write throws, and the only
        // response a user has to "failed" is to save again, which would be
        // pointless work over data already on disk.
        try {
          await this.tasksSettings.savedViews.set([...views]);
        } catch (error: unknown) {
          // Logged with its real message (which may carry an absolute path)
          // server-side only; the client gets a generic one (R4.4).
          this.logger.error(
            '[TasksRpc] tasks:saveViews failed to persist the view list',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: {
              code: 'WRITE_FAILED',
              message: 'Failed to save views. Nothing was changed.',
            },
          };
        }

        try {
          await this.tasksSettings.activeViewId.set(activeViewId);
        } catch (error: unknown) {
          this.logger.error(
            '[TasksRpc] tasks:saveViews saved the views but not the active id',
            error instanceof Error ? error : new Error(String(error)),
          );
          // The views ARE saved, so this is a success carrying a warning. The
          // stale pointer needs no repair path: `readViews` reconciles it
          // against the views it actually read, so the next load either finds
          // the named view or reports no active view at all.
          return {
            success: true,
            warning: {
              code: 'ACTIVE_VIEW_ID_NOT_SAVED',
              message:
                'Your views were saved. The active view could not be recorded, ' +
                'so the board may open on a different view than the one you ' +
                'selected. There is nothing to save again.',
            },
          };
        }

        return { success: true };
      },
    );
  }

  /**
   * Read + per-entry validate the stored views.
   *
   * Returns the survivors sorted by `order`. Sorting here rather than leaving
   * it to the caller is what makes `order` mean something: it is the only
   * reason the field exists, and a stored list is otherwise just whatever array
   * order the last write happened to use. Ties fall back to surviving position,
   * so the result is deterministic even for a hand-edited file that gave two
   * views the same `order`.
   */
  private readViews(): TasksGetViewsResult {
    const activeViewId = this.readActiveViewId();
    let stored: unknown[];
    try {
      stored = this.tasksSettings.savedViews.get();
    } catch (error: unknown) {
      this.logger.error(
        '[TasksRpc] tasks:getViews could not read the settings store',
        error instanceof Error ? error : new Error(String(error)),
      );
      return { views: [], activeViewId: null, skipped: 0 };
    }

    const views: SavedTaskView[] = [];
    let skipped = 0;
    for (const entry of stored) {
      const result = SavedTaskViewSchema.safeParse(entry);
      if (result.success) {
        views.push(result.data);
        continue;
      }
      skipped += 1;
      this.logger.warn(
        `[TasksRpc] Skipping an unreadable saved view: ${result.error.issues
          .map(
            (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          )
          .join('; ')}`,
      );
    }

    const ordered = views
      .map((view, index) => ({ view, index }))
      .sort((a, b) => a.view.order - b.view.order || a.index - b.index)
      .map((entry) => entry.view);

    return {
      views: ordered,
      activeViewId: ordered.some((view) => view.id === activeViewId)
        ? activeViewId
        : null,
      skipped,
    };
  }

  /**
   * The stored active-view id; `''` means none.
   *
   * Swallows a store failure rather than propagating it: which view was active
   * is a preference, and losing it must not be able to take down either the
   * read that renders the board or the write that saves the user's views.
   */
  private readActiveViewId(): string {
    try {
      return this.tasksSettings.activeViewId.get();
    } catch (error: unknown) {
      this.logger.error(
        '[TasksRpc] Could not read the active view id',
        error instanceof Error ? error : new Error(String(error)),
      );
      return '';
    }
  }

  /**
   * `tasks:adopt` — retrofit a carrier onto a folder that already exists.
   *
   * Delegates straight to `writer.adoptFolder`, which has NO code path into the
   * id allocator. An existing carrier comes back as a typed `CARRIER_EXISTS`
   * result, not as a fresh folder and not as an overwrite.
   */
  private registerAdopt(): void {
    this.rpcHandler.registerMethod<TasksAdoptParams, TasksAdoptResult>(
      'tasks:adopt',
      async (params) => {
        const parsed = this.parse(TasksAdoptParamsSchema, params);
        const root = this.resolveRoot(parsed.workspaceRoot);
        try {
          await this.index.ensureStarted(root);
          const result = await this.writer.adoptFolder(
            root,
            parsed.folderName,
            {
              title: parsed.title,
              type: parsed.type,
              status: parsed.status,
              description: parsed.description,
              dependsOn: parsed.dependsOn,
              executor: parsed.executor,
              statusInferred: parsed.statusInferred,
            },
          );
          return result.success
            ? { success: true, task: result.task }
            : { success: false, error: result.error };
        } catch (error: unknown) {
          throw this.sanitize(error, 'tasks:adopt', 'Failed to adopt folder.');
        }
      },
    );
  }

  /**
   * `tasks:doctorPlan` — diagnosis only. ZERO writes.
   *
   * Note the deliberate absence of `index.ensureStarted` here, which every
   * other method in this class calls. `ensureStarted` writes
   * `.ptah/specs/README.md` when its hash differs, so warming the index would
   * make this "read-only" method mutate the very directory it is reporting on.
   * The doctor reads the tree directly and needs no warm index.
   */
  private registerDoctorPlan(): void {
    this.rpcHandler.registerMethod<
      TasksDoctorPlanParams,
      TasksDoctorPlanResult
    >('tasks:doctorPlan', async (params) => {
      const parsed = this.parse(TasksDoctorPlanParamsSchema, params);
      const root = this.resolveRoot(parsed.workspaceRoot);
      try {
        const result = await this.doctor.plan(root);
        if (!result.ok) {
          return { ok: false, error: result.error };
        }
        return {
          ok: true,
          plan: {
            contractVersion: result.plan.contractVersion,
            stampVersion: result.plan.stampVersion,
            // `workspaceRoot` is deliberately dropped and rename paths are
            // reduced to bare filenames — an absolute path in an RPC result
            // leaks the user's directory layout to the webview (R4.4).
            actions: result.plan.actions.map(toWireAction),
            warnings: result.plan.warnings,
          },
        };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'tasks:doctorPlan',
          'Failed to diagnose the task-spec tree.',
        );
      }
    });
  }

  /**
   * `tasks:list` — the same method it always was, now carrying the shared
   * filter spec (FR-C1.5). **No new RPC method, therefore no
   * `ALLOWED_METHOD_PREFIXES` edit** (BR-1).
   *
   * The three facet bags are handed to the index untouched. Folding them into
   * one spec and running the predicate happens in ONE place — the store — so
   * the MCP `ptah_task_list` path, which reaches the store with only
   * `status`/`type`, goes through the identical predicate rather than a second
   * comparison that agrees with it today.
   */
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
            filter: parsed.filter,
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
            // The five metadata fields. Their absence here — while the schema
            // above validated them — is what made a `tasks:create` carrying
            // labels succeed and silently discard them. Mapped explicitly on
            // purpose: an omission is then visible at this call site rather
            // than hidden inside a spread.
            labels: parsed.labels,
            estimate: parsed.estimate,
            parent: parsed.parent,
            duplicates: parsed.duplicates,
            relatesTo: parsed.relatesTo,
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

  /**
   * `tasks:updateMetadata` — the one metadata write.
   *
   * Every field in `patch` is a FULL REPLACEMENT. Add/remove of a single label
   * is arithmetic the client does against the task it already holds, then
   * sends as a whole array; the writer deliberately does no read-modify-write,
   * because it cannot make one atomic.
   */
  private registerUpdateMetadata(): void {
    this.rpcHandler.registerMethod<
      TasksUpdateMetadataParams,
      TasksUpdateMetadataResult
    >('tasks:updateMetadata', async (params) => {
      const parsed = this.parse(TasksUpdateMetadataParamsSchema, params);
      const root = this.resolveRoot(parsed.workspaceRoot);
      try {
        await this.index.ensureStarted(root);
        const result = await this.writer.updateMetadata(
          root,
          parsed.taskId,
          parsed.patch,
        );
        return result.success
          ? { success: true, task: result.task }
          : { success: false, error: result.error };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'tasks:updateMetadata',
          'Failed to update task metadata.',
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
          const { tasks, excluded, excludedCount, specsDirExists } =
            await this.index.list(root);
          return {
            columns: this.groupByStatus(tasks),
            // Names + typed reasons, not just a magnitude: a folder that
            // vanished from the board is only actionable once the user can see
            // WHICH folder and WHY (TASK_2026_179, step 10).
            excluded,
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
