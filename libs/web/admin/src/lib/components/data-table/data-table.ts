import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Rows3, Rows4 } from 'lucide-angular';

import type { FieldSpec } from '../../admin-models.config';
import { EmptyState } from '../empty-state/empty-state';
import { StatusBadge } from '../status-badge/status-badge';

/**
 * Page/sort/selection event shapes emitted by `DataTable`.
 */
export interface DataTableSortEvent {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface DataTablePageEvent {
  page: number;
  pageSize: number;
}

/**
 * DataTable — reusable presentational table for the admin dashboard.
 *
 * Dumb component by design: receives rows + metadata via signal inputs and
 * emits every user interaction. The parent (`AdminList`) owns query state
 * and re-fetches on every event.
 *
 * - Only renders columns with `field.listColumn === true`.
 * - Formats cell values by `field.type` (datetime → DatePipe medium,
 *   boolean → yes/no badge, truncate applies max-width ellipsis).
 * - When `selectable()` is true, renders a checkbox column with a
 *   "select-all-on-page" header checkbox; selection is tracked as a set of
 *   row ids and emitted on every change.
 * - Clicking a row body (NOT the checkbox) emits `rowClick(id)`.
 */
@Component({
  selector: 'ptah-admin-data-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, LucideAngularModule, StatusBadge, EmptyState],
  templateUrl: './data-table.html',
})
export class DataTable {
  /** lucide density-toggle glyphs (compact = tighter rows). */
  protected readonly Rows3 = Rows3;
  protected readonly Rows4 = Rows4;
  /** Ordered column specs (full model field list — we filter `listColumn` internally). */
  public readonly columns = input.required<readonly FieldSpec[]>();

  /** Row data. `unknown[]` because different models have different shapes. */
  public readonly rows = input<readonly unknown[]>([]);

  /** Total rows across ALL pages (for pagination label). */
  public readonly total = input<number>(0);

  /** 1-based current page. */
  public readonly page = input<number>(1);

  /** Page size (matches backend `ListQueryDto` cap of 100). */
  public readonly pageSize = input<number>(25);

  /** Current sort column, if any. */
  public readonly sortBy = input<string | undefined>(undefined);

  /** Current sort direction. */
  public readonly sortOrder = input<'asc' | 'desc'>('desc');

  /** Whether to render the leading checkbox column for bulk operations. */
  public readonly selectable = input<boolean>(false);

  /** Loading flag — dims the table body. */
  public readonly loading = input<boolean>(false);

  public readonly sortChange = output<DataTableSortEvent>();
  public readonly pageChange = output<DataTablePageEvent>();
  public readonly rowClick = output<string>();
  public readonly selectionChange = output<string[]>();

  /** Selected row ids. Cleared externally by parent when rows change (not auto). */
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  /** Columns actually rendered — `listColumn === true`. */
  protected readonly listColumns = computed<readonly FieldSpec[]>(() =>
    this.columns().filter((c) => c.listColumn === true),
  );

  /** Total pages — at least 1 so the pager never shows "Page 1 of 0". */
  protected readonly totalPages = computed<number>(() => {
    const ps = Math.max(1, this.pageSize());
    return Math.max(1, Math.ceil(this.total() / ps));
  });

  /** Page-size options for the <select> widget. */
  protected readonly pageSizeOptions: readonly number[] = [10, 25, 50, 100];

  /** localStorage key for the persisted density preference. */
  private static readonly DENSITY_KEY = 'ptah-admin-table-density';

  /**
   * Row density (design spec §5.5): `compact` = current `table-sm`,
   * `comfortable` = default `table` spacing. Persisted to `localStorage`.
   */
  protected readonly density = signal<'compact' | 'comfortable'>(
    DataTable.readDensity(),
  );

  /**
   * FIRST-load skeleton: only when a fetch is in flight AND we have no rows
   * to dim yet. Once rows exist, refetches (pagination/sort) dim in place via
   * `[class.opacity-50]` instead of flashing skeletons over real data.
   */
  protected readonly showSkeleton = computed<boolean>(
    () => this.loading() && this.rows().length === 0,
  );

  /** Fixed-length placeholder list for skeleton rows (~5). */
  protected readonly skeletonRows: readonly number[] = [0, 1, 2, 3, 4];

  /** Total leading + data column count — drives skeleton/empty colspan. */
  protected readonly columnCount = computed<number>(
    () => this.listColumns().length + (this.selectable() ? 1 : 0),
  );

