import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ClipboardList,
  Command,
  EyeOff,
  FileText,
  FilterX,
  LucideAngularModule,
  Plus,
  RefreshCw,
  X,
} from 'lucide-angular';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import {
  SPEC_ROOT,
  TASK_ESTIMATES,
  TASK_TYPES,
  type ExcludedTaskFolder,
  type TaskEstimate,
  type TaskSpecSummary,
  type TaskType,
} from '@ptah-extension/shared';
import { TasksStore } from '../services/tasks-store.service';
import { TaskStartService } from '../services/task-start.service';
import { TaskViewsService } from '../services/task-views.service';
import { TaskBoardComponent } from './board/task-board.component';
import type {
  TaskSelectionToggle,
  TaskStartRequest,
  TaskStatusChange,
} from './board/task-card.component';
import { TaskBulkBarComponent } from './bulk/task-bulk-bar.component';
import { TaskBulkSummaryComponent } from './bulk/task-bulk-summary.component';
import { TaskDetailComponent } from './detail/task-detail.component';
import type { TaskMetadataWrite } from './detail/task-metadata-write';
import { TaskFilterBarComponent } from './filter/task-filter-bar.component';
import { TaskViewMenuComponent } from './filter/task-view-menu.component';
import type { TaskViewRename } from './filter/task-view-menu.component';
import { isTextEntryTarget } from './keyboard-target';
import { TaskCommandPaletteComponent } from './palette/task-command-palette.component';
import {
  buildPaletteEntries,
  type TaskPaletteAction,
} from './palette/palette-entries';
import { taskExclusionReasonLabel } from '../task-presentation';

/** One excluded folder plus the sentence explaining its typed reason. */
interface ExcludedFolderRow extends ExcludedTaskFolder {
  readonly reasonLabel: string;
}

/**
 * TasksViewComponent
 *
 * Top-level standalone Tasks surface. Owns the header actions (New Task,
 * Generate Registry, the exclusions drawer trigger, Reindex), the board, and
 * the detail panel. All data flows through {@link TasksStore}; this component
 * holds only transient form / modal / drawer UI state.
 *
 * The exclusions drawer lists EVERY skipped folder by name with its typed
 * reason. It deliberately replaces the old count badge: a count tells a user
 * that folders vanished without telling them which ones or why, which is the
 * silent-drop failure the Tasks contract work exists to end.
 *
 * The Start action delegates to {@link TaskStartService} (agent-managed
 * worktree isolation via a prompt directive, the `ChatPromptRequest` bridge,
 * then `TasksStore.updateStatus` on success), keeping this lib free of any
 * `chat` import (NFR-11). That store method now writes through
 * `tasks:updateMetadata` like every other client mutation — the wire method
 * changed, the service call did not, and `TaskStartService` is untouched.
 */
