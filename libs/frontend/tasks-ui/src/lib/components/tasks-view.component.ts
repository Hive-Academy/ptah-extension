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
  FileText,
  LucideAngularModule,
  Plus,
  RefreshCw,
  X,
} from 'lucide-angular';
import { TASK_TYPES, type TaskType } from '@ptah-extension/shared';
import { TasksStore } from '../services/tasks-store.service';
import { TaskStartService } from '../services/task-start.service';
import { TaskBoardComponent } from './board/task-board.component';
import type {
  TaskStartRequest,
  TaskStatusChange,
} from './board/task-card.component';
import { TaskDetailComponent } from './detail/task-detail.component';

/**
 * TasksViewComponent
 *
 * Top-level standalone Tasks surface. Owns the header actions (New Task,
 * Generate Registry, excluded-count chip, Reindex), the board, and the detail
 * panel. All data flows through {@link TasksStore}; this component holds only
 * transient form / modal UI state.
 *
 * The Start action delegates to {@link TaskStartService} (optional worktree
 * then `ChatPromptRequest` bridge then `tasks:updateStatus` on success),
 * keeping this lib free of any `chat` import (NFR-11).
 */
@Component({
  selector: 'ptah-tasks-view',
  standalone: true,
  imports: [
    FormsModule,
    LucideAngularModule,
    TaskBoardComponent,
    TaskDetailComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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

        @if (store.excludedCount() > 0) {
          <span
            class="badge badge-sm badge-ghost"
            title="Folders without valid task.md frontmatter (excluded from the board)"
          >
            {{ store.excludedCount() }} excluded
          </span>
        }

        <div class="flex-1"></div>

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

      <!-- Body -->
      <div class="flex flex-1 min-h-0">
        @if (store.loading() && !store.specsDirExists()) {
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
              <p class="text-sm font-medium text-base-content/70">
                @if (!store.specsDirExists()) {
                  No .ptah/specs directory yet
                } @else {
                  No tasks on the board
                }
              </p>
              <p class="text-xs text-base-content/40 max-w-xs">
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
            <ptah-task-board
              [columns]="store.board()"
              [selectedTaskId]="store.selectedTaskId()"
              (taskSelect)="store.openTask($event)"
              (statusChange)="onStatusChange($event)"
              (startTask)="onStartTask($event)"
            />
          </div>

          @if (store.selectedTaskId()) {
            <ptah-task-detail
              [detail]="store.taskDetail()"
              [loading]="store.detailLoading()"
              (closed)="store.closeTask()"
            />
          }
        }
      </div>
    </div>

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
  `,
})
export class TasksViewComponent {
  protected readonly store = inject(TasksStore);
  protected readonly taskStart = inject(TaskStartService);

  protected readonly taskTypes = TASK_TYPES;

  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createTitle = signal('');
  protected readonly createType = signal<TaskType>('FEATURE');
  protected readonly createDescription = signal('');

  protected readonly canCreate = computed(
    () => this.createTitle().trim().length > 0,
  );

  protected readonly ClipboardListIcon = ClipboardList;
  protected readonly FileTextIcon = FileText;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;

  public constructor() {
    void this.store.loadBoard();
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

  protected onStatusChange(change: TaskStatusChange): void {
    void this.store.updateStatus(change.taskId, change.status);
  }

  /**
   * Launch orchestration for the task. Delegates the full sequence (optional
   * worktree, chat-prompt bridge, status transition on success) to
   * {@link TaskStartService}; the board reflects the `in_progress` move via the
   * authoritative re-fetch inside `TasksStore.updateStatus` (no optimism).
   */
  protected onStartTask(request: TaskStartRequest): void {
    void this.taskStart.start(request.taskId, request.useWorktree);
  }
}
