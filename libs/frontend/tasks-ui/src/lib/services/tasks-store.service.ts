import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  type MessageHandler,
} from '@ptah-extension/core';
import {
  TASK_STATUSES,
  type TaskSpecDetail,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
  type TasksBoardResult,
  type TasksChangedNotification,
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

/**
 * Cached, per-workspace board snapshot. The store keeps one of these per
 * workspace key so a workspace switch can paint the last-known board instantly
 * (stale-while-revalidate) instead of flashing empty while the refetch lands.
 */
interface BoardSlice {
  columns: Record<TaskStatus, TaskSpecSummary[]>;
  excludedCount: number;
  specsDirExists: boolean;
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
 * Browser-safe workspace-root key used ONLY for cache lookups and for matching
 * the active workspace against a `tasks:changed` push root. Mirrors the intent
 * of the backend `normalizeWorkspaceRoot` (which we cannot import — it lives in
 * a backend lib and pulls in node `path`) without needing Node:
 *
 *  - unify `\` / `/` separators to `/` (the push root is `path.resolve`d, so it
 *    is back-slashed on Windows; `workspaceInfo().path` may use either),
 *  - strip a trailing separator,
 *  - lower-case a leading Windows drive letter (`D:` and `d:` are one root).
 *
 * Both roots are already absolute, so we skip resolution. This is a comparison
 * key only — the raw `workspaceInfo().path` is still sent as the RPC param (the
 * backend re-normalizes it on receipt). The empty string is the "no workspace"
 * key (RPC falls back to the backend's active workspace).
 */
function normalizeRootKey(root: string): string {
  return root
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .replace(/^([a-zA-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`);
}

/**
 * TasksStore
 *
 * Root-provided signal store for the standalone Tasks board. All data flows
 * through {@link ClaudeRpcService} (`tasks:*`); there is NO optimistic local
 * mutation (R5.7) — status changes and creates re-fetch the authoritative board
 * from the backend, and the `tasks:changed` push (handled here as a
 * {@link MessageHandler}) refreshes the board whenever the file index moves.
 *
 * Workspace-aware (TASK follow-up): the Electron shell keeps this page mounted
 * across workspace switches. Every `tasks:*` call carries the active workspace
 * root, a constructor {@link effect} reloads the board when the active workspace
 * changes, and a per-workspace {@link boardCache} paints the target board
 * instantly on switch (stale-while-revalidate). A slow response is stamped with
 * the workspace it was issued for so it can never overwrite a board the user has
 * since switched away from.
 */
