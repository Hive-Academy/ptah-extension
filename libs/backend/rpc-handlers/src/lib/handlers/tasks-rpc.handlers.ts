/**
 * Tasks RPC Handlers — the `tasks:` namespace (TASK_2026_157).
 *
 * Serves the standalone Tasks board on all hosts (VS Code, Electron, CLI) via
 * `SHARED_HANDLERS`. Methods:
 *   - tasks:list             - filtered summaries + excluded count
 *   - tasks:get              - single task detail (body + artifact NAMES)
 *   - tasks:getArtifact      - ONE workflow document's markdown, by DocFile
 *   - tasks:create           - create a new TASK_YYYY_NNN folder + task.md
 *   - tasks:updateStatus     - byte-preserving status transition
 *   - tasks:bulkUpdateStatus - N independent status writes, one result each
 *   - tasks:bulkUpdateLabel  - add/remove ONE label across N tasks; no-ops are
 *                              reported as successes that issued no write
 *   - tasks:generateRegistry - (re)write the derived registry.md
 *   - tasks:board            - all six status columns
 *   - tasks:reindex          - full rebuild of the derived index
 *   - tasks:getViews         - per-user saved board views, malformed ones skipped
 *   - tasks:saveViews        - whole-list replace of the saved views
 *
 * Every method:
 *   1. Zod-parses params (tasks-rpc.schema.ts) → RpcUserError('INVALID_PARAMS').
 *   2. Resolves + normalizes the workspace root (param ?? active workspace) and
 *      gates a caller-SUPPLIED root through `isAuthorizedWorkspace` →
 *      RpcUserError('UNAUTHORIZED_WORKSPACE'). See `resolveRoot`.
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
  type UpdateMetadataResult,
} from '@ptah-extension/task-specs';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { TasksSettings } from '@ptah-extension/settings-core';
import {
  LabelSchema,
  SavedTaskViewSchema,
  TaskMetadataPatchSchema,
} from '@ptah-extension/shared/schemas';
import {
  MAX_SAVED_TASK_VIEWS,
  TASK_STATUSES,
  labelKey,
  type RpcMethodName,
  type SavedTaskView,
  type TaskSpecSummary,
  type TaskStatus,
  type TasksListParams,
  type TasksListResult,
  type TasksGetParams,
  type TasksGetResult,
  type TasksGetArtifactParams,
  type TasksGetArtifactResult,
  type TasksCreateParams,
  type TasksCreateResult,
  type TasksUpdateStatusParams,
  type TasksUpdateStatusResult,
  type TasksUpdateMetadataParams,
  type TasksUpdateMetadataResult,
  type TasksBulkResultItem,
  type TasksBulkUpdateStatusParams,
  type TasksBulkUpdateStatusResult,
  type TasksBulkLabelMode,
  type TasksBulkUpdateLabelParams,
  type TasksBulkUpdateLabelResult,
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
  TasksGetArtifactParamsSchema,
  TasksCreateParamsSchema,
  TasksUpdateStatusParamsSchema,
  TasksUpdateMetadataParamsSchema,
  TasksBulkUpdateStatusParamsSchema,
  TasksBulkUpdateLabelParamsSchema,
  TasksGenerateRegistryParamsSchema,
  TasksBoardParamsSchema,
  TasksReindexParamsSchema,
  TasksAdoptParamsSchema,
  TasksDoctorPlanParamsSchema,
  TasksGetViewsParamsSchema,
  TasksSaveViewsParamsSchema,
} from './tasks-rpc.schema';
import { isAuthorizedWorkspace } from '../utils/workspace-authorization';

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

/**
 * Collapse a bulk request's ids to one entry per TASK, in first-requested
 * order, keeping each id exactly as the caller sent it.
 *
 * ## Why the key is case-folded and the value is not
 *
 * A task id IS a folder name, and this project's primary platform has a
 * case-insensitive filesystem: `TASK_2026_100` and `task_2026_100` name the
 * SAME `task.md`. Deduplicating on exact string identity lets both survive, and
 * both then write to that one file.
 *
 * The consequence is NOT a manufactured `TASK_CONFLICT` — that was the expected
 * failure and the mutation disproved it. `applyFrontmatterPatch` compares
 * `current` against that call's OWN snapshot, and the duplicate runs after the
 * first write completed, so it snapshots the updated file and its re-read
 * agrees. What actually happens is quieter: the caller receives TWO result
 * entries for ONE task, which FR-C4.3 forbids, and the carrier is rewritten a
 * second time purely to refresh `updated` — on a gitignored file with no undo.
 * The client's write serialization cannot prevent either, because from its view
 * these are two different tasks.
 *
 * The value keeps the caller's original casing so results still match what was
 * asked for; only the identity TEST is case-folded. `toLowerCase` rather than
 * `toLocaleLowerCase`: this is a filesystem identity question, not a
 * presentation one, and a locale-sensitive fold would make the answer depend on
 * the host's locale (the Turkish dotless-i being the standing example).
 *
 * This is not a claim that every filesystem is case-insensitive — on a
 * case-sensitive one the two really are different folders, and folding merges
 * them. That direction is accepted: the caller is told about the first casing
 * it named instead of both, which is a visible under-report rather than a
 * silent double write, and no producer in this codebase can emit a cased
 * duplicate anyway — ids come from the folder scan.
 */
