import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  TaskGraph,
  TaskSpecSummary,
  TaskStatus,
} from '@ptah-extension/shared';
import type { TaskBulkOutcome } from '../../services/tasks-store.service';
import {
  TaskCardComponent,
  type TaskSelectionToggle,
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
        <!-- Filtered over indexed. The second number appears ONLY while a
             filter is hiding something: a bare 3 beside a header that also
             said 12 at all times would read as a count that had stopped
             updating, and "3 of 3" is noise. -->
        <span
          class="text-xs text-base-content font-mono tabular-nums"
          data-testid="task-column-count"
          [title]="countTitle()"
        >
          @if (hidden() > 0) {
            {{ tasks().length }} of {{ total() }}
          } @else {
            {{ tasks().length }}
          }
        </span>
      </header>

      <div class="flex flex-col gap-2 px-2 pb-2 overflow-y-auto flex-1 min-h-0">
        @for (task of tasks(); track task.id) {
          <ptah-task-card
            [task]="task"
            [graph]="graph()"
            [selected]="task.id === selectedTaskId()"
            [checked]="selection().has(task.id)"
            [pending]="pending().has(task.id)"
            [bulkOutcome]="outcomes().get(task.id) ?? null"
            [focused]="task.id === focusedTaskId()"
            (selectTask)="taskSelect.emit($event)"
            (toggleTask)="taskToggle.emit($event)"
            (selectionToggle)="selectionToggle.emit($event)"
            (statusChange)="statusChange.emit($event)"
            (startTask)="startTask.emit($event)"
            (filterChildren)="filterChildren.emit($event)"
          />
        } @empty {
          <!-- An empty column says WHY it is empty. "No tasks" under an active
               filter is a false statement about the workspace.

               Full-opacity base-content, not /30: this sentence IS the
               explanation, and at /30 it computed to 1.85:1 on daisyUI
               light — a fix nobody can read is not a fix. Over this column's
               own bg-base-200/60 surface it is now 7.27:1 at worst
               (daisyUI dark) and 14.88:1 at best. -->
          <p
            class="text-[11px] text-base-content px-1 py-3 text-center"
            data-testid="task-column-empty"
          >
            @if (hidden() > 0) {
              {{ hidden() }} hidden by the filter
            } @else {
              No tasks
            }
          </p>
        }
      </div>
    </section>
  `,
})
export class TaskColumnComponent {
  public readonly status = input.required<TaskStatus>();
  public readonly tasks = input.required<TaskSpecSummary[]>();
  /**
   * How many tasks this status holds in the INDEX, before the filter.
   *
   * Defaults to `tasks().length` — a column rendered without it reports the
   * count it always reported, so an unfiltered board and a standalone use of
   * this component are unchanged.
   */
  public readonly total = input<number | null>(null);
  public readonly selectedTaskId = input<string | null>(null);
  /**
   * The whole multi-selection, membership-tested per card (FR-C4.1).
   *
   * A `ReadonlySet` rather than a per-card boolean because the column renders
   * the cards: it is the only place that can turn one set into N booleans
   * without the board materializing N inputs. The set is replaced wholesale on
   * every change, so the identity check that drives OnPush still works.
   *
   * Defaults to an empty set, so a column rendered without it — the standalone
   * and pre-selection cases — shows no checkboxes ticked and behaves exactly as
   * it did before.
   */
  public readonly selection = input<ReadonlySet<string>>(new Set());
  /** Ids whose bulk write is in flight, same shape as {@link selection}. */
  public readonly pending = input<ReadonlySet<string>>(new Set());
  /**
   * How the last bulk run left each still-selected task — see
   * `TasksStore.lastRunOutcomes`. One map rather than two id sets, so the
   * "refused" and "not attempted" groups cannot disagree about a card on the
   * way down.
   */
  public readonly outcomes = input<ReadonlyMap<string, TaskBulkOutcome>>(
    new Map(),
  );
  /**
   * The board's single roving tab stop, forwarded to the card that owns it
   * (FR-C7.1).
   *
   * The column is a pass-through here and holds no focus state of its own —
   * the board owns exactly one focused id across all six columns, and a
   * per-column notion of "the focused card" would immediately give the board
   * six tab stops instead of one.
   *
   * Batch 7 was asked for this input and deliberately did not ship it, because
   * at that point no card read it: an input nothing consumes is a dead prop.
   * It arrives here, beside `TaskCardComponent.focused`, which is the code that
   * reads it.
   */
  public readonly focusedTaskId = input<string | null>(null);
  /** Forwarded verbatim to every card; see `TaskCardComponent.graph`. */
  public readonly graph = input<TaskGraph | null>(null);

  public readonly taskSelect = output<string>();
  /** Space on a focused card — see `TaskCardComponent.toggleTask`. */
  public readonly taskToggle = output<string>();
  /** A checkbox / Ctrl-click / Shift-click gesture, forwarded verbatim. */
  public readonly selectionToggle = output<TaskSelectionToggle>();
  public readonly statusChange = output<TaskStatusChange>();
  public readonly startTask = output<TaskStartRequest>();
  /** A card's child-rollup click: narrow the board to that task's sub-tasks. */
  public readonly filterChildren = output<string>();

  protected readonly label = computed(() => TASK_STATUS_LABELS[this.status()]);
  protected readonly badgeClass = computed(
    () => TASK_STATUS_BADGE[this.status()],
  );

  /**
   * How many of this column's tasks the filter is hiding.
   *
   * Clamped at zero: a caller that passes a `total` smaller than the rendered
   * list would otherwise make the header claim a negative number rather than
   * fall back to the plain count.
   */
  protected readonly hidden = computed(() =>
    Math.max(0, (this.total() ?? this.tasks().length) - this.tasks().length),
  );

  protected readonly countTitle = computed(() => {
    const hidden = this.hidden();
    const shown = this.tasks().length;
    return hidden === 0
      ? `${shown} ${this.label()} task(s)`
      : `${shown} of ${shown + hidden} ${this.label()} task(s) — ${hidden} hidden by the active filter`;
  });
}
