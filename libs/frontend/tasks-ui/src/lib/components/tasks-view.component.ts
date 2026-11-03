import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import {
  SPEC_ROOT,
  TASK_ESTIMATES,
  type TaskEstimate,
  type TaskSpecSummary,
  type TaskStatus,
} from '@ptah-extension/shared';
import { TasksStore } from '../services/tasks-store.service';
import { TaskStartService } from '../services/task-start.service';
import { TaskAgentDiscoveryService } from '../services/task-agent-discovery.service';
import { TaskViewsService } from '../services/task-views.service';
import { TaskViewModeService } from '../services/task-view-mode.service';
import { TaskBoardComponent } from './board/task-board.component';
import { TaskListComponent } from './board/task-list.component';
import type {
  TaskSelectionToggle,
  TaskStatusChange,
} from './board/task-card.component';
import type { TaskStartRequest } from '../types/task-agent.types';
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
import { TaskBoardHeaderComponent } from './task-board-header.component';
import {
  TaskBoardStatesComponent,
  type TaskBoardStateKind,
} from './task-board-states.component';
import {
  TaskCreateDialogComponent,
  type TaskCreateDraft,
} from './task-create-dialog.component';
import { TaskMaintenanceDialogComponent } from './task-maintenance-dialog.component';

/**
 * TasksViewComponent
 *
 * Top-level standalone Tasks surface. Composes the header, the saved-view and
 * filter toolbar, the disk status rail, the board or list, the detail panel,
 * the bulk region and the dialogs. All data flows through {@link TasksStore};
 * this component holds only which transient surface is open.
 *
 * Start delegates to {@link TaskStartService} (chat prefill, optional worktree
 * isolation, then `TasksStore.updateStatus`), keeping this lib free of any
 * `chat` import (NFR-11).
 */