function dedupeTaskIds(taskIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const taskId of taskIds) {
    const key = taskId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(taskId);
  }
  return unique;
}

/**
 * The next `labels` array after adding or removing one label.
 *
 * ## The case-sensitivity rule, stated once and used by BOTH directions
 *
 * Labels MATCH through the shared {@link labelKey} — `trim().toLowerCase()` —
 * and are STORED as the author typed them. That is the rule the whole feature
 * already runs on: `TaskSpecSummary.labels` documents it, `buildTaskGraph`
 * folds the completion union by it, and the chip colour hashes it, so
 * `Licensing` and `licensing ` are one label everywhere a user can see.
 *
 * Both halves of this function use that one key, which is what makes the pair
 * coherent: `add` treats a task carrying `Licensing` as already carrying
 * `licensing` and does nothing, and `remove` of `licensing` drops `Licensing`.
 * Splitting them — an exact-match presence test with a folded removal, or the
 * reverse — is how "add then remove" stops being a round trip: the add would
 * plant a second casing the remove then takes both of, or the remove would miss
 * the very label the add refused to duplicate.
 *
 * `add` appends the caller's text at the END, preserving existing order.
 * `remove` drops EVERY case-insensitive match, so a carrier hand-authored with
 * both `Licensing` and `licensing` is cleaned in one pass rather than needing
 * two calls that each look like a no-op to the user.
 */
function nextLabels(
  current: readonly string[],
  label: string,
  mode: TasksBulkLabelMode,
): string[] {
  const key = labelKey(label);
  if (mode === 'remove') {
    return current.filter((existing) => labelKey(existing) !== key);
  }
  return current.some((existing) => labelKey(existing) === key)
    ? [...current]
    : [...current, label];
}

