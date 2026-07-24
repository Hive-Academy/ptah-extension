import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { TaskSpecSummary, TaskStatus } from '@ptah-extension/shared';
import {
  TaskCardComponent,
  type TaskStartRequest,
  type TaskStatusChange,
} from './task-card.component';
import { TASK_STATUS_BADGE, TASK_STATUS_LABELS } from '../../task-presentation';

/**
 * Presentational board column for a single status. Renders its task cards and
 * forwards their events upward; holds no state of its own.
 */
@Component({
  selector: 'ptah-task-column',
  standalone: true,
  imports: [TaskCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex flex-col w-64 flex-shrink-0 min-h-0 rounded-lg bg-base-200/60"
      [attr.aria-label]="label() + ' column'"
    >
      <header
        class="flex items-center justify-between gap-2 px-2 py-1.5 sticky top-0"
      >
        <div class="flex items-center gap-1.5">
          <span class="badge badge-xs" [class]="badgeClass()">{{
            label()
          }}</span>
        </div>
        <span class="text-xs text-base-content/40 font-mono">
          {{ tasks().length }}
        </span>
      </header>

      <div class="flex flex-col gap-2 px-2 pb-2 overflow-y-auto flex-1 min-h-0">
        @for (task of tasks(); track task.id) {
          <ptah-task-card
            [task]="task"
            [selected]="task.id === selectedTaskId()"
            (selectTask)="taskSelect.emit($event)"
            (statusChange)="statusChange.emit($event)"
            (startTask)="startTask.emit($event)"
          />
        } @empty {
          <p class="text-[11px] text-base-content/30 px-1 py-3 text-center">
            No tasks
          </p>
        }
      </div>
    </section>
  `,
})
export class TaskColumnComponent {
  public readonly status = input.required<TaskStatus>();
  public readonly tasks = input.required<TaskSpecSummary[]>();
  public readonly selectedTaskId = input<string | null>(null);

  public readonly taskSelect = output<string>();
  public readonly statusChange = output<TaskStatusChange>();
  public readonly startTask = output<TaskStartRequest>();

  protected readonly label = computed(() => TASK_STATUS_LABELS[this.status()]);
  protected readonly badgeClass = computed(
    () => TASK_STATUS_BADGE[this.status()],
  );
}
