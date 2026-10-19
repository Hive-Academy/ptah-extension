/**
 * `SurfaceRoutePersistence` specs — every settled URL is written into webview
 * state, in the shape the boot path and the host read back.
 *
 * Properties that carry the design:
 *   1. The write follows `NavigationEnd` and records `urlAfterRedirects`, so a
 *      restore lands where the user was, not where they asked to go.
 *   2. What is written round-trips through `parseWebviewRouteState` — the
 *      shared parser both the webview and the host validate with (L5). A URL
 *      the parser rejects is not written, so the last restorable route
 *      survives, and an over-long seed is stored as `null`.
 *   3. Persistence never affects navigation: no host means no write, and a
 *      throwing `setState` costs one warning, not the navigation.
 *   4. `start` is idempotent: one subscription, one write per navigation.
 *
 * The real `VSCodeService` runs over a fake `window.vscode`, so the merge
 * `setState` performs is the one production performs.
 */

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  WEBVIEW_ROUTE_STATE_KEY,
  parseWebviewRouteState,
} from '@ptah-extension/shared';
import { provideSurfaceRouterTesting, surfaceTestRoutes } from '../../testing';
import { VSCodeService, type WebviewConfig } from '../services/vscode.service';
import { SurfaceRoutePersistence } from './surface-route-persistence';
import { SurfaceRouterService } from './surface-router.service';
import { GENERATION_ROUTE_TAB_VALIDATOR } from './surface-routes';

/** The webview API the host injects, recording what is written. */
class FakeVsCodeApi {
  state: unknown = undefined;
  readonly writes: unknown[] = [];

  postMessage(): void {
    // Not exercised here.
  }

  getState(): unknown {
    return this.state;
  }

  setState(state: unknown): void {
    this.writes.push(state);
    this.state = state;
  }
}

interface HostGlobals {
  vscode?: FakeVsCodeApi;
  ptahConfig?: WebviewConfig;
}

function hostWindow(): HostGlobals {
  return window as unknown as HostGlobals;
}

function config(panelId: string | undefined): WebviewConfig {
  return {
    isVSCode: true,
    theme: 'dark',
    workspaceRoot: '',
    workspaceName: '',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId,
  };
}

interface Setup {
  readonly persistence: SurfaceRoutePersistence;
  readonly surfaceRouter: SurfaceRouterService;
}

/** `api` absent means no host: `VSCodeService.isConnected()` is false. */
function setup(
  api?: FakeVsCodeApi,
  panelId: string | undefined = '',
  validator?: (tabId: string, workflow: string) => boolean,
): Setup {
  if (api) {
    hostWindow().vscode = api;
    hostWindow().ptahConfig = config(panelId);
  }
  TestBed.configureTestingModule({
    providers: [
      ...provideSurfaceRouterTesting(),
      ...(validator
        ? [{ provide: GENERATION_ROUTE_TAB_VALIDATOR, useValue: validator }]
        : []),
    ],
  });
  return {
    persistence: TestBed.inject(SurfaceRoutePersistence),
    surfaceRouter: TestBed.inject(SurfaceRouterService),
  };
}