  /** Index list sized to the column count — drives skeleton cell iteration. */
  protected readonly skeletonCols = computed<readonly number[]>(() =>
    Array.from({ length: this.columnCount() }, (_, i) => i),
  );

  private static readDensity(): 'compact' | 'comfortable' {
    try {
      if (typeof localStorage === 'undefined') return 'compact';
      const v = localStorage.getItem(DataTable.DENSITY_KEY);
      return v === 'comfortable' ? 'comfortable' : 'compact';
    } catch {
      return 'compact';
    }
  }

  /** Flip compact ⇄ comfortable and persist (best-effort). */
  protected toggleDensity(): void {
    const next = this.density() === 'compact' ? 'comfortable' : 'compact';
    this.density.set(next);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DataTable.DENSITY_KEY, next);
      }
    } catch {
      /* storage unavailable (private mode / SSR) — keep in-memory only. */
    }
  }

  /**
   * Best-effort extraction of a row's id. We accept `unknown` rows so we
   * check shape defensively.
   */
  protected rowId(row: unknown): string {
    if (row && typeof row === 'object' && 'id' in row) {
      const id = (row as { id?: unknown }).id;
      if (typeof id === 'string') return id;
      if (typeof id === 'number') return String(id);
    }
    return '';
  }

  /** Look up a column value off an unknown row — never throws. */
  protected cellValue(row: unknown, key: string): unknown {
    if (row && typeof row === 'object' && key in row) {
      return (row as Record<string, unknown>)[key];
    }
    return undefined;
  }

  /**
   * Format a primitive cell value for display. Datetime is handled in the
   * template via DatePipe to preserve Angular's locale support.
   */
  protected formatString(value: unknown, truncate?: number): string {
    if (value == null) return '—';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (truncate && text.length > truncate) {
      return text.slice(0, truncate) + '…';
    }
    return text;
  }

  protected isTruthy(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
  }

  /**
   * Narrow an unknown cell value to something DatePipe accepts. Returns
   * `null` when the value isn't a valid date source — the template then
   * renders the em-dash fallback branch.
   */
  protected asDate(value: unknown): string | number | Date | null {
    if (value == null) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
  }

  protected onHeaderClick(col: FieldSpec): void {
    const currentBy = this.sortBy();
    const currentOrder = this.sortOrder();
    const nextOrder: 'asc' | 'desc' =
      currentBy === col.key && currentOrder === 'asc' ? 'desc' : 'asc';
    this.sortChange.emit({ sortBy: col.key, sortOrder: nextOrder });
  }

  protected sortIndicator(col: FieldSpec): '' | '▲' | '▼' {
    if (this.sortBy() !== col.key) return '';
    return this.sortOrder() === 'asc' ? '▲' : '▼';
  }

  protected onPrev(): void {
    const next = Math.max(1, this.page() - 1);
    if (next !== this.page()) {
      this.pageChange.emit({ page: next, pageSize: this.pageSize() });
    }
  }

  protected onNext(): void {
    const next = Math.min(this.totalPages(), this.page() + 1);
    if (next !== this.page()) {
      this.pageChange.emit({ page: next, pageSize: this.pageSize() });
    }
  }

  protected onPageSizeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const newSize = target ? Number(target.value) : this.pageSize();
    if (Number.isFinite(newSize) && newSize > 0) {
      this.pageChange.emit({ page: 1, pageSize: newSize });
    }
  }

  protected onRowClick(row: unknown, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && target.tagName === 'INPUT') return;
    const id = this.rowId(row);
    if (id) this.rowClick.emit(id);
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected toggleRow(id: string, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds.set(next);
    this.selectionChange.emit(Array.from(next));
  }

  protected get allOnPageSelected(): boolean {
    const rows = this.rows();
    if (rows.length === 0) return false;
    const sel = this.selectedIds();
    for (const r of rows) {
      const id = this.rowId(r);
      if (!id || !sel.has(id)) return false;
    }
    return true;
  }

  protected toggleAllOnPage(event: Event): void {
    event.stopPropagation();
    const next = new Set(this.selectedIds());
    const selectAll = !this.allOnPageSelected;
    for (const r of this.rows()) {
      const id = this.rowId(r);
      if (!id) continue;
      if (selectAll) next.add(id);
      else next.delete(id);
    }
    this.selectedIds.set(next);
    this.selectionChange.emit(Array.from(next));
  }

  /** Parent hook — called when the model changes to drop stale selection. */
  public clearSelection(): void {
    if (this.selectedIds().size === 0) return;
    this.selectedIds.set(new Set());
    this.selectionChange.emit([]);
  }
}