@injectable()
export class TasksRpcHandlers {
  /** RPC methods owned by this handler (SHARED_HANDLERS coverage invariant). */
  static readonly METHODS = [
    'tasks:list',
    'tasks:get',
    'tasks:getArtifact',
    'tasks:create',
    'tasks:updateStatus',
    'tasks:updateMetadata',
    'tasks:bulkUpdateStatus',
    'tasks:bulkUpdateLabel',
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
    this.registerGetArtifact();
    this.registerCreate();
    this.registerUpdateStatus();
    this.registerUpdateMetadata();
    this.registerBulkUpdateStatus();
    this.registerBulkUpdateLabel();
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

  /**
   * Read ONE workflow document out of a task folder, for in-place rendering.
   *
   * A missing document is `content: null` and a SUCCESS — most tasks carry a
   * handful of the fifteen recognised documents, and one that has not been
   * planned yet simply has no `implementation-plan.md`. Reporting that as an
   * error would make the ordinary case look like a fault.
   *
   * The requested name is echoed in the result so a slow response cannot be
   * rendered under whichever tab the user has since switched to.
   */
  private registerGetArtifact(): void {
    this.rpcHandler.registerMethod<
      TasksGetArtifactParams,
      TasksGetArtifactResult
    >('tasks:getArtifact', async (params) => {
      const parsed = this.parse(TasksGetArtifactParamsSchema, params);
      const root = this.resolveRoot(parsed.workspaceRoot);
      try {
        await this.index.ensureStarted(root);
        const content = await this.index.readArtifact(
          root,
          parsed.taskId,
          parsed.file,
        );
        return { file: parsed.file, content };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'tasks:getArtifact',
          'Failed to read task document.',
        );
      }
    });
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
            status: parsed.status,
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
          // Forwarded only when the caller stated it. Absent means "no
          // precondition", which is the right answer for every patch that does
          // not replace `labels`: gating a status move on the label array would
          // refuse a write the user asked for because somebody else labelled
          // the task.
          parsed.expectLabels === undefined
            ? undefined
            : { expectLabels: parsed.expectLabels },
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

  /**
   * `tasks:bulkUpdateStatus` — move a set of tasks to one status (FR-C4).
   *
   * ## Partial failure is the EXPECTED outcome, not an error path
   *
   * There is no transaction across N carrier files, and this method does not
   * pretend otherwise. It is N independent read → compare → write cycles
   * through the SAME single-task funnel `tasks:updateStatus` uses, against
   * files a live agent may be editing while the loop runs. Every requested id
   * gets exactly one result entry (FR-C4.3) describing what happened to THAT
   * task, and the loop never aborts early: one task's conflict says nothing
   * about the next task's, so stopping would refuse writes the user asked for
   * on the strength of an unrelated failure.
   *
   * There is deliberately no top-level success flag (D5). The entries are the
   * answer.
   *
   * ## Once a write has landed, this method stops being able to fail
   *
   * Only `ensureStarted` can make it throw, and that runs before the first
   * write, when "nothing happened" is still true. From the loop onward every
   * failure — typed or unexpected — becomes an ENTRY, because an exception
   * raised after three of five carriers changed would discard the three
   * `ok: true` facts the caller needs in order to retry only what failed. See
   * {@link applyBulkStatus}.
   *
   * ## One index rebuild for the whole call (R5 / FR-C4.10)
   *
   * Each write passes `deferNotify: true`, which suppresses the funnel's
   * per-write index notification. Without it, N writes would cause N full
   * `.ptah/specs` rescans (~180 folders each) and N `tasks:changed`
   * broadcasts. The single `applyFolderChange` in the `finally` pays that cost
   * once.
   *
   * It is in a `finally` rather than after the loop so that an unexpected throw
   * mid-loop still rebuilds the index over the writes that already landed —
   * those writes are on disk and are not reversed, so an index that does not
   * know about them is simply wrong.
   */
  private registerBulkUpdateStatus(): void {
    this.rpcHandler.registerMethod<
      TasksBulkUpdateStatusParams,
      TasksBulkUpdateStatusResult
    >('tasks:bulkUpdateStatus', async (params) => {
      const parsed = this.parse(TasksBulkUpdateStatusParamsSchema, params);
      const root = this.resolveRoot(parsed.workspaceRoot);
      const taskIds = dedupeTaskIds(parsed.taskIds);

      // Failing here means NOTHING was written, so throwing is the honest
      // answer — there is no partial outcome to report yet. Every failure from
      // this point on becomes a result ENTRY instead, because from the first
      // write onward an exception would be discarding facts about disk.
      try {
        await this.index.ensureStarted(root);
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'tasks:bulkUpdateStatus',
          'Failed to update task statuses.',
        );
      }

      const results: TasksBulkResultItem[] = [];
      /** Folders whose bytes actually changed — drives the single rebuild. */
      const written: string[] = [];

      try {
        for (const taskId of taskIds) {
          results.push(
            await this.applyBulkStatus(root, taskId, parsed.status, written),
          );
        }

        return { results };
      } finally {
        // Exactly one rebuild + one `tasks:changed` push per call, and none at
        // all when nothing was written — an empty rebuild is a full rescan
        // bought for no change.
        if (written.length > 0) {
          await this.rebuildAfterBulk(root, written[0]);
        }
      }
    });
  }

