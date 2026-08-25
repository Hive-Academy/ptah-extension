import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import {
  MAX_SAVED_TASK_VIEWS,
  MAX_SAVED_VIEW_NAME_LENGTH,
  labelKey,
  type SavedTaskView,
  type TaskFilterSpec,
  type TaskSortSpec,
  type TasksGetViewsResult,
  type TasksSaveViewsResult,
} from '@ptah-extension/shared';
import { TasksStore } from './tasks-store.service';

/**
 * Per-field equality for a {@link TaskFilterSpec}.
 *
 * A keyed record rather than a chain of `&&`, and typed with `-?` over
 * `keyof TaskFilterSpec`, so a facet added to the spec makes THIS OBJECT fail
 * to typecheck. The alternative — an expression a reader has to audit by eye —
 * is how a new facet silently stops counting towards "this view is modified",
 * which shows a user an unmodified badge over a lens that no longer matches
 * what they saved.
 */
type FilterFieldComparators = {
  readonly [K in keyof TaskFilterSpec]-?: (
    a: TaskFilterSpec,
    b: TaskFilterSpec,
  ) => boolean;
};

/**
 * Order-insensitive comparison of two facet selections.
 *
 * Facet arrays are SETS in meaning: `['done','backlog']` and
 * `['backlog','done']` select the same tasks, and the chip bar appends in click
 * order, so a user who removes a chip and re-adds it produces a differently
 * ordered array describing an identical lens. Comparing positionally would
 * light the "Modified" badge over a view nobody changed.
 */
