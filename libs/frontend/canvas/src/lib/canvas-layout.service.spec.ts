/**
 * CanvasLayoutService — columns-from-width and fill-remainder apportionment.
 *
 * The service is driven through its real `observe()` path with a stubbed
 * `ResizeObserver` and a synchronous `requestAnimationFrame`, so no test-only
 * setter has to be added to the public API.
 */

import { TestBed } from '@angular/core/testing';

import {
  CanvasLayoutService,
  MAX_COLUMNS,
  MIN_TILE_UNITS,
  MIN_TILE_WIDTH,
  type TileIntent,
} from './canvas-layout.service';

/** Gridstack `margin` — the gutter the column formula accounts for. */
const MARGIN = 8;
const GRID_COLUMNS = 12;
const TILE_HEIGHT_UNITS = 6;

/** Narrowest container that still fits `n` tiles of `MIN_TILE_WIDTH`. */
const minWidthForColumns = (n: number): number =>
  n * (MIN_TILE_WIDTH + MARGIN) - MARGIN;

type ObserverCallback = (entries: ResizeObserverEntry[]) => void;

let capturedCallback: ObserverCallback | null = null;
let originalResizeObserver: typeof ResizeObserver | undefined;
let originalRaf: typeof requestAnimationFrame;
let originalCancelRaf: typeof cancelAnimationFrame;

const intent = (tabId: string, order: number, weight = 1): TileIntent => ({
  tabId,
  order,
  weight,
  rowBreakBefore: false,
});