@Component({
  selector: 'ptah-tasks-view',
  standalone: true,
  imports: [
    LucideAngularModule,
    TaskBoardHeaderComponent,
    TaskBoardStatesComponent,
    TaskCreateDialogComponent,
    TaskMaintenanceDialogComponent,
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
  template: `
    <!-- bg-base-100 is surface-0 (styles.css --surface-0: oklch(var(--b1)));
         the class stays because the glass theme clears exactly
         "ptah-tasks-view > .bg-base-100". -->
    <div
      class="flex h-full w-full min-w-0 flex-col overflow-hidden bg-base-100 font-sans text-base-content"
    >
      <ptah-task-board-header
        [totalCount]="store.totalCount()"
        [activeCount]="store.activeCount()"
        [doneCount]="store.doneCount()"
        [mode]="viewMode.mode()"
        [paletteOpen]="paletteOpen()"
        [canWrite]="store.canWriteSpecs()"
        [busy]="store.busy()"
        [loading]="store.loading()"
        [sweeping]="store.sweeping()"
        [excludedCount]="store.excludedCount()"
        (modeChange)="viewMode.setMode($event)"
        (openPalette)="openPalette()"
        (reindex)="store.reindex()"
        (generateRegistry)="store.generateRegistry()"
        (openSweep)="openSweep()"
        (openExclusions)="openExclusions()"
        (createTask)="openCreate()"
      />

      @if (store.actionMessage(); as message) {
        <div
          class="flex items-center gap-2 border-b border-surface-border bg-surface-1 px-4 py-2 text-sm text-base-content"
          role="status"
          data-testid="tasks-action-message"
        >
          <span class="min-w-0 flex-1">{{ message }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square"
            aria-label="Dismiss"
            (click)="store.clearActionMessage()"
          >
            <lucide-angular [img]="XIcon" class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      }
      @if (store.error(); as error) {
        <div
          class="flex items-center gap-2 border-b border-surface-border bg-surface-1 px-4 py-2 text-sm"
          role="alert"
          data-testid="tasks-error"
        >
          <span class="min-w-0 flex-1 text-error">{{ error }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-testid="tasks-error-retry"
            [disabled]="store.loading()"
            (click)="store.loadBoard()"
          >
            Retry
          </button>
        </div>
      }
      @if (taskStart.error(); as startError) {
        <div
          class="flex items-center gap-2 border-b border-surface-border bg-surface-1 px-4 py-2 text-sm"
          role="alert"
          data-testid="tasks-start-error"
        >
          <span class="min-w-0 flex-1 text-error">{{ startError }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square"
            aria-label="Dismiss"
            (click)="taskStart.clearError()"
          >
            <lucide-angular [img]="XIcon" class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      }

      <!-- Saved views + filter. Rendered whenever the board holds anything:
           hiding it once a filter empties the board would remove the only
           control that can undo that (FR-C1.3). -->
      @if (store.totalIndexed() > 0) {
        <div
          class="flex flex-shrink-0 flex-wrap items-start gap-2 border-b border-surface-border bg-surface-1 p-3 text-base-content"
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
          <ptah-task-filter-bar
            class="min-w-0 flex-1"
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
        </div>
      }

      @if (store.loaded() && !store.noWorkspace()) {
        <div
          class="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-surface-border px-4 py-2 text-xs text-base-content-muted"
          data-testid="tasks-status-rail"
        >
          <span class="font-semibold text-base-content">From disk</span>
          <span aria-hidden="true">·</span>
          <span class="font-mono">{{ specRoot }}/</span>
          @if (store.excludedCount() > 0) {
            <span aria-hidden="true">·</span>
            <button
              type="button"
              class="rounded-btn px-1 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              aria-haspopup="dialog"
              [attr.aria-expanded]="exclusionsOpen()"
              data-testid="tasks-excluded-trigger"
              title="Show every folder the board skipped, and why"
              (click)="openExclusions()"
            >
              {{ store.excludedCount() }} excluded folder(s) — see why
            </button>
          }
          <span aria-hidden="true">·</span>
          <span aria-live="polite" data-testid="tasks-refresh-state">
            @if (store.loading() || store.busy()) {
              Refreshing…
            } @else {
              Updated just now
            }
          </span>
        </div>
      }

      @if (bulkSummaryVisible(); as summary) {
        <ptah-task-bulk-summary
          [summary]="summary"
          (retry)="store.requestBulk($event)"
          (dismissed)="store.clearBulkSummary()"
        />
      }

      <div class="flex min-h-0 flex-1">
        @if (boardState(); as state) {
          <ptah-task-board-states
            [kind]="state"
            [specsDirExists]="store.specsDirExists()"
            [totalIndexed]="store.totalIndexed()"
            [busy]="store.loading()"
            (retry)="store.loadBoard()"
            (create)="openCreate()"
            (clearFilter)="store.clearFilter()"
          />
        } @else {
          <!-- List mode with a task open: the list becomes a fixed-width rail
               and the detail panel takes the rest. The Kanban keeps the
               opposite split, because six lanes narrowed to a rail are not a
               board. -->
          <div
            class="min-w-0"
            [class.flex-1]="!detailRail()"
            [class.w-96]="detailRail()"
            [class.flex-none]="detailRail()"
          >
            @if (viewMode.mode() === 'list') {
              <ptah-task-list
                [columns]="store.board()"
                [graph]="store.graph()"
                [compact]="detailRail()"
                [selectedTaskId]="store.selectedTaskId()"
                [selection]="store.selection()"
                [pending]="store.pending()"
                [outcomes]="store.lastRunOutcomes()"
                [agentTargets]="agentDiscovery.availableAgents()"
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
                [agentTargets]="agentDiscovery.availableAgents()"
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
        }

        @if (store.selectedTaskId() && detailAllowed()) {
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
      </div>

      <!-- The bulk region docks at the content bottom only while there is
           something to act on: a selection, a pending confirmation, or a run
           in flight (the last two own the only Confirm and Cancel there are). -->
      @if (bulkBarVisible()) {
        <div class="flex-shrink-0 px-4 pb-3 pt-2">
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
        </div>
      }
    </div>

    <!-- Rendered inside an @if so closing DESTROYS it — the single close path
         its focus restore hangs off. -->
    @if (paletteOpen()) {
      <ptah-task-command-palette
        [entries]="paletteEntries()"
        (run)="onPaletteRun($event)"
        (closed)="closePalette()"
      />
    }

    @if (createStatus(); as status) {
      <ptah-task-create-dialog
        [initialStatus]="status"
        [creating]="creating()"
        (submitted)="submitCreate($event)"
        (cancelled)="closeCreate()"
      />
    }

    <ptah-task-maintenance-dialog
      [sweep]="store.sweep()"
      [sweepDays]="sweepDays"
      [sweeping]="store.sweeping()"
      [exclusionsOpen]="exclusionsOpen()"
      [excludedCount]="store.excludedCount()"
      [excludedFolders]="store.excludedFolders()"
      [namesUnavailable]="store.excludedNamesUnavailable()"
      (sweepClosed)="store.clearSweep()"
      (sweepConfirmed)="confirmSweep()"
      (exclusionsClosed)="closeExclusions()"
    />
  `,
})
export class TasksViewComponent {
  protected readonly store = inject(TasksStore);
  protected readonly taskStart = inject(TaskStartService);
  protected readonly agentDiscovery = inject(TaskAgentDiscoveryService);
  protected readonly views = inject(TaskViewsService);
  protected readonly viewMode = inject(TaskViewModeService);
  private readonly destroyRef = inject(DestroyRef);

  /** Workspace-relative spec root, named in the status rail. */
  protected readonly specRoot = SPEC_ROOT;
  /** Retention policy for the finished-task sweep. */
  protected readonly sweepDays = 7;
  protected readonly XIcon = X;

  /**
   * The list is a navigation rail beside an open task (list mode only).
   * Drives the list's compact columns, its fixed width and the detail panel's
   * share together, so they cannot disagree.
   */
  protected readonly detailRail = computed(
    () =>
      this.viewMode.mode() === 'list' && this.store.selectedTaskId() !== null,
  );

  /** Which whole-board panel replaces the lanes, or `null` for the lanes. */
  protected readonly boardState = computed<TaskBoardStateKind | null>(() => {
    if (this.store.loading() && !this.store.loaded()) return 'loading';
    if (this.store.noWorkspace()) return 'no-workspace';
    if (this.store.isEmpty()) return 'empty';
    if (this.store.filteredEmpty()) return 'filtered-empty';
    return null;
  });

  /** The detail panel sits beside the lanes, or beside a filtered-empty board. */
  protected readonly detailAllowed = computed(() => {
    const state = this.boardState();
    return state === null || state === 'filtered-empty';
  });

  /** `null` while closed; otherwise the status the New Task dialog opens in. */
  protected readonly createStatus = signal<TaskStatus | null>(null);
  protected readonly creating = signal(false);
  protected readonly exclusionsOpen = signal(false);
  protected readonly paletteOpen = signal(false);
  protected readonly writing = signal(false);

  protected readonly viewNameDraft = signal('');
  protected readonly viewRenamingId = signal<string | null>(null);
  protected readonly viewRenameDraft = signal('');

  /**
   * The task the detail panel is open on, from the loaded board. The palette's
   * selection-scoped actions need its CURRENT labels and status, and
   * `store.taskDetail()` is a separate fetch that lags the board.
   */
  private readonly selectedTask = computed<TaskSpecSummary | null>(() => {
    const id = this.store.selectedTaskId();
    if (id === null) return null;
    return this.store.allTasks().find((task) => task.id === id) ?? null;
  });

  /** Estimates actually in use, so the palette offers no empty facet. */
  private readonly estimatesInUse = computed<readonly TaskEstimate[]>(() => {
    const sized = this.store.estimateBuckets().sized;
    return TASK_ESTIMATES.filter((estimate) => sized[estimate] > 0);
  });

  /**
   * Every palette command, rebuilt from the board snapshot (no RPC). Gated by
   * the SAME `canWriteSpecs` signal as the header, so the keyboard entry point
   * cannot reach a write the header has closed off.
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
      canWriteSpecs: this.store.canWriteSpecs(),
    }),
  );

  /** Up while there is a selection, a pending confirmation or a run. */
  protected readonly bulkBarVisible = computed(
    () =>
      this.store.selectionCount() > 0 ||
      this.store.bulk() !== null ||
      this.store.bulkRequest() !== null,
  );

  /**
   * The last run's summary, hidden (not cleared) while a confirmation is
   * pending or a run is in flight — declining brings it straight back.
   */
  protected readonly bulkSummaryVisible = computed(() => {
    if (this.store.bulkRequest() !== null) return null;
    if (this.store.bulk() !== null) return null;
    return this.store.bulkSummary();
  });

  protected readonly knownTaskIds = computed<readonly string[]>(() => [
    ...this.store.graph().byId.keys(),
  ]);

  public constructor() {
    this.store.attachSurface();
    this.destroyRef.onDestroy(() => this.store.detachSurface());
    void this.store.loadBoard();
    void this.agentDiscovery.load();
    void this.views.load();
  }

  protected openCreate(status: TaskStatus = 'backlog'): void {
    this.createStatus.set(status);
  }

  protected closeCreate(): void {
    this.createStatus.set(null);
  }

  protected async submitCreate(draft: TaskCreateDraft): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    try {
      const result = await this.store.createTask({
        title: draft.title,
        type: draft.type,
        ...(draft.status === 'backlog' ? {} : { status: draft.status }),
        ...(draft.description ? { description: draft.description } : {}),
      });
      if (result?.success) this.createStatus.set(null);
    } finally {
      this.creating.set(false);
    }
  }

  protected openExclusions(): void {
    this.exclusionsOpen.set(true);
  }

  protected closeExclusions(): void {
    this.exclusionsOpen.set(false);
  }

  protected openPalette(): void {
    this.paletteOpen.set(true);
  }

  protected closePalette(): void {
    this.paletteOpen.set(false);
  }

  protected async openSweep(): Promise<void> {
    await this.store.previewSweep(this.sweepDays);
  }

  protected async confirmSweep(): Promise<void> {
    await this.store.applySweep(this.sweepDays);
  }

  /**
   * Ctrl+K / Cmd+K opens the palette — scoped to this host, and ignored while
   * typing in a field so it never steals a keystroke from text entry.
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

  /** Dispatch a palette command through the same paths the UI uses. */
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
        // Through the confirmation gate, never straight to the bulk write.
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

  protected onTaskToggle(taskId: string): void {
    this.store.toggleSelection(taskId);
  }

  protected onSelectionToggle(toggle: TaskSelectionToggle): void {
    if (toggle.range) {
      this.store.selectRangeTo(toggle.taskId);
      return;
    }
    this.store.toggleSelection(toggle.taskId);
  }

  /** Escape clears a selection first, then closes the open task. */
  protected onBoardEscape(): void {
    if (this.store.selectionCount() > 0) {
      this.store.clearSelection();
      return;
    }
    if (this.store.selectedTaskId() !== null) this.store.closeTask();
  }

  protected async onViewCreated(name: string): Promise<void> {
    if (await this.views.createView(name)) {
      this.viewNameDraft.set('');
    }
  }

  protected async onViewRenamed(rename: TaskViewRename): Promise<void> {
    if (await this.views.renameView(rename.id, rename.name)) {
      this.viewRenamingId.set(null);
      this.viewRenameDraft.set('');
    }
  }

  protected onStatusChange(change: TaskStatusChange): void {
    void this.store.updateStatus(change.taskId, change.status);
  }

  protected async onApplyMetadata(write: TaskMetadataWrite): Promise<void> {
    this.writing.set(true);
    try {
      await this.store.applyMetadata(write.taskId, write.patch);
    } finally {
      this.writing.set(false);
    }
  }

  protected onStartTask(request: TaskStartRequest): void {
    void this.taskStart.start(
      request.taskId,
      request.isolate,
      request.targetAgent,
    );
  }
}
