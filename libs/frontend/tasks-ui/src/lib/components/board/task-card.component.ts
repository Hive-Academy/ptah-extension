import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AlertTriangle,
  GitBranch,
  LucideAngularModule,
  MoreVertical,
  Play,
  User,
} from 'lucide-angular';
import {
  TASK_STATUSES,
  type TaskSpecSummary,
  type TaskStatus,
} from '@ptah-extension/shared';
import { TASK_STATUS_LABELS, taskTypeBadge } from '../../task-presentation';

/** Payload emitted when the (placeholder) Start action fires. */
export interface TaskStartRequest {
  taskId: string;
  useWorktree: boolean;
}

/** Payload emitted when the user picks a new status from the card menu. */
export interface TaskStatusChange {
  taskId: string;
  status: TaskStatus;
}

/**
 * Presentational task card. Pure `@Input`/`@Output`; owns only the local
 * worktree-toggle UI state. The Start action is a phase-1 placeholder — it emits
 * {@link start} but the real orchestration flow is wired in Batch D.
 */
@Component({
  selector: 'ptah-task-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="card card-compact bg-base-100 border transition-colors cursor-pointer hover:border-primary/40"
      [class.border-base-content]="selected()"
      [class.border-opacity-20]="!selected()"
      [class.ring-1]="selected()"
      [class.ring-primary]="selected()"
      role="button"
      tabindex="0"
      [attr.aria-label]="'Open task ' + task().id"
      (click)="selectTask.emit(task().id)"
      (keydown.enter)="selectTask.emit(task().id)"
      (keydown.space)="$event.preventDefault(); selectTask.emit(task().id)"
    >
      <div class="card-body gap-1.5">
        <!-- Header row: id + warning + status menu -->
        <div class="flex items-start justify-between gap-1">
          <span class="text-[10px] font-mono text-base-content/50 truncate">
            {{ task().id }}
          </span>
          <div class="flex items-center gap-1 flex-shrink-0">
            @if (!task().frontmatterValid) {
              <span
                class="text-warning"
                title="Frontmatter has validation warnings"
                [attr.aria-label]="
                  task().validationIssues.length + ' validation warning(s)'
                "
              >
                <lucide-angular [img]="AlertTriangleIcon" class="w-3 h-3" />
              </span>
            }
            <div class="dropdown dropdown-end">
              <button
                type="button"
                tabindex="0"
                class="btn btn-ghost btn-xs btn-square min-h-0 h-5 w-5 p-0"
                aria-label="Change status"
                title="Change status"
                (click)="$event.stopPropagation()"
              >
                <lucide-angular [img]="MoreVerticalIcon" class="w-3 h-3" />
              </button>
              <ul
                tabindex="0"
                class="dropdown-content menu menu-xs z-20 bg-base-200 rounded-box shadow border border-base-content/10 w-36 p-1"
              >
                @for (option of statusOptions(); track option) {
                  <li>
                    <button
                      type="button"
                      class="justify-between"
                      [class.active]="option === task().status"
                      (click)="$event.stopPropagation(); onStatusPick(option)"
                    >
                      {{ statusLabel(option) }}
                    </button>
                  </li>
                }
              </ul>
            </div>
          </div>
        </div>

        <!-- Title -->
        <p class="text-sm font-medium leading-snug line-clamp-2">
          {{ task().title }}
        </p>

        <!-- Meta row: type + executor + depends_on -->
        <div class="flex items-center flex-wrap gap-1">
          <span class="badge badge-xs" [class]="typeBadgeClass()">
            {{ task().type ?? 'no type' }}
          </span>
          @if (task().executor) {
            <span
              class="badge badge-xs badge-ghost gap-0.5"
              [title]="'Executor: ' + task().executor"
            >
              <lucide-angular [img]="UserIcon" class="w-2.5 h-2.5" />
              {{ task().executor }}
            </span>
          }
          @if (task().dependsOn.length > 0) {
            <span
              class="badge badge-xs badge-ghost gap-0.5"
              [title]="'Depends on: ' + task().dependsOn.join(', ')"
            >
              <lucide-angular [img]="GitBranchIcon" class="w-2.5 h-2.5" />
              {{ task().dependsOn.length }}
            </span>
          }
        </div>

        <!-- Actions: worktree toggle + Start (placeholder for Batch D) -->
        <div
          class="flex items-center justify-between pt-1 mt-0.5 border-t border-base-content/10"
        >
          <label
            class="label cursor-pointer gap-1 p-0"
            [title]="'Run in an isolated git worktree'"
          >
            <input
              type="checkbox"
              class="toggle toggle-xs"
              [checked]="useWorktree()"
              (click)="$event.stopPropagation()"
              (change)="onWorktreeToggle($event)"
              aria-label="Run in isolated worktree"
            />
            <span class="text-[10px] text-base-content/60">Worktree</span>
          </label>
          <button
            type="button"
            class="btn btn-primary btn-xs gap-1"
            (click)="$event.stopPropagation(); onStart()"
            [attr.aria-label]="'Start task ' + task().id"
          >
            <lucide-angular [img]="PlayIcon" class="w-3 h-3" />
            Start
          </button>
        </div>

        <!-- Worktree caveat (F-D1 pending): the worktree is created, but the
             session still runs against the main workspace until association ships. -->
        @if (useWorktree()) {
          <p class="text-[10px] leading-tight text-warning/80 mt-0.5">
            Worktree is created, but the session runs against the main workspace
            until association ships.
          </p>
        }
      </div>
    </div>
  `,
})
export class TaskCardComponent {
  public readonly task = input.required<TaskSpecSummary>();
  public readonly selected = input(false);

  public readonly selectTask = output<string>();
  public readonly statusChange = output<TaskStatusChange>();
  public readonly startTask = output<TaskStartRequest>();

  /** Local UI state: whether the Start action should request a worktree. */
  public readonly useWorktree = signal(false);

  protected readonly statusOptions = computed(() => TASK_STATUSES);
  protected readonly typeBadgeClass = computed(() =>
    taskTypeBadge(this.task().type),
  );

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly MoreVerticalIcon = MoreVertical;
  protected readonly UserIcon = User;
  protected readonly GitBranchIcon = GitBranch;
  protected readonly PlayIcon = Play;

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }

  protected onWorktreeToggle(event: Event): void {
    this.useWorktree.set((event.target as HTMLInputElement).checked);
  }

  protected onStatusPick(status: TaskStatus): void {
    if (status === this.task().status) return;
    this.statusChange.emit({ taskId: this.task().id, status });
  }

  protected onStart(): void {
    this.startTask.emit({
      taskId: this.task().id,
      useWorktree: this.useWorktree(),
    });
  }
}