  /**
   * One task's write inside a bulk loop. **This method does not throw.**
   *
   * That is its entire reason for existing. Once any write in the loop has
   * landed, an escaping exception would replace a result list that records
   * which carriers changed with an error that records nothing — and those
   * writes are on disk and are not reversed. A caller told "the call failed"
   * after three of five succeeded has no way to distinguish that from "nothing
   * happened", so its only safe move is to retry all five, and retrying a write
   * that already landed is how a bulk operation manufactures the very conflicts
   * this batch exists to report accurately.
   *
   * The typed failures the writer RETURNS are already handled below; this
   * catches the ones it THROWS, which are by definition the unexpected ones.
   * They are sanitized exactly as a single-task method's would be — the raw
   * error (which carries absolute paths) is logged server-side only (R4.4).
   *
   * @param written appended to when this task's bytes actually changed.
   */
  private async applyBulkStatus(
    root: string,
    taskId: string,
    status: TaskStatus,
    written: string[],
  ): Promise<TasksBulkResultItem> {
    try {
      const result = await this.writer.updateMetadata(
        root,
        taskId,
        { status },
        { deferNotify: true },
      );

      if (result.success) {
        written.push(taskId);
        return { taskId, ok: true };
      }

      return {
        taskId,
        ok: false,
        error: result.error,
        // FR-C4.7 — enrich ONLY a conflict. Every other code already says
        // everything there is to say; a conflict alone leaves the user asking
        // "changed to what?", and that question has an answer.
        ...(result.error.code === 'TASK_CONFLICT'
          ? await this.readCurrentStatus(root, taskId)
          : {}),
      };
    } catch (error: unknown) {
      const sanitized = this.sanitize(
        error,
        'tasks:bulkUpdateStatus',
        `Failed to update '${taskId}'.`,
      );
      // `WRITE_FAILED` because that is what the caller can act on: it is not a
      // conflict (nothing is known to have changed underneath us) and not a
      // missing task. Whether the carrier was written before the throw is
      // genuinely unknown here, which is precisely why the OTHER entries must
      // survive — they are the ones the caller can still trust.
      return {
        taskId,
        ok: false,
        error: { code: 'WRITE_FAILED', message: sanitized.message },
      };
    }
  }

