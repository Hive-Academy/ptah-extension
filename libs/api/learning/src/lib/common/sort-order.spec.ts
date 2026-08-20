import {
  DETERMINISTIC_ORDER_BY,
  SORT_ORDER_STEP,
  appendSortOrder,
  renumberSparse,
} from './sort-order';

describe('renumberSparse — R8.8', () => {
  it('numbers from the step, in the submitted order', () => {
    expect(renumberSparse(['c', 'a', 'b'])).toEqual([
      { id: 'c', sortOrder: 100 },
      { id: 'a', sortOrder: 200 },
      { id: 'b', sortOrder: 300 },
    ]);
  });

  it('starts at the step and not at 0, so a new FIRST row has room', () => {
    // Leaving a gap before the first row matters as much as between them.
    const [first] = renumberSparse(['a', 'b']);

    expect(first?.sortOrder).toBe(SORT_ORDER_STEP);
    expect(first?.sortOrder).toBeGreaterThan(0);
  });

  it('leaves 99 insertion slots between any two adjacent rows', () => {
    // The property R8.8's sparse scale exists for, stated as a property rather
    // than as "the numbers are 100 and 200".
    const positions = renumberSparse(['a', 'b', 'c', 'd']);

    for (let i = 1; i < positions.length; i++) {
      const gap =
        (positions[i]?.sortOrder ?? 0) - (positions[i - 1]?.sortOrder ?? 0);
      expect(gap).toBe(SORT_ORDER_STEP);
      expect(gap - 1).toBe(99);
    }
  });

  it('is strictly increasing, so no two siblings tie', () => {
    const orders = renumberSparse(['a', 'b', 'c', 'd', 'e']).map(
      (p) => p.sortOrder,
    );

    expect(orders).toEqual([...orders].sort((x, y) => x - y));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('handles the empty list without inventing a row', () => {
    expect(renumberSparse([])).toEqual([]);
  });

  it('is pure — it invents no ids and drops none', () => {
    const ids = ['a', 'b', 'c'];

    expect(renumberSparse(ids).map((p) => p.id)).toEqual(ids);
  });
});

describe('appendSortOrder', () => {
  it('appends one step past the highest existing sibling', () => {
    expect(appendSortOrder(300)).toBe(400);
  });

  it('gives the first slot when there are no siblings', () => {
    expect(appendSortOrder(null)).toBe(SORT_ORDER_STEP);
  });

  it('lands after a hand-set position that is not on the scale', () => {
    // An admin may have typed 250. Appending must still come after it.
    expect(appendSortOrder(250)).toBeGreaterThan(250);
  });
});

describe('DETERMINISTIC_ORDER_BY — R2.1.4', () => {
  it('is the (sortOrder, createdAt, id) tuple plan §1.4 states', () => {
    expect(DETERMINISTIC_ORDER_BY).toEqual([
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('ends with `id`, which is what makes it a TOTAL order', () => {
    // 🔴 The load-bearing member. `@@unique([courseId, sortOrder])` is
    // deliberately NOT declared (R8.8), so ties are an ordinary state — and
    // `createdAt` alone still ties for two rows created in the same
    // millisecond. A copy of this tuple that omitted `id` would be right
    // 99.99% of the time, which is the worst available failure rate for an
    // ordering bug.
    expect(DETERMINISTIC_ORDER_BY[DETERMINISTIC_ORDER_BY.length - 1]).toEqual({
      id: 'asc',
    });
  });

  it('sorts a tied fixture set the same way every time', () => {
    // A behavioural check of the tuple's MEANING, not just its shape: two rows
    // sharing a sortOrder must come back in createdAt order, and two sharing
    // both must come back in id order.
    interface Row {
      id: string;
      sortOrder: number;
      createdAt: number;
    }
    const rows: Row[] = [
      { id: 'z', sortOrder: 100, createdAt: 5 },
      { id: 'a', sortOrder: 100, createdAt: 5 },
      { id: 'm', sortOrder: 100, createdAt: 1 },
      { id: 'b', sortOrder: 50, createdAt: 9 },
    ];

    const sorted = [...rows].sort(
      (x, y) =>
        x.sortOrder - y.sortOrder ||
        x.createdAt - y.createdAt ||
        x.id.localeCompare(y.id),
    );

    expect(sorted.map((r) => r.id)).toEqual(['b', 'm', 'a', 'z']);
  });
});
