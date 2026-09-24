import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  Check,
  CircleAlert,
  LucideAngularModule,
  Minus,
  RefreshCw,
  Terminal,
  Zap,
  type LucideIconData,
} from 'lucide-angular';
import { BrandMarkComponent } from '@ptah-extension/ui';

import type {
  CoverageCell,
  CoverageMatrix,
  CoverageRow,
} from '../data/coverage';
import { TargetMarksComponent } from './target-marks.component';

/** How one cell state is drawn: icon, tone and the words a reader hears. */
export interface CoverageCellPresentation {
  readonly icon: LucideIconData;
  readonly toneClass: string;
  /** Visually hidden text naming the state. */
  readonly srText: string;
}

const CELL_PRESENTATION: Readonly<
  Record<CoverageCell, CoverageCellPresentation>
> = {
  configured: {
    icon: Check,
    toneClass: 'text-success',
    srText: 'Configured',
  },
  'declared-by-cli': {
    icon: Terminal,
    toneClass: 'text-info',
    srText: "Declared in the CLI's own config",
  },
  'session-override': {
    icon: Zap,
    toneClass: 'text-secondary',
    srText: 'Injected into Ptah sessions only',
  },
  none: {
    icon: Minus,
    toneClass: 'text-base-content-muted',
    srText: 'Not configured',
  },
};

/** The icon, tone and hidden words of a cell state. */
export function coverageCellPresentation(
  cell: CoverageCell,
): CoverageCellPresentation {
  return CELL_PRESENTATION[cell];
}

/** Legend order. */
const LEGEND: readonly CoverageCell[] = [
  'configured',
  'declared-by-cli',
  'session-override',
  'none',
];

/** A row ready to draw. */
interface MatrixRowView {
  readonly row: CoverageRow;
  /** Per-target cells, or `null` for the merged cell. */
  readonly cells:
    | readonly {
        readonly key: string;
        readonly presentation: CoverageCellPresentation;
      }[]
    | null;
  readonly mergedLabel: string;
}

/**
 * Which CLI receives which MCP server (plan C8 `CoverageMatrix`), from the
 * `buildCoverageMatrix()` model (`data/coverage.ts`).
 *
 * A real `<table>` with a `<caption>`: column headers are the CLI targets,
 * row headers the servers. Every cell is an icon plus visually hidden text,
 * so the state is never carried by colour or shape alone. Connection and
 * account-connector rows render ONE merged "Ptah sessions" cell spanning
 * every target column: only Ptah's own sessions receive those servers (A5),
 * so a per-CLI answer would be a claim without evidence.
 *
 * States: `loading`, `error` (with a Retry output) and an empty state when
 * there are no servers.
 *
 * @example
 * ```html
 * <ptah-coverage-matrix [matrix]="coverage()" [state]="installedState()" />
 * ```
 */
