import { TestBed } from '@angular/core/testing';
import {
  CanvasLayoutService,
  MAX_COLUMNS,
  MIN_TILE_WIDTH,
} from './canvas-layout.service';
import type {
  TileIntent,
  TileViewConstraints,
  TileWidthIntent,
} from './canvas-layout-intent';

type ObserverCallback = (entries: ResizeObserverEntry[]) => void;
let callback: ObserverCallback | null;
let originalObserver: typeof ResizeObserver;
let originalRaf: typeof requestAnimationFrame;
let originalCancel: typeof cancelAnimationFrame;
let disconnectMock: jest.Mock;

const width = (
  span: 'third' | 'half' | 'two-thirds' | 'full',
): TileWidthIntent => ({ kind: 'span', span });
const tile = (
  tabId: string,
  order: number,
  value: TileWidthIntent = { kind: 'auto', weight: 1 },
  rowBreakBefore = false,
): TileIntent => ({
  tabId,
  order,
  width: value,
  rowBreakBefore,
});
const compactOnly = (tabIds: readonly string[]): TileViewConstraints =>
  tabIds.map((tabId) => ({ tabId, heightTier: 'compact' as const }));
const compact = (tabId: string): TileViewConstraints => compactOnly([tabId]);
const geometry = (layout: ReturnType<CanvasLayoutService['computeLayout']>) =>
  layout.tiles.map(({ tabId, x, y, w, h }) => ({ tabId, x, y, w, h }));

