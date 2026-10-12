import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { FileStatusBadgeComponent } from '@ptah-extension/ui';
import { ROW_PAGE_SIZE } from '../../molecules/change-set/change-set-card.component';
import type {
  TurnSummaryFileRow,
  TurnSummaryFilesCard,
} from '../../molecules/turn-recap/turn-summary.model';

/** `src/app/alpha.ts` → `src/app/` and `alpha.ts`. */
function splitPath(path: string): {
  readonly dir: string;
  readonly name: string;
} {
  const slash = path.lastIndexOf('/');
  return slash < 0
    ? { dir: '', name: path }
    : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

/**
 * TurnSummaryFilesComponent - the expanded Files card of the panel's turn
 * summary (TASK_2026_623, component 5; R6.1, R6.3, R6.8; parity-inventory
 * section 2, the change-set card's capabilities).
 *
 * One row per active file: the status badge (accessible name, `U` when
 * conflicted), the path (directory muted, file name bold, full path in
 * `title`), the rename origin, the counts (`+n −n`, `?`, `binary`, or
 * "+0 −0" only when both are 0) and a Review or Resolve action whose
 * accessible name includes the file name. Footer: Review all, 50 rows per
 * page, "+N more files not listed". Files that no longer change HEAD sit in a
 * native `<details>` group. Presentational: the dock handles both outputs
 * through `ChangeSetActionsService`.
 */
@Component({
  selector: 'ptah-turn-summary-files',
  standalone: true,
  imports: [LucideAngularModule, FileStatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .ts-wrap {
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    @let files = card();
      @if (files.baselineMissing) {
        <p
          class="ts-wrap mb-2 flex items-start gap-1.5 rounded border border-warning/40 px-2 py-1.5"
          role="note"
          data-testid="turn-summary-baseline-missing"
        >
          <lucide-angular
            [img]="TriangleAlertIcon"
            class="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          May include changes made before this turn.
        </p>
      }
      @if (files.countsUnavailable) {
        <p
          class="ts-wrap mb-2 text-base-content-muted"
          data-testid="turn-summary-counts-unavailable"
        >
          Line counts are unavailable for this turn.
        </p>
      }
      <ul class="flex min-w-0 flex-col" role="list">
        @for (row of visibleActiveRows(); track row.file.path) {
          <li
            class="flex min-w-0 flex-col gap-1 border-b border-base-content/10 py-1.5 last:border-b-0"
            data-testid="turn-summary-file-row"
          >
            <div class="flex min-w-0 items-start gap-2">
              <ptah-file-status-badge
                [status]="row.state === 'conflicted' ? 'U' : row.file.status"
              />
              <span
                class="ts-wrap min-w-0 flex-1"
                [title]="row.file.path"
                data-testid="turn-summary-file-path"
              >
                <span class="text-base-content-muted">{{
                  dirOf(row.file.path)
                }}</span
                ><span class="font-semibold">{{ nameOf(row.file.path) }}</span>
              </span>
              @if (row.state === 'conflicted') {
                <span
                  class="badge badge-sm badge-ghost h-auto whitespace-nowrap diff-del-text"
                  data-testid="turn-summary-file-conflicted"
                  >Conflicted</span
                >
              } @else {
                <span
                  class="shrink-0 font-mono tabular-nums text-base-content-muted"
                  data-testid="turn-summary-file-counts"
                  >{{ row.counts }}</span
                >
              }
            </div>
            @if (row.file.origPath; as origin) {
              <span
                class="ts-wrap pl-6 font-mono text-[11px] text-base-content-muted"
                data-testid="turn-summary-file-origin"
                >renamed from {{ origin }}</span
              >
            }
            <span class="flex flex-wrap gap-1 pl-6">
              <button
                type="button"
                class="btn btn-xs btn-ghost min-h-6 rounded-full border border-base-content/20"
                [attr.aria-label]="rowActionName(row)"
                [title]="rowActionName(row)"
                (click)="openFile.emit(row.file.path)"
                data-testid="turn-summary-file-action"
              >
                {{ row.state === 'conflicted' ? 'Resolve' : 'Review' }}
              </button>
            </span>
          </li>
        }
      </ul>
      <div
        class="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-base-content/10 pt-2"
      >
        <button
          type="button"
          class="btn btn-xs btn-primary rounded-full"
          (click)="review.emit()"
          data-testid="turn-summary-review-all"
        >
          Review all
        </button>
        @if (hiddenActiveCount() > 0) {
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            (click)="showMoreActive()"
            data-testid="turn-summary-show-more"
          >
            {{ showMoreLabel(hiddenActiveCount()) }}
          </button>
        }
        @if (files.truncatedCount > 0) {
          <span
            class="text-base-content-muted"
            data-testid="turn-summary-truncated"
            >+{{ files.truncatedCount }} more
            {{ files.truncatedCount === 1 ? 'file' : 'files' }} not listed</span
          >
        }
      </div>
      @if (reconciledRows().length > 0) {
        <details
          class="mt-2 border-t border-base-content/10 pt-2"
          data-testid="turn-summary-reconciled"
        >
          <summary class="cursor-pointer text-base-content-muted">
            No longer changes HEAD ({{ reconciledRows().length }})
          </summary>
          <ul class="mt-1 flex min-w-0 flex-col gap-1" role="list">
            @for (row of visibleReconciledRows(); track row.file.path) {
              <li
                class="flex min-w-0 items-start gap-2 text-base-content-muted"
                data-testid="turn-summary-file-reconciled"
              >
                <ptah-file-status-badge [status]="row.file.status" />
                <span
                  class="ts-wrap min-w-0 flex-1"
                  [title]="row.file.path"
                  data-testid="turn-summary-file-reconciled-path"
                  >{{
                  row.file.path
                }}</span>
              </li>
            }
            @if (hiddenReconciledCount() > 0) {
              <li>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  (click)="showMoreReconciled()"
                  data-testid="turn-summary-show-more-reconciled"
                >
                  {{ showMoreLabel(hiddenReconciledCount()) }}
                </button>
              </li>
            }
          </ul>
        </details>
      }
  `,
})
export class TurnSummaryFilesComponent {
  /** The model's Files card: rows, marks and change-set states. */
  readonly card = input.required<TurnSummaryFilesCard>();
  /** Open (or resolve) one file of the change set; emits its path. */
  readonly openFile = output<string>();
  /** Review the whole change set. */
  readonly review = output<void>();

  protected readonly TriangleAlertIcon = TriangleAlert;

  private readonly activeLimit = signal(ROW_PAGE_SIZE);
  private readonly reconciledLimit = signal(ROW_PAGE_SIZE);

  protected readonly activeRows = computed(
    (): readonly TurnSummaryFileRow[] =>
      this.card().rows.filter((row) => row.state !== 'reconciled'),
  );
  protected readonly reconciledRows = computed(
    (): readonly TurnSummaryFileRow[] =>
      this.card().rows.filter((row) => row.state === 'reconciled'),
  );
  protected readonly visibleActiveRows = computed(() =>
    this.activeRows().slice(0, this.activeLimit()),
  );
  protected readonly visibleReconciledRows = computed(() =>
    this.reconciledRows().slice(0, this.reconciledLimit()),
  );
  protected readonly hiddenActiveCount = computed(
    () => this.activeRows().length - this.visibleActiveRows().length,
  );
  protected readonly hiddenReconciledCount = computed(
    () => this.reconciledRows().length - this.visibleReconciledRows().length,
  );

  protected showMoreActive(): void {
    this.activeLimit.update((limit) => limit + ROW_PAGE_SIZE);
  }

  protected showMoreReconciled(): void {
    this.reconciledLimit.update((limit) => limit + ROW_PAGE_SIZE);
  }

  protected showMoreLabel(hidden: number): string {
    return `Show ${Math.min(hidden, ROW_PAGE_SIZE)} more (${hidden} hidden)`;
  }

  protected dirOf(path: string): string {
    return splitPath(path).dir;
  }

  protected nameOf(path: string): string {
    return splitPath(path).name;
  }

  /** The row action's accessible name, including the file name (design 5). */
  protected rowActionName(row: TurnSummaryFileRow): string {
    const name = splitPath(row.file.path).name;
    return row.state === 'conflicted'
      ? `Resolve ${name}`
      : `Show ${name} in review`;
  }
}
