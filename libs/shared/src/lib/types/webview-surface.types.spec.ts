/**
 * The surface-id contract, tested where it now lives.
 *
 * `libs/shared` is the owner because the extension host has to validate
 * `initialView` against the same list the renderer routes on, and host code
 * cannot import `libs/frontend/core`. What matters here is the relationships
 * between the four exported lists — a drift between any two of them is what
 * produced the three disagreeing allow-lists this replaced.
 */

import {
  ACCEPTED_INITIAL_VIEWS,
  DEFAULT_SURFACE_ID,
  LEGACY_SURFACE_ALIASES,
  SURFACE_ROUTE_IDS,
  isAcceptedInitialView,
  isSurfaceRouteId,
  surfaceIdFromSegment,
  surfaceRoutePath,
} from './webview-surface.types';

describe('webview surface ids', () => {
  it('lists every routable surface exactly once', () => {
    expect([...SURFACE_ROUTE_IDS]).toEqual([
      'chat',
      'setup-wizard',
      'settings',
      'analytics',
      'harness-builder',
      'setup-hub',
      'thoth',
      'marketplace',
      'tribunal',
      'tasks',
      'apps',
    ]);
    expect(new Set(SURFACE_ROUTE_IDS).size).toBe(SURFACE_ROUTE_IDS.length);
  });

  it('defaults to chat, and chat is routable', () => {
    expect(DEFAULT_SURFACE_ID).toBe('chat');
    expect(isSurfaceRouteId(DEFAULT_SURFACE_ID)).toBe(true);
  });

  it('accepts every route id plus every legacy alias as an initialView', () => {
    expect([...ACCEPTED_INITIAL_VIEWS]).toEqual([
      ...SURFACE_ROUTE_IDS,
      ...LEGACY_SURFACE_ALIASES,
    ]);
    expect(new Set(ACCEPTED_INITIAL_VIEWS).size).toBe(
      ACCEPTED_INITIAL_VIEWS.length,
    );
  });

  it('keeps the legacy aliases OUT of the route ids', () => {
    // A route for `orchestra-canvas` would be a surface with no component;
    // `normalizeInitialView` rewrites it to chat + grid instead.
    for (const alias of LEGACY_SURFACE_ALIASES) {
      expect(isSurfaceRouteId(alias)).toBe(false);
      expect(isAcceptedInitialView(alias)).toBe(true);
    }
  });

  it('accepts orchestra-canvas, which ptah.openOrchestraCanvas still sends', () => {
    // Revision 1, F4: the host allow-list rejected this, the generator threw,
    // the public boundary swallowed the throw and returned fallback HTML, and
    // the command rendered an empty panel.
    expect(isAcceptedInitialView('orchestra-canvas')).toBe(true);
  });

  it('rejects command-builder and context-tree, which have no render branch', () => {
    for (const removed of ['command-builder', 'context-tree']) {
      expect(isSurfaceRouteId(removed)).toBe(false);
      expect(isAcceptedInitialView(removed)).toBe(false);
    }
  });

  describe('isSurfaceRouteId / isAcceptedInitialView', () => {
    it.each([...SURFACE_ROUTE_IDS])('accepts %s on both predicates', (id) => {
      expect(isSurfaceRouteId(id)).toBe(true);
      expect(isAcceptedInitialView(id)).toBe(true);
    });

    it.each([
      ['an unknown string', 'not-a-view'],
      ['the empty string', ''],
      ['a path rather than an id', '/settings'],
      ['a traversal attempt', '../settings'],
      ['an absolute URL', 'https://evil.test'],
      ['a matrix-parameterised segment', 'settings;panel=auth'],
    ])('rejects %s', (_label, value) => {
      expect(isSurfaceRouteId(value)).toBe(false);
      expect(isAcceptedInitialView(value)).toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 3],
      ['an object', { path: 'settings' }],
    ])('rejects %s without throwing', (_label, value) => {
      expect(isSurfaceRouteId(value)).toBe(false);
      expect(isAcceptedInitialView(value)).toBe(false);
    });
  });

  describe('surfaceRoutePath / surfaceIdFromSegment', () => {
    it.each([...SURFACE_ROUTE_IDS])('round-trips %s', (id) => {
      expect(surfaceIdFromSegment(surfaceRoutePath(id).slice(1))).toBe(id);
    });

    it('produces an absolute, single-segment path', () => {
      expect(surfaceRoutePath('setup-wizard')).toBe('/setup-wizard');
    });

    it('falls back to the default for an absent segment', () => {
      // The Router holds an empty URL until `App.handleInitialView` seeds the
      // first navigation under `withDisabledInitialNavigation()`.
      expect(surfaceIdFromSegment(undefined)).toBe(DEFAULT_SURFACE_ID);
      expect(surfaceIdFromSegment('')).toBe(DEFAULT_SURFACE_ID);
    });

    it('falls back to the default for an unrecognised segment', () => {
      expect(surfaceIdFromSegment('command-builder')).toBe(DEFAULT_SURFACE_ID);
      expect(surfaceIdFromSegment('nonsense')).toBe(DEFAULT_SURFACE_ID);
    });

    it('takes a PARSED segment, so matrix parameters are the caller"s job', () => {
      // Documents the contract that F5 turned on: this function must never see
      // `settings;panel=auth`, because `SurfaceRouterService` hands it the
      // segment path Angular already parsed out of the URL.
      expect(surfaceIdFromSegment('settings;panel=auth')).toBe(
        DEFAULT_SURFACE_ID,
      );
      expect(surfaceIdFromSegment('settings')).toBe('settings');
    });
  });
});