describe('CanvasLayoutService', () => {
  let service: CanvasLayoutService;
  const measure = (containerWidth: number, height = 900): void => {
    callback?.([
      { contentRect: { width: containerWidth, height } } as ResizeObserverEntry,
    ]);
  };

  beforeEach(() => {
    callback = null;
    originalObserver = globalThis.ResizeObserver;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    disconnectMock = jest.fn();
    globalThis.ResizeObserver = class {
      constructor(cb: ObserverCallback) {
        callback = cb;
      }
      observe(): void {
        /* no-op */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        disconnectMock();
      }
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() =>
      undefined) as typeof cancelAnimationFrame;
    TestBed.configureTestingModule({ providers: [CanvasLayoutService] });
    service = TestBed.inject(CanvasLayoutService);
    service.observe(document.createElement('div'));
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalObserver;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });

  it('derives responsive columns from minimum tile width', () => {
    expect(service.columnsFor(1180)).toBe(2);
    expect(service.columnsFor(3 * (MIN_TILE_WIDTH + 8) - 8)).toBe(3);
    expect(service.columnsFor(Number.NaN)).toBe(1);
    expect(service.columnsFor(10000)).toBe(MAX_COLUMNS);
  });

  it('derives exact named-span rows and independent later combinations', () => {
    measure(1464);
    const layout = service.computeLayout([
      tile('A', 0, width('two-thirds')),
      tile('B', 1, width('third')),
      tile('C', 2, width('half'), true),
      tile('D', 3, width('half')),
      tile('E', 4, width('full'), true),
    ]);
    expect(
      layout.tiles.map(({ tabId, x, y, w, h }) => ({ tabId, x, y, w, h })),
    ).toEqual([
      { tabId: 'A', x: 0, y: 0, w: 8, h: 6 },
      { tabId: 'B', x: 8, y: 0, w: 4, h: 6 },
      { tabId: 'C', x: 0, y: 6, w: 6, h: 6 },
      { tabId: 'D', x: 6, y: 6, w: 6, h: 6 },
      { tabId: 'E', x: 0, y: 12, w: 12, h: 6 },
    ]);
  });

  it('fills an auto final row', () => {
    measure(1464);
    expect(
      service.computeLayout([tile('A', 0), tile('B', 1)]).tiles.map((t) => t.w),
    ).toEqual([6, 6]);
  });

  it('restores stored geometry after a responsive fallback', () => {
    const intent = [tile('A', 0, width('third')), tile('B', 1, width('third'))];
    measure(1180);
    expect(service.computeLayout(intent).tiles.map((t) => t.w)).toEqual([6, 6]);
    measure(1464);
    expect(service.computeLayout(intent).tiles.map((t) => t.w)).toEqual([4, 4]);
  });

  it('renders layout focus alone and restores exact prior layout on exit', () => {
    measure(1464);
    const intent = [
      tile('A', 0, width('third')),
      tile('B', 1, width('half')),
      tile('C', 2, width('third')),
    ];
    const before = service.computeLayout(intent);
    expect(
      service.computeLayout(intent, 'B').tiles.map((t) => [t.tabId, t.y, t.w]),
    ).toEqual([
      ['A', 0, 4],
      ['B', 6, 12],
      ['C', 12, 4],
    ]);
    expect(service.computeLayout(intent)).toEqual(before);
  });

  it('renders a compact layout-focus target at twelve by six and restores it after exit', () => {
    measure(1464);
    const intent = [
      tile('A', 0, width('third')),
      tile('B', 1, width('half')),
      tile('C', 2, width('third')),
    ];
    const before = service.computeLayout(intent, null, compact('B'));
    expect(geometry(service.computeLayout(intent, 'B', compact('B')))).toEqual([
      { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
      { tabId: 'B', x: 0, y: 6, w: 12, h: 6 },
      { tabId: 'C', x: 0, y: 12, w: 4, h: 6 },
    ]);
    expect(service.computeLayout(intent, null, compact('B'))).toEqual(before);
  });

  it('projects the compact height tier and the skyline reflow around it', () => {
    measure(1464);
    const intent = [
      tile('A', 0, width('third')),
      tile('B', 1, width('third')),
      tile('C', 2, width('third')),
      tile('D', 3, width('third')),
    ];
    expect(geometry(service.computeLayout(intent, null, compact('B')))).toEqual(
      [
        { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
        { tabId: 'B', x: 4, y: 0, w: 4, h: 2 },
        { tabId: 'C', x: 8, y: 0, w: 4, h: 6 },
        { tabId: 'D', x: 4, y: 2, w: 4, h: 6 },
      ],
    );
  });

  it('projects an all-compact row at two units without stretching any tile', () => {
    measure(1464);
    const intent = [tile('A', 0), tile('B', 1), tile('C', 2)];
    expect(
      geometry(
        service.computeLayout(intent, null, compactOnly(['A', 'B', 'C'])),
      ),
    ).toEqual([
      { tabId: 'A', x: 0, y: 0, w: 4, h: 2 },
      { tabId: 'B', x: 4, y: 0, w: 4, h: 2 },
      { tabId: 'C', x: 8, y: 0, w: 4, h: 2 },
    ]);
  });

  it('projects auto compact widths responsively without mutating the stored intent', () => {
    const intent = [tile('A', 0)];
    const before = JSON.stringify(intent);
    measure(1464);
    expect(service.computeLayout(intent, null, compact('A')).tiles[0].w).toBe(
      4,
    );
    measure(1180);
    expect(service.computeLayout(intent, null, compact('A')).tiles[0].w).toBe(
      6,
    );
    measure(480);
    expect(service.computeLayout(intent, null, compact('A')).tiles[0].w).toBe(
      12,
    );
    measure(1464);
    expect(service.computeLayout(intent).tiles[0].w).toBe(12);
    expect(JSON.stringify(intent)).toBe(before);
  });

  it('remains total for zero measurement, height and invalid auto weight', () => {
    expect(service.computeLayout([tile('A', 0)]).tiles).toEqual([]);
    measure(1464, 0);
    expect(service.computeLayout([tile('A', 0)]).tiles).toEqual([]);
    measure(1464, 900);
    expect(
      service.computeLayout([
        tile('A', 0, { kind: 'auto', weight: Number.NaN }),
      ]).tiles[0].w,
    ).toBe(12);
  });

  it('keeps wrapped full-height tiles at least ninety percent of the viewport height', () => {
    measure(MIN_TILE_WIDTH, 600);
    const layout = service.computeLayout([
      tile('A', 0),
      tile('B', 1),
      tile('C', 2),
    ]);
    expect(layout.cellHeight).toBe(90);
    expect(layout.cellHeight * 6).toBeGreaterThanOrEqual(0.9 * 600);
  });

  it('fits an all-compact stack to its true extent without the viewport floor', () => {
    measure(MIN_TILE_WIDTH, 600);
    const sixCompact = service.computeLayout(
      [
        tile('A', 0),
        tile('B', 1),
        tile('C', 2),
        tile('D', 3),
        tile('E', 4),
        tile('F', 5),
      ],
      null,
      compactOnly(['A', 'B', 'C', 'D', 'E', 'F']),
    );
    expect(sixCompact.tiles.map((t) => [t.tabId, t.y, t.w, t.h])).toEqual([
      ['A', 0, 12, 2],
      ['B', 2, 12, 2],
      ['C', 4, 12, 2],
      ['D', 6, 12, 2],
      ['E', 8, 12, 2],
      ['F', 10, 12, 2],
    ]);
    expect(sixCompact.cellHeight).toBe(48);
    expect(sixCompact.cellHeight).toBeLessThan(90);
  });

  it('scales the fitted cell height with the skyline extent max(y plus h)', () => {
    measure(MIN_TILE_WIDTH, 600);
    const threeCompact = service.computeLayout(
      [tile('A', 0), tile('B', 1), tile('C', 2)],
      null,
      compactOnly(['A', 'B', 'C']),
    );
    expect(threeCompact.cellHeight).toBe(97);
    const sixCompact = service.computeLayout(
      [
        tile('A', 0),
        tile('B', 1),
        tile('C', 2),
        tile('D', 3),
        tile('E', 4),
        tile('F', 5),
      ],
      null,
      compactOnly(['A', 'B', 'C', 'D', 'E', 'F']),
    );
    expect(sixCompact.cellHeight).toBe(48);
  });

  it('keeps a compact singleton at two units instead of stretching it to the viewport', () => {
    measure(1464, 600);
    const layout = service.computeLayout([tile('A', 0)], null, compact('A'));
    expect(layout.tiles[0]).toMatchObject({ w: 4, h: 2 });
    expect(layout.cellHeight * layout.tiles[0].h).toBeLessThan(600);
  });

  it('debounces observed measurements through animation frames and disconnects on destroy', () => {
    let queuedFrame: FrameRequestCallback | null = null;
    let nextFrameId = 10;
    const requestFrame = jest.fn((frame: FrameRequestCallback) => {
      queuedFrame = frame;
      nextFrameId += 1;
      return nextFrameId;
    });
    const cancelFrame = jest.fn();
    globalThis.requestAnimationFrame =
      requestFrame as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame =
      cancelFrame as typeof cancelAnimationFrame;

    measure(1000.9, 700.8);
    measure(1234.9, 777.8);
    expect(cancelFrame).toHaveBeenCalledWith(11);
    expect(service.containerWidth()).toBe(0);
    expect(service.containerHeight()).toBe(0);
    expect(queuedFrame).not.toBeNull();
    queuedFrame?.(0);
    expect(service.containerWidth()).toBe(1234);
    expect(service.containerHeight()).toBe(777);

    TestBed.resetTestingModule();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
