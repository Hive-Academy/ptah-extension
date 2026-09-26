import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, viewChild, type InputSignal } from '@angular/core';
import type { DashboardTableCell } from '@ptah-extension/shared';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceComponentViewState } from '../surface-view-state';
import { cellText, nextTableSort, tableRows, type TableNode } from '../table/table-rows';
import { DashboardPagerComponent } from './dashboard-pager.component';

interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly align: 'left' | 'center' | 'right';
}
type AriaSort = 'ascending' | 'descending' | 'none';

let nextTableInstance = 0;
const ALIGN_CLASSES = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function plainText(value: unknown): string | undefined {
  return record(value) && typeof value['text'] === 'string' ? value['text'] : undefined;
}
function scalarCell(value: unknown): DashboardTableCell {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

@Component({
  selector: 'ptah-dashboard-table',
  standalone: true,
  imports: [DashboardPagerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-bordered bg-base-100 p-3 text-base-content" (keydown.escape)="collapse($event)">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ title() }}</h3>
        <button #expandButton type="button" class="btn btn-ghost btn-xs"
          [attr.aria-label]="(viewState().expanded ? 'Collapse ' : 'Expand ') + title()"
          [attr.aria-expanded]="!!viewState().expanded" [attr.aria-controls]="contentId"
          [attr.data-apps-focus-key]="focusKey('expand')" (click)="toggleExpanded()">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <path [attr.d]="viewState().expanded ? 'M7 14l5-5 5 5' : 'M7 10l5 5 5-5'" />
          </svg>
        </button>
      </div>
      @if (description(); as description) { <p class="text-sm text-base-content-muted">{{ description }}</p> }
      <div [id]="contentId" class="flex flex-col gap-2">
        @if (node().data; as data) {
          <p role="status">Data is not available in this view.@if (data.rowCount !== undefined) { {{ data.rowCount }} rows. }</p>
        } @else {
          <label [for]="filterId" class="text-sm text-base-content-muted">Filter {{ title() }}</label>
          <input #filterInput [id]="filterId" type="search" class="input input-bordered input-sm w-full"
            [value]="viewState().filter ?? ''" [attr.data-apps-focus-key]="focusKey('filter')"
            (input)="setFilter(filterInput.value)" />
          <p role="status" class="text-sm text-base-content-muted">{{ page().total }} results</p>
          <div class="overflow-auto" [class.max-h-96]="!viewState().expanded">
            <table class="table table-xs w-full">
              <caption class="sr-only">{{ title() }}</caption>
              <thead>
                <tr>
                  @for (column of columns(); track $index) {
                    <th scope="col" [class]="alignClass(column)" [attr.aria-sort]="ariaSort(column)">
                      <button type="button" class="btn btn-ghost btn-xs"
                        [attr.data-apps-focus-key]="focusKey('sort-' + $index)" (click)="sortBy(column)">{{ column.label }}</button>
                    </th>
                  }
                  @if (node().selectable) { <th scope="col">Selection</th> }
                </tr>
              </thead>
              <tbody>
                @for (row of page().items; track row.originalIndex) {
                  <tr>
                    @for (column of columns(); track $index) {
                      <td [class]="alignClass(column)">{{ cell(row.cells, $index) }}</td>
                    }
                    @if (node().selectable) {
                      <td><button type="button" class="btn btn-ghost btn-xs"
                        [attr.aria-label]="'Select row ' + (row.originalIndex + 1)"
                        [attr.aria-pressed]="isSelected(row.originalIndex)"
                        [attr.data-apps-focus-key]="focusKey('row-' + row.originalIndex)"
                        (click)="selectRow(row.originalIndex)">Select</button></td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <ptah-dashboard-pager [pagination]="page()" [surfaceId]="surfaceId()" [componentId]="node().id"
            (pageChange)="setPage($event)" />
        }
      </div>
    </section>
  `,
})
export class DashboardTableComponent {
  public readonly node: InputSignal<TableNode> = input.required<TableNode>();
  public readonly surfaceId = input('');
  public readonly viewState = input<SurfaceComponentViewState>({});
  public readonly selection = input<SurfaceSelection | null>(null);
  public readonly viewStateChange = output<SurfaceComponentViewState>();
  public readonly selectionChange = output<SurfaceSelection>();
  public readonly contentId = `ptah-table-content-${nextTableInstance++}`;
  public readonly filterId = `${this.contentId}-filter`;
  public readonly title = computed(() => plainText(this.node().title) ?? 'Table');
  public readonly description = computed(() => plainText(this.node().description));
  /** Malformed columns keep their position so cells stay aligned; they never render "[object Object]". */
  public readonly columns = computed((): readonly TableColumn[] => {
    const columns: unknown = this.node().columns;
    if (!Array.isArray(columns)) return [];
    return columns.map((column: unknown, index): TableColumn => {
      const key = record(column) && typeof column['key'] === 'string' ? column['key'] : `#${index}`;
      const align = record(column) && (column['align'] === 'center' || column['align'] === 'right') ? column['align'] : 'left';
      return { key, label: plainText(record(column) ? column['label'] : undefined) ?? key, align };
    });
  });
  /** Rows normalised to scalar cells; indices stay those of the spec. */
  private readonly safeNode = computed((): TableNode => {
    const rows: unknown = this.node().rows;
    return {
      ...this.node(),
      columns: this.columns().map(column => ({ key: column.key, label: { text: column.label }, align: column.align })),
      rows: Array.isArray(rows) ? rows.map((row: unknown) => Array.isArray(row) ? row.map(scalarCell) : []) : [],
    };
  });
  public readonly page = computed(() => tableRows(this.safeNode(), this.viewState()));
  private readonly expandButton = viewChild.required<ElementRef<HTMLButtonElement>>('expandButton');

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public cell(cells: readonly DashboardTableCell[], index: number): string { return cellText(cells[index] ?? null); }
  public alignClass(column: TableColumn): string { return ALIGN_CLASSES[column.align]; }
  public ariaSort(column: TableColumn): AriaSort {
    const sort = this.viewState().sort;
    if (sort?.columnKey !== column.key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }
  public sortBy(column: TableColumn): void {
    this.viewStateChange.emit({ ...this.viewState(), sort: nextTableSort(this.viewState().sort, column.key), page: 0 });
  }
  public setFilter(filter: string): void { this.viewStateChange.emit({ ...this.viewState(), filter, page: 0 }); }
  public setPage(page: number): void { this.viewStateChange.emit({ ...this.viewState(), page }); }
  public toggleExpanded(): void { this.viewStateChange.emit({ ...this.viewState(), expanded: !this.viewState().expanded }); }
  public collapse(event: Event): void {
    if (!this.viewState().expanded) return;
    event.stopPropagation();
    this.viewStateChange.emit({ ...this.viewState(), expanded: false });
    this.expandButton().nativeElement.focus();
  }
  public isSelected(rowIndex: number): boolean {
    const selection = this.selection();
    return selection?.componentId === this.node().id && selection.target.kind === 'table-row' && selection.target.rowIndex === rowIndex;
  }
  public selectRow(rowIndex: number): void {
    const rows = this.safeNode().rows ?? [];
    if (this.node().selectable && Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < rows.length) {
      this.selectionChange.emit({ componentId: this.node().id, target: { kind: 'table-row', rowIndex } });
    }
  }
}
