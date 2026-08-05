import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CheckSquare, LucideAngularModule, X } from 'lucide-angular';
import { TASK_STATUSES, type TaskStatus } from '@ptah-extension/shared';
import { TASK_STATUS_LABELS } from '../../task-presentation';
import type { BulkProgress } from '../../services/tasks-store.service';

/**
 * The bulk action bar (FR-C4.2, FR-C4.9, FR-C4.12).
 *
 * Presentational and stateless: it renders whichever of three mutually
 * exclusive states its inputs describe — idle with a selection, awaiting
 * confirmation, or running — and emits the user's intent. Every decision about
 * WHEN a confirmation is required lives in `TasksStore.requestBulkStatus`, and
 * this component cannot bypass it, which is what makes the palette and the
 * picker share one confirmation rather than two similar ones (FR-C6.7).
 *
 * ## The word this bar does not use
 *
 * There is no transaction here. A run is N independent writes to N files, and
 * the bar's job in the seconds before the user presses Confirm is to say so:
 * the confirmation names the count and the target, the cancel notice says which
 * writes already landed, and nothing anywhere promises that the set moves
 * together or not at all (FR-C4.4).
 *
 * ## Colour is not a signal here
 *
 * No `alert-*` fill. `alert-error` computes to 3.87:1 and `alert-info` to
 * 2.95:1 on anubis, the app's default theme — the audit table lives on
 * `TaskViewMenuComponent`, and `tailwind.config.js` is deliberately not touched
 * (that is `TASK_2026_183`'s call). This bar is full `base-content` on
 * `base-200`, and it carries its meaning in words.
 */
