import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CircleDashed, CircleX, LucideAngularModule, X } from 'lucide-angular';
import type { TaskStatus } from '@ptah-extension/shared';
import { TASK_STATUS_LABELS } from '../../task-presentation';
import type {
  BulkOperation,
  BulkSummary,
} from '../../services/tasks-store.service';

/**
 * What the last bulk run did, per task (FR-C4.5, FR-C4.7).
 *
 * ## Persistent, and deliberately not a toast
 *
 * A toast is the wrong shape for this by construction. Its contents are a list
 * of files that did not change and the reason each one refused — the user has
 * to read it, decide per row, and then act — and a surface that removes itself
 * on a timer cannot support any of that. It stays until the user dismisses it
 * or starts another run.
 *
 * ## `currentStatus` is why a conflict row is worth reading
 *
 * A conflict means the carrier moved between the read and the write, and the
 * write was refused rather than allowed to clobber it. "It changed, try again"
 * is a dead end. "It changed, and it now says In Review" is a fact the user can
 * decide against — which is the entire reason the backend re-reads the file
 * after refusing and sends the status back (FR-C4.7).
 *
 * ## Three words that do not appear here (FR-C4.4)
 *
 * There is no transaction across N files and this panel never implies one. It
 * reports counts and per-task outcomes; it never characterises the run as a
 * single thing that did or did not happen. `task-bulk-summary.component.spec.ts`
 * asserts that over the rendered text rather than trusting this paragraph.
 *
 * ## No `alert-*` fill
 *
 * Same finding as `TaskViewMenuComponent`: `alert-error` is 3.87:1 on the
 * default theme. Full `base-content` on `base-200`, with the error glyph as
 * redundant reinforcement rather than the signal (WCAG 1.4.1).
 */
