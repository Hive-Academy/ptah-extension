import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  CircleX,
  Info,
  LucideAngularModule,
  Pencil,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-angular';
import {
  MAX_SAVED_TASK_VIEWS,
  MAX_SAVED_VIEW_NAME_LENGTH,
  type SavedTaskView,
} from '@ptah-extension/shared';

/** A rename request: which view, and the new name the user typed. */
export interface TaskViewRename {
  readonly id: string;
  readonly name: string;
}

/** A reorder request: which view, and which way. */
export interface TaskViewMove {
  readonly id: string;
  readonly direction: 'up' | 'down';
}

/**
 * One rendered row.
 *
 * `key` is the `@for` track key, and it is qualified by the row's POSITION
 * rather than by the view id alone. View ids are client-generated and unique in
 * anything this UI writes, but the list is read back out of a settings file a
 * user can hand-edit, and `tasks:getViews` de-duplicates nothing — it validates
 * each entry and drops what will not parse. Two entries carrying one id
 * therefore reach this template, and a `track view.id` throws NG0955 on the
 * second, taking the whole menu down over a typo in a JSON file. The position
 * cannot collide with itself.
 */
interface TaskViewRow {
  readonly key: string;
  readonly view: SavedTaskView;
  readonly active: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly applyLabel: string;
}

/**
 * TaskViewMenuComponent
 *
 * The saved-views menu (FR-C2.5): the list, apply, create, rename, update,
 * delete, reorder, the cap message, the modified badge and the "some of your
 * views could not be read" report.
 *
 * ## It stores nothing and computes no lens
 *
 * Presentational. It renders {@link SavedTaskView}s and emits what the user
 * asked for; {@link TaskViewsService} owns the list arithmetic and the single
 * `tasks:saveViews` write, and the shared `filterTasks` owns what a view
 * matches. There is no ordering decision here either — `views` arrives already
 * sorted by `order` from the backend and is rendered in exactly that order.
 * `order` is NOT the array index and is never treated as one; a move emits a
 * direction and the service rewrites the whole list's values.
 *
 * ## The name is untrusted free text (BR-10)
 *
 * A view name is whatever somebody typed. Every render of it in this file is
 * `{{ interpolation }}` — never `[innerHTML]`, never markdown, and never
 * interpolated into a path, a glob, a `RegExp` or an RPC method name. The
 * `title`/`aria-label` attributes it appears in are property bindings, which
 * are escaped by the same mechanism.
 *
 * ## Failure is rendered as the backend worded it
 *
 * `CAP_EXCEEDED` resolves as a normal result rather than throwing, and its
 * message already names the 50-view limit and states that nothing was saved.
 * The `error` input is rendered verbatim for that reason. The `notice` input is
 * its opposite: a write that LANDED with something secondary missing, so it is
 * styled as information and carries no retry.
 *
 * ## Colour — and why the three message states are not daisyUI `alert`s
 *
 * Every text colour here is full `base-content`. No informational element
 * carries a `text-base-content/NN` opacity modifier — the ratio of one depends
 * on the theme's base, and none of `/30`–`/70` clears 4.5:1 on all four
 * mandated bases (that audit table lives on `TaskFilterBarComponent`).
 *
 * The error / notice / skipped rows were first written as `alert alert-error`
 * and `alert alert-info`. Both FAIL, and the more important of the two fails
 * worse. Recomputed from the installed `tailwind.config.js` and
 * `daisyui@4`'s own `themes.js` / `functions.js` defaults:
 *
 * | fill (`-content` on its colour) | anubis | anubis-light | dUI dark | dUI light |
 * |---|---|---|---|---|
 * | `alert-error` | **3.87** | **4.12** | 6.83 | 6.83 |
 * | `alert-info` | **2.95** | 5.08 | 9.09 | 9.09 |
 * | `alert-warning` | 11.10 | 7.63 | 12.62 | 12.62 |
 *
 * `alert-info` on anubis — the app's DEFAULT theme — misses even the 3:1
 * non-text floor, and it was carrying the `ACTIVE_VIEW_ID_NOT_SAVED` notice.
 *
 * A coloured container was investigated and rejected rather than tuned: no
 * accent reaches the 3:1 boundary gate on the light themes
 * (`border-info` 2.59 / 2.31, `border-warning` 1.83 / 1.66 against
 * `base-100`), and no step of the daisyUI base ramp delimits a block either
 * (`base-300` on `base-100` is 1.21 / 1.20 / 1.11 / 1.25). There is no colour
 * that carries this reliably across 30-plus themes.
 *
 * So colour carries NOTHING here. All three states are text in full
 * `base-content` on the panel's `base-200` — **13.89 / 14.21 / 7.44 / 13.11**,
 * clearing 4.5:1 everywhere — and the semantics are carried by the words
 * themselves ("Nothing was saved…", "Your views were saved…"), by `role`, and
 * by an `aria-hidden` glyph that is redundant reinforcement rather than the
 * signal. That also satisfies WCAG 1.4.1: colour is not the only visual means.
 * It is the same construction as the `skipped` row, which is why the three now
 * look like one family.
 *
 * **The `alert-*` token failure itself is app-wide, not this batch's** — the
 * pre-existing banners in `TasksViewComponent` use the same classes.
 * `tailwind.config.js` is deliberately NOT edited: a default-theme colour is an
 * app-wide decision with a blast radius far beyond one feature batch. Recorded
 * for `TASK_2026_183`.
 */
