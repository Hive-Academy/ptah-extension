import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import {
  CANVAS_LAYOUT_SAVE_DEBOUNCE_MS,
  CanvasLayoutPersistenceService,
} from './canvas-layout-persistence.service';
import type { TileIntent } from './canvas-layout-intent';
import { DEFAULT_BOARD_STATE } from './canvas-board-mode';

describe('CanvasLayoutPersistenceService', () => {
  let service: CanvasLayoutPersistenceService;
  const path = '/workspace/é';
  const intent: TileIntent[] = [
    { tabId: 'A', order: 0, width: { kind: 'span', span: 'two-thirds' }, rowBreakBefore: false },
    { tabId: 'B', order: 1, width: { kind: 'auto', weight: 5 }, rowBreakBefore: true },
  ];
  const board = { ...DEFAULT_BOARD_STATE, railCollapsed: true, railDensity: 'dense' as const, railScrollTop: 123 };

  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
    TestBed.configureTestingModule({ providers: [
      CanvasLayoutPersistenceService,
      { provide: VSCodeService, useValue: { config: signal({ panelId: 'panel-7' }) } },
    ] });
    service = TestBed.inject(CanvasLayoutPersistenceService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('round-trips v3 per encoded workspace and panel', () => {
    service.markHydrated(path, true);
    service.schedule(path, () => ({ tiles: intent, board }));
    jest.advanceTimersByTime(CANVAS_LAYOUT_SAVE_DEBOUNCE_MS);
    expect(service.storageKey(path)).toBe('ptah.canvas-layout.ws._2Fworkspace_2F_C3_A9.panel-7');
    expect(service.load(path)).toEqual({
      tiles: intent,
      board,
      writable: true,
      needsWrite: false,
      readOnlyReason: null,
    });
  });

  it('opens a stored v3 Grid board as Rail without changing tiles or Rail options', () => {
    const raw = '{"version":3,"tiles":[{"tabId":"A","order":0,"width":{"kind":"span","span":"two-thirds"},"rowBreakBefore":false},{"tabId":"B","order":1,"width":{"kind":"auto","weight":5},"rowBreakBefore":true}],"board":{"mode":"grid","railCollapsed":true,"railDensity":"dense","railScrollTop":123}}';
    localStorage.setItem(service.storageKey(path), raw);

    expect(service.load(path)).toEqual({
      tiles: intent,
      board,
      writable: true,
      needsWrite: false,
      readOnlyReason: null,
    });
    expect(localStorage.getItem(service.storageKey(path))).toBe(raw);

    service.markHydrated(path, true);
    service.schedule(path, () => ({ tiles: intent, board: { ...board, railScrollTop: 456 } }));
    service.flush();

    const stored = JSON.parse(localStorage.getItem(service.storageKey(path))!);
    expect(stored.board).toEqual({ ...board, railScrollTop: 456 });
    expect(stored.tiles).toEqual(intent);
  });

  it.each(['auto', 1, 2, 3] as const)('migrates v1 %s losslessly into durable rows', (columnsPreference) => {
    localStorage.setItem(service.storageKey(path), JSON.stringify({
      version: 1,
      columnsPreference,
      tiles: [1, 2, 3, 4].map((weight, order) => ({
        tabId: String.fromCharCode(65 + order), order, weight, rowBreakBefore: false,
      })),
    }));
    const loaded = service.load(path).tiles;
    expect(loaded).not.toBeNull();
    if (loaded === null) return;
    expect(loaded.map((tile) => tile.width)).toEqual([1, 2, 3, 4].map((weight) => ({ kind: 'auto', weight })));
    const maximum = columnsPreference === 'auto' ? 3 : columnsPreference;
    expect(loaded.map((tile) => tile.rowBreakBefore)).toEqual([false, ...[1, 2, 3].map((index) => index % maximum === 0)]);
  });

  it.each([
    { version: 3, tiles: [{ tabId: 'A', order: 0, width: { kind: 'span', span: 'quarter' }, rowBreakBefore: false }], board },
    { version: 3, tiles: [{ tabId: 'A', order: 0, width: { kind: 'span', span: 'full' } }], board },
    { version: 2, tiles: [{ tabId: 'A', order: 0, width: { kind: 'span', span: 'quarter' }, rowBreakBefore: false }] },
    { version: 2, tiles: [{ tabId: 'A', order: 0, width: { kind: 'auto', weight: 0 }, rowBreakBefore: false }] },
    { version: 2, tiles: [{ tabId: 'A', order: 0, width: { kind: 'span', span: 'full' }, rowBreakBefore: false, x: 0 }] },
    { version: 2, tiles: [
      { tabId: 'A', order: 0, width: { kind: 'span', span: 'full' }, rowBreakBefore: false },
      { tabId: 'A', order: 1, width: { kind: 'span', span: 'full' }, rowBreakBefore: false },
    ] },
  ])('rejects malformed boundary records', (record) => {
    localStorage.setItem(service.storageKey(path), JSON.stringify(record));
    expect(service.load(path).tiles).toBeNull();
  });

  it.each([99, 2.5, 3.5])('preserves future-version %s bytes and disables writes', (version) => {
    const raw = `{"version":${version},"future":true}`;
    localStorage.setItem(service.storageKey(path), raw);
    const loaded = service.load(path);
    service.markHydrated(path, loaded.writable);
    service.schedule(path, () => ({ tiles: intent, board }));
    service.flush();
    expect(loaded).toEqual({
      tiles: null,
      board: null,
      writable: false,
      needsWrite: false,
      readOnlyReason: 'newer-version',
    });
    expect(service.readOnlyPaths().has(path)).toBe(true);
    expect(localStorage.getItem(service.storageKey(path))).toBe(raw);
  });

  it('never writes before hydration and debounces equivalent snapshots', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    service.schedule(path, () => ({ tiles: [], board }));
    jest.runOnlyPendingTimers();
    expect(setItem).not.toHaveBeenCalled();
    service.markHydrated(path, true);
    service.schedule(path, () => ({ tiles: intent, board }));
    service.schedule(path, () => ({ tiles: intent, board }));
    jest.runOnlyPendingTimers();
    service.schedule(path, () => ({ tiles: intent, board }));
    jest.runOnlyPendingTimers();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('flushes synchronously on pagehide and destroy', () => {
    service.markHydrated(path, true);
    service.schedule(path, () => ({ tiles: intent, board }));
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(service.storageKey(path))).not.toBeNull();
    const second = '/second';
    service.markHydrated(second, true);
    service.schedule(second, () => ({ tiles: intent, board }));
    TestBed.resetTestingModule();
    expect(localStorage.getItem(service.storageKey(second))).not.toBeNull();
  });

  it('flushes a pending write on beforeunload', () => {
    service.markHydrated(path, true);
    service.schedule(path, () => ({ tiles: intent, board }));
    window.dispatchEvent(new Event('beforeunload'));
    expect(localStorage.getItem(service.storageKey(path))).not.toBeNull();
  });

  it('flushes on hidden visibilitychange but not while visible', () => {
    const originalVisibility = document.visibilityState;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    service.markHydrated(path, true);
    service.schedule(path, () => ({ tiles: intent, board }));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(localStorage.getItem(service.storageKey(path))).toBeNull();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(localStorage.getItem(service.storageKey(path))).not.toBeNull();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibility,
    });
  });

  it('warns once per storage failure kind and counts each failed write', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    service.markHydrated(path, true);
    expect(service.writeFailureCount()).toBe(0);
    service.schedule(path, () => ({ tiles: intent, board }));
    service.flush();
    expect(service.writeFailureCount()).toBe(1);
    service.schedule(path, () => ({ tiles: intent, board }));
    service.flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(service.writeFailed()).toBe(true);
    expect(service.writeFailureCount()).toBe(2);
  });

  it('opens v2 as Rail defaults without scheduling an upgrade', () => {
    localStorage.setItem(service.storageKey(path), JSON.stringify({ version: 2, tiles: intent }));
    const loaded = service.load(path);
    expect(loaded).toEqual({ tiles: intent, board: null, writable: true, needsWrite: false, readOnlyReason: null });
  });

  it('loads v1 with null board and a pending migration', () => {
    localStorage.setItem(service.storageKey(path), JSON.stringify({ version: 1, columnsPreference: 1, tiles: [{ tabId: 'A', order: 0, weight: 2, rowBreakBefore: false }] }));
    expect(service.load(path)).toMatchObject({ board: null, needsWrite: true, readOnlyReason: null });
  });

  it('defaults invalid board fields while preserving valid tiles', () => {
    localStorage.setItem(service.storageKey(path), JSON.stringify({ version: 3, tiles: intent, board: { mode: 'unknown', railCollapsed: true, railDensity: 'unknown', railScrollTop: -2 } }));
    expect(service.load(path)).toMatchObject({ tiles: intent, board: { mode: 'rail', railCollapsed: true, railDensity: 'comfortable', railScrollTop: 0 } });
  });

  it('clears read-only paths when removed', () => {
    localStorage.setItem(service.storageKey(path), '{"version":99}');
    service.load(path);
    service.remove(path);
    expect(service.readOnlyPaths().has(path)).toBe(false);
  });

  it('recovers writeFailed after the next successful write', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    service.markHydrated(path, true);
    service.schedule(path, () => ({ tiles: intent, board }));
    service.flush();
    expect(service.writeFailed()).toBe(true);
    setItem.mockRestore();
    service.schedule(path, () => ({ tiles: intent, board }));
    service.flush();
    expect(service.writeFailed()).toBe(false);
  });
});