@Component({
  selector: 'ptah-task-bulk-summary',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <section
      class="flex flex-col gap-1.5 border-b border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content"
      role="status"
      aria-live="polite"
      [attr.aria-label]="announcement()"
      data-testid="task-bulk-summary"
    >
      <div class="flex items-start gap-2">
        <p class="min-w-0 flex-1" data-testid="task-bulk-summary-headline">
          {{ headline() }}
          <!-- The no-op count sits INSIDE the headline rather than beside it:
               it is a correction to the number immediately before it, and a
               reader who takes the first sentence alone must not be left with
               "10 tasks got the label" when eight of them already had it. Its
               own element only so it can be pointed at. -->
          @if (noopSentence(); as sentence) {
            <span data-testid="task-bulk-summary-noop">{{ sentence }}</span>
          }
        </p>

        @if (summary().failures.length > 0) {
          <!-- Retry is a BUTTON and nothing retries on its own (FR-C4.8). The
               failures are still selected, so this re-runs exactly them — and
               it goes back through the same confirmation, so a large retry
               asks again rather than inheriting the first run's consent. -->
          <button
            type="button"
            class="btn btn-outline btn-xs"
            data-testid="task-bulk-summary-retry"
            (click)="retry.emit(summary().operation)"
          >
            Retry {{ summary().failures.length }} still selected
          </button>
        }
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          aria-label="Dismiss this summary"
          title="Dismiss this summary"
          data-testid="task-bulk-summary-dismiss"
          (click)="dismissed.emit()"
        >
          <lucide-angular [img]="XIcon" class="h-3 w-3" />
        </button>
      </div>

      @if (summary().cancelled) {
        <!-- FR-C4.9, verbatim. Cancellation is chunk-granular: writes already
             issued completed, and there is no undo for a carrier file. Saying
             "cancelled" alone would let a user believe the run stopped where
             they clicked.

             It is set apart and semibold, against the body text around it.
             This sentence is the whole honesty of the feature — it is the one
             place the interface admits that pressing Cancel did not undo
             anything — and at the weight of an ordinary paragraph it reads as
             a detail rather than as the correction it is. The prominence is
             weight, rule and spacing, all in full base-content (13.89 / 14.21 /
             7.44 / 13.11 across the four mandated bases): no accent clears the
             3:1 boundary gate on the light themes, so colour carries none of
             it. -->
        <p
          class="border-l-2 border-base-content py-0.5 pl-2 font-semibold"
          data-testid="task-bulk-summary-cancelled"
        >
          Cancelled after {{ summary().attempted }} of
          {{ summary().requested }}. Writes already issued completed and were
          not reversed.
        </p>
      }

      <!-- THE THIRD GROUP (see BulkUntouched). Its own count and its own list,
           never merged into the failures above: nothing was attempted for these
           and nothing is on disk, so listing them as refusals would tell the
           user that N tasks broke when they pressed Cancel. They are still
           selected, so Retry resumes them — which is the fact the count has to
           carry. -->
      @if (summary().untouched.length > 0) {
        <p
          class="font-semibold"
          data-testid="task-bulk-summary-untouched-count"
        >
          {{ summary().untouched.length }} task(s) were never attempted. Nothing
          was written for them and they are still selected.
        </p>
        <ul
          class="flex max-h-40 flex-col gap-1 overflow-y-auto"
          data-testid="task-bulk-summary-untouched-list"
        >
          @for (skipped of summary().untouched; track skipped.taskId) {
            <li
              class="flex items-start gap-1.5 rounded border border-base-300 px-2 py-1"
              data-testid="task-bulk-summary-untouched"
            >
              <lucide-angular
                [img]="CircleDashedIcon"
                class="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="font-mono">{{ skipped.taskId }}</span>
                @if (skipped.title; as title) {
                  <span class="truncate">{{ title }}</span>
                }
              </div>
            </li>
          }
        </ul>
      }

      @if (summary().failures.length > 0) {
        <!-- The LIST scrolls, not the page. A chunk is 20 tasks, so a
             double-figure failure count is routine rather than exceptional,
             and an unbounded list pushes the board region down until the
             columns are unusable — with the Retry and Dismiss controls above
             it carried off screen with them. Same treatment as the saved-views
             list one file over: bound the list, leave every surrounding
             control reachable. -->
        <ul
          class="flex max-h-64 flex-col gap-1 overflow-y-auto"
          data-testid="task-bulk-summary-list"
        >
          @for (failure of summary().failures; track failure.taskId) {
            <li
              class="flex items-start gap-1.5 rounded border border-base-300 px-2 py-1"
              data-testid="task-bulk-summary-failure"
            >
              <lucide-angular
                [img]="CircleXIcon"
                class="mt-0.5 h-3.5 w-3.5 shrink-0 text-error"
                aria-hidden="true"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="font-mono" data-testid="task-bulk-failure-id">
                  {{ failure.taskId }}
                </span>
                @if (failure.title; as title) {
                  <span class="truncate">{{ title }}</span>
                }
                <span data-testid="task-bulk-failure-message">
                  {{ failure.message }}
                </span>
                @if (failure.currentStatus; as current) {
                  <span data-testid="task-bulk-failure-current">
                    It is now in {{ statusLabel(current) }} on disk — the change
                    you asked for was not applied over it.
                  </span>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class TaskBulkSummaryComponent {
  public readonly summary = input.required<BulkSummary>();

  /** Re-run the WHOLE operation over the still-selected failures (FR-C4.8). */
  public readonly retry = output<BulkOperation>();
  public readonly dismissed = output<void>();

  protected readonly CircleXIcon = CircleX;
  protected readonly CircleDashedIcon = CircleDashed;
  protected readonly XIcon = X;

  /**
   * The one-line account of the run.
   *
   * It reports two independent numbers rather than a verdict, because a verdict
   * would have to pick one of them. "42 moved, 3 refused" is true; "the move
   * failed" and "the move succeeded" are each false about part of the run.
   *
   * ## The first number is WRITES, not successes
   *
   * On a label run they differ: a task that already carried the label is a
   * success that wrote nothing. Counting those here would produce "10 task(s)
   * got the label" for a run that touched two files — a sentence that is wrong
   * about disk, and wrong in the direction that makes a user believe an edit
   * landed. They are subtracted out and reported by {@link noopSentence}
   * instead. A status run has no no-ops at all (the bulk status path never sets
   * the flag), so this arithmetic is a no-op there too.
   */
  protected readonly headline = computed(() => {
    const summary = this.summary();
    const written = summary.succeeded - summary.noop;
    const failed = summary.failures.length;
    const first = this.wroteSentence(summary.operation, written);
    if (failed === 0) return first;
    return `${first} ${failed} were refused and are still selected.`;
    // The untouched group is deliberately NOT folded in here. It gets its own
    // sentence below, because "3 refused" and "80 never attempted" answer
    // different questions and a headline that added them would answer neither.
  });

  /**
   * The correction to the headline's count, or `null` when there is nothing to
   * correct.
   *
   * It says what was true BEFORE the run and that nothing was written, because
   * those are the two things a user needs to distinguish "it is done" from "I
   * did it". Only a label run can produce one.
   */
  protected readonly noopSentence = computed<string | null>(() => {
    const summary = this.summary();
    if (summary.noop === 0) return null;
    if (summary.operation.kind === 'status') return null;
    const label = summary.operation.label;
    return summary.operation.mode === 'add'
      ? `${summary.noop} already carried "${label}", so nothing was written for them.`
      : `${summary.noop} did not carry "${label}", so nothing was written for them.`;
  });

  /**
   * What a screen reader is told the panel is, in one string.
   *
   * The no-op clause is part of it: it lives in its own element for the sake of
   * assertions and layout, not because it is an aside, and a label that stopped
   * at the headline would announce the very number the clause exists to
   * correct.
   */
  protected readonly announcement = computed(() => {
    const sentence = this.noopSentence();
    return sentence === null
      ? this.headline()
      : `${this.headline()} ${sentence}`;
  });

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }

  /** "N task(s) <what actually landed on disk>." for either operation. */
  private wroteSentence(operation: BulkOperation, written: number): string {
    if (operation.kind === 'status') {
      return `${written} task(s) moved to ${TASK_STATUS_LABELS[operation.status]}.`;
    }
    return operation.mode === 'add'
      ? `${written} task(s) got the label "${operation.label}".`
      : `${written} task(s) had the label "${operation.label}" removed.`;
  }
}
