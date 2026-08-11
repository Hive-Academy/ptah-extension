import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CheckSquare, LucideAngularModule, X } from 'lucide-angular';
import {
  TASK_STATUSES,
  type TaskStatus,
  type TasksBulkLabelMode,
} from '@ptah-extension/shared';
import { TASK_STATUS_LABELS } from '../../task-presentation';
import type {
  BulkOperation,
  BulkProgress,
} from '../../services/tasks-store.service';

/** What the label field emits: the trimmed label and which way to apply it. */
export interface TaskBulkLabelPick {
  readonly label: string;
  readonly mode: TasksBulkLabelMode;
}

/**
 * The bulk action bar (FR-C4.2, FR-C4.9, FR-C4.12, FR-C5).
 *
 * Presentational and stateless: it renders whichever of three mutually
 * exclusive states its inputs describe — idle with a selection, awaiting
 * confirmation, or running — and emits the user's intent. Every decision about
 * WHEN a confirmation is required lives in `TasksStore.requestBulk`, and this
 * component cannot bypass it, which is what makes the palette, the status
 * picker and the label field share one confirmation rather than three similar
 * ones (FR-C6.7).
 *
 * ## The label field states no limits
 *
 * It has no `maxlength` and no client-side check on how many labels a task
 * already carries. Both limits live in `TaskMetadataPatchSchema` on the write
 * path; a second copy here would be a second enforcer to drift, and an
 * over-limit merge comes back as the boundary's own sentence per task, which is
 * the sentence the summary renders.
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
          {{ runningLabel(run.operation) }} — {{ run.done }} / {{ run.total }}
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
            {{ confirmAction(target) }}
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

        <!-- LABEL add / remove (FR-C5). Two verbs over ONE field, because the
             field answers "which label" and the buttons answer "which way" —
             and both answers are needed before anything can be written.

             Enter in the field runs Add. A text field beside two buttons has no
             default action of its own, and a user who types a label and presses
             Enter has unambiguously asked for the common one; leaving Enter
             inert makes the whole control mouse-only for the frequent case. It
             is the same act as pressing Add, so it goes through the same
             method rather than a parallel one. -->
        <label class="flex items-center gap-1.5">
          <span>Label</span>
          <input
            #labelField
            type="text"
            class="input input-bordered input-xs w-32"
            data-testid="task-bulk-label-input"
            aria-label="A label to add to or remove from the selected tasks"
            placeholder="label"
            (keydown.enter)="pickLabel(labelField, 'add')"
          />
        </label>

        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="task-bulk-label-add"
          (click)="pickLabel(labelField, 'add')"
        >
          Add to {{ count() }}
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="task-bulk-label-remove"
          (click)="pickLabel(labelField, 'remove')"
        >
          Remove from {{ count() }}
        </button>

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
  /** An operation awaiting confirmation, or `null` (FR-C4.12). */
  public readonly requested = input<BulkOperation | null>(null);
  /** The run in flight, or `null`. */
  public readonly progress = input<BulkProgress | null>(null);

  /** The user picked a target status. May or may not need confirming. */
  public readonly statusPicked = output<TaskStatus>();
  /** The user asked to add or remove a label. Same confirmation gate. */
  public readonly labelPicked = output<TaskBulkLabelPick>();
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
   * The confirmation sentence. It states the count and WHAT is about to happen
   * to each of them, and it does not state that they move together — because
   * they do not.
   *
   * The label variants name the label itself, for the same reason the status
   * variant names the target: a prompt that said "Change 42 tasks?" is one
   * people learn to click through, and a mistyped label is exactly the mistake
   * this dialog is the last chance to catch.
   */
  protected confirmPrompt(operation: BulkOperation): string {
    const count = this.count();
    if (operation.kind === 'status') {
      return `Move ${count} task(s) to ${this.statusLabel(operation.status)}?`;
    }
    return operation.mode === 'add'
      ? `Add the label "${operation.label}" to ${count} task(s)?`
      : `Remove the label "${operation.label}" from ${count} task(s)?`;
  }

  /** The commit button's own words — the same act, in the imperative. */
  protected confirmAction(operation: BulkOperation): string {
    const count = this.count();
    if (operation.kind === 'status') {
      return `Move ${count} to ${this.statusLabel(operation.status)}`;
    }
    return operation.mode === 'add'
      ? `Add "${operation.label}" to ${count}`
      : `Remove "${operation.label}" from ${count}`;
  }

  /**
   * What the progress line says the run is doing. Present tense, because it is
   * still happening, and it names the label so a user who started two runs in a
   * row can tell which one they are watching.
   */
  protected runningLabel(operation: BulkOperation): string {
    if (operation.kind === 'status') {
      return `Moving to ${this.statusLabel(operation.status)}`;
    }
    return operation.mode === 'add'
      ? `Adding the label "${operation.label}"`
      : `Removing the label "${operation.label}"`;
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

  /**
   * Read the label off the field, emit it, and clear the field.
   *
   * Trimmed, and an empty field does nothing at all — no emit, and the field is
   * left as the user left it. Surrounding whitespace is invisible, so a label
   * that differed from an existing one only by a trailing space would look
   * identical on every card while matching nothing.
   *
   * Cleared on success for the same reason the status `<select>` is reset: the
   * control is a verb. Left populated it reads as a property of the selection,
   * and the next Add would silently re-apply a label the user has stopped
   * looking at.
   */
  protected pickLabel(field: HTMLInputElement, mode: TasksBulkLabelMode): void {
    const label = field.value.trim();
    if (label.length === 0) return;
    field.value = '';
    this.labelPicked.emit({ label, mode });
  }
}
