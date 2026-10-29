import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import {
  Router,
  provideRouter,
  withDisabledInitialNavigation,
  type Route,
} from '@angular/router';
import {
  SURFACE_ACTIVE,
  SurfaceRoutePersistence,
  VSCodeService,
} from '@ptah-extension/core';
import {
  WEBVIEW_ROUTE_STATE_KEY,
  parseWebviewRouteState,
} from '@ptah-extension/shared';

import { onboardingFirstRunGuard } from '@ptah-extension/onboarding/services';

import { appRoutes } from './app.routes';

function routeFor(path: string): Route {
  const route = appRoutes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`Missing route: ${path}`);
  return route;
}

describe('generation workflow route', () => {
  it('keeps the legacy wizard and a separate parameterized generation route', () => {
    const route = routeFor('setup-wizard/generation/:workflow/:tabId');
    expect(routeFor('setup-wizard').component).toBeDefined();
    expect(route.component).toBeDefined();
    expect(route.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: SURFACE_ACTIVE }),
      ]),
    );
  });
});

describe('harness builder route', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the bare route and Setup Hub while lazily loading the parameterized builder', async () => {
    const builder = routeFor('harness-builder/:mode/:tabId');
    const bareBuilder = routeFor('harness-builder');
    const hub = routeFor('setup-hub');
    const module = await import('@ptah-extension/harness-builder');

    expect(builder.loadComponent).toBeDefined();
    expect(await builder.loadComponent?.()).toBe(
      module.HarnessBuilderViewComponent,
    );
    expect(await bareBuilder.loadComponent?.()).toBe(
      module.HarnessBuilderViewComponent,
    );
    expect(await hub.loadComponent?.()).toBe(module.SetupHubComponent);
    expect(builder.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: SURFACE_ACTIVE }),
      ]),
    );
  });

  it.each(['configure-harness', 'new-project'])(
    'keeps the %s mode and tab ID in the settled and restored URL',
    async (mode) => {
      const setState = jest.fn<void, [string, unknown]>();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(appRoutes, withDisabledInitialNavigation()),
          {
            provide: VSCodeService,
            useValue: {
              isConnected: () => true,
              config: () => ({ panelId: 'ptah.panel.builder-route-test' }),
              setState,
            },
          },
        ],
      });
      const router = TestBed.inject(Router);
      TestBed.inject(SurfaceRoutePersistence).start(null);
      const tabId = 'tab-123';
      const url = `/harness-builder/${mode}/${tabId}`;

      expect(await router.navigateByUrl(url)).toBe(true);
      expect(router.url).toBe(url);
      const snapshot = router.routerState.snapshot.root.firstChild;
      expect(snapshot?.routeConfig?.path).toBe('harness-builder/:mode/:tabId');
      expect(snapshot?.paramMap.get('mode')).toBe(mode);
      expect(snapshot?.paramMap.get('tabId')).toBe(tabId);

      expect(setState).toHaveBeenCalledWith(
        WEBVIEW_ROUTE_STATE_KEY,
        expect.objectContaining({ route: url }),
      );
      const saved = setState.mock.lastCall?.[1];
      const restored = parseWebviewRouteState({
        [WEBVIEW_ROUTE_STATE_KEY]: saved,
      });
      expect(restored?.route).toBe(url);
      expect(await router.navigateByUrl('/setup-hub')).toBe(true);
      expect(await router.navigateByUrl(restored?.route ?? '')).toBe(true);
      expect(
        router.routerState.snapshot.root.firstChild?.paramMap.get('tabId'),
      ).toBe(tabId);
    },
  );

  it('bounds the Electron outer row and configuration host', () => {
    const source = readFileSync(
      join(
        __dirname,
        '../../../../libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts',
      ),
      'utf-8',
    );
    const rowClasses = source.match(
      /<!-- 3-Panel Content Area -->\s*<div class="([^"]+)"/,
    )?.[1];
    const hostClasses = source.match(
      /data-test="configuration-surface-host"[\s\S]*?class="([^"]+)"/,
    )?.[1];

    expect(rowClasses?.split(' ')).toContain('min-h-0');
    expect(hostClasses?.split(' ')).toContain('min-h-0');
  });
});

describe('onboarding route (TASK_2026_ONBOARDING)', () => {
  it('guards only the chat route with the first-run guard', () => {
    const guarded = appRoutes
      .filter((route) => route.canActivate !== undefined)
      .map((route) => route.path);

    expect(guarded).toEqual(['chat']);
    expect(routeFor('chat').canActivate).toEqual([onboardingFirstRunGuard]);
  });

  it('lazily loads ONBOARDING_ROUTES with its own SURFACE_ACTIVE provider', async () => {
    const route = routeFor('onboarding');
    const module = await import('@ptah-extension/onboarding');

    expect(route.component).toBeUndefined();
    expect(route.loadComponent).toBeUndefined();
    expect(route.canMatch).toBeUndefined();
    expect(route.providers).toEqual([
      expect.objectContaining({ provide: SURFACE_ACTIVE }),
    ]);
    expect(await route.loadChildren?.()).toBe(module.ONBOARDING_ROUTES);
  });

  it('declares onboarding right after chat', () => {
    const order = appRoutes.map((route) => route.path);
    expect(order.indexOf('onboarding')).toBe(order.indexOf('chat') + 1);
  });

  it('keeps the legacy setup surfaces routed until the cut-over', () => {
    for (const path of ['setup-wizard', 'harness-builder', 'setup-hub']) {
      expect(routeFor(path)).toBeDefined();
    }
  });

  it('imports onboarding eagerly only through its narrow services entry', () => {
    const source = readFileSync(join(__dirname, 'app.routes.ts'), 'utf-8');
    expect(source).toContain("from '@ptah-extension/onboarding/services'");
    expect(source).not.toMatch(/from '@ptah-extension\/onboarding'/);
  });
});
