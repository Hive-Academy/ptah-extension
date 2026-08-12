import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { TaskGraph } from '@ptah-extension/shared';
import { TaskColumnComponent } from './task-column.component';
import type {
  TaskSelectionToggle,
  TaskStartRequest,
  TaskStatusChange,
} from './task-card.component';
import type {
  TaskBoardColumn,
  TaskBulkOutcome,
} from '../../services/tasks-store.service';
import { isTextEntryTarget } from '../keyboard-target';

/**
 * Presentational board — a horizontal strip of the six status columns (B1
 * order, supplied by the store). One `tasks:board` round trip populates it
 * upstream; the board itself holds exactly one piece of state, described below.
 *
 * ## The roving tabindex owner (FR-C7.1)
 *
 * The board owns `focusedTaskId` and nothing else. Each card renders
 * `[attr.tabindex]="focused() ? 0 : -1"` on its root AND on every focusable
 * descendant, so the whole board is one tab stop to enter rather than one per
 * card — and, before this, one per *control* per card.
 *
 * Arrow keys move the focus across the **filtered** column model, which is the
 * `columns()` input: what the user can see is what the arrows can reach. Empty
 * columns are skipped horizontally rather than trapping focus in a column that
 * has nothing to focus.
 *
 * ## Why the keydown is on the HOST element (R10)
 *
 * `host: { '(keydown)': … }`, never `window` or `document`. A document-level
 * listener would move board focus while the user was typing in the chat panel
 * on the other side of the webview. Text-entry targets are ignored on top of
 * that (the card carries a checkbox, and Space on a checkbox is the checkbox's
 * key, not the board's) — see `keyboard-target.ts`.
 *
 * ## Activation lives on the CARD, navigation lives here
 *
 * Enter and Space are handled by `TaskCardComponent`, whose root is the
 * `role="button"`, and are guarded there against firing for a descendant's
 * keyboard activation. Handling them here as well would re-create the
 * double-fire this batch exists to remove, one level further out.
 */
@Component({
  selector: 'ptah-task-board',
  standalone: true,
  imports: [TaskColumnComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full min-h-0',
    '(keydown)': 'onKeyDown($event)',
  },
  template: `
    <div class="flex gap-3 h-full overflow-x-auto p-3 items-stretch">
      @for (column of columns(); track column.status) {
        <ptah-task-column
          [status]="column.status"
          [tasks]="column.tasks"
          [total]="column.total"
          [graph]="graph()"
          [selectedTaskId]="selectedTaskId()"
          [selection]="selection()"
          [pending]="pending()"
          [outcomes]="outcomes()"
          [focusedTaskId]="focusedTaskId()"
          (taskSelect)="onTaskSelect($event)"
          (taskToggle)="onTaskToggle($event)"
          (selectionToggle)="onSelectionToggle($event)"
          (statusChange)="statusChange.emit($event)"
          (startTask)="startTask.emit($event)"
          (filterChildren)="filterChildren.emit($event)"
        />
      }
    </div>
  `,
})
export class TaskBoardComponent {
  public readonly columns = input.required<TaskBoardColumn[]>();
  public readonly selectedTaskId = input<string | null>(null);
  /** The multi-selection (FR-C4.1) — see `TaskColumnComponent.selection`. */
  public readonly selection = input<ReadonlySet<string>>(new Set());
  /** Ids with a bulk write in flight (FR-C4.11). */
  public readonly pending = input<ReadonlySet<string>>(new Set());
  /** Last-run outcomes — see `TaskColumnComponent.outcomes`. */
  public readonly outcomes = input<ReadonlyMap<string, TaskBulkOutcome>>(
    new Map(),
  );
  /**
   * The derived board graph, forwarded to every card so it can render its child
   * rollup and resolve its parent claim. Optional — a board handed no graph
   * renders cards with neither, which is exactly the zero-metadata rendering.
   */
  public readonly graph = input<TaskGraph | null>(null);

  public readonly taskSelect = output<string>();
  /** Space on the focused card (FR-C7.2). See `TaskCardComponent.toggleTask`. */
  public readonly taskToggle = output<string>();
  /** A pointer selection gesture from a card — checkbox, Ctrl, or Shift. */
  public readonly selectionToggle = output<TaskSelectionToggle>();
  /**
   * Escape was pressed with focus on the board (FR-C7.3).
   *
   * The board does not decide what Escape means, because what it means depends
   * on state the board cannot see. The host now reads it as both branches
   * FR-C7.3 always described: clear the multi-selection when there is one,
   * otherwise close the detail panel. That second selection model arrived with
   * FR-C4, and this component did not change to carry it — the event was
   * always "Escape happened here", and only its reducer moved.
   */
  public readonly escapePressed = output<void>();
  public readonly statusChange = output<TaskStatusChange>();
  public readonly startTask = output<TaskStartRequest>();
  /** Forwarded from a card's child rollup — the id of the PARENT clicked. */
  public readonly filterChildren = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The explicitly-focused card, or `null` for "wherever the default lands". */
  private readonly _focusedTaskId = signal<string | null>(null);

