/**
 * `MemoryPlatformLocation` specs.
 *
 * The property that matters most here is a NEGATIVE one: nothing this class
 * does may reach `window.history` or `window.location`. That is the whole
 * reason it exists — `BrowserPlatformLocation.pushState` forwards straight to
 * `history.pushState`, and a `file:` pathname rewrite is rejected in the
 * Electron renderer. So every mutating test below runs with the four History
 * API methods spied and asserts they were never called, not just that the
 * in-memory state came out right.
 */

import { PlatformLocation } from '@angular/common';
import { MemoryPlatformLocation } from './memory-platform-location';

interface HistorySpies {
  pushState: jest.SpyInstance;
  replaceState: jest.SpyInstance;
  back: jest.SpyInstance;
  forward: jest.SpyInstance;
  go: jest.SpyInstance;
}

function spyOnHistory(): HistorySpies {
  return {
    pushState: jest.spyOn(window.history, 'pushState').mockImplementation(),
    replaceState: jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(),
    back: jest.spyOn(window.history, 'back').mockImplementation(),
    forward: jest.spyOn(window.history, 'forward').mockImplementation(),
    go: jest.spyOn(window.history, 'go').mockImplementation(),
  };
}

function expectHistoryUntouched(spies: HistorySpies): void {
  expect(spies.pushState).not.toHaveBeenCalled();
  expect(spies.replaceState).not.toHaveBeenCalled();
  expect(spies.back).not.toHaveBeenCalled();
  expect(spies.forward).not.toHaveBeenCalled();
  expect(spies.go).not.toHaveBeenCalled();
}