@Component({
  selector: 'ptah-coverage-matrix',
  standalone: true,
  imports: [LucideAngularModule, BrandMarkComponent, TargetMarksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="rounded-xl border border-base-300 bg-base-200"
      [attr.aria-busy]="state() === 'loading'"
      data-testid="coverage-matrix"
    >
      @switch (state()) {
        @case ('loading') {
          <div class="space-y-2 p-3" data-testid="coverage-matrix-loading">
            <span class="sr-only">Loading {{ caption() }}…</span>
            @for (line of skeletonLines; track line) {
              <div class="skeleton h-6 w-full rounded" aria-hidden="true"></div>
            }
          </div>
        }
        @case ('error') {
          <div
            role="alert"
            class="space-y-2 p-3"
            data-testid="coverage-matrix-error"
          >
            <p class="flex items-start gap-1.5 text-xs text-error">
              <lucide-angular
                [img]="ErrorIcon"
                class="mt-px h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{{
                errorMessage() || 'Could not build the coverage matrix.'
              }}</span>
            </p>
            <button
              type="button"
              class="btn btn-outline btn-xs gap-1"
              data-testid="coverage-matrix-retry"
              (click)="retryRequested.emit()"
            >
              <lucide-angular
                [img]="RetryIcon"
                class="h-3 w-3"
                aria-hidden="true"
              />
              Retry
            </button>
          </div>
        }
        @default {
          @if (matrix().rows.length === 0) {
            <p
              class="p-3 text-xs text-base-content-muted"
              data-testid="coverage-matrix-empty"
            >
              No MCP servers installed yet, so no CLI receives any.
            </p>
          } @else {
            <div class="overflow-x-auto">
              <table class="table table-xs w-full" data-testid="coverage-table">
                <caption
                  class="px-3 pb-2 pt-3 text-left text-xs text-base-content-muted"
                >
                  {{
                    caption()
                  }}
                </caption>
                <thead>
                  <tr class="border-base-300">
                    <th
                      scope="col"
                      class="text-left text-xs font-normal text-base-content-muted"
                    >
                      Server
                    </th>
                    @for (column of matrix().columns; track column.target) {
                      <th
                        scope="col"
                        class="text-center text-xs font-normal"
                        [attr.data-target]="column.target"
                        data-testid="coverage-column"
                      >
                        <span class="inline-flex items-center gap-1.5">
                          <span aria-hidden="true" class="inline-flex">
                            <ptah-target-marks
                              [targets]="[column]"
                              [maxVisible]="1"
                            />
                          </span>
                          <span class="whitespace-nowrap">{{
                            column.label
                          }}</span>
                        </span>
                      </th>
                    }
                    @if (matrix().columns.length === 0) {
                      <th
                        scope="col"
                        class="text-center text-xs font-normal text-base-content-muted"
                      >
                        CLI targets
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (view of rowViews(); track view.row.ref) {
                    <tr
                      class="border-base-300"
                      [attr.data-ref]="view.row.ref"
                      data-testid="coverage-row"
                    >
                      <th scope="row" class="text-left font-normal">
                        <span class="flex min-w-0 items-center gap-2">
                          <ptah-brand-mark
                            [brandSlug]="view.row.brand"
                            [label]="view.row.title"
                            size="sm"
                          />
                          <span class="min-w-0">
                            <span
                              class="block truncate text-sm text-base-content"
                              >{{ view.row.title }}</span
                            >
                            <span
                              class="block truncate text-[11px] text-base-content-muted"
                              >{{ view.row.originLabel }}</span
                            >
                          </span>
                        </span>
                      </th>
                      @if (view.cells; as cells) {
                        @for (cell of cells; track cell.key) {
                          <td class="text-center" data-testid="coverage-cell">
                            <span
                              class="inline-flex"
                              [class]="cell.presentation.toneClass"
                              aria-hidden="true"
                            >
                              <lucide-angular
                                [img]="cell.presentation.icon"
                                class="h-4 w-4"
                              />
                            </span>
                            <span class="sr-only">{{
                              cell.presentation.srText
                            }}</span>
                          </td>
                        }
                      } @else {
                        <td
                          class="text-center"
                          [attr.colspan]="spanColumns()"
                          data-testid="coverage-merged-cell"
                        >
                          <span
                            class="inline-flex items-center gap-1.5 rounded-full border border-secondary/30 px-2 py-0.5 text-xs text-base-content"
                          >
                            <span
                              class="inline-flex"
                              [class]="merged.toneClass"
                              aria-hidden="true"
                            >
                              <lucide-angular
                                [img]="merged.icon"
                                class="h-3.5 w-3.5"
                              />
                            </span>
                            {{ view.mergedLabel }}
                            <span class="sr-only">— {{ merged.srText }}</span>
                          </span>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <ul
              class="flex flex-wrap gap-x-4 gap-y-1 border-t border-base-300 px-3 py-2 text-[11px] text-base-content-muted"
              aria-label="Legend"
              data-testid="coverage-legend"
            >
              @for (cell of legend; track cell) {
                <li class="inline-flex items-center gap-1">
                  <span
                    class="inline-flex"
                    [class]="presentationOf(cell).toneClass"
                    aria-hidden="true"
                  >
                    <lucide-angular
                      [img]="presentationOf(cell).icon"
                      class="h-3.5 w-3.5"
                    />
                  </span>
                  {{ presentationOf(cell).srText }}
                </li>
              }
            </ul>
          }
        }
      }
    </section>
  `,
})
export class CoverageMatrixComponent {
  /** The matrix from `buildCoverageMatrix()`. */
  public readonly matrix = input.required<CoverageMatrix>();

  /** Load state of the rows the matrix is built from. @default 'ready' */
  public readonly state = input<'loading' | 'ready' | 'error'>('ready');

  /** Shown in the error state; a generic line when absent. */
  public readonly errorMessage = input<string | null>(null);

  /** The table caption. */
  public readonly caption = input<string>(
    'Coverage: which CLI receives which MCP server',
  );

  /** The user asked to retry the failed load. */
  public readonly retryRequested = output<void>();

  protected readonly ErrorIcon = CircleAlert;
  protected readonly RetryIcon = RefreshCw;
  protected readonly skeletonLines = [0, 1, 2, 3] as const;
  protected readonly legend = LEGEND;
  protected readonly merged = CELL_PRESENTATION['session-override'];
  protected readonly presentationOf = coverageCellPresentation;

  /** Target columns the merged cell spans; at least the placeholder one. */
  protected readonly spanColumns = computed(() =>
    Math.max(1, this.matrix().columns.length),
  );

  protected readonly rowViews = computed((): MatrixRowView[] => {
    const { columns, rows } = this.matrix();
    return rows.map((row) => {
      if (row.coverage.kind === 'merged') {
        return { row, cells: null, mergedLabel: row.coverage.label };
      }
      const cells = row.coverage.cells;
      // No target columns: one placeholder cell under "CLI targets".
      const drawn =
        columns.length === 0
          ? [{ key: 'none', presentation: CELL_PRESENTATION.none }]
          : columns.map((column, index) => ({
              key: column.target,
              presentation: CELL_PRESENTATION[cells[index] ?? 'none'],
            }));
      return { row, cells: drawn, mergedLabel: '' };
    });
  });
}
