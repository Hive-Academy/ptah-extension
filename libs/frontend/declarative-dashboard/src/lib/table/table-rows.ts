import type { DashboardTableCell } from '@ptah-extension/shared';
import { SURFACE_PAGE_SIZE, type SurfaceComponentViewState } from '../surface-view-state';
import type { DisplayNode } from '../view-model/view-model.types';

export type TableNode = Extract<DisplayNode, { kind: 'table' }>;
export interface IndexedTableRow {
  readonly originalIndex: number;
  readonly cells: readonly DashboardTableCell[];
}

export function cellText(cell: DashboardTableCell): string {
  return cell === null ? '' : String(cell);
}

/** Ascending groups: numbers, nonempty text/booleans, then null/empty. */
function compareCells(left: DashboardTableCell, right: DashboardTableCell): number {
  const rank = (cell: DashboardTableCell) => cell === null || cell === '' ? 2 : typeof cell === 'number' ? 0 : 1;
  const rankDifference = rank(left) - rank(right);
  if (rankDifference) return rankDifference;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : left > right ? 1 : 0;
  return cellText(left).localeCompare(cellText(right));
}

export function nextTableSort(
  sort: SurfaceComponentViewState['sort'], columnKey: string,
): SurfaceComponentViewState['sort'] {
  if (sort?.columnKey !== columnKey) return { columnKey, direction: 'asc' };
  return sort.direction === 'asc' ? { columnKey, direction: 'desc' } : undefined;
}

/** Shared zero-based paging, clamped after a filter or data change. */
export function pageSlice<T>(items: readonly T[], requestedPage = 0) {
  const pageCount = Math.max(1, Math.ceil(items.length / SURFACE_PAGE_SIZE));
  const page = Math.min(pageCount - 1, Math.max(0,
    Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  return { items: items.slice(page * SURFACE_PAGE_SIZE, (page + 1) * SURFACE_PAGE_SIZE),
    page, pageCount, total: items.length };
}

/** Only rendered columns participate in filtering; indices always refer to the spec. */
export function tableRows(node: TableNode, state: SurfaceComponentViewState = {}) {
  const query = (state.filter ?? '').toLowerCase();
  const rows: IndexedTableRow[] = (node.rows ?? []).map((cells, originalIndex) => ({ cells, originalIndex }))
    .filter(row => node.columns.some((_, index) => cellText(row.cells[index] ?? null).toLowerCase().includes(query)) || !query);
  const column = node.columns.findIndex(item => item.key === state.sort?.columnKey);
  if (state.sort && column >= 0) {
    const direction = state.sort.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const left = a.cells[column] ?? null;
      const right = b.cells[column] ?? null;
      const comparison = compareCells(left, right);
      return comparison * direction || a.originalIndex - b.originalIndex;
    });
  }
  return pageSlice(rows, state.page);
}