describe('MemoryPlatformLocation', () => {
  let location: MemoryPlatformLocation;
  let history: HistorySpies;

  beforeEach(() => {
    location = new MemoryPlatformLocation();
    history = spyOnHistory();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a PlatformLocation, so it can be bound at that token', () => {
    expect(location).toBeInstanceOf(PlatformLocation);
  });

  describe('initial state', () => {
    it('starts at the root with no state', () => {
      expect(location.pathname).toBe('/');
      expect(location.search).toBe('');
      expect(location.hash).toBe('');
      expect(location.getState()).toBeNull();
    });

    it('reports a synthetic, parseable origin rather than the document"s', () => {
      expect(location.href).toBe('ptah://webview/');
      expect(location.protocol).toBe('ptah:');
      expect(location.hostname).toBe('webview');
      expect(location.port).toBe('');
      expect(() => new URL(location.href)).not.toThrow();
    });

    it('reports "/" as the base href, NOT the document base', () => {
      // The document base is `./` under `mainWindow.loadFile(...)`. Reading it
      // would make every route path resolve against a filesystem directory.
      document.head.insertAdjacentHTML('beforeend', '<base href="./">');
      expect(location.getBaseHrefFromDOM()).toBe('/');
    });
  });

  describe('pushState', () => {
    it('moves the logical URL and never calls history.pushState', () => {
      location.pushState({ nav: 1 }, '', '/settings?tab=tools#anchor');

      expect(location.pathname).toBe('/settings');
      expect(location.search).toBe('?tab=tools');
      expect(location.hash).toBe('#anchor');
      expect(location.getState()).toEqual({ nav: 1 });
      expect(location.href).toBe('ptah://webview/settings?tab=tools#anchor');
      expectHistoryUntouched(history);
    });

    it('makes a relative url absolute', () => {
      location.pushState(null, '', 'settings');
      expect(location.pathname).toBe('/settings');
    });

    it('discards forward entries, like the History API does', () => {
      location.pushState(null, '', '/settings');
      location.pushState(null, '', '/analytics');
      location.back();
      expect(location.pathname).toBe('/settings');

      location.pushState(null, '', '/tasks');
      location.forward();

      // '/analytics' was truncated by the push, so forward has nowhere to go.
      expect(location.pathname).toBe('/tasks');
      expectHistoryUntouched(history);
    });
  });

  describe('replaceState', () => {
    it('overwrites the current entry instead of adding one', () => {
      location.pushState(null, '', '/settings');
      location.replaceState({ replaced: true }, '', '/analytics');

      expect(location.pathname).toBe('/analytics');
      expect(location.getState()).toEqual({ replaced: true });

      location.back();
      // Back from the replaced entry reaches the ROOT, not '/settings' —
      // there is only one entry above it.
      expect(location.pathname).toBe('/');
      expectHistoryUntouched(history);
    });
  });

  describe('back / forward / historyGo', () => {
    beforeEach(() => {
      location.pushState({ i: 1 }, '', '/settings');
      location.pushState({ i: 2 }, '', '/analytics');
    });

    it('walks the stack and restores each entry"s state', () => {
      location.back();
      expect(location.pathname).toBe('/settings');
      expect(location.getState()).toEqual({ i: 1 });

      location.forward();
      expect(location.pathname).toBe('/analytics');
      expect(location.getState()).toEqual({ i: 2 });
      expectHistoryUntouched(history);
    });

    it('historyGo moves by a relative offset', () => {
      location.historyGo(-2);
      expect(location.pathname).toBe('/');

      location.historyGo(2);
      expect(location.pathname).toBe('/analytics');
      expectHistoryUntouched(history);
    });

    it('ignores an out-of-range move rather than clamping it', () => {
      location.historyGo(-99);
      expect(location.pathname).toBe('/analytics');

      location.forward();
      expect(location.pathname).toBe('/analytics');

      location.historyGo(0);
      expect(location.pathname).toBe('/analytics');
      expectHistoryUntouched(history);
    });

    describe('invalid offsets leave the cursor usable (F6)', () => {
      // A fractional or NaN cursor indexes no entry, so EVERY later read of
      // href / pathname / getState throws — the history is unrecoverable
      // rather than merely wrong. Each case below asserts the reads still
      // work afterwards, which is the property that matters.
      it.each([
        ['a fractional offset', -0.5],
        ['a positive fractional offset', 1.5],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['-Infinity', Number.NEGATIVE_INFINITY],
      ])('ignores %s without moving the cursor', (_label, offset) => {
        const warn = jest.spyOn(console, 'warn').mockImplementation();

        expect(() => location.historyGo(offset)).not.toThrow();

        expect(location.pathname).toBe('/analytics');
        expect(location.getState()).toEqual({ i: 2 });
        expect(location.href).toBe('ptah://webview/analytics');
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('must be a finite integer'),
        );
        expectHistoryUntouched(history);
      });

      it('still traverses normally after an ignored offset', () => {
        jest.spyOn(console, 'warn').mockImplementation();

        location.historyGo(-0.5);
        location.back();

        expect(location.pathname).toBe('/settings');
        expect(location.getState()).toEqual({ i: 1 });
      });

      it('notifies no popstate listener for an ignored offset', () => {
        jest.spyOn(console, 'warn').mockImplementation();
        const listener = jest.fn();
        location.onPopState(listener);

        location.historyGo(Number.NaN);

        expect(listener).not.toHaveBeenCalled();
      });
    });

    it('back at the oldest entry is a no-op, not an exit', () => {
      location.historyGo(-2);
      expect(location.pathname).toBe('/');

      location.back();

      expect(location.pathname).toBe('/');
      expectHistoryUntouched(history);
    });
  });

  describe('listeners', () => {
    it('notifies popstate listeners AFTER the cursor has moved', () => {
      const seen: Array<{ type: string; pathname: string }> = [];
      location.onPopState((event) => {
        seen.push({
          type: (event as { type: string }).type,
          pathname: location.pathname,
        });
      });

      location.pushState(null, '', '/settings');
      // A push is not a pop — nothing fires.
      expect(seen).toEqual([]);

      location.back();
      location.forward();

      expect(seen).toEqual([
        { type: 'popstate', pathname: '/' },
        { type: 'popstate', pathname: '/settings' },
      ]);
    });

    it('carries the target entry"s state on the popstate event', () => {
      const states: unknown[] = [];
      location.onPopState((event) => {
        states.push((event as { state: unknown }).state);
      });
      location.pushState({ i: 1 }, '', '/settings');
      location.pushState({ i: 2 }, '', '/analytics');

      location.back();

      expect(states).toEqual([{ i: 1 }]);
    });

    it('removes a popstate listener through the returned disposer', () => {
      const listener = jest.fn();
      const dispose = location.onPopState(listener);
      location.pushState(null, '', '/settings');

      dispose();
      location.back();

      expect(listener).not.toHaveBeenCalled();
    });

    it('fires hashchange only when the fragment alone changed', () => {
      const hashListener = jest.fn();
      location.onHashChange(hashListener);
      location.pushState(null, '', '/settings');
      location.pushState(null, '', '/settings#one');
      location.pushState(null, '', '/analytics');

      // '/analytics' -> '/settings#one' is a different path: pop only.
      location.back();
      expect(hashListener).not.toHaveBeenCalled();

      // '/settings#one' -> '/settings' is the same path: pop AND hashchange.
      location.back();
      expect(hashListener).toHaveBeenCalledTimes(1);
      expect(hashListener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'hashchange' }),
      );
    });

    it('removes a hashchange listener through the returned disposer', () => {
      const listener = jest.fn();
      const dispose = location.onHashChange(listener);
      location.pushState(null, '', '/settings');
      location.pushState(null, '', '/settings#one');

      dispose();
      location.back();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
