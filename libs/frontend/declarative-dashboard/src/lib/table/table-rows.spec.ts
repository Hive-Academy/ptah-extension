import { cellText, nextTableSort, pageSlice, tableRows, type TableNode } from './table-rows';

describe('table rows', () => {
  const node: TableNode = { id: 'table', kind: 'table', selectable: false,
    columns: [{ key: 'value', label: { text: 'Value' } }], rows: [[10], [2], [2], [null]] };
  it('cycles ascending, descending and original without mutating input', () => {
    const asc = nextTableSort(undefined, 'value');
    const desc = nextTableSort(asc, 'value');
    const original = nextTableSort(desc, 'value');
    expect(asc).toEqual({ columnKey: 'value', direction: 'asc' });
    expect(tableRows(node, { sort: asc }).items.map(row => row.originalIndex)).toEqual([1, 2, 0, 3]);
    expect(tableRows(node, { sort: desc }).items.map(row => row.originalIndex)).toEqual([3, 0, 1, 2]);
    expect(original).toBeUndefined();
    expect(tableRows(node, { sort: original }).items.map(row => row.originalIndex)).toEqual([0, 1, 2, 3]);
    expect(nextTableSort(desc, 'other')?.direction).toBe('asc');
    expect(node.rows).toEqual([[10], [2], [2], [null]]);
  });
  it('totally orders mixed cells in both directions with stable empty and numeric ties', () => {
    const mixed: TableNode = { ...node, rows: [[10], ['2'], [2], [null], [''], [false], ['10'], [2], [true]] };
    const indices = (direction: 'asc' | 'desc') => tableRows(mixed, { sort: { columnKey: 'value', direction } })
      .items.map(row => row.originalIndex);
    expect(indices('asc')).toEqual([2, 7, 0, 6, 1, 5, 8, 3, 4]);
    expect(indices('desc')).toEqual([3, 4, 8, 5, 1, 6, 0, 2, 7]);
    expect(tableRows(mixed).items.map(row => row.originalIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('filters literal visible cells case-insensitively, excluding hidden data', () => {
    const textNode: TableNode = { ...node, rows: [['<b>ALPHA</b>', 'secret'], [false], [null]] };
    expect(tableRows(textNode, { filter: '<b>alpha' }).total).toBe(1);
    expect(tableRows(textNode, { filter: 'secret' }).total).toBe(0);
    expect(tableRows(textNode, { filter: 'false' }).items[0].originalIndex).toBe(1);
    expect(cellText(null)).toBe('');
  });
  it('slices 25 rows and clamps invalid or stale pages', () => {
    const rows = Array.from({ length: 51 }, (_, index) => index);
    expect(pageSlice(rows, 1)).toEqual({ items: rows.slice(25, 50), page: 1, pageCount: 3, total: 51 });
    expect(pageSlice(rows, 99).items).toEqual([50]);
    expect(pageSlice(rows, -1).page).toBe(0);
    expect(pageSlice(rows, NaN).page).toBe(0);
    expect(pageSlice([], 5)).toEqual({ items: [], page: 0, pageCount: 1, total: 0 });
  });
});