describe('SurfaceRoutePersistence', () => {
  it('keeps the last route when a generation tab no longer belongs to the workspace', async () => {
    const api = new FakeVsCodeApi();
    const { persistence, surfaceRouter } = setup(api, '', () => false);
    const router = TestBed.inject(Router);
    router.resetConfig(
      surfaceTestRoutes().map((route) =>
        route.path === 'setup-wizard'
          ? {
              ...route,
              children: [{ path: 'generation/:workflow/:tabId', children: [] }],
            }
          : route,
      ),
    );
    persistence.start(null);
    await surfaceRouter.navigateToSurface('settings');
    await surfaceRouter.navigateToSurface('setup-wizard', [
      'generation',
      'setup-agent-generation',
      'stale-tab',
    ]);
    expect(api.writes).toHaveLength(1);
    expect(parseWebviewRouteState(api.state)?.route).toBe('/settings');
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
    delete hostWindow().vscode;
    delete hostWindow().ptahConfig;
  });

  it('writes the settled URL after redirects, with the seed and panel id', async () => {
    const api = new FakeVsCodeApi();
    const { persistence, surfaceRouter } = setup(api, 'ptah.panel.abc-123');
    persistence.start('analytics');

    // The test table redirects a bare `/thoth` to its default tab.
    await surfaceRouter.navigateToSurface('thoth');

    expect(api.writes).toHaveLength(1);
    expect(api.state).toEqual({
      [WEBVIEW_ROUTE_STATE_KEY]: {
        v: 1,
        route: '/thoth/memory',
        seed: 'analytics',
        panelId: 'ptah.panel.abc-123',
      },
    });
  });

  it('writes once per settled navigation', async () => {
    const api = new FakeVsCodeApi();
    const { persistence, surfaceRouter } = setup(api);
    persistence.start(null);

    await surfaceRouter.navigateToSurface('settings');
    await surfaceRouter.navigateToUrl('/chat/tab-1');
    await surfaceRouter.navigateToUrl('/chat/tab-2');

    expect(api.writes).toHaveLength(3);
    expect(parseWebviewRouteState(api.state)?.route).toBe('/chat/tab-2');
  });

  it('writes nothing for a navigation that does not settle', async () => {
    jest.spyOn(console, 'warn').mockImplementation();
    const api = new FakeVsCodeApi();
    const { persistence, surfaceRouter } = setup(api);
    persistence.start(null);

    await surfaceRouter.navigateToUrl('/command-builder');

    expect(api.writes).toHaveLength(0);
  });

  it('keeps the other keys of the state record', async () => {
    const api = new FakeVsCodeApi();
    api.state = { otherFeature: { kept: true } };
    const { persistence, surfaceRouter } = setup(api);
    persistence.start(null);

    await surfaceRouter.navigateToSurface('settings');

    expect(api.state).toEqual(
      expect.objectContaining({ otherFeature: { kept: true } }),
    );
  });

  describe('records the restore contract rejects (review round 1)', () => {
    const savedSettings = {
      [WEBVIEW_ROUTE_STATE_KEY]: {
        v: 1,
        route: '/settings',
        seed: null,
        panelId: '',
      },
    };

    it.each([
      ['a colon in the query', '/settings?time=12:30'],
      ['a colon in the fragment', '/settings#at:top'],
      ['an auxiliary outlet', '/chat(aux:help)'],
      ['a URL over 2048 characters', `/settings?q=${'a'.repeat(2100)}`],
    ])(
      'keeps the last valid route when the settled URL has %s',
      async (_label, rejectedUrl) => {
        const warn = jest.spyOn(console, 'warn').mockImplementation();
        const api = new FakeVsCodeApi();
        const { persistence, surfaceRouter } = setup(api);
        const router = TestBed.inject(Router);
        // A component-less auxiliary route, so `/chat(aux:help)` settles.
        router.resetConfig([
          ...surfaceTestRoutes(),
          { path: 'help', outlet: 'aux', children: [] },
        ]);
        persistence.start(null);
        await surfaceRouter.navigateToSurface('settings');
        expect(api.state).toEqual(savedSettings);

        await expect(router.navigateByUrl(rejectedUrl)).resolves.toBe(true);

        // The navigation landed, but nothing was written over the good value.
        expect(router.url).not.toBe('/settings');
        expect(api.writes).toHaveLength(1);
        expect(parseWebviewRouteState(api.state)?.route).toBe('/settings');
        expect(warn).toHaveBeenCalledTimes(1);
      },
    );

    it('warns once, not once per skipped write', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation();
      const api = new FakeVsCodeApi();
      const { persistence } = setup(api);
      const router = TestBed.inject(Router);
      persistence.start(null);

      await router.navigateByUrl('/settings?time=12:30');
      await router.navigateByUrl('/analytics?time=13:45');
      await router.navigateByUrl('/settings#at:top');

      expect(api.writes).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[SurfaceRoutePersistence]'),
      );
    });

    it('resumes writing once the Router settles on an accepted URL', async () => {
      jest.spyOn(console, 'warn').mockImplementation();
      const api = new FakeVsCodeApi();
      const { persistence, surfaceRouter } = setup(api);
      persistence.start(null);

      await TestBed.inject(Router).navigateByUrl('/settings?time=12:30');
      await surfaceRouter.navigateToSurface('analytics');

      expect(parseWebviewRouteState(api.state)?.route).toBe('/analytics');
    });

    it('writes a null seed, and a restorable record, for an over-long seed', async () => {
      const api = new FakeVsCodeApi();
      const { persistence, surfaceRouter } = setup(api);
      persistence.start('x'.repeat(65));

      await surfaceRouter.navigateToSurface('settings');

      expect(parseWebviewRouteState(api.state)).toEqual({
        v: 1,
        route: '/settings',
        seed: null,
        panelId: '',
      });
    });

    it('keeps a seed at the 64-character limit', async () => {
      const api = new FakeVsCodeApi();
      const { persistence, surfaceRouter } = setup(api);
      const seed = 'x'.repeat(64);
      persistence.start(seed);

      await surfaceRouter.navigateToSurface('settings');

      expect(parseWebviewRouteState(api.state)?.seed).toBe(seed);
    });
  });

  describe('round trip through parseWebviewRouteState (L5)', () => {
    it.each([
      ['the sidebar', ''],
      ['the Electron main window', 'electron-main'],
      ['an editor panel', 'ptah.panel.550e8400-e29b-41d4-a716-446655440000'],
    ])('reads back what %s writes', async (_label, panelId) => {
      const api = new FakeVsCodeApi();
      const { persistence, surfaceRouter } = setup(api, panelId);
      persistence.start('chat');

      await surfaceRouter.navigateToUrl(
        '/chat/550e8400-e29b-41d4-a716-446655440000',
      );

      expect(parseWebviewRouteState(api.state)).toEqual({
        v: 1,
        route: '/chat/550e8400-e29b-41d4-a716-446655440000',
        seed: 'chat',
        panelId,
      });
    });

    it('writes the sidebar panel id when the config has none', async () => {
      const api = new FakeVsCodeApi();
      const { persistence, surfaceRouter } = setup(api, undefined);
      persistence.start(null);

      await surfaceRouter.navigateToSurface('settings');

      expect(parseWebviewRouteState(api.state)).toEqual({
        v: 1,
        route: '/settings',
        seed: null,
        panelId: '',
      });
    });

    it('round-trips a matrix, query and fragment URL', async () => {
      const api = new FakeVsCodeApi();
      const { persistence, surfaceRouter } = setup(api);
      persistence.start(null);

      await surfaceRouter.navigateToUrl('/settings;panel=auth?x=1#top');

      expect(parseWebviewRouteState(api.state)?.route).toBe(
        '/settings;panel=auth?x=1#top',
      );
    });
  });

  it('writes nothing when no host is connected', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const { persistence, surfaceRouter } = setup();
    const setState = jest.spyOn(TestBed.inject(VSCodeService), 'setState');
    persistence.start(null);

    await expect(surfaceRouter.navigateToSurface('settings')).resolves.toBe(
      'navigated',
    );

    expect(setState).not.toHaveBeenCalled();
    // Not even `VSCodeService`'s own "API not available" warning.
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs one warning per failed write and leaves navigation unaffected', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const api = new FakeVsCodeApi();
    jest.spyOn(api, 'setState').mockImplementation(() => {
      throw new Error('state too large');
    });
    const { persistence, surfaceRouter } = setup(api);
    persistence.start(null);

    await expect(surfaceRouter.navigateToSurface('settings')).resolves.toBe(
      'navigated',
    );
    expect(surfaceRouter.currentSurface()).toBe('settings');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[SurfaceRoutePersistence]'),
      'state too large',
    );

    // The subscription survives the throw: the next navigation lands and
    // tries again.
    await expect(surfaceRouter.navigateToSurface('analytics')).resolves.toBe(
      'navigated',
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('ignores a second start: one write per navigation, first seed kept', async () => {
    const api = new FakeVsCodeApi();
    const { persistence, surfaceRouter } = setup(api);
    persistence.start('analytics');
    persistence.start('settings');

    await surfaceRouter.navigateToSurface('settings');

    expect(api.writes).toHaveLength(1);
    expect(parseWebviewRouteState(api.state)?.seed).toBe('analytics');
  });

  it('writes nothing before start', async () => {
    const api = new FakeVsCodeApi();
    const { surfaceRouter } = setup(api);
    TestBed.inject(SurfaceRoutePersistence);

    await surfaceRouter.navigateToSurface('settings');

    expect(api.writes).toHaveLength(0);
  });
});
