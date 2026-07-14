import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TaskColumnComponent } from './task-column.component';
import type { TaskStartRequest, TaskStatusChange } from './task-card.component';
import type { TaskBoardColumn } from '../../services/tasks-store.service';

/**
 * Presentational board — a horizontal strip of the six status columns (B1
 * order, supplied by the store). Pure `@Input`/`@Output`; one `tasks:board`
 * round trip populates it upstream.
 */
@Component({
  selector: 'ptah-task-board',
  standalone: true,
  imports: [TaskColumnComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex gap-3 h-full overflow-x-auto p-3 items-start">
      @for (column of columns(); track column.status) {
        <ptah-task-column
          [status]="column.status"
          [tasks]="column.tasks"
          [selectedTaskId]="selectedTaskId()"
          (taskSelect)="taskSelect.emit($event)"
          (statusChange)="statusChange.emit($event)"
          (startTask)="startTask.emit($event)"
        />
      }
    </div>
  `,
})
export class TaskBoardComponent {
  public readonly columns = input.required<TaskBoardColumn[]>();
  public readonly selectedTaskId = input<string | null>(null);

  public readonly taskSelect = output<string>();
  public readonly statusChange = output<TaskStatusChange>();
  public readonly startTask = output<TaskStartRequest>();
}