  /**
   * The card that carries `tabindex="0"`.
   *
   * Falls back to the first task in the first non-empty column whenever the
   * explicit choice is not on the board — which happens on first render and
   * every time a filter hides the previously-focused card. Without the
   * fallback the board would have ZERO tab stops in exactly those cases, which
   * is a worse keyboard failure than the 181 it replaces.
   */
  protected readonly focusedTaskId = computed<string | null>(() => {
    const order = this.navigationOrder();
    const explicit = this._focusedTaskId();
    if (explicit !== null && order.includes(explicit)) return explicit;
    return order[0] ?? null;
  });

  /**
   * Every visible task id in reading order — column by column, top to bottom.
   *
   * Only used to resolve the fallback above; the arrow keys navigate the
   * two-dimensional `columns()` model directly, because "one to the right"
   * means a column, not an offset into a flattened list.
   */
  private readonly navigationOrder = computed<readonly string[]>(() =>
    this.columns().flatMap((column) => column.tasks.map((task) => task.id)),
  );

  /** Where the focused card sits, or `null` when nothing is focused. */
  private position(): { column: number; row: number } | null {
    const focused = this.focusedTaskId();
    if (focused === null) return null;
    const columns = this.columns();
    for (let column = 0; column < columns.length; column += 1) {
      const row = columns[column].tasks.findIndex(
        (task) => task.id === focused,
      );
      if (row >= 0) return { column, row };
    }
    return null;
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (isTextEntryTarget(event.target)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.escapePressed.emit();
      return;
    }

    const position = this.position();
    if (position === null) return;

    let moved = false;
    switch (event.key) {
      case 'ArrowDown':
        moved = this.moveVertical(position, 1);
        break;
      case 'ArrowUp':
        moved = this.moveVertical(position, -1);
        break;
      case 'ArrowRight':
        moved = this.moveHorizontal(position, 1);
        break;
      case 'ArrowLeft':
        moved = this.moveHorizontal(position, -1);
        break;
      case 'Home':
        moved = this.focusAt(position.column, 0);
        break;
      case 'End':
        moved = this.focusAt(
          position.column,
          this.columns()[position.column].tasks.length - 1,
        );
        break;
      default:
        return;
    }

    // `preventDefault` ONLY on consumption (R10): an arrow key the board did
    // not act on — at the end of a column, or with the board empty — has to
    // stay available to whatever scrolls the page.
    if (moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private moveVertical(
    position: { column: number; row: number },
    delta: number,
  ): boolean {
    return this.focusAt(position.column, position.row + delta);
  }

  /**
   * Move to the neighbouring column, skipping empty ones.
   *
   * The board always renders all six statuses, so an unfiltered workspace
   * routinely has empty columns between populated ones. Stopping at the first
   * empty column would strand the user mid-board with nothing focused; walking
   * past it keeps every visible card reachable.
   */
  private moveHorizontal(
    position: { column: number; row: number },
    delta: number,
  ): boolean {
    const columns = this.columns();
    for (
      let candidate = position.column + delta;
      candidate >= 0 && candidate < columns.length;
      candidate += delta
    ) {
      if (columns[candidate].tasks.length === 0) continue;
      // Clamp rather than wrap: a short column next to a long one should land
      // on its last card, not on nothing and not back at its first.
      const row = Math.min(position.row, columns[candidate].tasks.length - 1);
      return this.focusAt(candidate, row);
    }
    return false;
  }

  /** Move focus to a coordinate, or refuse if it is off the board. */
  private focusAt(column: number, row: number): boolean {
    const columns = this.columns();
    const target = columns[column]?.tasks[row];
    if (target === undefined) return false;
    this._focusedTaskId.set(target.id);
    this.focusCardElement(target.id);
    return true;
  }

  /**
   * Put DOM focus on the card that just became the roving tab stop.
   *
   * ## Matched by attribute, never by an interpolated selector (BR-10)
   *
   * A task id is a folder name — untrusted text from disk. Building
   * `[data-task-id="${id}"]` would be interpolating it into a selector
   * grammar, which is the same class of mistake as building a `RegExp` from
   * it. Reading the attribute off each candidate cannot be escaped out of.
   *
   * ## It runs before change detection, and that is fine
   *
   * The element is already rendered; only its `tabindex` attribute is stale at
   * this instant, and `focus()` works on `tabindex="-1"` too. The attribute
   * catches up on the change-detection pass this keystroke triggers.
   */
  private focusCardElement(taskId: string): void {
    const cards =
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-task-id]');
    for (const card of Array.from(cards)) {
      if (card.getAttribute('data-task-id') === taskId) {
        card.focus();
        return;
      }
    }
  }

  /**
   * A card was opened — by click, by Enter, or from the palette's jump list.
   *
   * The roving focus follows, so a user who reaches for the mouse once does not
   * find the keyboard starting over at the top-left card.
   */
  protected onTaskSelect(taskId: string): void {
    this._focusedTaskId.set(taskId);
    this.taskSelect.emit(taskId);
  }

  protected onTaskToggle(taskId: string): void {
    this._focusedTaskId.set(taskId);
    this.taskToggle.emit(taskId);
  }

  /**
   * A card's selection gesture. The roving focus follows it for the same reason
   * it follows an open: the next arrow key should move from the card the user
   * just acted on, not from wherever the keyboard was left.
   */
  protected onSelectionToggle(toggle: TaskSelectionToggle): void {
    this._focusedTaskId.set(toggle.taskId);
    this.selectionToggle.emit(toggle);
  }
}