@Component({
  selector: 'ptah-task-view-menu',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <details class="dropdown" data-testid="task-view-menu">
      <summary
        class="btn btn-ghost btn-xs gap-1 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
        [class.btn-active]="activeView() !== null"
        [attr.aria-label]="triggerAriaLabel()"
        data-testid="task-view-menu-trigger"
      >
        <lucide-angular
          [img]="BookmarkIcon"
          class="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
        />
        @if (activeView(); as view) {
          <span class="max-w-[9rem] truncate font-semibold">
            {{ view.name }}
          </span>
        } @else {
          <span class="font-normal">Views</span>
        }
        @if (modified()) {
          <!-- Not a colour-only signal: the word itself is the affordance. -->
          <span
            class="badge badge-outline badge-xs border-warning text-base-content"
            data-testid="task-view-modified-badge"
          >
            Modified
          </span>
        }
      </summary>

      <div
        class="dropdown-content z-30 mt-1 flex w-[min(24rem,calc(100vw-1rem))] flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-2 text-base-content shadow"
        data-testid="task-view-menu-panel"
      >
        @if (error(); as message) {
          <!-- Verbatim. The cap message names the limit and says nothing was
               saved; a generic sentence in its place loses both facts.

               NOT a daisyUI alert fill. See the colour note on the class: the
               error variant is 3.87:1 on anubis and 4.12:1 on anubis-light,
               both under 4.5. This is the same construction as the skipped
               row below — full base-content on the panel's base-200, which is
               7.44:1 at its worst across the four mandated themes. -->
          <p
            class="flex items-start gap-1.5 text-xs text-base-content"
            role="alert"
            data-testid="task-view-error"
          >
            <lucide-angular
              [img]="CircleXIcon"
              class="mt-0.5 h-3.5 w-3.5 shrink-0 text-error"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">{{ message }}</span>
            <button
              type="button"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded"
              aria-label="Dismiss this message"
              (click)="errorDismissed.emit()"
            >
              <lucide-angular [img]="XIcon" class="h-3 w-3" />
            </button>
          </p>
        }

        @if (notice(); as message) {
          <!-- A SUCCESS carrying a warning. No retry is offered: the message
               itself ends "There is nothing to save again."

               The info fill was the worst of the three at 2.95:1 on anubis —
               it failed even the 3:1 non-text floor, on the message this
               batch was most careful to word correctly. -->
          <p
            class="flex items-start gap-1.5 text-xs text-base-content"
            role="status"
            data-testid="task-view-notice"
          >
            <lucide-angular
              [img]="InfoIcon"
              class="mt-0.5 h-3.5 w-3.5 shrink-0 text-info"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">{{ message }}</span>
            <button
              type="button"
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded"
              aria-label="Dismiss this message"
              (click)="noticeDismissed.emit()"
            >
              <lucide-angular [img]="XIcon" class="h-3 w-3" />
            </button>
          </p>
        }

        @if (skipped() > 0) {
          <!-- Said out loud rather than absorbed: the alternative to naming
               this is a menu that is quietly shorter than the user left it. -->
          <p
            class="flex items-start gap-1.5 text-xs text-base-content"
            data-testid="task-view-skipped"
          >
            <lucide-angular
              [img]="TriangleAlertIcon"
              class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <span>
              {{ skipped() }} stored view(s) could not be read and are not
              listed here. They are still in your settings file — nothing was
              deleted.
            </span>
          </p>
        }

        @if (rows().length > 0) {
          <!-- The list scrolls; the panel around it does not. At the 50-view
               cap an unbounded list pushes the create-view row and the cap
               message off-screen — and the cap message is exactly what a user
               with 50 views needs to read. Same treatment as the sibling facet
               menu, one step taller because these rows carry controls. -->
          <ul
            class="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
            data-testid="task-view-list"
          >
            @for (row of rows(); track row.key) {
              <li
                class="flex flex-col gap-1 rounded px-1 py-0.5"
                [class.bg-base-300]="row.active"
                data-testid="task-view-row"
              >
                <div class="flex items-center gap-0.5">
                  <button
                    type="button"
                    class="flex h-6 min-w-0 flex-1 items-center gap-1 rounded px-1 text-left text-xs disabled:opacity-40"
                    [disabled]="busy()"
                    [attr.aria-current]="row.active ? 'true' : null"
                    [title]="row.applyLabel"
                    [attr.aria-label]="row.applyLabel"
                    data-testid="task-view-apply"
                    (click)="viewApplied.emit(row.view.id)"
                  >
                    @if (row.active) {
                      <lucide-angular
                        [img]="CheckIcon"
                        class="h-3 w-3 shrink-0"
                        aria-hidden="true"
                      />
                    }
                    <span class="truncate">{{ row.view.name }}</span>
                  </button>

                  <button
                    type="button"
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded disabled:opacity-40"
                    [disabled]="!row.canMoveUp || busy()"
                    [attr.aria-label]="'Move ' + row.view.name + ' up'"
                    [title]="'Move ' + row.view.name + ' up'"
                    data-testid="task-view-move-up"
                    (click)="
                      viewMoved.emit({ id: row.view.id, direction: 'up' })
                    "
                  >
                    <lucide-angular [img]="ChevronUpIcon" class="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded disabled:opacity-40"
                    [disabled]="!row.canMoveDown || busy()"
                    [attr.aria-label]="'Move ' + row.view.name + ' down'"
                    [title]="'Move ' + row.view.name + ' down'"
                    data-testid="task-view-move-down"
                    (click)="
                      viewMoved.emit({ id: row.view.id, direction: 'down' })
                    "
                  >
                    <lucide-angular [img]="ChevronDownIcon" class="h-3 w-3" />
                  </button>

                  @if (row.active && modified()) {
                    <!-- Only on the active row, and only while it differs:
                         overwriting a view the board is not showing would save
                         a lens the user cannot see. -->
                    <button
                      type="button"
                      class="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                      [disabled]="busy()"
                      [attr.aria-label]="
                        'Save the current filters into ' + row.view.name
                      "
                      [title]="'Save the current filters into ' + row.view.name"
                      data-testid="task-view-update"
                      (click)="viewUpdated.emit(row.view.id)"
                    >
                      <lucide-angular [img]="SaveIcon" class="h-3 w-3" />
                    </button>
                  }

                  <button
                    type="button"
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                    [disabled]="busy()"
                    [attr.aria-label]="'Rename ' + row.view.name"
                    [title]="'Rename ' + row.view.name"
                    data-testid="task-view-rename"
                    (click)="startRename(row.view)"
                  >
                    <lucide-angular [img]="PencilIcon" class="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-error"
                    [disabled]="busy()"
                    [attr.aria-label]="'Delete ' + row.view.name"
                    [title]="'Delete ' + row.view.name"
                    data-testid="task-view-delete"
                    (click)="confirmingId.set(row.view.id)"
                  >
                    <lucide-angular [img]="Trash2Icon" class="h-3 w-3" />
                  </button>
                </div>

                @if (renamingId() === row.view.id) {
                  <div class="flex items-center gap-1 pl-1">
                    <input
                      type="text"
                      class="input input-xs input-bordered min-w-0 flex-1"
                      [attr.maxlength]="maxNameLength"
                      [attr.aria-label]="'New name for ' + row.view.name"
                      data-testid="task-view-rename-input"
                      [value]="renameDraft()"
                      (input)="renameDraft.set(readValue($event))"
                    />
                    <button
                      type="button"
                      class="btn btn-xs"
                      [disabled]="renameDraft().trim().length === 0 || busy()"
                      data-testid="task-view-rename-confirm"
                      (click)="commitRename(row.view.id)"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      (click)="cancelRename()"
                    >
                      Cancel
                    </button>
                  </div>
                }

                @if (confirmingId() === row.view.id) {
                  <!-- Two steps on purpose. Settings are gitignored: a deleted
                       view has no undo anywhere. -->
                  <div
                    class="flex flex-wrap items-center gap-1 pl-1 text-xs"
                    data-testid="task-view-delete-confirm"
                  >
                    <span class="flex-1">Delete this view?</span>
                    <button
                      type="button"
                      class="btn btn-error btn-xs"
                      [disabled]="busy()"
                      data-testid="task-view-delete-confirm-yes"
                      (click)="commitDelete(row.view.id)"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      (click)="confirmingId.set(null)"
                    >
                      Keep
                    </button>
                  </div>
                }
              </li>
            }
          </ul>

          @if (activeView() !== null) {
            <button
              type="button"
              class="btn btn-ghost btn-xs justify-start"
              [disabled]="busy()"
              title="Stop tracking a saved view. The current filters stay as they are."
              data-testid="task-view-clear-active"
              (click)="activeCleared.emit()"
            >
              Stop using this view
            </button>
          }
        } @else {
          <p
            class="px-1 text-xs text-base-content"
            data-testid="task-view-none"
          >
            No saved views yet. Filter the board the way you want it, then save
            it here to come back to it.
          </p>
        }

        <div class="flex items-center gap-1 border-t border-base-300 pt-2">
          <input
            type="text"
            class="input input-xs input-bordered min-w-0 flex-1"
            placeholder="Name this view"
            aria-label="Name for a new saved view"
            [attr.maxlength]="maxNameLength"
            [disabled]="atCap()"
            data-testid="task-view-create-input"
            [value]="createDraft()"
            (input)="createDraft.set(readValue($event))"
          />
          <button
            type="button"
            class="btn btn-primary btn-xs"
            [disabled]="atCap() || createDraft().trim().length === 0 || busy()"
            [title]="createTitle()"
            data-testid="task-view-create"
            (click)="commitCreate()"
          >
            Save view
          </button>
        </div>

        @if (atCap()) {
          <p class="px-1 text-xs text-base-content" data-testid="task-view-cap">
            You have {{ maxViews }} saved views, which is the most this stores.
            Delete one to save another.
          </p>
        }
      </div>
    </details>
  `,
})
export class TaskViewMenuComponent {
  /**
   * The stored views, ALREADY ordered by the backend.
   *
   * Rendered in the order given. This component holds no sort.
   */
  public readonly views = input<readonly SavedTaskView[]>([]);
  public readonly activeViewId = input<string | null>(null);
  /** The board's lens differs from what the active view stores. */
  public readonly modified = input(false);
  /** Stored entries that could not be read (FR-C2.3). */
  public readonly skipped = input(0);
  /** A write is outstanding — controls read as busy rather than as available. */
  public readonly busy = input(false);
  /** Set only when nothing was saved. Rendered verbatim. */
  public readonly error = input<string | null>(null);
  /** A write that landed with something secondary missing. */
  public readonly notice = input<string | null>(null);

  public readonly viewApplied = output<string>();
  public readonly viewCreated = output<string>();
  public readonly viewRenamed = output<TaskViewRename>();
  public readonly viewUpdated = output<string>();
  public readonly viewDeleted = output<string>();
  public readonly viewMoved = output<TaskViewMove>();
  public readonly activeCleared = output<void>();
  public readonly errorDismissed = output<void>();
  public readonly noticeDismissed = output<void>();

  protected readonly maxViews = MAX_SAVED_TASK_VIEWS;
  protected readonly maxNameLength = MAX_SAVED_VIEW_NAME_LENGTH;

  protected readonly BookmarkIcon = Bookmark;
  protected readonly CheckIcon = Check;
  protected readonly ChevronUpIcon = ChevronUp;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly CircleXIcon = CircleX;
  protected readonly InfoIcon = Info;
  protected readonly PencilIcon = Pencil;
  protected readonly SaveIcon = Save;
  protected readonly Trash2Icon = Trash2;
  protected readonly TriangleAlertIcon = TriangleAlert;
  protected readonly XIcon = X;

  /**
   * The two in-flight name drafts — `model`s, not internal state.
   *
   * Neither is cleared when its write is emitted. A write can be refused after
   * the fact (`CAP_EXCEEDED` resolves rather than throwing, a transport can
   * fail), and clearing on emit throws the typed name away at exactly the
   * moment the user most needs it back: someone who just named their
   * fifty-first view is told the list is full and finds the name gone as well.
   *
   * This component cannot see the outcome — it is presentational and the write
   * belongs to the service. So ownership moves to the parent, which does know,
   * and which clears each draft only after a save that actually landed.
   *
   * `renamingId` is a `model` for the same reason: closing the rename row is
   * part of "the rename succeeded", and this component cannot tell. Rename
   * loses less than create on a refusal — the original name is still on screen
   * in the row beneath, so nothing is unrecoverable — but that argues for
   * making the fix cheap, not for skipping it. Two adjacent controls doing the
   * same thing by different rules is worse than either rule applied uniformly:
   * the next reader cannot tell which one is intended.
   */
  public readonly createDraft = model('');
  public readonly renamingId = model<string | null>(null);
  public readonly renameDraft = model('');
  protected readonly confirmingId = signal<string | null>(null);

  protected readonly activeView = computed<SavedTaskView | null>(() => {
    const id = this.activeViewId();
    if (id === null) return null;
    return this.views().find((view) => view.id === id) ?? null;
  });

  protected readonly atCap = computed(
    () => this.views().length >= MAX_SAVED_TASK_VIEWS,
  );

  protected readonly rows = computed<readonly TaskViewRow[]>(() => {
    const views = this.views();
    const activeId = this.activeViewId();
    const modified = this.modified();
    return views.map((view, index) => {
      const active = view.id === activeId;
      return {
        key: `${index}#${view.id}`,
        view,
        active,
        canMoveUp: index > 0,
        canMoveDown: index < views.length - 1,
        applyLabel:
          active && modified
            ? `Reapply ${view.name}, discarding the changes to the current filters`
            : `Show ${view.name}`,
      };
    });
  });

  protected readonly triggerAriaLabel = computed(() => {
    const view = this.activeView();
    if (view === null) return 'Saved views';
    return this.modified()
      ? `Saved views, showing ${view.name} with unsaved changes`
      : `Saved views, showing ${view.name}`;
  });

  protected readonly createTitle = computed(() =>
    this.atCap()
      ? `You already have ${MAX_SAVED_TASK_VIEWS} saved views. Delete one to save another.`
      : 'Save the current filters and sort as a new view',
  );

  protected readValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected startRename(view: SavedTaskView): void {
    this.confirmingId.set(null);
    this.renamingId.set(view.id);
    this.renameDraft.set(view.name);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
    this.renameDraft.set('');
  }

  protected commitRename(id: string): void {
    const name = this.renameDraft().trim();
    if (name.length === 0) return;
    // No clear and no close here — see the note on `renameDraft`. The parent
    // does both, and only if the write landed. Closing the row on emit would
    // discard the typed name on a refusal, exactly as clearing the create box
    // on emit did.
    this.viewRenamed.emit({ id, name });
  }

  protected commitDelete(id: string): void {
    this.confirmingId.set(null);
    this.viewDeleted.emit(id);
  }

  protected commitCreate(): void {
    const name = this.createDraft().trim();
    if (name.length === 0 || this.atCap()) return;
    // No clear here — see the note on `createDraft`. The parent clears it if,
    // and only if, the write landed.
    this.viewCreated.emit(name);
  }
}