describe('CanvasLayoutService', () => {
  let service: CanvasLayoutService;

  const measure = (width: number, height: number): void => {
    capturedCallback?.([
      { contentRect: { width, height } } as unknown as ResizeObserverEntry,
    ]);
  };

  beforeEach(() => {
    capturedCallback = null;
    originalResizeObserver = globalThis.ResizeObserver;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancelRaf = globalThis.cancelAnimationFrame;

    globalThis.ResizeObserver = class {
      constructor(cb: ObserverCallback) {
        capturedCallback = cb;
      }
      observe(): void {
        /* no-op */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    } as unknown as typeof ResizeObserver;

    // Run the measurement callback synchronously so tests never await a frame.
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {
      /* no-op */
    }) as typeof cancelAnimationFrame;

    TestBed.configureTestingModule({ providers: [CanvasLayoutService] });
    service = TestBed.inject(CanvasLayoutService);
    service.observe(document.createElement('div'));
  });

  afterEach(() => {
    globalThis.ResizeObserver =
      originalResizeObserver as typeof globalThis.ResizeObserver;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  describe('column count derives from a minimum tile width', () => {
    it('gives two columns at the reported 1180 px regression width', () => {
      expect(service.columnsFor(1180)).toBe(2);
    });

    it('steps 1 -> 2 -> 3 at the widths MIN_TILE_WIDTH implies', () => {
      expect(service.columnsFor(minWidthForColumns(2) - 1)).toBe(1);
      expect(service.columnsFor(minWidthForColumns(2))).toBe(2);
      expect(service.columnsFor(minWidthForColumns(3) - 1)).toBe(2);
      expect(service.columnsFor(minWidthForColumns(3))).toBe(3);
    });

    it('clamps to MAX_COLUMNS however wide the container gets', () => {
      expect(service.columnsFor(minWidthForColumns(9))).toBe(MAX_COLUMNS);
    });

    it('clamps to a single column for degenerate widths', () => {
      expect(service.columnsFor(0)).toBe(1);
      expect(service.columnsFor(-100)).toBe(1);
      expect(service.columnsFor(Number.NaN)).toBe(1);
      expect(service.columnsFor(120)).toBe(1);
    });

    it('reports the derived column count on the layout result', () => {
      measure(1180, 900);
      expect(service.computeLayout([intent('a', 0)]).columns).toBe(2);
    });
  });

  describe('rows fill the full width (fill-remainder)', () => {
    it('preserves an explicit 2+1 row across narrow then wide measurement', () => {
      const explicit = [
        intent('a', 0),
        intent('b', 1),
        { ...intent('c', 2), rowBreakBefore: true },
      ];
      measure(minWidthForColumns(3), 900);
      expect(service.computeLayout(explicit).tiles.map((tile) => tile.y)).toEqual([
        0,
        0,
        TILE_HEIGHT_UNITS,
      ]);
      measure(minWidthForColumns(1), 900);
      expect(service.computeLayout(explicit).tiles.map((tile) => tile.y)).toEqual([
        0,
        TILE_HEIGHT_UNITS,
        2 * TILE_HEIGHT_UNITS,
      ]);
      measure(minWidthForColumns(3), 900);
      expect(service.computeLayout(explicit).tiles.map((tile) => tile.y)).toEqual([
        0,
        0,
        TILE_HEIGHT_UNITS,
      ]);
    });

    it('honours a workspace maximum without changing row intent', () => {
      measure(minWidthForColumns(3), 900);
      const source = [intent('a', 0), intent('b', 1), intent('c', 2)];
      expect(
        service.computeLayout(source, 2).tiles.map((tile) => tile.y),
      ).toEqual([0, 0, TILE_HEIGHT_UNITS]);
      expect(source.every((tile) => !tile.rowBreakBefore)).toBe(true);
    });

    it('gives 4/4/4 on a full row and a single full-width tile on the short row', () => {
      measure(minWidthForColumns(3), 900);

      const { tiles } = service.computeLayout([
        intent('a', 0),
        intent('b', 1),
        intent('c', 2),
        intent('d', 3),
      ]);

      expect(tiles.map((t) => [t.tabId, t.x, t.y, t.w, t.h])).toEqual([
        ['a', 0, 0, 4, TILE_HEIGHT_UNITS],
        ['b', 4, 0, 4, TILE_HEIGHT_UNITS],
        ['c', 8, 0, 4, TILE_HEIGHT_UNITS],
        ['d', 0, TILE_HEIGHT_UNITS, 12, TILE_HEIGHT_UNITS],
      ]);
    });

    const apportionmentCases: Array<{ columns: number; weights: number[] }> = [
      { columns: 1, weights: [1] },
      { columns: 2, weights: [1, 1] },
      { columns: 3, weights: [1, 1, 1] },
      { columns: 3, weights: [5, 4, 3] },
      { columns: 3, weights: [10, 1, 1] },
      { columns: 3, weights: [1, 1, 10] },
      { columns: 2, weights: [7, 5] },
      { columns: 2, weights: [1, 11] },
    ];

    it.each(apportionmentCases)(
      'every row sums to 12 with no tile below the floor (columns=$columns, weights=$weights)',
      ({ columns, weights }) => {
        measure(minWidthForColumns(columns), 900);

        for (let count = 1; count <= 9; count++) {
          const tiles = Array.from({ length: count }, (_, i) =>
            intent(`t${i}`, i, weights[i % weights.length]),
          );
          const { tiles: positioned } = service.computeLayout(tiles);

          expect(positioned).toHaveLength(count);
          const rows = new Map<number, typeof positioned>();
          for (const tile of positioned) {
            rows.set(tile.y, [...(rows.get(tile.y) ?? []), tile]);
          }
          for (const row of rows.values()) {
            expect(row.reduce((sum, t) => sum + t.w, 0)).toBe(GRID_COLUMNS);
            expect(row.every((t) => t.w >= MIN_TILE_UNITS)).toBe(true);
            expect(Math.min(...row.map((t) => t.x))).toBe(0);
          }
        }
      },
    );

    it('lays rows out contiguously with no vertical gaps', () => {
      measure(minWidthForColumns(2), 900);

      const { tiles } = service.computeLayout(
        Array.from({ length: 5 }, (_, i) => intent(`t${i}`, i)),
      );

      expect([...new Set(tiles.map((t) => t.y))]).toEqual([
        0,
        TILE_HEIGHT_UNITS,
        2 * TILE_HEIGHT_UNITS,
      ]);
    });

    it('honours weight as a relative width share within a row', () => {
      measure(minWidthForColumns(2), 900);

      const { tiles } = service.computeLayout([
        intent('a', 0, 8),
        intent('b', 1, 4),
      ]);

      expect(tiles.map((t) => t.w)).toEqual([8, 4]);
      expect(tiles.map((t) => t.x)).toEqual([0, 8]);
    });

    it('re-derives the same widths from widths read back as weights (idempotent)', () => {
      measure(minWidthForColumns(3), 900);

      const first = service.computeLayout([
        intent('a', 0, 5),
        intent('b', 1, 4),
        intent('c', 2, 3),
      ]);
      const second = service.computeLayout(
        first.tiles.map((t, i) => intent(t.tabId, i, t.w)),
      );

      expect(first.tiles.map((t) => t.w)).toEqual([5, 4, 3]);
      expect(second.tiles).toEqual(first.tiles);
    });
  });

  describe('ordering', () => {
    it('sorts by order, breaking ties by tabId', () => {
      measure(minWidthForColumns(3), 900);

      const { tiles } = service.computeLayout([
        intent('c', 2),
        intent('a', 0),
        intent('b', 1),
      ]);
      expect(tiles.map((t) => t.tabId)).toEqual(['a', 'b', 'c']);

      const tied = service.computeLayout([
        intent('z', 0),
        intent('m', 0),
        intent('a', 0),
      ]);
      expect(tied.tiles.map((t) => t.tabId)).toEqual(['a', 'm', 'z']);
    });

    it('tolerates sparse order values', () => {
      measure(minWidthForColumns(2), 900);

      const { tiles } = service.computeLayout([
        intent('b', 40),
        intent('a', 7),
      ]);
      expect(tiles.map((t) => t.tabId)).toEqual(['a', 'b']);
    });
  });

  describe('degenerate inputs are total', () => {
    it('returns the empty layout with no tiles, no width or no height', () => {
      measure(1180, 900);
      expect(service.computeLayout([])).toEqual({
        cellHeight: 120,
        columns: 1,
        tiles: [],
      });

      measure(0, 900);
      expect(service.computeLayout([intent('a', 0)]).tiles).toEqual([]);

      measure(1180, 0);
      expect(service.computeLayout([intent('a', 0)]).tiles).toEqual([]);
    });

    it('treats a non-finite or non-positive weight as the default', () => {
      measure(minWidthForColumns(2), 900);

      const { tiles } = service.computeLayout([
        intent('a', 0, Number.NaN),
        intent('b', 1, -5),
      ]);

      expect(tiles.map((t) => t.w)).toEqual([6, 6]);
      expect(tiles.every((t) => Number.isFinite(t.w))).toBe(true);
    });

    it('splits equally when every weight is zero', () => {
      measure(minWidthForColumns(3), 900);

      const { tiles } = service.computeLayout([
        intent('a', 0, 0),
        intent('b', 1, 0),
        intent('c', 2, 0),
      ]);
      expect(tiles.map((t) => t.w)).toEqual([4, 4, 4]);
    });
  });

  describe('cell height keeps each tile near-viewport tall', () => {
    it('never drops a tile below MIN_TILE_VIEWPORT_RATIO of the container', () => {
      measure(minWidthForColumns(1), 600);

      const single = service.computeLayout([intent('a', 0)]);
      const wrapped = service.computeLayout([
        intent('a', 0),
        intent('b', 1),
        intent('c', 2),
      ]);

      // One row fits: (600 - 2*8) / 6 = 97 per cell, taller than the 90 floor.
      expect(single.cellHeight).toBe(97);
      // Three rows would shrink to 31; the 0.9 * 600 / 6 = 90 floor wins and the
      // canvas host scrolls instead.
      expect(wrapped.cellHeight).toBe(90);
      expect(wrapped.cellHeight * TILE_HEIGHT_UNITS).toBeGreaterThanOrEqual(
        0.9 * 600,
      );
    });
  });

  describe('measurement driver', () => {
    it('publishes the measured container size through the readonly signals', () => {
      measure(1234, 777);
      expect(service.containerWidth()).toBe(1234);
      expect(service.containerHeight()).toBe(777);
    });
  });
});
