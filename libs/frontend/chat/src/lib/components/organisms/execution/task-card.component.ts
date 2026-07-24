import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ListTodo, SquarePen } from 'lucide-angular';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * TaskCardComponent — compact card for the SDK task-management tools
 * (`TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` / `TaskStop` /
 * `TaskOutput`).
 *
 * Complexity Level: 1 (single presentational card that adapts by tool name).
 *
 * One reusable card renders every task tool: the action label, icon and the
 * key input fields (subject/description, task id, status) all derive from
 * `node().toolName` + `node().toolInput`. Input is read defensively because it
 * may be partial while the tool_use is still streaming.
 *
 * Stateless — no service injection — but kept co-located in `chat` (only
 * consumer) alongside the other execution-tree cards rather than in `chat-ui`.
 */
@Component({
  selector: 'ptah-task-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-start gap-2 my-1.5 px-3 py-2 rounded-lg border border-secondary/30 bg-secondary/5"
    >
      <lucide-angular
        [img]="icon()"
        class="w-4 h-4 shrink-0 mt-0.5 text-secondary"
        aria-hidden="true"
      />
      <div class="flex flex-col min-w-0 flex-1 gap-0.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-semibold text-base-content/80">
            {{ actionLabel() }}
          </span>
          @if (status(); as s) {
            <span [class]="'badge badge-xs ' + statusBadgeClass()">{{
              s
            }}</span>
          }
          @if (taskId(); as id) {
            <span
              class="text-[10px] font-mono text-base-content/40 truncate max-w-[10rem]"
              [title]="id"
              >{{ id }}</span
            >
          }
        </div>
        @if (title(); as t) {
          <span class="text-[11px] text-base-content/60 truncate" [title]="t">
            {{ t }}
          </span>
        }
      </div>
    </div>
  `,
})
export class TaskCardComponent {
  readonly node = input.required<ExecutionNode>();

  private readonly ListTodoIcon = ListTodo;
  private readonly SquarePenIcon = SquarePen;

  /** Parsed tool_use input, guarded against missing/partial streaming state. */
  private readonly toolInput = computed<Record<string, unknown>>(
    () => this.node().toolInput ?? {},
  );

  /** SquarePen for updates, list icon for everything else. */
  readonly icon = computed(() =>
    this.node().toolName === 'TaskUpdate'
      ? this.SquarePenIcon
      : this.ListTodoIcon,
  );

  /** Human-readable action derived from the tool name. */
  readonly actionLabel = computed<string>(() => {
    switch (this.node().toolName) {
      case 'TaskCreate':
        return 'Task created';
      case 'TaskUpdate':
        return 'Task updated';
      case 'TaskList':
        return 'Tasks listed';
      case 'TaskGet':
        return 'Task fetched';
      case 'TaskStop':
        return 'Task stopped';
      case 'TaskOutput':
        return 'Task output';
      default:
        return 'Task';
    }
  });

  /** Subject/description title — undefined when the SDK has not sent it yet. */
  readonly title = computed<string | undefined>(() => {
    const input = this.toolInput();
    return (
      readString(input['subject']) ??
      readString(input['description']) ??
      undefined
    );
  });

  /** Task id from either the camelCase (`taskId`) or snake_case (`task_id`) arg. */
  readonly taskId = computed<string | undefined>(() => {
    const input = this.toolInput();
    return readString(input['taskId']) ?? readString(input['task_id']);
  });

  /** Task status (TaskUpdate) — used for the badge. */
  readonly status = computed<string | undefined>(() =>
    readString(this.toolInput()['status']),
  );

  /** DaisyUI badge color keyed off the status value. */
  readonly statusBadgeClass = computed<string>(() => {
    switch (this.status()) {
      case 'completed':
        return 'badge-success';
      case 'in_progress':
        return 'badge-info';
      case 'deleted':
        return 'badge-error';
      case 'pending':
        return 'badge-ghost';
      default:
        return 'badge-ghost';
    }
  });
}

/** Returns the value when it is a non-empty string, otherwise undefined. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