@Component({
  selector: 'ptah-tasks-view',
  standalone: true,
  imports: [
    FormsModule,
    LucideAngularModule,
    NativeDrawerComponent,
    TaskBoardComponent,
    TaskBulkBarComponent,
    TaskBulkSummaryComponent,
    TaskDetailComponent,
    TaskCommandPaletteComponent,
    TaskFilterBarComponent,
    TaskViewMenuComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // R10: the palette shortcut is bound to THIS component's host element, never
  // to `window` or `document`. See {@link TasksViewComponent.onKeyDown}.
  host: { '(keydown)': 'onKeyDown($event)' },
  template: `
    <div class="flex flex-col h-full w-full bg-base-100">
      <!-- Header -->
      <header
        class="flex items-center gap-2 px-3 py-2 border-b border-base-300 flex-shrink-0"
      >
        <div class="flex items-center gap-1.5">
          <lucide-angular
            [img]="ClipboardListIcon"
            class="w-4 h-4 text-primary"
          />
          <h1 class="text-sm font-semibold">Tasks</h1>
        </div>

        @if (store.totalCount() > 0) {
          <span
            class="text-xs text-base-content-muted tabular-nums"
            title="Board totals — active = In Progress + In Review"
          >
            {{ store.totalCount() }} total ·
            <span class="text-info">{{ store.activeCount() }} active</span> ·
            <span class="text-success">{{ store.doneCount() }} done</span>
          </span>
        }

        @if (store.excludedCount() > 0) {
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1 text-warning"
            aria-haspopup="dialog"
            [attr.aria-expanded]="exclusionsOpen()"
            data-testid="tasks-excluded-trigger"
            title="Show every folder the board skipped, and why"
            (click)="openExclusions()"
          >
            <lucide-angular [img]="EyeOffIcon" class="w-3.5 h-3.5" />
            <span class="text-xs">
              {{ store.excludedCount() }} skipped — see why
            </span>
          </button>
        }

        <div class="flex-1"></div>

        <!-- The palette's PRIMARY affordance (FR-C6.1). The shortcut is the
             convenience; this button is the contract, because a shortcut is
             invisible, is not discoverable, and is the one part of this feature
             a host application can take away. -->
        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          aria-haspopup="dialog"
          [attr.aria-expanded]="paletteOpen()"
          data-testid="tasks-palette-trigger"
          title="Open the command palette (Ctrl+K / Cmd+K)"
          (click)="openPalette()"
        >
          <lucide-angular [img]="CommandIcon" class="w-3.5 h-3.5" />
          <span class="text-xs">Commands</span>
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          [disabled]="store.busy()"
          title="Regenerate registry.md"
          (click)="store.generateRegistry()"
        >
          <lucide-angular [img]="FileTextIcon" class="w-3.5 h-3.5" />
          <span class="text-xs">Registry</span>
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          [disabled]="store.busy() || store.loading()"
          title="Reindex .ptah/specs"
          (click)="store.reindex()"
        >
          <lucide-angular
            [img]="RefreshCwIcon"
            class="w-3.5 h-3.5"
            [class.animate-spin]="store.busy() || store.loading()"
          />
          <span class="text-xs">Reindex</span>
        </button>

        <button
          type="button"
          class="btn btn-primary btn-xs gap-1"
          (click)="openCreate()"
        >
          <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
          <span class="text-xs">New Task</span>
        </button>
      </header>

      <!-- Transient banners -->
      @if (store.actionMessage(); as message) {
        <div class="alert alert-success py-1.5 px-3 rounded-none text-xs">
          <span>{{ message }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            aria-label="Dismiss"
            (click)="store.clearActionMessage()"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" />
          </button>
        </div>
      }
      @if (store.error(); as error) {
        <div class="alert alert-error py-1.5 px-3 rounded-none text-xs">
          <span>{{ error }}</span>
        </div>
      }
      @if (taskStart.error(); as startError) {
        <div class="alert alert-error py-1.5 px-3 rounded-none text-xs">
          <span>{{ startError }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            aria-label="Dismiss"
            (click)="taskStart.clearError()"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" />
          </button>
        </div>
      }

      <!-- Filter + sort. Rendered whenever the board holds anything at all:
           hiding it once a filter empties the board would remove the only
           control that can undo that (FR-C1.3). -->
      @if (store.totalIndexed() > 0) {
        <!-- Saved views (FR-C2). Above the filter bar rather than inside it,
             because a view is a whole lens — filter AND sort — and reads as a
             peer of the bar it fills in, not as one more facet on it. -->
        <div
          class="flex flex-wrap items-center gap-1 border-b border-base-300 px-3 py-1 text-base-content"
          data-testid="task-view-bar"
        >
          <ptah-task-view-menu
            [views]="views.views()"
            [activeViewId]="views.activeViewId()"
            [modified]="views.modified()"
            [skipped]="views.skipped()"
            [busy]="views.saving() || views.loading()"
            [error]="views.error()"
            [notice]="views.notice()"
            [(createDraft)]="viewNameDraft"
            [(renamingId)]="viewRenamingId"
            [(renameDraft)]="viewRenameDraft"
            (viewApplied)="views.applyView($event)"
            (viewCreated)="onViewCreated($event)"
            (viewRenamed)="onViewRenamed($event)"
            (viewUpdated)="views.updateView($event)"
            (viewDeleted)="views.deleteView($event)"
            (viewMoved)="views.moveView($event.id, $event.direction)"
            (activeCleared)="views.clearActiveView()"
            (errorDismissed)="views.clearError()"
            (noticeDismissed)="views.clearNotice()"
          />
        </div>

        <ptah-task-filter-bar
          [filter]="store.filter()"
          [sort]="store.sort()"
          [knownLabels]="store.knownLabels()"
          [knownExecutors]="store.knownExecutors()"
          [estimateBuckets]="store.estimateBuckets()"
          [matchedCount]="store.matchedCount()"
          [totalIndexed]="store.totalIndexed()"
          (filterChange)="store.setFilter($event)"
          (sortChange)="store.setSort($event)"
        />
      }

      <!-- The bulk bar appears only once there is something to act on, and
           stays through the confirmation and the run. It is not permanent
           chrome: a toolbar offering to move zero tasks is a row of controls
           that cannot do anything, on a board that is mostly reading. -->
      @if (bulkBarVisible()) {
        <ptah-task-bulk-bar
          [count]="store.selectionCount()"
          [hiddenCount]="store.hiddenSelectionCount()"
          [matchedCount]="store.matchedCount()"
          [requested]="store.bulkRequest()"
          [progress]="store.bulk()"
          (statusPicked)="store.requestBulkStatus($event)"
          (confirmRequest)="store.confirmBulkRequest()"
          (cancelRequest)="store.cancelBulkRequest()"
          (cancelRun)="store.cancelBulk()"
          (selectAllMatching)="store.selectAllMatching()"
          (clearSelection)="store.clearSelection()"
        />
      }

      <!-- Persistent, NOT a toast (FR-C4.5). It outlives the run that produced
           it and is cleared only by the user or by the next run.

           HIDDEN while a confirmation is pending or a run is in flight, rather
           than cleared. Two different failures are being avoided at once: left
           visible, a Retry confirmation is read against the previous run's
           failure list sitting right underneath it, and the user cannot tell
           which run the numbers on screen belong to. But CLEARING it on the
           request would destroy that list for a user who then declines the
           confirmation — and the list is the thing they were reading in order
           to decide. Hiding satisfies both: decline the retry and the summary
           comes straight back. -->
      @if (bulkSummaryVisible(); as summary) {
        <ptah-task-bulk-summary
          [summary]="summary"
          (retry)="store.requestBulkStatus($event)"
          (dismissed)="store.clearBulkSummary()"
        />
      }

      <!-- Body -->
      <div class="flex flex-1 min-h-0">
        @if (store.loading() && !store.loaded()) {
          <div class="flex items-center justify-center flex-1">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        } @else if (store.isEmpty()) {
          <!-- Empty state with create CTA -->
          <div
            class="flex flex-col items-center justify-center flex-1 text-center gap-3 p-6"
          >
            <lucide-angular
              [img]="ClipboardListIcon"
              class="w-12 h-12 text-base-content/20"
            />
            <div class="flex flex-col gap-1">
              <p class="text-sm font-medium text-base-content">
                @if (!store.specsDirExists()) {
                  No .ptah/specs directory yet
                } @else {
                  No tasks on the board
                }
              </p>
              <p class="text-xs text-base-content-muted max-w-xs">
                Create a task to generate a
                <span class="font-mono">task.md</span> with valid frontmatter —
                it becomes the first card on the board.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm gap-1"
              (click)="openCreate()"
            >
              <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
              Create your first task
            </button>
          </div>
        } @else {
          <div class="flex-1 min-w-0">
            <!-- "Nothing matches" is NOT "nothing exists" (FR-C1.3). The
                 create CTA is deliberately absent here: offering to create a
                 182nd task to someone whose 181 are behind a chip answers a
                 question they did not ask. The only action is the one that
                 brings them back. -->
            @if (store.filteredEmpty()) {
              <div
                class="flex flex-col items-center justify-center h-full text-center gap-3 p-6"
                data-testid="tasks-filtered-empty"
              >
                <!-- Decorative and redundant with the sentence below it, so it
                     is hidden from the accessibility tree and exempt from the
                     text-contrast gate. It is the one place in this block an
                     opacity modifier survives. -->
                <lucide-angular
                  [img]="FilterXIcon"
                  class="w-10 h-10 text-base-content/20"
                  aria-hidden="true"
                />
                <div class="flex flex-col gap-1">
                  <p class="text-sm font-medium text-base-content">
                    No tasks match the current filter
                  </p>
                  <p class="text-xs text-base-content-muted max-w-xs">
                    All {{ store.totalIndexed() }} indexed task(s) are still on
                    the board — the active filter is hiding every one of them.
                    Remove a chip above, or clear the filter.
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-outline gap-1"
                  data-testid="tasks-filtered-empty-clear"
                  (click)="store.clearFilter()"
                >
                  Clear the filter
                </button>
              </div>
            } @else {
              <ptah-task-board
                [columns]="store.board()"
                [graph]="store.graph()"
                [selectedTaskId]="store.selectedTaskId()"
                [selection]="store.selection()"
                [pending]="store.pending()"
                [outcomes]="store.lastRunOutcomes()"
                (taskSelect)="store.openTask($event)"
                (taskToggle)="onTaskToggle($event)"
                (selectionToggle)="onSelectionToggle($event)"
                (escapePressed)="onBoardEscape()"
                (statusChange)="onStatusChange($event)"
                (startTask)="onStartTask($event)"
                (filterChildren)="store.showChildrenOf($event)"
              />
            }
          </div>

          @if (store.selectedTaskId()) {
            <ptah-task-detail
              [detail]="store.taskDetail()"
              [graph]="store.graph()"
              [knownLabels]="store.knownLabels()"
              [knownTaskIds]="knownTaskIds()"
              [busy]="writing()"
              [loading]="store.detailLoading()"
              (closed)="store.closeTask()"
              (openArtifact)="store.openArtifact($event)"
              (openTask)="store.openTask($event)"
              (applyMetadata)="onApplyMetadata($event)"
            />
          }
        }
      </div>
    </div>

    <!-- Command palette (FR-C6). Rendered inside an @if so that closing it
         DESTROYS it — which is the single close path its focus restore hangs
         off, and the reason there is no way to close it without giving focus
         back to whatever opened it. -->
    @if (paletteOpen()) {
      <ptah-task-command-palette
        [entries]="paletteEntries()"
        (run)="onPaletteRun($event)"
        (closed)="closePalette()"
      />
    }

    <!-- New Task modal -->
    @if (createOpen()) {
      <dialog class="modal modal-open">
        <div class="modal-box max-w-md">
          <h3 class="text-base font-semibold mb-3">New Task</h3>

          <div class="flex flex-col gap-3">
            <label class="form-control">
              <span class="label-text text-xs mb-1">Title</span>
              <input
                type="text"
                class="input input-sm input-bordered"
                placeholder="Short imperative title"
                [ngModel]="createTitle()"
                (ngModelChange)="createTitle.set($event)"
                aria-label="Task title"
              />
            </label>

            <label class="form-control">
              <span class="label-text text-xs mb-1">Type</span>
              <select
                class="select select-sm select-bordered"
                [ngModel]="createType()"
                (ngModelChange)="setCreateType($event)"
                aria-label="Task type"
              >
                @for (type of taskTypes; track type) {
                  <option [value]="type">{{ type }}</option>
                }
              </select>
            </label>

            <label class="form-control">
              <span class="label-text text-xs mb-1"
                >Description (optional)</span
              >
              <textarea
                class="textarea textarea-sm textarea-bordered"
                rows="2"
                placeholder="One-line summary"
                [ngModel]="createDescription()"
                (ngModelChange)="createDescription.set($event)"
                aria-label="Task description"
              ></textarea>
            </label>
          </div>

          <div class="modal-action mt-4">
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              [disabled]="creating()"
              (click)="closeCreate()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              [disabled]="!canCreate() || creating()"
              (click)="submitCreate()"
            >
              @if (creating()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Create
            </button>
          </div>
        </div>
        <button
          type="button"
          class="modal-backdrop"
          aria-label="Close"
          (click)="closeCreate()"
        ></button>
      </dialog>
    }

    <!-- Excluded folders — every skipped folder BY NAME with its typed reason.
         A count alone is the failure mode this drawer replaces: it tells a user
         that folders vanished without telling them which, or why. -->
    <ptah-native-drawer
      [isOpen]="exclusionsOpen()"
      ariaLabel="Folders excluded from the board"
      widthClass="w-full max-w-xl"
      (closed)="closeExclusions()"
    >
      <div drawer-header class="flex flex-col gap-0.5">
        <h2 class="text-sm font-semibold">
          {{ store.excludedCount() }} folder(s) skipped
        </h2>
        <p class="text-xs text-base-content-muted">
          These sub-folders of
          <span class="font-mono">{{ specRoot }}</span> exist on disk but never
          reach the board.
        </p>
      </div>

      @if (excludedFolders().length > 0) {
        <ul class="flex flex-col gap-2" data-testid="tasks-excluded-list">
          @for (folder of excludedFolders(); track folder.folderName) {
            <li
              class="flex flex-col gap-1 rounded border border-base-300 px-3 py-2"
              data-testid="tasks-excluded-row"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="font-mono text-xs break-all"
                  data-testid="tasks-excluded-name"
                >
                  {{ folder.folderName }}
                </span>
                <span
                  class="badge badge-xs badge-warning badge-outline font-mono"
                >
                  {{ folder.reason }}
                </span>
              </div>
              <p
                class="text-xs text-base-content-muted"
                data-testid="tasks-excluded-reason"
              >
                {{ folder.reasonLabel }}
              </p>
            </li>
          }
        </ul>
      } @else if (store.excludedNamesUnavailable()) {
        <p
          class="text-xs text-base-content-muted"
          data-testid="tasks-excluded-unnamed"
        >
          This host reported {{ store.excludedCount() }} skipped folder(s) but
          did not name them. Run Reindex; if the list stays empty the host
          predates the named-exclusion contract and must be updated.
        </p>
      } @else {
        <p class="text-xs text-base-content-muted">
          Nothing is being skipped — every task folder on disk is on the board.
        </p>
      }
    </ptah-native-drawer>
  `,
})
export class TasksViewComponent {
  protected readonly store = inject(TasksStore);
  protected readonly taskStart = inject(TaskStartService);
  protected readonly views = inject(TaskViewsService);

  protected readonly taskTypes = TASK_TYPES;

  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createTitle = signal('');
  protected readonly createType = signal<TaskType>('FEATURE');
  protected readonly createDescription = signal('');

  protected readonly canCreate = computed(
    () => this.createTitle().trim().length > 0,
  );

  /** Workspace-relative spec root, named in the drawer copy. */
  protected readonly specRoot = SPEC_ROOT;

  protected readonly exclusionsOpen = signal(false);
  protected readonly paletteOpen = signal(false);

  /**
   * The task the detail panel is open on, resolved against the loaded board.
   *
   * The palette's selection-scoped actions need the task's CURRENT labels and
   * status to decide what running them would write, and `store.taskDetail()`
   * is a separate fetch that lags the board. Reading the board payload keeps
   * the palette's arithmetic and the card's rendering on the same snapshot.
   */
  private readonly selectedTask = computed<TaskSpecSummary | null>(() => {
    const id = this.store.selectedTaskId();
    if (id === null) return null;
    return this.store.allTasks().find((task) => task.id === id) ?? null;
  });

  /**
   * Every command the palette offers, rebuilt from the board snapshot.
   *
   * A `computed()` over payload that is already in hand — it issues no RPC and
   * triggers no reload, exactly like the filter path it reads (FR-C1.4).
   */
  protected readonly paletteEntries = computed(() =>
    buildPaletteEntries({
      tasks: this.store.allTasks(),
      views: this.views.views(),
      filter: this.store.filter(),
      knownLabels: this.store.knownLabels(),
      knownExecutors: this.store.knownExecutors(),
      estimatesInUse: this.estimatesInUse(),
      selectedTask: this.selectedTask(),
      selectionCount: this.store.selectionCount(),
      excludedCount: this.store.excludedCount(),
      busy: this.store.busy() || this.store.loading(),
    }),
  );

  /**
   * Whether the bulk bar has anything to say.
   *
   * Three states keep it up, and the last two matter: a run in flight owns the
   * only Cancel button there is, and a pending confirmation owns the only
   * Confirm. Gating the bar on the selection count alone would make both
   * unreachable the moment a selection emptied underneath them.
   */
  protected readonly bulkBarVisible = computed(
    () =>
      this.store.selectionCount() > 0 ||
      this.store.bulk() !== null ||
      this.store.bulkRequest() !== null,
  );

  /**
   * The last run's summary, but only while nothing newer is being decided.
   *
   * Returns `null` — so the `@if` drops the panel entirely — whenever a
   * confirmation is pending or a run is in flight. The summary is NOT cleared;
   * declining the confirmation brings it straight back, because the failure
   * list is what the user was reading in order to decide.
   */
  protected readonly bulkSummaryVisible = computed(() => {
    if (this.store.bulkRequest() !== null) return null;
    if (this.store.bulk() !== null) return null;
    return this.store.bulkSummary();
  });

  /**
   * The estimate buckets that actually hold a task.
   *
   * Offering all five sizes unconditionally would put four commands that match
   * nothing in front of a workspace that only ever uses `M` — the same reason
   * the filter bar shows counts rather than an unconditional list.
   */
  private readonly estimatesInUse = computed<readonly TaskEstimate[]>(() => {
    const sized = this.store.estimateBuckets().sized;
    return TASK_ESTIMATES.filter((estimate) => sized[estimate] > 0);
  });

  /**
   * The saved-views menu's in-flight name drafts, and which row is being
   * renamed.
   *
   * Held here rather than inside the menu because only this component learns
   * whether a write landed — {@link onViewCreated} and {@link onViewRenamed}. A
   * refused create or rename (`CAP_EXCEEDED`, a failed write) leaves the typed
   * name where the user can correct or retry it, instead of clearing the box on
   * a write that never reached disk.
   */
  protected readonly viewNameDraft = signal('');
  protected readonly viewRenamingId = signal<string | null>(null);
  protected readonly viewRenameDraft = signal('');

  /** True while a metadata write issued from the detail panel is outstanding. */
  protected readonly writing = signal(false);

  /**
   * Every board-visible task id, for the detail panel's parent and relation
   * completion. Read off the memoized graph rather than re-flattening the
   * columns, so it costs one map read per change of the board payload.
   */
  protected readonly knownTaskIds = computed<readonly string[]>(() => [
    ...this.store.graph().byId.keys(),
  ]);

  /**
   * Excluded folders decorated with the human sentence for their typed reason.
   * The raw `reason` token is rendered alongside it — the token is what appears
   * in logs and in the backend contract, the sentence is what tells the user
   * what to fix.
   */
  protected readonly excludedFolders = computed<readonly ExcludedFolderRow[]>(
    () =>
      this.store.excludedFolders().map((folder) => ({
        ...folder,
        reasonLabel: taskExclusionReasonLabel(folder.reason),
      })),
  );

  protected readonly ClipboardListIcon = ClipboardList;
  protected readonly CommandIcon = Command;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly FilterXIcon = FilterX;
  protected readonly FileTextIcon = FileText;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;

  public constructor() {
    void this.store.loadBoard();
    // Independent of the board load, and deliberately not awaited behind it:
    // saved views live in `~/.ptah/settings.json`, not in the task index, so a
    // settings file that cannot be read must not delay or block the board
    // (NFR-11). The reverse holds too — a failed board load still leaves the
    // views menu usable.
    void this.views.load();
  }

  protected setCreateType(value: string): void {
    if (this.store.isKnownType(value)) {
      this.createType.set(value);
    }
  }

  protected openCreate(): void {
    this.createTitle.set('');
    this.createType.set('FEATURE');
    this.createDescription.set('');
    this.createOpen.set(true);
  }

  protected closeCreate(): void {
    this.createOpen.set(false);
  }

  protected openExclusions(): void {
    this.exclusionsOpen.set(true);
  }

  protected openPalette(): void {
    this.paletteOpen.set(true);
  }

  protected closePalette(): void {
    this.paletteOpen.set(false);
  }

  /**
   * The palette shortcut, and nothing else (FR-C6.1, R10).
   *
   * ## Bound to the host element, never to `window` or `document`
   *
   * See the `host` metadata above. A `document` listener would fire while the
   * user was anywhere else in the webview — the chat composer, the editor, the
   * marketplace — and "Ctrl+K stopped working in chat because the Tasks tab is
   * open somewhere" is not a bug anyone would successfully report. Because the
   * binding is host-scoped, the shortcut exists only while focus is inside the
   * Tasks surface, and the host application keeps every combination it owns
   * whenever focus is anywhere else.
   *
   * ## Ignored inside text entry
   *
   * `isTextEntryTarget` short-circuits every key whose target is an `<input>`,
   * `<textarea>`, `<select>` or `[contenteditable]` — including the filter
   * bar's free-text box, the New Task form, and the palette's own query input.
   *
   * ## `preventDefault` only on consumption
   *
   * The one combination this consumes is `Ctrl/Cmd+K` without `Alt`. Every
   * other key returns untouched, so nothing this component does can stop a key
   * it did not act on from reaching the host.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    if (isTextEntryTarget(event.target)) return;
    if (event.altKey) return;
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key.toLowerCase() !== 'k') return;

    this.openPalette();
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Run one palette action.
   *
   * The `switch` is exhaustive over `TaskPaletteAction['kind']` and the
   * `never` assignment at the end is what enforces it: an action variant added
   * to the catalogue without an arm here fails typecheck rather than silently
   * doing nothing when a user presses Enter on it.
   *
   * The palette closes on every run, including the filter toggles. Closing on
   * some actions and not others would mean the surface behaves differently
   * depending on which command you picked, which is a worse trade than the
   * extra keystroke to re-open it for a second toggle.
   *
   * **BR-8 / R12**: there is no `start` arm, because there is no `start`
   * variant. `TaskStartService` is injected by this component for the CARD's
   * Start button, which predates this batch and is untouched — the palette
   * neither reads it nor reaches it.
   */
  protected onPaletteRun(action: TaskPaletteAction): void {
    this.closePalette();
    switch (action.kind) {
      case 'openTask':
        void this.store.openTask(action.taskId);
        return;
      case 'applyView':
        void this.views.applyView(action.viewId);
        return;
      case 'setStatus':
        void this.store.updateStatus(action.taskId, action.status);
        return;
      case 'setLabels':
        void this.store.applyMetadata(action.taskId, {
          labels: [...action.labels],
        });
        return;
      case 'bulkSetStatus':
        // FR-C6.7: the SAME entry point the bulk bar's picker calls, so a
        // palette-launched move over 40 tasks asks for confirmation exactly as
        // the bar's does. There is no second route into `bulkUpdateStatus`
        // from this dispatcher, and adding one would be the whole failure.
        this.store.requestBulkStatus(action.status);
        return;
      case 'createTask':
        this.openCreate();
        return;
      case 'setFilter':
        this.store.setFilter(action.filter);
        return;
      case 'clearFilter':
        this.store.clearFilter();
        return;
      case 'openExclusions':
        this.openExclusions();
        return;
      case 'reindex':
        void this.store.reindex();
        return;
      default: {
        const unhandled: never = action;
        void unhandled;
        return;
      }
    }
  }

  /**
   * Space on the focused card (FR-C7.2) — add or remove it from the
   * multi-selection.
   *
   * ## This is one of the two seam reducers, re-pointed
   *
   * The event was plumbed card → column → board → here by the batch that built
   * the keyboard navigation, with a body that toggled the DETAIL PANEL, because
   * the multi-select model did not exist yet and that was the only selection
   * there was to toggle. FR-C4's model exists now, and re-pointing it meant
   * changing this method body and nothing else: the card still emits "Space
   * happened on this card", the column still forwards it, the board still
   * tracks focus through it. Neither component was edited for this.
   *
   * It deliberately no longer opens or closes the detail panel. Space is now
   * the keyboard equivalent of the checkbox, which is what FR-C7.2 asked for,
   * and Enter remains the key that opens.
   */
  protected onTaskToggle(taskId: string): void {
    this.store.toggleSelection(taskId);
  }

  /**
   * A pointer selection gesture — the checkbox, Ctrl-click, or Shift-click.
   *
   * The store owns what a range means, because it is the only thing that can
   * see the filtered, sorted, column-flattened order the range resolves
   * against (plan §6.3). This method only routes the gesture.
   */
  protected onSelectionToggle(toggle: TaskSelectionToggle): void {
    if (toggle.range) {
      this.store.selectRangeTo(toggle.taskId);
      return;
    }
    this.store.toggleSelection(toggle.taskId);
  }

  /**
   * Escape on the board (FR-C7.3) — the second seam reducer, also re-pointed.
   *
   * FR-C7.3 always described two branches, and until FR-C4 there was one
   * selection model for them to branch on, so they collapsed into one act. Now
   * they do not: clear the multi-selection first, and close the detail panel
   * only when there is no selection to clear.
   *
   * That order is the recoverable one. A selection can cost a user twelve
   * clicks and cannot be restored; a detail panel is one click away. When both
   * are open, Escape should discard the cheap thing first.
   *
   * Like {@link onTaskToggle}, this changed here and nowhere else —
   * `TaskBoardComponent` still emits "Escape happened on the board" and has no
   * opinion about what that means.
   */
  protected onBoardEscape(): void {
    if (this.store.selectionCount() > 0) {
      this.store.clearSelection();
      return;
    }
    if (this.store.selectedTaskId() !== null) this.store.closeTask();
  }

  /** The drawer only ever *requests* closure; this component owns `isOpen`. */
  protected closeExclusions(): void {
    this.exclusionsOpen.set(false);
  }

  protected async submitCreate(): Promise<void> {
    if (!this.canCreate() || this.creating()) return;
    this.creating.set(true);
    try {
      const description = this.createDescription().trim();
      const result = await this.store.createTask({
        title: this.createTitle().trim(),
        type: this.createType(),
        ...(description ? { description } : {}),
      });
      if (result?.success) {
        this.createOpen.set(false);
      }
    } finally {
      this.creating.set(false);
    }
  }

  /**
   * Save the board's current lens as a new view, clearing the typed name ONLY
   * once the write has actually landed.
   *
   * `createView` resolves `false` for a refusal that never reached disk — the
   * 50-view cap resolves as a typed result rather than throwing — and the name
   * has to survive that, because the cap is precisely the case a user hits
   * after deliberately naming one more view.
   */
  protected async onViewCreated(name: string): Promise<void> {
    if (await this.views.createView(name)) {
      this.viewNameDraft.set('');
    }
  }

  /**
   * Rename one saved view, closing the inline row only once the write landed.
   *
   * The same rule as {@link onViewCreated}, applied to the control beside it. A
   * rename loses less on a refusal — the original name is still on screen in
   * the row — but two adjacent controls that discard typed input under
   * different rules is the inconsistency, not the data loss.
   */
  protected async onViewRenamed(rename: TaskViewRename): Promise<void> {
    if (await this.views.renameView(rename.id, rename.name)) {
      this.viewRenamingId.set(null);
      this.viewRenameDraft.set('');
    }
  }

  protected onStatusChange(change: TaskStatusChange): void {
    void this.store.updateStatus(change.taskId, change.status);
  }

  /**
   * Route a detail-panel edit to the single client mutation funnel.
   *
   * `write.taskId` is used, never `store.selectedTaskId()`: the "this task
   * blocks X" affordance targets X's carrier, because that is where the edge is
   * authored. Substituting the open task here would write the wrong file.
   *
   * The store serializes per task on its own; the `writing` flag is only a UI
   * affordance so the panel's controls read as busy rather than as available.
   */
  protected async onApplyMetadata(write: TaskMetadataWrite): Promise<void> {
    this.writing.set(true);
    try {
      await this.store.applyMetadata(write.taskId, write.patch);
    } finally {
      this.writing.set(false);
    }
  }

  /**
   * Launch orchestration for the task. Delegates the full sequence (optional
   * worktree, chat-prompt bridge, status transition on success) to
   * {@link TaskStartService}; the board reflects the `in_progress` move via the
   * authoritative re-fetch inside `TasksStore.updateStatus` (no optimism).
   */
  protected onStartTask(request: TaskStartRequest): void {
    void this.taskStart.start(request.taskId, request.isolate);
  }
}
