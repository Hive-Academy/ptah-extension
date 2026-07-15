import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ClaudeRpcService, type MessageHandler } from '@ptah-extension/core';
import {
  TASK_STATUSES,
  type TaskSpecDetail,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
  type TasksBoardResult,
  type TasksCreateParams,
  type TasksCreateResult,
} from '@ptah-extension/shared';

/**
 * Raw webview message type broadcast by the backend `TasksRpcHandlers` whenever
 * the on-disk `.ptah/specs` index changes (write / watcher / reindex). Dispatched
 * by `MessageRouterService` purely by type string — mirrors `git:worktreeChanged`.
 */
export const TASKS_CHANGED_MESSAGE_TYPE = 'tasks:changed';

/** One rendered board column: a status plus the tasks currently in it. */
export interface TaskBoardColumn {
  status: TaskStatus;
  tasks: TaskSpecSummary[];
}

/** Empty six-key column map — every status key is always present (R4). */
function emptyColumns(): Record<TaskStatus, TaskSpecSummary[]> {
  return TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
}

/**
 * TasksStore
 *
 * Root-provided signal store for the standalone Tasks board. All data flows
 * through {@link ClaudeRpcService} (`tasks:*`); there is NO optimistic local
 * mutation (R5.7) — status changes and creates re-fetch the authoritative board
 * from the backend, and the `tasks:changed` push (handled here as a
 * {@link MessageHandler}) refreshes the board whenever the file index moves.
 */
