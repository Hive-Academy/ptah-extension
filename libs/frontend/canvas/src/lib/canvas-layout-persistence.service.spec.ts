import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import {
  CANVAS_LAYOUT_SAVE_DEBOUNCE_MS,
  CanvasLayoutPersistenceService,
} from './canvas-layout-persistence.service';
import type { TileIntent } from './canvas-layout-intent';

describe('CanvasLayoutPersistenceService', () => {
  let service: CanvasLayoutPersistenceService;
  const path = '/workspace/é';
  const intent: TileIntent[] = [
    { tabId: 'A', order: 0, width: { kind: 'span', span: 'two-thirds' }, rowBreakBefore: false },
    { tabId: 'B', order: 1, width: { kind: 'auto', weight: 5 }, rowBreakBefore: true },
  ];

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

  it('round-trips v2 per encoded workspace and panel', () => {
    service.markHydrated(path, true);
    service.schedule(path, () => intent);
    jest.advanceTimersByTime(CANVAS_LAYOUT_SAVE_DEBOUNCE_MS);
    expect(service.storageKey(path)).toBe('ptah.canvas-layout.ws._2Fworkspace_2F_C3_A9.panel-7');
    expect(service.load(path)).toEqual({
      tiles: intent,
      writable: true,
      needsWrite: false,
    });
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

  it.each([99, 2.5])('preserves future-version %s bytes and disables writes', (version) => {
    const raw = `{"version":${version},"future":true}`;
    localStorage.setItem(service.storageKey(path), raw);
    const loaded = service.load(path);
    service.markHydrated(path, loaded.writable);
    service.schedule(path, () => intent);
    service.flush();
    expect(loaded).toEqual({
      tiles: null,
      writable: false,
      needsWrite: false,
    });
    expect(localStorage.getItem(service.storageKey(path))).toBe(raw);
  });

  it('never writes before hydration and debounces equivalent snapshots', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    service.schedule(path, () => intent);
    jest.runOnlyPendingTimers();
    expect(setItem).not.toHaveBeenCalled();
    service.markHydrated(path, true);
    service.schedule(path, () => intent);
    service.schedule(path, () => intent);
    jest.runOnlyPendingTimers();
    service.schedule(path, () => intent);
    jest.runOnlyPendingTimers();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('flushes synchronously on pagehide and destroy', () => {
    service.markHydrated(path, true);
    service.schedule(path, () => intent);
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(service.storageKey(path))).not.toBeNull();
    const second = '/second';
    service.markHydrated(second, true);
    service.schedule(second, () => intent);
    TestBed.resetTestingModule();
    expect(localStorage.getItem(service.storageKey(second))).not.toBeNull();
  });

  it('flushes a pending write on beforeunload', () => {
    service.markHydrated(path, true);
    service.schedule(path, () => intent);
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
    service.schedule(path, () => intent);
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

  it('warns once per storage failure kind and keeps operating', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    service.markHydrated(path, true);
    service.schedule(path, () => intent);
    service.flush();
    service.schedule(path, () => intent);
    service.flush();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