  /**
   * `tasks:bulkUpdateLabel` — add or remove ONE label across a set (FR-C5).
   *
   * Structurally identical to {@link registerBulkUpdateStatus}, and
   * deliberately so: dedupe first, `ensureStarted` is the only thing allowed to
   * throw (nothing is written yet), every failure from the loop onward becomes
   * a result ENTRY, every write carries `deferNotify: true`, and exactly one
   * index rebuild happens in a `finally` — and none at all when nothing was
   * written.
   *
   * The one behaviour this method has that the status method does not is
   * {@link TasksBulkResultItem.noop}. It can afford it because its write is a
   * read-modify-write anyway (see {@link applyBulkLabel}); the status path
   * cannot, and does not.
   */
  private registerBulkUpdateLabel(): void {
    this.rpcHandler.registerMethod<
      TasksBulkUpdateLabelParams,
      TasksBulkUpdateLabelResult
    >('tasks:bulkUpdateLabel', async (params) => {
      const parsed = this.parse(TasksBulkUpdateLabelParamsSchema, params);
      const root = this.resolveRoot(parsed.workspaceRoot);
      const taskIds = dedupeTaskIds(parsed.taskIds);

      // The three label rules live in `LabelSchema` and are applied HERE, not
      // in the request schema, so that their refusal can be reported the way
      // every other refusal in this method is: one entry per task, carrying
      // Zod's own sentence and INVALID_PARAMS. At the request schema they
      // reached the caller as `parse`'s single generic
      // "Invalid task request parameters." throw, which `callBulkChunk` on the
      // board expands into a WRITE_FAILED entry per task — telling a user who
      // typed a 40-character label that twelve carriers had failed to write,
      // and never that the label was too long. Only the ≤12-per-task limit
      // behaved correctly, because it is enforced in `applyBulkLabel` where a
      // result list exists to put it in.
      //
      // Before `ensureStarted`, so a refusal starts no watcher and writes
      // nothing. The merged array is still validated by
      // `TaskMetadataPatchSchema` on the way to the funnel; this is the earlier
      // and more specific of the two, not a replacement for it.
      const label = LabelSchema.safeParse(parsed.label);
      if (!label.success) {
        return {
          results: taskIds.map((taskId) => ({
            taskId,
            ok: false,
            error: {
              code: 'INVALID_PARAMS' as const,
              message:
                label.error.issues[0]?.message ?? 'That label is not valid.',
            },
          })),
        };
      }

      // Nothing has been written yet, so throwing is the honest answer here and
      // nowhere after it.
      try {
        await this.index.ensureStarted(root);
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'tasks:bulkUpdateLabel',
          'Failed to update task labels.',
        );
      }

      const results: TasksBulkResultItem[] = [];
      /** Folders whose bytes actually changed — drives the single rebuild. */
      const written: string[] = [];

      try {
        for (const taskId of taskIds) {
          results.push(
            await this.applyBulkLabel(
              root,
              taskId,
              label.data,
              parsed.mode,
              written,
            ),
          );
        }

        return { results };
      } finally {
        // A no-op run writes nothing, so it must also rebuild nothing — an
        // empty rebuild is a full rescan of every folder bought for no change.
        if (written.length > 0) {
          await this.rebuildAfterBulk(root, written[0]);
        }
      }
    });
  }

  /**
   * One task's label change inside a bulk loop. **This method does not throw**,
   * for exactly the reasons {@link applyBulkStatus} does not.
   *
   * ## Why this one reads before it writes, and the status path does not
   *
   * `labels` is a FULL REPLACEMENT on the write funnel. "Add `licensing`"
   * therefore cannot be expressed as a patch without first knowing the array
   * being added to, so the pre-read is forced by the write shape rather than
   * chosen. Two things follow from having it:
   *
   *  - the no-op case becomes decidable (step 3), which is what finally gives
   *    `TasksBulkResultItem.noop` a producer; and
   *  - the read is STALE by construction, which is what `expectLabels` on the
   *    writer exists to catch. Without it, a third party changing this task's
   *    labels between our read and the writer's read would have their change
   *    silently overwritten by our full-replacement array.
   *
   * ## `currentStatus` is deliberately NOT set here
   *
   * `applyBulkStatus` enriches a conflict with the status now on disk because
   * the user asked to change the STATUS and "changed to what?" has an answer
   * they can act on. This method's user asked about labels; reporting a status
   * they neither sent nor asked about answers a question nobody posed, and the
   * field is typed and documented as the STATUS the carrier holds, so
   * repurposing it would make it mean two things. The board reloads on
   * conflict and shows the real labels anyway.
   *
   * @param written appended to when this task's bytes actually changed.
   */
  private async applyBulkLabel(
    root: string,
    taskId: string,
    label: string,
    mode: TasksBulkLabelMode,
    written: string[],
  ): Promise<TasksBulkResultItem> {
    try {
      const detail = await this.index.getDetail(root, taskId);

      // `getDetail` collapses THREE situations into `null`: no carrier, a
      // carrier that no longer parses, and a read that failed outright. The
      // writer distinguishes the first two (`TASK_NOT_FOUND` vs
      // `TASK_EXCLUDED`) and refuses without writing in every one of them, so
      // the accurate answer is to let it say which — guessing `TASK_NOT_FOUND`
      // here would tell a user their broken task does not exist.
      //
      // `expectLabels: []` is what makes delegating safe rather than a hole: if
      // the carrier raced into existence between the read above and the
      // writer's own read, a labelled one is refused as a conflict instead of
      // being overwritten by this probe.
      if (!detail) {
        return this.toBulkEntry(
          taskId,
          await this.writer.updateMetadata(
            root,
            taskId,
            { labels: mode === 'add' ? [label] : [] },
            { deferNotify: true, expectLabels: [] },
          ),
          written,
        );
      }

      const current = detail.labels;
      const next = nextLabels(current, label, mode);

      // `next` is `current` plus one element, or `current` minus zero or more,
      // so equal lengths means nothing changed. Reported as a SUCCESS that
      // issued no write: the task already carries the state the caller asked
      // for, and rewriting it would refresh `updated` on a gitignored file to
      // record a change that did not happen.
      if (next.length === current.length) {
        return { taskId, ok: true, noop: true };
      }

      // The MERGED array is validated by the one definition of the label
      // limits. `MAX_LABELS_PER_TASK` constrains what a task ends up carrying,
      // which is knowable only here — the request schema saw one label and had
      // nothing to count. Restating the cap in this file would be the second
      // enforcer of one number that the request schema already refuses to be.
      const validated = TaskMetadataPatchSchema.safeParse({ labels: next });
      if (!validated.success) {
        return {
          taskId,
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            // Zod's own message, so the limit is NAMED once, where it is
            // defined. A generic "invalid parameters" would leave a user who
            // just hit the twelfth label with nothing to act on.
            message:
              validated.error.issues[0]?.message ??
              'The resulting labels are invalid.',
          },
        };
      }

      return this.toBulkEntry(
        taskId,
        await this.writer.updateMetadata(
          root,
          taskId,
          { labels: next },
          { deferNotify: true, expectLabels: current },
        ),
        written,
      );
    } catch (error: unknown) {
      const sanitized = this.sanitize(
        error,
        'tasks:bulkUpdateLabel',
        `Failed to update '${taskId}'.`,
      );
      return {
        taskId,
        ok: false,
        error: { code: 'WRITE_FAILED', message: sanitized.message },
      };
    }
  }

  /**
   * Project a write-funnel result onto its bulk entry, recording the write.
   *
   * `written` is appended to ONLY on success, which is what keeps the single
   * post-bulk rebuild honest: a run of pure refusals — or pure no-ops — leaves
   * it empty and buys no rescan at all.
   */
  private toBulkEntry(
    taskId: string,
    result: UpdateMetadataResult,
    written: string[],
  ): TasksBulkResultItem {
    if (result.success) {
      written.push(taskId);
      return { taskId, ok: true };
    }
    return { taskId, ok: false, error: result.error };
  }

  /**
   * The single post-bulk index rebuild.
   *
   * ## Why one folder name is not an under-report of the rebuild
   *
   * `TaskIndexService.applyFolderChange` performs a FULL workspace scan and
   * replaces the whole index in one transaction — `folderNames` is carried
   * into the emitted `tasks:changed` payload as a hint and does not scope the
   * scan. So every task this call wrote is reindexed regardless of which name
   * is passed. The push payload does narrow to one name; no consumer reads it
   * (the board reloads wholesale), and widening the notifier port to carry a
   * list would be a change to the write-order seam bought for a field nothing
   * reads.
   *
   * ## Why failures here are swallowed
   *
   * The writes have already landed. Letting a rebuild failure throw would
   * replace a complete per-task result list with an exception, leaving the
   * caller unable to tell which of its tasks were written — the one outcome
   * worse than a stale index, which the next scan corrects anyway. This mirrors
   * `TaskWriterService.notify`, which swallows for the same reason.
   */
  private async rebuildAfterBulk(
    root: string,
    folderName: string,
  ): Promise<void> {
    try {
      await this.index.applyFolderChange(root, folderName);
    } catch (error: unknown) {
      this.logger.warn('[TasksRpc] bulk index rebuild failed', {
        folderName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Re-read a carrier from disk after a refused write and report the status it
   * actually holds now (FR-C4.7).
   *
   * Read AFTER the refusal, so it reflects what the other writer left rather
   * than the snapshot our own write was computed from. `getDetail` is the
   * existing disk read — it opens the carrier and runs it through
   * `parseTaskFile` — so this adds no second notion of where a carrier lives
   * or how it is parsed.
   *
   * Returns an empty object when the carrier cannot be read or no longer
   * parses (the other writer may have left it mid-edit, or removed it). The
   * conflict itself is still reported; only the enrichment is missing, and an
   * absent `currentStatus` is honest where a guessed one would not be.
   */
  private async readCurrentStatus(
    root: string,
    taskId: string,
  ): Promise<{ currentStatus?: TaskStatus }> {
    const detail = await this.index.getDetail(root, taskId);
    return detail ? { currentStatus: detail.status } : {};
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
   *
   * ## The namespace-wide workspace guard
   *
   * EVERY `tasks:*` method routes its root through here, so this one check is
   * the whole namespace's boundary. That is deliberate: the reachable
   * primitives are privileged in three different ways and a per-method guard
   * would have to be remembered fourteen times.
   *
   *   - `index.ensureStarted(root)` starts a recursive file watcher on the root
   *     and can create `<root>/.ptah/specs/README.md`.
   *   - `writer.updateStatus` / `updateMetadata` / `adopt` rewrite the
   *     frontmatter of existing `<root>/.ptah/specs/TASK_YYYY_NNN/task.md`, and
   *     `bulkUpdateLabel` does so up to `BULK_CHUNK_SIZE` times per call.
   *   - `tasks:board` / `tasks:get` READ an arbitrary directory's specs tree
   *     and return its contents to the caller.
   *
   * Only a caller-SUPPLIED root is checked. The implicit
   * `workspace.getWorkspaceRoot()` fallback is authorized by construction —
   * it IS the open folder — and gating it would fail closed on any host whose
   * provider reports a root without enumerating folders. This is the same
   * shape `SetupRpcHandlers` and `MemoryRpcHandlers` use.
   *
   * Note that `isAuthorizedWorkspace` admits paths INSIDE an open folder, not
   * just the folder itself, so `<workspace>/sub` resolves to a specs tree under
   * `<workspace>/sub`. That stays within the trust boundary the host already
   * granted and keeps this check identical to every other one in the lib.
   */
  private resolveRoot(requested: string | undefined): string {
    const root = requested ?? this.workspace.getWorkspaceRoot();
    if (!root) {
      throw new RpcUserError('No workspace folder open.', 'WORKSPACE_NOT_OPEN');
    }
    if (
      requested !== undefined &&
      !isAuthorizedWorkspace(requested, this.workspace)
    ) {
      throw new RpcUserError(
        'Access denied: workspace path is not an open folder.',
        'UNAUTHORIZED_WORKSPACE',
      );
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