@Injectable({ providedIn: 'root' })
export class TasksStore implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
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

  /**
   * Last-known board per workspace, keyed by {@link normalizeRootKey}. Used to
   * repaint the target board instantly on switch and to update background
   * workspaces from `tasks:changed` pushes without touching the visible board.
   */
  private readonly boardCache = new Map<string, BoardSlice>();

  /**
   * Workspace key the switch effect last observed. `undefined` means "no
   * emission seen yet" — the first observation only records the value so the
   * effect's initial run doesn't duplicate the component's initial `loadBoard()`.
   */
  private lastWorkspaceKey: string | undefined;

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

  /** Per-status task counts (all six keys always present). */
  public readonly statusCounts = computed<Record<TaskStatus, number>>(() => {
    const columns = this._columns();
    return TASK_STATUSES.reduce(
      (acc, status) => {
        acc[status] = columns[status].length;
        return acc;
      },
      {} as Record<TaskStatus, number>,
    );
  });

  /** Count of completed (done) tasks — surfaced in the header summary. */
  public readonly doneCount = computed(() => this._columns().done.length);

  /** Count of actively-worked tasks (in progress + in review). */
  public readonly activeCount = computed(
    () => this._columns().in_progress.length + this._columns().in_review.length,
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
    this.setupWorkspaceSwitch();
  }

  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== TASKS_CHANGED_MESSAGE_TYPE) return;

    const payload = message.payload as TasksChangedNotification | undefined;
    const changedRoot = payload?.workspaceRoot;

    // No root in the push → refresh the active workspace only (best effort).
    if (changedRoot === undefined || changedRoot === '') {
      void this.refreshActiveFromPush();
      return;
    }

    const changedKey = normalizeRootKey(changedRoot);
    if (changedKey === this.activeKey()) {
      void this.refreshActiveFromPush();
    } else if (this.boardCache.has(changedKey)) {
      // A background (visited-but-not-visible) workspace changed on disk —
      // silently refresh just its cached slice so a later switch-back is fresh.
      void this.fetchBoard(changedKey, changedRoot);
    }
  }

  /**
   * Load (or reload) the full board for the active workspace in one
   * `tasks:board` round trip. Shows the loading flag while the request is in
   * flight (explicit reload path — the switch/push paths refresh silently).
   */
  public async loadBoard(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    await this.fetchBoard(this.activeKey(), this.activeRoot());
  }

  /** Fetch and select a single task's detail (frontmatter + markdown body). */
  public async openTask(taskId: string): Promise<void> {
    this._selectedTaskId.set(taskId);
    this._detailLoading.set(true);
    try {
      const result = await this.rpc.call('tasks:get', {
        taskId,
        ...this.workspaceParam(),
      });
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
   * Open one of the currently-selected task's artifact files in the host editor
   * (`file:open`). The absolute path is composed here from the webview's known
   * workspace root plus the task folder — the backend never leaks abs paths
   * (R4.4), and the filename is validated against the detail's artifact list to
   * rule out traversal before it reaches the host.
   */
  public async openArtifact(file: string): Promise<void> {
    const detail = this._taskDetail();
    if (!detail || !detail.artifacts.includes(file)) return;

    const root = this.appState.workspaceInfo()?.path;
    if (!root) {
      this._error.set('Cannot open file — no workspace root is available.');
      return;
    }

    const base = root.replace(/[\\/]+$/, '');
    const absPath = `${base}/.ptah/specs/${detail.folderName}/${file}`;
    const result = await this.rpc.openFile(absPath);
    if (!(result.isSuccess() && result.data?.success)) {
      this._error.set(
        result.data?.error ?? result.error ?? `Failed to open ${file}`,
      );
    }
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
      ...this.workspaceParam(),
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
    const result = await this.rpc.call('tasks:create', {
      ...input,
      ...this.workspaceParam(),
    });
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
      const result = await this.rpc.call(
        'tasks:reindex',
        this.workspaceParam(),
      );
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
      const result = await this.rpc.call(
        'tasks:generateRegistry',
        this.workspaceParam(),
      );
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

  /** Active workspace root sent as the `tasks:*` RPC param (undefined = none). */
  private activeRoot(): string | undefined {
    return this.appState.workspaceInfo()?.path ?? undefined;
  }

  /** Cache/comparison key for the active workspace (`''` when none). */
  private activeKey(): string {
    const root = this.appState.workspaceInfo()?.path;
    return root ? normalizeRootKey(root) : '';
  }

  /** `{ workspaceRoot }` spread for `tasks:*` params, omitted when no workspace. */
  private workspaceParam(): { workspaceRoot?: string } {
    const root = this.appState.workspaceInfo()?.path;
    return root ? { workspaceRoot: root } : {};
  }

  /**
   * Reload the board whenever the active Electron workspace changes. Mirrors the
   * `ThothStatusService` hook: the first emission only records the key (the
   * component's constructor already issues the initial `loadBoard()`), and every
   * subsequent change repaints from cache (if present) and revalidates.
   */
  private setupWorkspaceSwitch(): void {
    effect(() => {
      const key = this.activeKey();
      const prev = this.lastWorkspaceKey;
      this.lastWorkspaceKey = key;
      if (prev === undefined || prev === key) return;
      untracked(() => this.onWorkspaceSwitch(key));
    });
  }

  /**
   * Paint the target workspace's board immediately (from cache when we have it,
   * otherwise an empty/loading state) and revalidate in the background. Task ids
   * are per-workspace, so the open detail is cleared on switch.
   */
  private onWorkspaceSwitch(key: string): void {
    this.closeTask();
    this._error.set(null);

    const cached = this.boardCache.get(key);
    if (cached) {
      this.applySlice(cached);
      // Stale-while-revalidate: repaint instantly, refresh silently.
      void this.fetchBoard(key, this.activeRoot());
    } else {
      this.resetVisibleForLoading();
      this._loading.set(true);
      void this.fetchBoard(key, this.activeRoot());
    }
  }

  /**
   * Single board fetch. Results are stamped with the workspace `key` they were
   * issued for: the slice cache is always updated, but the *visible* board only
   * moves when `key` is still the active workspace — a response that arrives
   * after the user switched away can never clobber the newly-active board (R5.5).
   */
  private async fetchBoard(
    key: string,
    root: string | undefined,
  ): Promise<void> {
    const isActive = (): boolean => key === this.activeKey();
    try {
      const result = await this.rpc.call(
        'tasks:board',
        root !== undefined ? { workspaceRoot: root } : {},
      );
      if (result.isSuccess() && result.data) {
        const slice = this.toSlice(result.data);
        this.boardCache.set(key, slice);
        if (isActive()) {
          this.applySlice(slice);
          this._error.set(null);
        }
      } else if (isActive()) {
        this._error.set(result.error ?? 'Failed to load tasks');
      }
    } finally {
      if (isActive()) {
        this._loading.set(false);
        this._loaded.set(true);
      }
    }
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

  private async refreshActiveFromPush(): Promise<void> {
    await this.fetchBoard(this.activeKey(), this.activeRoot());
    const selected = this._selectedTaskId();
    if (selected) {
      await this.openTask(selected);
    }
  }

  /** Snapshot RPC board data into a cache slice (all six keys guaranteed). */
  private toSlice(data: TasksBoardResult): BoardSlice {
    const normalized = emptyColumns();
    for (const status of TASK_STATUSES) {
      normalized[status] = data.columns[status] ?? [];
    }
    return {
      columns: normalized,
      excludedCount: data.excludedCount,
      specsDirExists: data.specsDirExists,
    };
  }

  /** Paint a cached/fresh slice onto the visible board signals. */
  private applySlice(slice: BoardSlice): void {
    this._columns.set(slice.columns);
    this._excludedCount.set(slice.excludedCount);
    this._specsDirExists.set(slice.specsDirExists);
    this._loaded.set(true);
  }

  /** Reset the visible board to the first-visit empty/loading baseline. */
  private resetVisibleForLoading(): void {
    this._columns.set(emptyColumns());
    this._excludedCount.set(0);
    this._specsDirExists.set(true);
    this._loaded.set(false);
  }
}
