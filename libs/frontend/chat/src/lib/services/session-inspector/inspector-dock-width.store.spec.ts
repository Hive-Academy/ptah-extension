import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import {
  INSPECTOR_DOCK_WIDTH_STORAGE_KEY,
  InspectorDockWidthStore,
} from './inspector-dock-width.store';

const KEY = INSPECTOR_DOCK_WIDTH_STORAGE_KEY;

describe('InspectorDockWidthStore', () => {
  let logger: { warn: jest.Mock };

  function create(): InspectorDockWidthStore {
    logger = { warn: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: LoggingService, useValue: logger }],
    });
    return TestBed.inject(InspectorDockWidthStore);
  }

  function dispatchStorage(init: StorageEventInit): void {
    window.dispatchEvent(
      new StorageEvent('storage', { storageArea: localStorage, ...init }),
    );
  }

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  describe('restore', () => {
    it.each([
      ['420', 420],
      ['9999', 560],
      ['12', 300],
      ['400.6', 401],
      ['abc', null],
      ['', null],
      ['   ', null],
      ['NaN', null],
      ['Infinity', null],
    ])('stored %p gives %p', (raw, expected) => {
      localStorage.setItem(KEY, raw);
      expect(create().preference()).toBe(expected);
    });

    it('gives null when nothing is stored', () => {
      expect(create().preference()).toBeNull();
    });

    it('a throwing getItem gives null and one warning', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const consoleWarn = jest.spyOn(console, 'warn');
      const store = create();
      expect(store.preference()).toBeNull();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'InspectorDockWidth',
        'read failed; width kept in memory only',
        expect.any(Error),
      );
      expect(consoleWarn).not.toHaveBeenCalled();
    });
  });

  describe('commit', () => {
    it('writes an integer string and sets the preference', () => {
      const store = create();
      store.commit(448);
      expect(localStorage.getItem(KEY)).toBe('448');
      expect(store.preference()).toBe(448);
    });

    it('rounds and clamps to [300, 560]', () => {
      const store = create();
      store.commit(900);
      expect(store.preference()).toBe(560);
      expect(localStorage.getItem(KEY)).toBe('560');
      store.commit(100);
      expect(store.preference()).toBe(300);
      store.commit(420.4);
      expect(localStorage.getItem(KEY)).toBe('420');
    });

    it.each([NaN, Infinity, -Infinity])('ignores %p', (value) => {
      localStorage.setItem(KEY, '420');
      const store = create();
      const setItem = jest.spyOn(Storage.prototype, 'setItem');
      store.commit(value);
      expect(store.preference()).toBe(420);
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(KEY)).toBe('420');
    });

    it('a throwing setItem keeps the value in memory and warns once', () => {
      const store = create();
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const consoleWarn = jest.spyOn(console, 'warn');
      expect(() => store.commit(500)).not.toThrow();
      expect(store.preference()).toBe(500);
      expect(() => store.commit(510)).not.toThrow();
      expect(store.preference()).toBe(510);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'InspectorDockWidth',
        'write failed; width kept in memory only',
        expect.any(Error),
      );
      expect(consoleWarn).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('removes the key and sets null', () => {
      localStorage.setItem(KEY, '480');
      const store = create();
      store.reset();
      expect(store.preference()).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('a throwing removeItem still sets null and warns once', () => {
      localStorage.setItem(KEY, '480');
      const store = create();
      jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => store.reset()).not.toThrow();
      store.reset();
      expect(store.preference()).toBeNull();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'InspectorDockWidth',
        'remove failed; width kept in memory only',
        expect.any(Error),
      );
    });
  });

  it('persists across a reload in the same storage scope', () => {
    create().commit(480);
    TestBed.resetTestingModule();
    const reloaded = create();
    expect(reloaded.preference()).toBe(480);
  });

  describe('live sync from another document', () => {
    it('applies a valid value with the same clamp as restore', () => {
      const store = create();
      dispatchStorage({ key: KEY, newValue: '480' });
      expect(store.preference()).toBe(480);
      dispatchStorage({ key: KEY, newValue: '9999' });
      expect(store.preference()).toBe(560);
    });

    it.each(['abc', '', 'NaN'])('keeps the preference on malformed %p', (raw) => {
      const store = create();
      store.commit(420);
      dispatchStorage({ key: KEY, newValue: raw });
      expect(store.preference()).toBe(420);
    });

    it('a removed key sets null', () => {
      const store = create();
      store.commit(420);
      dispatchStorage({ key: KEY, newValue: null });
      expect(store.preference()).toBeNull();
    });

    it('ignores other keys and clear() (key null)', () => {
      const store = create();
      store.commit(420);
      dispatchStorage({ key: 'ptah.workflow-sessions.v1', newValue: '480' });
      dispatchStorage({ key: null, newValue: null });
      expect(store.preference()).toBe(420);
    });

    it('ignores events from sessionStorage', () => {
      const store = create();
      store.commit(420);
      dispatchStorage({
        key: KEY,
        newValue: '480',
        storageArea: sessionStorage,
      });
      expect(store.preference()).toBe(420);
    });

    it('never writes storage', () => {
      const store = create();
      const setItem = jest.spyOn(Storage.prototype, 'setItem');
      const removeItem = jest.spyOn(Storage.prototype, 'removeItem');
      dispatchStorage({ key: KEY, newValue: '480' });
      dispatchStorage({ key: KEY, newValue: null });
      expect(store.preference()).toBeNull();
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    });

    it('removes its listener when the injector is destroyed', () => {
      const store = create();
      store.commit(420);
      TestBed.resetTestingModule();
      dispatchStorage({ key: KEY, newValue: '480' });
      expect(store.preference()).toBe(420);
    });
  });
});
