import { TestBed } from '@angular/core/testing';
import { CanvasLayoutService, MAX_COLUMNS, MIN_TILE_WIDTH } from './canvas-layout.service';
import type { TileIntent, TileWidthIntent } from './canvas-layout-intent';

type ObserverCallback = (entries: ResizeObserverEntry[]) => void;
let callback: ObserverCallback | null;
let originalObserver: typeof ResizeObserver;
let originalRaf: typeof requestAnimationFrame;
let originalCancel: typeof cancelAnimationFrame;

const width = (span: 'third' | 'half' | 'two-thirds' | 'full'): TileWidthIntent => ({ kind: 'span', span });
const tile = (tabId: string, order: number, value: TileWidthIntent = { kind: 'auto', weight: 1 }, rowBreakBefore = false): TileIntent => ({
  tabId, order, width: value, rowBreakBefore,
});

describe('CanvasLayoutService', () => {
  let service: CanvasLayoutService;
  const measure = (containerWidth: number, height = 900): void => {
    callback?.([{ contentRect: { width: containerWidth, height } } as ResizeObserverEntry]);
  };

  beforeEach(() => {
    callback = null;
    originalObserver = globalThis.ResizeObserver;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    globalThis.ResizeObserver = class {
      constructor(cb: ObserverCallback) { callback = cb; }
      observe(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 1; }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
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
    expect(layout.tiles.map(({ tabId, x, y, w, h }) => ({ tabId, x, y, w, h }))).toEqual([
      { tabId: 'A', x: 0, y: 0, w: 8, h: 6 },
      { tabId: 'B', x: 8, y: 0, w: 4, h: 6 },
      { tabId: 'C', x: 0, y: 6, w: 6, h: 6 },
      { tabId: 'D', x: 6, y: 6, w: 6, h: 6 },
      { tabId: 'E', x: 0, y: 12, w: 12, h: 6 },
    ]);
  });

  it('fills an auto final row', () => {
    measure(1464);
    expect(service.computeLayout([tile('A', 0), tile('B', 1)]).tiles.map((t) => t.w)).toEqual([6, 6]);
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
    const intent = [tile('A', 0, width('third')), tile('B', 1, width('half')), tile('C', 2, width('third'))];
    const before = service.computeLayout(intent);
    expect(service.computeLayout(intent, 'B').tiles.map((t) => [t.tabId, t.y, t.w])).toEqual([
      ['A', 0, 4], ['B', 6, 12], ['C', 12, 4],
    ]);
    expect(service.computeLayout(intent)).toEqual(before);
  });

  it('remains total for zero measurement, height and invalid auto weight', () => {
    expect(service.computeLayout([tile('A', 0)]).tiles).toEqual([]);
    measure(1464, 0);
    expect(service.computeLayout([tile('A', 0)]).tiles).toEqual([]);
    measure(1464, 900);
    expect(service.computeLayout([tile('A', 0, { kind: 'auto', weight: Number.NaN })]).tiles[0].w).toBe(12);
  });
});