function sameValues<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const remaining = [...b];
  for (const value of a) {
    const index = remaining.indexOf(value);
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

/**
 * Label selections, folded through the SHARED {@link labelKey}.
 *
 * `Licensing`, `licensing` and `licensing ` are one label everywhere else
 * (R9); a raw string comparison here would report a view as modified because
 * the same label was re-selected from a differently-cased carrier.
 */
function sameLabels(a: readonly string[], b: readonly string[]): boolean {
  return sameValues(a.map(labelKey), b.map(labelKey));
}

const FILTER_FIELD_EQUALS: FilterFieldComparators = {
  text: (a, b) => a.text === b.text,
  statuses: (a, b) => sameValues(a.statuses, b.statuses),
  types: (a, b) => sameValues(a.types, b.types),
  labels: (a, b) => sameLabels(a.labels, b.labels),
  labelsMode: (a, b) => a.labelsMode === b.labelsMode,
  estimates: (a, b) => sameValues(a.estimates, b.estimates),
  unestimated: (a, b) => a.unestimated === b.unestimated,
  executors: (a, b) => sameValues(a.executors, b.executors),
  parentage: (a, b) => sameValues(a.parentage, b.parentage),
  childrenOf: (a, b) => sameValues(a.childrenOf, b.childrenOf),
  relations: (a, b) => sameValues(a.relations, b.relations),
  hasValidationIssues: (a, b) =>
    a.hasValidationIssues === b.hasValidationIssues,
};

const FILTER_FIELDS = Object.keys(FILTER_FIELD_EQUALS) as ReadonlyArray<
  keyof TaskFilterSpec
>;

/** True when two filter specs describe the same lens. */
export function taskFilterEquals(
  a: TaskFilterSpec,
  b: TaskFilterSpec,
): boolean {
  return FILTER_FIELDS.every((field) => FILTER_FIELD_EQUALS[field](a, b));
}

type SortFieldComparators = {
  readonly [K in keyof TaskSortSpec]-?: (
    a: TaskSortSpec,
    b: TaskSortSpec,
  ) => boolean;
};

const SORT_FIELD_EQUALS: SortFieldComparators = {
  field: (a, b) => a.field === b.field,
  direction: (a, b) => a.direction === b.direction,
};

const SORT_FIELDS = Object.keys(SORT_FIELD_EQUALS) as ReadonlyArray<
  keyof TaskSortSpec
>;

/** True when two sort specs order the board identically. */
export function taskSortEquals(a: TaskSortSpec, b: TaskSortSpec): boolean {
  return SORT_FIELDS.every((field) => SORT_FIELD_EQUALS[field](a, b));
}

/**
 * A fresh opaque token for a view id.
 *
 * The id is CLIENT-OWNED: `tasks:saveViews` refuses a list containing two views
 * with the same id outright (it is a client bug, not a user action), so the
 * uniqueness guarantee has to be made here. `crypto.randomUUID` is the source
 * where it exists; the fallbacks exist because this file runs in a webview, in
 * Electron and under jsdom, and only the first of those is guaranteed to be a
 * secure context.
 *
 * The value is never rendered, never joined onto a path and never interpolated
 * into a glob, a `RegExp` or an RPC method name (BR-10) — it is compared for
 * equality against `activeViewId` and nothing else.
 */
function randomViewToken(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A view id that no view in `taken` already carries.
 *
 * Termination is guaranteed rather than probabilistic: the random token is
 * drawn once, and if it is already taken the search walks a monotonically
 * increasing integer suffix, which exhausts a FINITE set of taken ids in at
 * most `taken.size + 1` steps. A "keep drawing until it is free" loop has no
 * such bound, and this runs on the path that creates a user's view.
 */
export function nextViewId(taken: ReadonlySet<string>): string {
  const base = randomViewToken();
  if (!taken.has(base)) return base;
  for (let suffix = 1; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Which way {@link TaskViewsService.moveView} shifts a view. */
export type TaskViewMoveDirection = 'up' | 'down';

/**
 * TaskViewsService
 *
 * Saved board views (FR-C2) — the list, the active pointer, and the
 * modified-vs-saved comparison — over `tasks:getViews` / `tasks:saveViews`.
 *
 * ## A view is a lens, and this service owns none of the filtering
 *
 * Applying a view writes {@link TasksStore.setFilter} and
 * {@link TasksStore.setSort} and stops. Which tasks that spec then matches is
 * the shared `filterTasks`' decision, exactly as it is for a filter the user
 * typed; there is no comparison against a task anywhere in this file. A view
 * naming a label nobody uses any more therefore APPLIES and matches nothing on
 * that facet, rather than being repaired or pruned (FR-C2.4) — the stale-facet
 * note the chip carries is a render-time annotation and never an edit.
 *
 * ## Every mutation is a whole-list replace
 *
 * Create, rename, update, delete and reorder are arithmetic performed here on
 * the list already in hand, followed by ONE `tasks:saveViews`. The backend has
 * no per-view CRUD and no read-modify-write, because a settings file gives no
 * way to make one atomic.
 *
 * ## Four backend contracts this service is shaped by
 *
 * 1. **`tasks:getViews` returns the list already sorted by `order`.** Nothing
 *    here re-sorts it, and `order` is never derived from — or written as — the
 *    array index. They are two facts about the same list and they are allowed
 *    to disagree in a hand-edited settings file.
 * 2. **`CAP_EXCEEDED` and `WRITE_FAILED` RESOLVE, they do not throw.** A
 *    `try`/`catch` cannot see them, so {@link persist} inspects `data.success`
 *    and renders `data.error.message` verbatim — the cap message already names
 *    the limit and says nothing was saved, and substituting a generic "save
 *    failed" would drop both facts.
 * 3. **`success: true` may carry an `ACTIVE_VIEW_ID_NOT_SAVED` warning.** The
 *    views ARE on disk; only the pointer did not record. It is surfaced as a
 *    notice, never as an error, and no retry is offered — its own message ends
 *    "There is nothing to save again."
 * 4. **`activeViewId: null` is "no active view", not a failure.** On write,
 *    OMITTING the key leaves the stored value alone and sending `null` clears
 *    it, so this service sends `null` only when it means "clear" — deleting the
 *    active view — and omits the key otherwise.
 */
@Injectable({ providedIn: 'root' })
export class TaskViewsService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly store = inject(TasksStore);

  /**
   * The stored views, in the order `tasks:getViews` returned them.
   *
   * That order IS the presentation order: the handler sorts by `order` with a
   * stable tie-break before it answers. Re-sorting here would be a second
   * opinion about the same list, and one of the two would eventually be wrong.
   */
  private readonly _views = signal<readonly SavedTaskView[]>([]);
  private readonly _activeViewId = signal<string | null>(null);
  private readonly _skipped = signal(0);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _notice = signal<string | null>(null);

  public readonly views = this._views.asReadonly();
  public readonly activeViewId = this._activeViewId.asReadonly();
  /**
   * How many stored entries could not be read (FR-C2.3).
   *
   * Surfaced rather than swallowed: a non-zero value means the user silently
   * lost something they saved, and a menu that is quietly shorter than they
   * left it is the failure this number exists to prevent.
   */
  public readonly skipped = this._skipped.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly saving = this._saving.asReadonly();
  /** Set only when NOTHING was saved. */
  public readonly error = this._error.asReadonly();
  /** Set when the write landed but something secondary did not. */
  public readonly notice = this._notice.asReadonly();

  /** The active view, or `null` when no view is selected. */
  public readonly activeView = computed<SavedTaskView | null>(() => {
    const id = this._activeViewId();
    if (id === null) return null;
    return this._views().find((view) => view.id === id) ?? null;
  });

  /**
   * The board's current lens differs from what the active view stores.
   *
   * False when there is no active view: an unsaved filter is not a modified
   * view, and badging it as one would imply an Update action that has nothing
   * to update.
   */
  public readonly modified = computed<boolean>(() => {
    const view = this.activeView();
    if (view === null) return false;
    return !(
      taskFilterEquals(view.filter, this.store.filter()) &&
      taskSortEquals(view.sort, this.store.sort())
    );
  });

  /** True once the list is full — the create control says so rather than failing. */
  public readonly atCap = computed(
    () => this._views().length >= MAX_SAVED_TASK_VIEWS,
  );

  /**
   * Read the stored views.
   *
   * This call does not fail on the backend: a malformed entry, a settings file
   * full of nonsense and one that cannot be read at all all resolve to a
   * successful result carrying whatever survived. A TRANSPORT failure can still
   * happen, and it is reported as an error on the menu only — the board itself
   * never depends on this call, so an unreadable settings file still renders a
   * full board (NFR-11).
   *
   * The active view's lens is applied to the board only on the FIRST successful
   * load. A later reload must not reach in and replace a filter the user is
   * part-way through editing.
   */
  public async load(): Promise<void> {
    if (this._loading()) return;
    this._loading.set(true);
    this._error.set(null);
    const first = !this._loaded();
    try {
      const result = await this.rpc.call('tasks:getViews', {
        ...this.workspaceParam(),
      });
      if (!(result.isSuccess() && result.data)) {
        this._error.set(result.error ?? 'Saved views could not be loaded.');
        return;
      }
      this.applyReadResult(result.data, first);
      this._loaded.set(true);
    } catch (error: unknown) {
      this._error.set(
        error instanceof Error
          ? error.message
          : 'Saved views could not be loaded.',
      );
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Apply a saved view: its filter and its sort become the board's.
   *
   * The lens is applied locally FIRST and unconditionally, then the pointer is
   * persisted. The two are deliberately not gated on each other: the user asked
   * to look at something, and refusing to show it because a preference file
   * could not be written would be a strictly worse outcome than opening on a
   * different view after a restart — which is what the backend's own
   * reconciliation already describes.
   */
  public async applyView(id: string): Promise<void> {
    const view = this._views().find((candidate) => candidate.id === id);
    if (view === undefined) return;

    this.store.setFilter(view.filter);
    this.store.setSort(view.sort);
    this._activeViewId.set(view.id);
    await this.persist(this._views(), view.id);
  }

  /**
   * Save the board's current filter and sort as a NEW view.
   *
   * The new view takes `max(order) + 1` rather than `views.length`: the two are
   * only equal when the stored orders happen to be dense and zero-based, and a
   * hand-edited settings file owes nobody that. Appending to the array keeps
   * the local list in the same order the next `tasks:getViews` will return.
   */
  public async createView(name: string): Promise<boolean> {
    const trimmed = this.validateName(name);
    if (trimmed === null) return false;

    const views = this._views();
    if (this.atCap()) {
      this._error.set(
        `You can save at most ${MAX_SAVED_TASK_VIEWS} views. ` +
          `Delete a view before saving another.`,
      );
      return false;
    }

    const id = nextViewId(new Set(views.map((view) => view.id)));
    const highestOrder = views.reduce(
      (highest, view) => Math.max(highest, view.order),
      -1,
    );
    const created: SavedTaskView = {
      id,
      name: trimmed,
      filter: this.store.filter(),
      sort: this.store.sort(),
      order: highestOrder + 1,
    };
    return this.persist([...views, created], id);
  }

  /** Rename one view, leaving its lens and its position untouched. */
  public async renameView(id: string, name: string): Promise<boolean> {
    const trimmed = this.validateName(name);
    if (trimmed === null) return false;
    if (!this._views().some((view) => view.id === id)) return false;

    return this.persist(
      this._views().map((view) =>
        view.id === id ? { ...view, name: trimmed } : view,
      ),
    );
  }

  /** Overwrite one view's lens with the board's current filter and sort. */
  public async updateView(id: string): Promise<boolean> {
    if (!this._views().some((view) => view.id === id)) return false;

    const filter = this.store.filter();
    const sort = this.store.sort();
    return this.persist(
      this._views().map((view) =>
        view.id === id ? { ...view, filter, sort } : view,
      ),
    );
  }

  /**
   * Delete one view.
   *
   * Deleting the ACTIVE view sends `activeViewId: null` — the key is cleared on
   * purpose. Deleting any other view omits the key entirely, which leaves the
   * stored pointer alone. Sending `null` in that case would silently deselect a
   * view the user never touched.
   */
  public async deleteView(id: string): Promise<boolean> {
    const views = this._views();
    if (!views.some((view) => view.id === id)) return false;

    const remaining = views.filter((view) => view.id !== id);
    return id === this._activeViewId()
      ? this.persist(remaining, null)
      : this.persist(remaining);
  }

  /**
   * Move a view one place up or down the list.
   *
   * The whole list's `order` values are REWRITTEN to its new positions rather
   * than swapping the two numbers involved. Swapping assumes the stored orders
   * are distinct, and they need not be: `tasks:getViews` breaks an `order` tie
   * on surviving position, so two views can legitimately arrive carrying the
   * same number — and swapping equal numbers is a move that appears to do
   * nothing. Rewriting is also what makes the next read return exactly the
   * order shown here.
   */
  public async moveView(
    id: string,
    direction: TaskViewMoveDirection,
  ): Promise<boolean> {
    const views = this._views();
    const from = views.findIndex((view) => view.id === id);
    if (from === -1) return false;

    const to = direction === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= views.length) return false;

    const reordered = [...views];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    return this.persist(
      reordered.map((view, index) => ({ ...view, order: index })),
    );
  }

  /**
   * Clear the active-view pointer without touching the board's filter.
   *
   * Deselecting a view and clearing a filter are different acts, and the filter
   * bar already owns the second one. Silently discarding a lens the user is
   * looking at, in response to a request to stop tracking a view, would be a
   * destructive act with no undo affordance.
   */
  public async clearActiveView(): Promise<boolean> {
    if (this._activeViewId() === null) return false;
    return this.persist(this._views(), null);
  }

  /** Dismiss the "nothing was saved" banner. */
  public clearError(): void {
    this._error.set(null);
  }

  /** Dismiss the partial-success notice. */
  public clearNotice(): void {
    this._notice.set(null);
  }

  /**
   * Read a `tasks:getViews` payload into local state.
   *
   * The payload crosses the host bridge and nothing on that path validates it,
   * so each field is narrowed here rather than trusted — the same reasoning
   * `withRelationArrays` carries in the store. `views` keeps the order it
   * arrived in.
   */
  private applyReadResult(
    data: TasksGetViewsResult,
    applyActive: boolean,
  ): void {
    const views = Array.isArray(data.views) ? data.views : [];
    this._views.set(views);
    this._skipped.set(
      typeof data.skipped === 'number' && data.skipped > 0 ? data.skipped : 0,
    );

    const activeViewId =
      typeof data.activeViewId === 'string' &&
      views.some((view) => view.id === data.activeViewId)
        ? data.activeViewId
        : null;
    this._activeViewId.set(activeViewId);

    if (!applyActive || activeViewId === null) return;
    const active = views.find((view) => view.id === activeViewId);
    if (active === undefined) return;
    this.store.setFilter(active.filter);
    this.store.setSort(active.sort);
  }

  /**
   * The one write. Replaces the whole list, then reconciles local state to
   * whatever actually persisted.
   *
   * Local state is updated ONLY on `success`. `CAP_EXCEEDED` and `WRITE_FAILED`
   * both mean nothing reached disk, so a local list that moved anyway would be
   * a board that disagrees with its own settings file until the next reload.
   *
   * `activeViewId` is `undefined` for "leave the stored pointer alone", which
   * is a different request from `null` ("clear it"), and the key is omitted
   * from the params in that case rather than sent as `undefined`.
   */
  private async persist(
    views: readonly SavedTaskView[],
    activeViewId?: string | null,
  ): Promise<boolean> {
    this._saving.set(true);
    this._error.set(null);
    this._notice.set(null);
    try {
      let result: TasksSaveViewsResult | null;
      try {
        const call = await this.rpc.call('tasks:saveViews', {
          views: [...views],
          ...(activeViewId === undefined ? {} : { activeViewId }),
          ...this.workspaceParam(),
        });
        result = call.isSuccess() && call.data ? call.data : null;
        if (result === null) {
          this._error.set(call.error ?? 'Failed to save views.');
          return false;
        }
      } catch (error: unknown) {
        // A broken transport still throws. Left unhandled it escapes a template
        // event handler as an unhandled rejection and the user sees a control
        // that did nothing and said nothing.
        this._error.set(
          error instanceof Error ? error.message : 'Failed to save views.',
        );
        return false;
      }

      if (!result.success) {
        // Verbatim. The cap message names the limit AND states that nothing was
        // saved; a generic sentence in its place would lose both.
        this._error.set(result.error?.message ?? 'Failed to save views.');
        return false;
      }

      this._views.set(views);
      // Mirror the backend's own reconciliation: a pointer naming no view in
      // the submitted list is stored as "none" there, and must read as "none"
      // here, or the menu badges an active view that the next load will not.
      const requested =
        activeViewId === undefined ? this._activeViewId() : activeViewId;
      this._activeViewId.set(
        requested !== null && views.some((view) => view.id === requested)
          ? requested
          : null,
      );

      if (result.warning) {
        // A SUCCESS carrying a warning: the views are on disk and only the
        // pointer did not record. Rendered as a notice with no retry, because
        // the message itself ends "There is nothing to save again."
        this._notice.set(result.warning.message);
      }
      return true;
    } finally {
      this._saving.set(false);
    }
  }

  /**
   * Trim and bound a name the user typed, or report why it cannot be used.
   *
   * The limits restate `MAX_SAVED_VIEW_NAME_LENGTH` from the shared module
   * rather than a number written here, so the sentence the user reads names the
   * bound the boundary actually enforces.
   */
  private validateName(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      this._error.set('A view needs a name.');
      return null;
    }
    if (trimmed.length > MAX_SAVED_VIEW_NAME_LENGTH) {
      this._error.set(
        `A view name can be at most ${MAX_SAVED_VIEW_NAME_LENGTH} characters. Nothing was saved.`,
      );
      return null;
    }
    this._error.set(null);
    return trimmed;
  }

  /**
   * `{ workspaceRoot }` spread for `tasks:*` params, omitted when no workspace.
   *
   * Read from `AppStateManager` directly rather than through `TasksStore`: the
   * store keeps its own copy private, and views are per-user (D2) — the root is
   * carried because every method in the `tasks:` namespace requires it, not
   * because views are scoped by it.
   */
  private workspaceParam(): { workspaceRoot?: string } {
    const root = this.appState.workspaceInfo()?.path;
    return root ? { workspaceRoot: root } : {};
  }
}
