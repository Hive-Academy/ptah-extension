import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  CircleCheck,
  CircleX,
  LucideAngularModule,
  Trash2,
  X,
} from 'lucide-angular';

/** One item a bulk action could not complete, with the reason. */
export interface BulkActionFailure {
  readonly name: string;
  readonly reason: string;
}

/** The outcome of the last bulk removal. */
export interface BulkActionResult {
  readonly removed: number;
  readonly failed: readonly BulkActionFailure[];
}

/** "3 selected", or the words for an empty selection. */
export function bulkSelectionLabel(count: number): string {
  return count > 0 ? `${count} selected` : 'No items selected';
}

/** "2 removed, 1 failed" — the parts that are non-zero, "Nothing removed" otherwise. */
export function bulkResultSummary(result: BulkActionResult): string {
  const parts: string[] = [];
  if (result.removed > 0) parts.push(`${result.removed} removed`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
  return parts.length > 0 ? parts.join(', ') : 'Nothing removed';
}

/**
 * The bar shown while rows are selected: the selection count, the bulk
 * action, and the outcome of the last run (N removed, M failed with reasons).
 *
 * A `role="region"` named "Bulk actions". The count and the outcome sit in
 * polite live regions that stay in the DOM while the bar is idle (visually
 * hidden then), so a change is announced rather than inserted silently.
 *
 * Presentational: the page owns the selection, runs the action and passes the
 * outcome back through `result`.
 *
 * @example
 * ```html
 * <ptah-bulk-action-bar
 *   [selectedCount]="selection().size"
 *   [busy]="removing()"
 *   [result]="lastResult()"
 *   (actionRequested)="removeSelected()"
 *   (clearRequested)="selection.set(new Set())"
 *   (resultDismissed)="lastResult.set(null)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-bulk-action-bar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      role="region"
      aria-label="Bulk actions"
      data-testid="bulk-action-bar"
      [attr.data-idle]="idle()"
      [class]="
        idle()
          ? ''
          : 'flex flex-col gap-2 rounded-xl border border-secondary/30 bg-base-300 px-4 py-3 shadow-2xl'
      "
    >
      <div class="flex flex-wrap items-center gap-2">
        <p
          aria-live="polite"
          aria-atomic="true"
          class="text-xs font-semibold tabular-nums text-base-content"
          [class.sr-only]="idle()"
          data-testid="bulk-count"
        >
          {{ selectionLabel() }}
        </p>
        @if (selectedCount() > 0) {
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm gap-1"
              data-testid="bulk-clear"
              [disabled]="busy()"
              (click)="clearRequested.emit()"
            >
              <lucide-angular
                [img]="XIcon"
                class="h-3.5 w-3.5"
                aria-hidden="true"
              />
              Clear selection
            </button>
            <button
              type="button"
              class="btn btn-error btn-sm gap-1"
              data-testid="bulk-action"
              [disabled]="busy()"
              [attr.aria-busy]="busy()"
              (click)="actionRequested.emit()"
            >
              @if (busy()) {
                <span
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                ></span>
                {{ busyLabel() }}
              } @else {
                <lucide-angular
                  [img]="TrashIcon"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {{ actionLabel() }}
              }
            </button>
          </div>
        }
      </div>

      <div aria-live="polite" data-testid="bulk-result-region">
        @if (result(); as outcome) {
          <div
            class="space-y-1 border-t border-base-300 pt-2"
            data-testid="bulk-result"
          >
            <div class="flex items-center gap-2">
              <p
                class="flex items-center gap-1.5 text-xs font-medium text-base-content"
                data-testid="bulk-result-summary"
              >
                <lucide-angular
                  [img]="outcome.failed.length > 0 ? FailedIcon : DoneIcon"
                  class="h-3.5 w-3.5 shrink-0"
                  [class]="
                    outcome.failed.length > 0 ? 'text-error' : 'text-success'
                  "
                  aria-hidden="true"
                />
                {{ summary() }}
              </p>
              <button
                type="button"
                class="btn btn-ghost btn-xs ml-auto"
                data-testid="bulk-result-dismiss"
                (click)="resultDismissed.emit()"
              >
                Dismiss
              </button>
            </div>
            @if (outcome.failed.length > 0) {
              <ul
                class="space-y-0.5 pl-5 text-[11px] text-base-content-muted"
                aria-label="Failed items"
                data-testid="bulk-failures"
              >
                @for (failure of outcome.failed; track $index) {
                  <li>
                    <span class="font-medium text-base-content">{{
                      failure.name
                    }}</span>
                    — {{ failure.reason }}
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class BulkActionBarComponent {
  /** How many rows are selected. */
  public readonly selectedCount = input.required<number>();

  /** The action is running: both buttons are disabled. @default false */
  public readonly busy = input<boolean>(false);

  /** The outcome of the last run, or `null` before one / once dismissed. */
  public readonly result = input<BulkActionResult | null>(null);

  /** Label of the bulk action button. @default 'Remove selected' */
  public readonly actionLabel = input<string>('Remove selected');

  /** Label while the action runs. @default 'Removing…' */
  public readonly busyLabel = input<string>('Removing…');

  /** The user asked to run the bulk action on the selection. */
  public readonly actionRequested = output<void>();

  /** The user asked to clear the selection. */
  public readonly clearRequested = output<void>();

  /** The user dismissed the outcome. */
  public readonly resultDismissed = output<void>();

  protected readonly XIcon = X;
  protected readonly TrashIcon = Trash2;
  protected readonly DoneIcon = CircleCheck;
  protected readonly FailedIcon = CircleX;

  /** Nothing selected and no outcome to show: only the live regions remain. */
  protected readonly idle = computed(
    () => this.selectedCount() <= 0 && this.result() === null,
  );

  protected readonly selectionLabel = computed(() =>
    bulkSelectionLabel(this.selectedCount()),
  );

  protected readonly summary = computed(() => {
    const result = this.result();
    return result === null ? '' : bulkResultSummary(result);
  });
}
