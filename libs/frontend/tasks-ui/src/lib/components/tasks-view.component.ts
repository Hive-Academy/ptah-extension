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
  Columns3,
  Command,
  EyeOff,
  FileText,
  FilterX,
  FolderOpen,
  List,
  LucideAngularModule,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-angular';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import {
  SPEC_ROOT,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  type ExcludedTaskFolder,
  type TaskEstimate,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';
import { TasksStore } from '../services/tasks-store.service';
import { TaskStartService } from '../services/task-start.service';
import { TaskViewsService } from '../services/task-views.service';
import {
  TASK_VIEW_MODES,
  TASK_VIEW_MODE_LABELS,
  TaskViewModeService,
  type TaskViewMode,
} from '../services/task-view-mode.service';
import { TaskBoardComponent } from './board/task-board.component';
import { TaskListComponent } from './board/task-list.component';
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
import {
  TASK_STATUS_LABELS,
  taskExclusionReasonLabel,
} from '../task-presentation';

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
    TaskListComponent,
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
  template:
    `
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

        <!-- Layout switcher. A segmented control rather than a menu: there are
             two options, both are always available, and which one is active is
             the single most useful thing this header can state at rest.
             aria-pressed carries the active state, so it is announced rather
             than being available only as a background colour. -->
        <div class="join ml-1" role="group" aria-label="Task layout">
          @for (mode of viewModes; track mode) {
            <button
              type="button"
              class="btn btn-xs join-item gap-1"
              [class.btn-active]="viewMode.mode() === mode"
              [class.btn-ghost]="viewMode.mode() !== mode"
              [attr.aria-pressed]="viewMode.mode() === mode"
              [attr.data-testid]="'tasks-view-mode-' + mode"
              [title]="modeTitle(mode)"
              (click)="viewMode.setMode(mode)"
            >
              <lucide-angular
                [img]="mode === 'kanban' ? Columns3Icon : ListIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
              <span class="text-xs">{{ modeLabel(mode) }}</span>
            </button>
          }
        </div>

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

        <!-- Every header action below writes into .ptah/specs through the tasks
             RPC namespace, so with no folder open each one can only earn the
             same WORKSPACE_NOT_OPEN refusal — as a red error banner over a
             panel that has just explained, calmly, that no folder is open.
             Disabling them is what makes "the no-workspace state offers no
             create affordance" true of the whole screen rather than of one
             block in the middle of it. The palette trigger is deliberately left
             enabled: it acts on the board and the selection, both empty here,
             and it is also how a user finds out what this surface can do. -->
        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          [disabled]="store.busy() || !store.canWriteSpecs()"
          title="Regenerate registry.md"
          (click)="store.generateRegistry()"
        >
          <lucide-angular [img]="FileTextIcon" class="w-3.5 h-3.5" />
          <span class="text-xs">Registry</span>
        </button>

        <!-- DESTRUCTIVE, and deliberately not a one-click control: it opens
             a PREVIEW. The delete only happens from the confirmation inside,
             against the list the preview showed. -->
        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          [disabled]="store.busy() || store.sweeping() || !store.canWriteSpecs()"
          data-testid="tasks-sweep-trigger"
          aria-haspopup="dialog"
          title="Preview which finished tasks would be deleted"
          (click)="openSweep()"
        >
          <lucide-angular [img]="Trash2Icon" class="w-3.5 h-3.5" />
          <span class="text-xs">Tidy finished</span>
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          [disabled]="store.busy() || store.loading() || !store.canWriteSpecs()"
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
          data-testid="tasks-create-trigger"
          [disabled]="!store.canWriteSpecs()"
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
          (labelPicked)="store.requestBulkLabel($event.label, $event.mode)"
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
          (retry)="store.requestBulk($event)"
          (dismissed)="store.clearBulkSummary()"
        />
      }

      <!-- Body -->
      <div class="flex flex-1 min-h-0">
        @if (store.loading() && !store.loaded()) {
          <div class="flex items-center justify-center flex-1">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        } @else if (store.noWorkspace()) {
          <!-- THE THIRD EMPTY CASE, and the reason it is not one of the other
               two: the board reads .ptah/specs out of the open folder, and the
               host refuses the whole tasks RPC namespace when there is no
               folder to read it from (a typed WORKSPACE_NOT_OPEN, not a
               failure). So this is neither "no tasks yet" nor "the filter hides
               them" — nothing about it is fixed on this screen.

               NO CREATE CTA, deliberately. A task is a folder under
               .ptah/specs; with no workspace there is nowhere to put one, so a
               "Create your first task" button here is a control that can only
               produce the same refusal the user is already reading. The
               filtered-empty block below makes the same call for the same
               reason and is the shape this copies.

               "Check again" is the one control, and it is not the recovery
               path — opening a folder is, and that reloads the board by itself
               (TasksStore.onWorkspaceSwitch, off the AppStateManager workspace
               signal). It is here for the case the webview's view of the
               workspace has drifted from the host's, which is exactly the case
               this state cannot detect locally. One click, one request: it
               re-asks, it does not resume polling. -->
          <div
            class="flex flex-col items-center justify-center flex-1 text-center gap-3 p-6"
            data-testid="tasks-no-workspace"
          >
            <lucide-angular
              [img]="FolderOpenIcon"
              class="w-10 h-10 text-base-content-muted"
              aria-hidden="true"
            />
            <div class="flex flex-col gap-1">
              <p class="text-sm font-medium text-base-content">
                No folder is open
              </p>
              <p class="text-xs text-base-content-muted max-w-xs">
                The board reads tasks from
                <span class="font-mono">{{ specRoot }}</span> inside the open
                folder. Open one and its board loads here — nothing needs to be
                created first.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline gap-1"
              data-testid="tasks-no-workspace-retry"
              [disabled]="store.loading()"
              (click)="store.loadBoard()"
            >
              Check again
            </button>
          </div>
        } @else if (store.isEmpty()) {
          <!-- Empty state with create CTA -->
          <div
            class="flex flex-col items-center justify-center flex-1 text-center gap-3 p-6"
          >
            <!-- Decorative and redundant with the sentence below it, so it is
                 hidden from the accessibility tree and exempt from the
                 text-contrast gate — the same call the filtered-empty glyph
                 below makes, and now the same attribute backing it. The
                 no-alpha ratchet records BOTH glyphs in this file as
                 decorative exceptions; only one of the two carried the
                 attribute, so the exemption did not actually apply here, and
                 the ratchet could not tell because it keys on the class string
                 and a count. -->
            <lucide-angular
              [img]="ClipboardListIcon"
              class="w-12 h-12 text-base-content/20"
              aria-hidden="true"
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
          <!-- In LIST mode with a task open, the list becomes a fixed-width
               navigation rail and the detail panel takes the rest — a task
               body is prose, and 384px is not a width anyone wants to read
               prose in. The Kanban keeps the opposite split, because a
               six-column board narrowed to a rail is not a board. -->
          <div
            class="min-w-0"
            [class.flex-1]="!detailRail()"
            [class.w-96]="detailRail()"
            [class.flex-none]="detailRail()"
          >
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
            } @else if (viewMode.mode() === 'list') {
              <!-- Same board model, same six outputs as the Kanban. The two
                   layouts are interchangeable here on purpose: a facet added
                   to the filter, or a new bulk state, reaches both without
                   either being taught about it. -->
              <ptah-task-list
                [columns]="store.board()"
                [graph]="store.graph()"
                [compact]="detailRail()"
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
                (createInStatus)="openCreate($event)"
              />
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
              [wide]="detailRail()"
              [detail]="store.taskDetail()"
              [graph]="store.graph()"
              [knownLabels]="store.knownLabels()"
              [knownTaskIds]="knownTaskIds()"
              [busy]="writing()"
              [loading]="store.detailLoading()"
              [openDocument]="store.openDocument()"
              [documentContent]="store.documentContent()"
              [documentLoading]="store.documentLoading()"
              (closed)="store.closeTask()"
              (readDocument)="store.readDocument($event)"
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

            <!-- Editable, and pre-set by whichever ` +
    ` opened this. Showing it
                 as a read-only note would leave the one control the group
                 button implies — "put it somewhere else after all" — with no
                 way to reach it short of cancelling and starting again. -->
            <label class="form-control">
              <span class="label-text text-xs mb-1">Status</span>
              <select
                class="select select-sm select-bordered"
                data-testid="tasks-create-status"
                [ngModel]="createStatus()"
                (ngModelChange)="setCreateStatus($event)"
                aria-label="Task status"
              >
                @for (status of taskStatuses; track status) {
                  <option [value]="status">{{ statusLabel(status) }}</option>
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


    <!-- Retention sweep. Preview first, ALWAYS: the confirm button names the
         exact count, and the list above it names every folder. A delete whose
         scope the user has to infer is one they cannot meaningfully agree to. -->
    @if (store.sweep(); as plan) {
      <dialog class="modal modal-open">
        <div class="modal-box max-w-2xl">
          <h3 class="text-base font-semibold mb-1">
            @if (plan.previewOnly) {
              Delete finished tasks older than {{ sweepDays() }} days?
            } @else {
              Swept {{ plan.deleted.length }} finished task(s)
            }
          </h3>

          @if (plan.previewOnly) {
            <p class="text-xs text-base-content-muted mb-3">
              This deletes the folders from disk. Committed folders stay
              recoverable with <span class="font-mono">git show</span>; anything
              git has not seen is skipped rather than destroyed.
            </p>
          }

          @if (plan.candidates.length === 0) {
            <p class="text-sm" data-testid="tasks-sweep-empty">
              Nothing has aged out. No finished task is older than
              {{ sweepDays() }} days.
            </p>
          } @else {
            <div class="max-h-72 overflow-y-auto rounded border border-base-300">
              <table class="w-full text-xs">
                <tbody>
                  @for (item of plan.candidates; track item.taskId) {
                    <tr
                      class="border-b border-base-300/60"
                      [attr.data-testid]="'tasks-sweep-row-' + item.taskId"
                    >
                      <td class="px-2 py-1 font-mono">{{ item.taskId }}</td>
                      <td class="px-2 py-1">{{ statusLabel(item.status) }}</td>
                      <td class="px-2 py-1 tabular-nums text-base-content-muted">
                        {{ item.ageDays }}d old
                      </td>
                      <td class="px-2 py-1">
                        @if (!item.committed) {
                          <span
                            class="badge badge-xs badge-warning"
                            title="git has no copy of this folder, so deleting it could not be undone. It will be skipped."
                            >not in git — skipped</span
                          >
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (!plan.previewOnly && plan.skipped.length > 0) {
            <p
              class="mt-3 text-xs text-warning"
              data-testid="tasks-sweep-skipped"
            >
              {{ plan.skipped.length }} folder(s) were left alone — see the
              badges above.
            </p>
          }

          <div class="modal-action mt-4">
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              (click)="store.clearSweep()"
            >
              @if (plan.previewOnly) {
                Cancel
              } @else {
                Close
              }
            </button>
            @if (plan.previewOnly && deletableCount() > 0) {
              <button
                type="button"
                class="btn btn-sm btn-error"
                [disabled]="store.sweeping()"
                data-testid="tasks-sweep-confirm"
                (click)="confirmSweep()"
              >
                @if (store.sweeping()) {
                  <span class="loading loading-spinner loading-xs"></span>
                }
                Delete {{ deletableCount() }} folder(s)
              </button>
            }
          </div>
        </div>
        <button
          type="button"
          class="modal-backdrop"
          aria-label="Close"
          (click)="store.clearSweep()"
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
  protected readonly viewMode = inject(TaskViewModeService);

  protected readonly taskTypes = TASK_TYPES;
  protected readonly taskStatuses = TASK_STATUSES;
  protected readonly viewModes = TASK_VIEW_MODES;

  /**
   * The list is a navigation rail beside an open task (list mode only).
   *
   * Drives three things at once so they cannot disagree: the list drops its
   * scanning columns, its wrapper stops flexing and takes a fixed width, and
   * the detail panel takes the space that frees up. In Kanban mode it is always
   * false — a board narrowed to 384px is not a board.
   */
  protected readonly detailRail = computed(
    () =>
      this.viewMode.mode() === 'list' && this.store.selectedTaskId() !== null,
  );

  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createTitle = signal('');
  protected readonly createType = signal<TaskType>('FEATURE');
  /** Status the new task opens in — set by whichever `+` was pressed. */
  protected readonly createStatus = signal<TaskStatus>('backlog');
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
      // The SAME signal the header buttons are disabled from. The palette is a
      // keyboard-driven second entry point to the same commands, and gating it
      // separately is how "Create a task" and "Reindex" stayed reachable with
      // no folder open after the header had been closed off.
      canWriteSpecs: this.store.canWriteSpecs(),
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

  /**
   * How many days of finished work to keep. Not user-editable yet — a single
   * stated default beats a field nobody sets, and the preview makes the
   * consequence of the number visible before anything happens.
   */
  protected readonly sweepDays = signal(7);

  /**
   * How many the confirm button would actually delete.
   *
   * Uncommitted candidates are excluded, because the backend refuses them —
   * a button offering to delete 12 when 3 will survive is the button lying.
   */
  protected readonly deletableCount = computed(
    () => this.store.sweep()?.candidates.filter((c) => c.committed).length ?? 0,
  );

  protected async openSweep(): Promise<void> {
    await this.store.previewSweep(this.sweepDays());
  }

  protected async confirmSweep(): Promise<void> {
    await this.store.applySweep(this.sweepDays());
  }

  protected modeLabel(mode: TaskViewMode): string {
    return TASK_VIEW_MODE_LABELS[mode];
  }

  protected modeTitle(mode: TaskViewMode): string {
    return mode === 'kanban'
      ? 'Kanban — six status columns of cards'
      : 'List — one scrolling table, grouped by status';
  }

  protected readonly ClipboardListIcon = ClipboardList;
  protected readonly Columns3Icon = Columns3;
  protected readonly ListIcon = List;
  protected readonly CommandIcon = Command;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly FilterXIcon = FilterX;
  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly FileTextIcon = FileText;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly PlusIcon = Plus;
  protected readonly Trash2Icon = Trash2;
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

  /** Narrowed rather than cast — the select's value is a bare string. */
  protected setCreateStatus(value: string): void {
    if ((TASK_STATUSES as readonly string[]).includes(value)) {
      this.createStatus.set(value as TaskStatus);
    }
  }

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }

  /**
   * Open the create modal, optionally opening the task in a given status.
   *
   * `status` comes from a list group's `+`. Omitted — the header's New Task
   * button — means `backlog`, which is where every create landed before the
   * per-group control existed.
   */
  protected openCreate(status: TaskStatus = 'backlog'): void {
    this.createTitle.set('');
    this.createType.set('FEATURE');
    this.createStatus.set(status);
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
      const status = this.createStatus();
      const result = await this.store.createTask({
        title: this.createTitle().trim(),
        type: this.createType(),
        // Omitted for `backlog` so the header's New Task keeps producing the
        // exact params — and therefore the exact carrier bytes — it always did.
        ...(status === 'backlog' ? {} : { status }),
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