@Component({
  selector: 'ptah-task-bulk-bar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div
      class="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-200 px-3 py-1.5 text-xs text-base-content"
      role="region"
      aria-label="Bulk actions for the selected tasks"
      data-testid="task-bulk-bar"
    >
      @if (progress(); as run) {
        <!-- RUNNING. The count is issued-and-answered, not succeeded — see
             BulkProgress. Cancel stays enabled until the run ends, because
             the only thing it can do is stop the NEXT chunk. -->
        <span
          class="inline-flex items-center gap-1.5 font-medium tabular-nums"
          role="status"
          aria-live="polite"
          data-testid="task-bulk-progress"
        >
          <span class="loading loading-spinner loading-xs"></span>
          Moving to {{ statusLabel(run.status) }} — {{ run.done }} /
          {{ run.total }}
        </span>

        <div class="flex-1"></div>

        <button
          type="button"
          class="btn btn-outline btn-xs"
          data-testid="task-bulk-cancel"
          [disabled]="run.cancelled"
          (click)="cancelRun.emit()"
        >
          @if (run.cancelled) {
            Stopping after this batch
          } @else {
            Cancel
          }
        </button>
      } @else if (requested(); as target) {
        <!-- CONFIRMATION (FR-C4.12). It names the COUNT and the TARGET STATUS,
             because those are the two facts that decide whether this is the
             action the user meant, and a dialog that omits either is one people
             learn to dismiss without reading.

             The alertdialog role is on the CONTAINER, which holds the prompt
             AND both buttons. It was previously on the paragraph alone, which
             is structurally wrong in the way that matters: the role promises
             assistive technology a grouping that contains the controls that
             answer it, and a dialog whose Confirm button sits outside it is a
             prompt a screen-reader user is told about and then has to go
             looking for. -->
        <div
          class="flex flex-1 flex-wrap items-center gap-2"
          role="alertdialog"
          aria-modal="false"
          [attr.aria-label]="confirmPrompt(target)"
          data-testid="task-bulk-confirm"
        >
          <p class="min-w-0 flex-1">
            {{ confirmPrompt(target) }}
            <span class="block">
              Each task is written to its own file, one at a time. Some may
              succeed and others fail; anything already written stays written.
            </span>
          </p>

          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-testid="task-bulk-confirm-cancel"
            (click)="cancelRequest.emit()"
          >
            Keep the selection
          </button>
          <!-- NOT btn-primary. That is bg-primary + text-primary-content,
               which computes to 4.144:1 on anubis (the app default) and
               5.18:1 on anubis-light, against a 4.5:1 gate — the same pair
               Batch 7 recorded, Batch 9 refused for its banners and Batch 10
               moved the palette's active row off. It has no business on the
               single most consequential control in this feature: the button
               that commits N irreversible carrier writes.

               Measured across the four mandated bases from the DECLARED
               tokens (no generated -content colour is involved):
                 label  base-content on base-100 — 14.86 / 15.91 / 7.03 / 14.68
                 border base-content on base-200 — 13.89 / 14.21 / 7.44 / 13.11
                 hover  base-content on base-300 — 12.29 / 13.21 / 7.83 / 11.74
               Every one clears 4.5:1 for text and 3:1 for the boundary, on all
               four. Prominence is carried by the full-weight border, the
               semibold label and the sentence naming the count and target —
               shape and words, exactly as Batch 10 concluded, because no
               accent clears the boundary gate on the light themes.

               Changing the USAGE is this batch's; changing the PAIR is
               TASK_2026_183's. tailwind.config.js is untouched. -->
          <button
            type="button"
            class="btn btn-xs border border-base-content bg-base-100 font-semibold text-base-content hover:bg-base-300"
            data-testid="task-bulk-confirm-run"
            (click)="confirmRequest.emit()"
          >
            Move {{ count() }} to {{ statusLabel(target) }}
          </button>
        </div>
      } @else {
        <!-- IDLE with a selection. -->
        <span
          class="inline-flex items-center gap-1.5 font-medium tabular-nums"
          data-testid="task-bulk-count"
        >
          <lucide-angular
            [img]="CheckSquareIcon"
            class="h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          {{ count() }} selected
        </span>

        <!-- The selection outlives a filter change on purpose, so it can
             disagree with what is on screen. Saying the number is the honest
             middle between pruning it silently (destroys the user's work) and
             saying nothing (writes carriers nobody can see). -->
        @if (hiddenCount() > 0) {
          <span data-testid="task-bulk-hidden">
            {{ hiddenCount() }} of them hidden by the filter
          </span>
        }

        @if (canSelectAllMatching()) {
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-testid="task-bulk-select-all"
            (click)="selectAllMatching.emit()"
          >
            Select all {{ matchedCount() }} matching
          </button>
        }

        <div class="flex-1"></div>

        <label class="flex items-center gap-1.5">
          <span>Move to</span>
          <select
            class="select select-bordered select-xs"
            data-testid="task-bulk-status"
            aria-label="Move the selected tasks to a status"
            [value]="''"
            (change)="onStatusPicked($event)"
          >
            <option value="" disabled selected>Choose a status</option>
            @for (status of statuses; track status) {
              <option [value]="status">{{ statusLabel(status) }}</option>
            }
          </select>
        </label>

        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          aria-label="Clear the selection"
          title="Clear the selection"
          data-testid="task-bulk-clear"
          (click)="clearSelection.emit()"
        >
          <lucide-angular [img]="XIcon" class="h-3 w-3" />
        </button>
      }
    </div>
  `,
})
export class TaskBulkBarComponent {
  /** How many tasks are selected. */
  public readonly count = input.required<number>();
  /** How many of them the active filter is hiding. */
  public readonly hiddenCount = input(0);
  /** How many tasks the active filter matches, for "select all N matching". */
  public readonly matchedCount = input(0);
  /** A move awaiting confirmation, or `null` (FR-C4.12). */
  public readonly requested = input<TaskStatus | null>(null);
  /** The run in flight, or `null`. */
  public readonly progress = input<BulkProgress | null>(null);

  /** The user picked a target status. May or may not need confirming. */
  public readonly statusPicked = output<TaskStatus>();
  public readonly confirmRequest = output<void>();
  public readonly cancelRequest = output<void>();
  public readonly cancelRun = output<void>();
  public readonly selectAllMatching = output<void>();
  public readonly clearSelection = output<void>();

  protected readonly statuses = TASK_STATUSES;
  protected readonly CheckSquareIcon = CheckSquare;
  protected readonly XIcon = X;

  /**
   * Offer "select all matching" only when it would change something.
   *
   * A button that reads "Select all 12 matching" while all 12 are already
   * selected is a control whose only possible effect is nothing, and the user
   * cannot tell that by looking at it.
   */
  protected readonly canSelectAllMatching = computed(
    () => this.matchedCount() > this.count(),
  );

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }

  /**
   * The confirmation sentence. It states the count and the target status, and
   * it does not state that they move together — because they do not.
   */
  protected confirmPrompt(status: TaskStatus): string {
    return `Move ${this.count()} task(s) to ${this.statusLabel(status)}?`;
  }

  /**
   * Read the picked status off the `<select>` and reset it.
   *
   * The reset matters: the control is a verb, not a value. Left showing the
   * last choice it would read as "the selection is in this status", which is
   * the opposite of what it does — and picking the same status twice in a row
   * (a legitimate retry) would fire no `change` event at all.
   */
  protected onStatusPicked(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    select.value = '';
    const status = TASK_STATUSES.find((candidate) => candidate === value);
    if (status === undefined) return;
    this.statusPicked.emit(status);
  }
}