@Injectable({ providedIn: 'root' })
export class TasksStore implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);

  /** Consumed by `MessageRouterService` — refresh on backend index changes. */
  public readonly handledMessageTypes = [TASKS_CHANGED_MESSAGE_TYPE] as const;

  private readonly _columns =
    signal<Record<TaskStatus, TaskSpecSummary[]>>(emptyColumns());
  private readonly _excludedCount = signal(0);
  private readonly _specsDirExists = signal(true);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _busy = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionMessage = signal<string | null>(null);
  private readonly _selectedTaskId = signal<string | null>(null);
  private readonly _taskDetail = signal<TaskSpecDetail | null>(null);
  private readonly _detailLoading = signal(false);

  /** Board columns keyed by status (all six keys always present). */
  public readonly columns = this._columns.asReadonly();
  public readonly excludedCount = this._excludedCount.asReadonly();
  public readonly specsDirExists = this._specsDirExists.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly busy = this._busy.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly actionMessage = this._actionMessage.asReadonly();
  public readonly selectedTaskId = this._selectedTaskId.asReadonly();
  public readonly taskDetail = this._taskDetail.asReadonly();
  public readonly detailLoading = this._detailLoading.asReadonly();

  /** Ordered board columns (canonical `TASK_STATUSES` / B1 order). */
  public readonly board = computed<TaskBoardColumn[]>(() => {
    const columns = this._columns();
    return TASK_STATUSES.map((status) => ({
      status,
      tasks: columns[status],
    }));
  });

  /** Total number of included (board-visible) tasks. */
  public readonly totalCount = computed(() =>
    TASK_STATUSES.reduce(
      (sum, status) => sum + this._columns()[status].length,
      0,
    ),
  );

  /**
   * True when there is nothing to show: either no `.ptah/specs` directory yet,
   * or the directory exists but holds zero valid tasks. Only meaningful once a
   * board load has completed at least once.
   */
  public readonly isEmpty = computed(
    () =>
      this._loaded() && (!this._specsDirExists() || this.totalCount() === 0),
  );

  public constructor() {
    this.setupVisibilityReconcile();
  }

  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== TASKS_CHANGED_MESSAGE_TYPE) return;
    void this.refreshFromPush();
  }

  /** Load (or reload) the full board in one `tasks:board` round trip. */
  public async loadBoard(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const result = await this.rpc.call('tasks:board', {});
      if (result.isSuccess() && result.data) {
        this.applyBoard(result.data);
      } else {
        this._error.set(result.error ?? 'Failed to load tasks');
      }
    } finally {
      this._loading.set(false);
      this._loaded.set(true);
    }
  }

  /** Fetch and select a single task's detail (frontmatter + markdown body). */
  public async openTask(taskId: string): Promise<void> {
    this._selectedTaskId.set(taskId);
    this._detailLoading.set(true);
    try {
      const result = await this.rpc.call('tasks:get', { taskId });
      if (result.isSuccess() && result.data) {
        this._taskDetail.set(result.data.task);
      } else {
        this._taskDetail.set(null);
        this._error.set(result.error ?? 'Failed to load task detail');
      }
    } finally {
      this._detailLoading.set(false);
    }
  }

  /** Clear the selected task / detail panel. */
  public closeTask(): void {
    this._selectedTaskId.set(null);
    this._taskDetail.set(null);
  }

  /**
   * Move a task to a new status. No optimistic transition (R5.7): the card only
   * moves once the authoritative board re-fetch (or the `tasks:changed` push)
   * lands.
   */
  public async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    this._error.set(null);
    const result = await this.rpc.call('tasks:updateStatus', {
      taskId,
      status,
    });
    if (result.isSuccess() && result.data?.success) {
      await this.loadBoard();
      if (this._selectedTaskId() === taskId && result.data.task) {
        // Refresh the open detail with the authoritative row (not a guess).
        await this.openTask(taskId);
      }
    } else {
      this._error.set(
        result.data?.error?.message ??
          result.error ??
          'Failed to update task status',
      );
    }
  }

  /** Create a new task folder + `task.md`, then reload the board. */
  public async createTask(
    input: Omit<TasksCreateParams, 'workspaceRoot'>,
  ): Promise<TasksCreateResult | null> {
    this._error.set(null);
    const result = await this.rpc.call('tasks:create', input);
    if (result.isSuccess() && result.data) {
      if (result.data.success) {
        await this.loadBoard();
      } else {
        this._error.set(result.data.error?.message ?? 'Failed to create task');
      }
      return result.data;
    }
    this._error.set(result.error ?? 'Failed to create task');
    return null;
  }

  /** Full backend reindex of `.ptah/specs`, then reload the board. */
  public async reindex(): Promise<void> {
    this._busy.set(true);
    this._error.set(null);
    this._actionMessage.set(null);
    try {
      const result = await this.rpc.call('tasks:reindex', {});
      if (result.isSuccess() && result.data?.success) {
        this._actionMessage.set(
          `Reindexed ${result.data.indexedCount} task(s) in ${result.data.durationMs}ms`,
        );
        await this.loadBoard();
      } else {
        this._error.set(result.error ?? 'Failed to reindex tasks');
      }
    } finally {
      this._busy.set(false);
    }
  }

  /** Regenerate `.ptah/specs/registry.md` from current frontmatter. */
  public async generateRegistry(): Promise<void> {
    this._busy.set(true);
    this._error.set(null);
    this._actionMessage.set(null);
    try {
      const result = await this.rpc.call('tasks:generateRegistry', {});
      if (result.isSuccess() && result.data?.success) {
        this._actionMessage.set(
          `Registry generated — ${result.data.includedCount} listed, ${result.data.excludedCount} excluded`,
        );
      } else {
        this._error.set(result.error ?? 'Failed to generate registry');
      }
    } finally {
      this._busy.set(false);
    }
  }

  /** Dismiss the transient action banner. */
  public clearActionMessage(): void {
    this._actionMessage.set(null);
  }

  /** Convenience filter used by the New Task form's type picker. */
  public isKnownType(value: string): value is TaskType {
    return (
      value === 'FEATURE' ||
      value === 'BUGFIX' ||
      value === 'REFACTORING' ||
      value === 'DOCUMENTATION' ||
      value === 'RESEARCH' ||
      value === 'DEVOPS' ||
      value === 'SAAS_INIT' ||
      value === 'CREATIVE'
    );
  }

  /**
   * Client-side staleness safety net (no optimistic state — R5.7). If a
   * `tasks:changed` push is missed while the webview is backgrounded, the board
   * could sit stale indefinitely. Re-fetch the authoritative board whenever the
   * surface regains visibility/focus. Guarded so it never stacks or fires before
   * the first load, and no-op-safe: an in-flight `loadBoard` (`_loading`) short-
   * circuits re-entry, so back-to-back `focus` + `visibilitychange` collapse to
   * one refetch. Listeners are torn down with the root injector.
   */
  private setupVisibilityReconcile(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const reconcile = (): void => {
      // Only refetch when actually visible, after an initial load, and when no
      // load is already in flight — the guard doubles as the debounce.
      if (document.visibilityState === 'hidden') return;
      if (!this._loaded() || this._loading()) return;
      void this.loadBoard();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') reconcile();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', reconcile);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', reconcile);
    });
  }

  private async refreshFromPush(): Promise<void> {
    await this.loadBoard();
    const selected = this._selectedTaskId();
    if (selected) {
      await this.openTask(selected);
    }
  }

  private applyBoard(data: TasksBoardResult): void {
    // Defensive: guarantee all six keys exist even if a host under-populates.
    const normalized = emptyColumns();
    for (const status of TASK_STATUSES) {
      normalized[status] = data.columns[status] ?? [];
    }
    this._columns.set(normalized);
    this._excludedCount.set(data.excludedCount);
    this._specsDirExists.set(data.specsDirExists);
  }
}
