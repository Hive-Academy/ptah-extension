import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  ArrowLeft,
  ChevronDown,
  LucideAngularModule,
  Play,
} from 'lucide-angular';
import {
  SPEC_ROOT,
  TASK_STATUSES,
  type TaskSpecDetail,
  type TaskStatus,
} from '@ptah-extension/shared';
import { TASK_STATUS_LABELS, isStartableStatus } from '../../task-presentation';
import { TASK_STATUS_INK, deriveTaskStage } from '../../task-stage';
import type { TaskStartRequest } from '../../types/task-agent.types';
import type { TaskStatusChange } from '../board/task-card.component';

/**
 * The full-page task detail's header (design-spec "Task detail"): a
 * "← Board" back control, the `.ptah / specs / <folder>` breadcrumb, the title
 * with status, type and stage badges, the folder path, and the two task
 * actions on the right — Start in chat and Change status.
 *
 * Presentational: it emits the SAME payloads the Kanban card emits
 * ({@link TaskStartRequest}, {@link TaskStatusChange}), so the host routes
 * them through the paths the board already uses. Start is offered only where
 * the card offers it (`isStartableStatus`); isolation and agent targeting stay
 * on the card and the list row.
 *
 * Focus moves to Back when the page opens, because the card that opened it is
 * hidden with the board.
 */
@Component({
  selector: 'ptah-task-detail-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header
      class="flex flex-col gap-2 border-b border-surface-border bg-surface-1 px-5 py-4"
      data-testid="task-detail-header"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          #backButton
          type="button"
          class="btn btn-outline btn-sm gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          aria-label="Back to board"
          data-testid="task-detail-back"
          (click)="back.emit()"
        >
          <lucide-angular
            [img]="ArrowLeftIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Board
        </button>
        <nav
          class="min-w-0 flex-1 truncate font-mono text-xs text-base-content-muted"
          aria-label="Task folder location"
          data-testid="task-detail-breadcrumb"
        >
          .ptah / specs / {{ detail()?.folderName ?? folderHint() }}
        </nav>

        @if (detail(); as task) {
          <div class="ml-auto flex flex-wrap items-center gap-2">
            @if (startable()) {
              <button
                type="button"
                class="btn btn-outline btn-sm gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="task-detail-start"
                [disabled]="starting()"
                [attr.aria-label]="'Start task ' + task.id + ' in chat'"
                (click)="onStart(task)"
              >
                <lucide-angular
                  [img]="PlayIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                Start in chat
              </button>
            }
            <div class="dropdown dropdown-end">
              <button
                type="button"
                class="btn btn-outline btn-sm gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                aria-haspopup="menu"
                data-testid="task-detail-status-trigger"
                [disabled]="busy()"
              >
                Change status
                <lucide-angular
                  [img]="ChevronDownIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
              </button>
              <ul
                tabindex="0"
                class="dropdown-content menu menu-sm z-30 mt-1 w-44 rounded-box border border-surface-border bg-surface-2 p-1 shadow-[var(--elev-shadow-raised)]"
                aria-label="Change status"
                data-testid="task-detail-status-menu"
              >
                @for (option of statusOptions; track option) {
                  <li>
                    <button
                      type="button"
                      [class.active]="option === task.status"
                      [attr.aria-current]="
                        option === task.status ? 'true' : null
                      "
                      [attr.data-status]="option"
                      (click)="onStatusPick(task, option)"
                    >
                      {{ statusLabels[option] }}
                    </button>
                  </li>
                }
              </ul>
            </div>
          </div>
        }
      </div>

      @if (detail(); as task) {
        <div class="flex flex-wrap items-center gap-2">
          <h2
            class="min-w-0 text-xl font-semibold leading-snug text-base-content"
          >
            {{ task.title }}
          </h2>
          <span
            class="badge badge-ghost badge-sm"
            [class]="statusInk()"
            data-testid="task-detail-status"
            >{{ statusLabels[task.status] }}</span
          >
          @if (task.type) {
            <span class="badge badge-ghost badge-sm text-base-content">{{
              task.type
            }}</span>
          }
          @if (stage(); as stage) {
            <span
              class="badge badge-ghost badge-sm text-base-content"
              data-testid="task-detail-stage"
              >{{ stage }}</span
            >
          }
        </div>
        <span
          class="truncate font-mono text-xs text-base-content-muted"
          data-testid="task-detail-path"
          [title]="specRoot + '/' + task.folderName + '/'"
          >{{ specRoot }}/{{ task.folderName }}/</span
        >
      }
    </header>
  `,
})
export class TaskDetailHeaderComponent {
  /** `null` while the task loads or when it could not be found. */
  public readonly detail = input.required<TaskSpecDetail | null>();
  /** Shown in the breadcrumb until the detail arrives. */
  public readonly folderHint = input('');
  /** A carrier write is outstanding; the status menu waits for it. */
  public readonly busy = input(false);
  /** This task is launching; Start waits for it. */
  public readonly starting = input(false);

  public readonly back = output<void>();
  public readonly startTask = output<TaskStartRequest>();
  public readonly statusChange = output<TaskStatusChange>();

  private readonly backButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('backButton');

  protected readonly specRoot = SPEC_ROOT;
  protected readonly statusOptions: readonly TaskStatus[] = TASK_STATUSES;
  protected readonly statusLabels = TASK_STATUS_LABELS;

  protected readonly startable = computed(() => {
    const task = this.detail();
    return task !== null && isStartableStatus(task.status);
  });
  protected readonly statusInk = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_INK[task.status] : '';
  });
  protected readonly stage = computed(() =>
    deriveTaskStage(this.detail()?.artifacts ?? []),
  );

  public constructor() {
    afterNextRender(() => this.backButton().nativeElement.focus());
  }

  protected onStart(task: TaskSpecDetail): void {
    this.startTask.emit({ taskId: task.id, isolate: false });
  }

  protected onStatusPick(task: TaskSpecDetail, status: TaskStatus): void {
    if (status === task.status) return;
    this.statusChange.emit({ taskId: task.id, status });
  }

  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly PlayIcon = Play;
}
