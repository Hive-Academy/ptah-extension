/**
 * `SurfaceRouterService` specs — the Router read and written as a surface id.
 *
 * Properties that carry the design:
 *   1. The provided `PlatformLocation` is the in-memory one and `window.history`
 *      is never called, in either host. That is acceptance criterion 1 of
 *      TASK_2026_524 and the reason the Router can run here at all.
 *   2. `currentSurface` follows `NavigationEnd` ONLY, so a navigation that
 *      does not land leaves the surface where it was. A second owner of the
 *      surface is exactly the bug (TASK_2026_317) this replaced.
 *   3. The four-state result tells `already-there` from `cancelled` from
 *      `failed`. A boolean could not, and that cost the user a false error
 *      alert (revision 1, F3).
 *   4. Surface parsing agrees with Angular's URL grammar, matrix parameters
 *      included (revision 1, F5).
 *   5. `pendingSurface()` reports in-flight intent, which is what lets a
 *      consumer avoid cancelling a navigation the user just started
 *      (revision 1, F2).
 *   6. A sub-path keeps all four results honest, and the Marketplace's
 *      default-child redirect can restore the remembered page without
 *      re-creating the page the user is already on — probes A2 and A3 of
 *      TASK_2026_533, run against a real Router and real components.
 */

import { Location, PlatformLocation } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  viewChild,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationEnd,
  NavigationStart,
  provideRouter,
  Router,
  RouterOutlet,
  withComponentInputBinding,
  withDisabledInitialNavigation,
  type RedirectFunction,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, take } from 'rxjs';
import { provideSurfaceRouterTesting, surfaceTestRoutes } from '../../testing';
import { marketplaceRouteCommands } from '../marketplace/marketplace-route';
import { AppStateManager } from '../services/app-state.service';
import { MemoryPlatformLocation } from './memory-platform-location';
import {
  SurfaceRouterService,
  surfaceNavigationLanded,
  type SurfaceNavigationResult,
} from './surface-router.service';
import { DEFAULT_SURFACE_ID, SURFACE_ROUTE_IDS } from './surface-routes';

/** Resolves on the Router's next settled navigation. Subscribe BEFORE acting. */
function nextNavigationEnd(router: Router): Promise<NavigationEnd> {
  return firstValueFrom(
    router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      take(1),
    ),
  );
}

function createService(): SurfaceRouterService {
  TestBed.configureTestingModule({
    providers: [...provideSurfaceRouterTesting()],
  });
  return TestBed.inject(SurfaceRouterService);
}

@Component({
  standalone: true,
  template: 'Configuration surface',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RemountSurfaceComponent {
  static constructions = 0;
  readonly instanceNumber = ++RemountSurfaceComponent.constructions;
}

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RemountParentComponent {
  static constructions = 0;
  readonly instanceNumber = ++RemountParentComponent.constructions;
  readonly outlet = viewChild.required(RouterOutlet);
}

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class RemountHostComponent {
  readonly outlet = viewChild.required(RouterOutlet);
}

/**
 * The shared testing table with a catch-all child under `marketplace`, so a
 * sub-path lands somewhere instead of falling through to the wildcard. The
 * real Marketplace tree lives in the marketplace library.
 */
function createServiceWithMarketplaceChildren(): SurfaceRouterService {
  const service = createService();
  TestBed.inject(Router).resetConfig(
    surfaceTestRoutes().map((route) =>
      route.path === 'marketplace'
        ? { path: 'marketplace', children: [{ path: '**', children: [] }] }
        : route,
    ),
  );
  return service;
}

/** How many times each probe page has been constructed. */
const constructed = {
  shell: 0,
  overview: 0,
  installedServers: 0,
  serverSource: 0,
  installedSkills: 0,
  detail: 0,
};

@Component({
  selector: 'ptah-probe-marketplace-shell',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProbeShellComponent {
  constructor() {
    constructed.shell++;
  }
}

@Component({
  selector: 'ptah-probe-overview',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProbeOverviewComponent {
  constructor() {
    constructed.overview++;
  }
}

@Component({
  selector: 'ptah-probe-installed-servers',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProbeInstalledServersComponent {
  constructor() {
    constructed.installedServers++;
  }
}

@Component({
  selector: 'ptah-probe-server-source',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProbeServerSourceComponent {
  constructor() {
    constructed.serverSource++;
  }
}

@Component({
  selector: 'ptah-probe-installed-skills',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProbeInstalledSkillsComponent {
  constructor() {
    constructed.installedSkills++;
  }
}

@Component({
  selector: 'ptah-probe-detail',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProbeDetailComponent {
  constructor() {
    constructed.detail++;
  }
}

/**
 * The redirect Batch 17's `MARKETPLACE_ROUTES` depends on: read the active
 * workspace's remembered page through `inject()` — probe A2 is whether that
 * is legal inside a `RedirectFunction` — and fall back to overview.
 */
const restoreMarketplaceRoute: RedirectFunction = () => {
  const remembered = inject(AppStateManager).marketplaceRoute();
  return inject(Router).createUrlTree([
    '/marketplace',
    ...marketplaceRouteCommands(remembered ?? { page: 'overview' }),
  ]);
};

/**
 * The plan's Marketplace route tree (implementation-plan.md D1), trimmed to
 * the shapes the probes need, under the same surface routes production has.
 */
function marketplaceProbeRoutes(): Routes {
  // Every other surface as the shared table has it; the two fallbacks are
  // re-added last, after the marketplace tree.
  const otherSurfaces = surfaceTestRoutes().filter(
    (route) =>
      route.path !== 'marketplace' && route.path !== '' && route.path !== '**',
  );
  return [
    ...otherSurfaces,
    {
      path: 'marketplace',
      component: ProbeShellComponent,
      children: [
        { path: '', pathMatch: 'full', redirectTo: restoreMarketplaceRoute },
        { path: 'overview', component: ProbeOverviewComponent },
        {
          path: 'servers',
          children: [
            {
              path: 'smithery',
              component: ProbeServerSourceComponent,
              data: { source: 'smithery' },
            },
            {
              path: 'registry',
              component: ProbeServerSourceComponent,
              data: { source: 'registry' },
            },
            {
              path: '',
              component: ProbeInstalledServersComponent,
              children: [
                { path: '', children: [] },
                { path: ':serverRef', component: ProbeDetailComponent },
              ],
            },
          ],
        },
        {
          path: 'skills',
          children: [
            {
              path: '',
              component: ProbeInstalledSkillsComponent,
              children: [
                { path: '', children: [] },
                { path: ':skillRef', component: ProbeDetailComponent },
              ],
            },
          ],
        },
        { path: '**', redirectTo: 'overview' },
      ],
    },
    { path: '', pathMatch: 'full', redirectTo: DEFAULT_SURFACE_ID },
    { path: '**', redirectTo: DEFAULT_SURFACE_ID },
  ];
}

interface MarketplaceProbe {
  readonly harness: RouterTestingHarness;
  readonly router: Router;
  readonly service: SurfaceRouterService;
  readonly appState: AppStateManager;
}

/** A real Router, wired as `app.config.ts` wires it, rendering real outlets. */
async function createMarketplaceProbe(): Promise<MarketplaceProbe> {
  for (const key of Object.keys(constructed) as (keyof typeof constructed)[]) {
    constructed[key] = 0;
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformLocation, useClass: MemoryPlatformLocation },
      provideRouter(
        marketplaceProbeRoutes(),
        withComponentInputBinding(),
        withDisabledInitialNavigation(),
      ),
    ],
  });
  const harness = await RouterTestingHarness.create();
  return {
    harness,
    router: TestBed.inject(Router),
    service: TestBed.inject(SurfaceRouterService),
    appState: TestBed.inject(AppStateManager),
  };
}

/**
 * Let a navigation started through `AppStateManager` (fire-and-forget) land
 * and render. The probe HAS a fixture, so it awaits `whenStable()` rather than
 * `TestBed.tick()` — see `settleSurfaceNavigation` for why.
 */
async function settleProbe(probe: MarketplaceProbe): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  probe.harness.detectChanges();
  await probe.harness.fixture.whenStable();
}

/** Navigate through the service and render whatever the Router activated. */
async function navigateProbe(
  probe: MarketplaceProbe,
  subPath?: readonly string[],
): Promise<SurfaceNavigationResult> {
  const result = await probe.service.navigateToSurface('marketplace', subPath);
  probe.harness.detectChanges();
  await probe.harness.fixture.whenStable();
  return result;
}

describe('SurfaceRouterService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('runs on the in-memory PlatformLocation, not the browser one', () => {
    createService();
    expect(TestBed.inject(PlatformLocation)).toBeInstanceOf(
      MemoryPlatformLocation,
    );
  });

  it('never touches window.history across a full navigation round trip', async () => {
    const pushState = jest
      .spyOn(window.history, 'pushState')
      .mockImplementation();
    const replaceState = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation();
    const back = jest.spyOn(window.history, 'back').mockImplementation();
    const forward = jest.spyOn(window.history, 'forward').mockImplementation();
    const go = jest.spyOn(window.history, 'go').mockImplementation();

    const service = createService();
    for (const id of SURFACE_ROUTE_IDS) {
      await service.navigateToSurface(id);
    }

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it('reports the default surface before the first navigation', () => {
    // `withDisabledInitialNavigation()` means nothing has navigated yet.
    const service = createService();
    expect(service.currentSurface()).toBe('chat');
  });

  it.each([...SURFACE_ROUTE_IDS])(
    'navigates to %s and reports it',
    async (id) => {
      const service = createService();

      await expect(service.navigateToSurface(id)).resolves.toBe('navigated');

      expect(service.currentSurface()).toBe(id);
      expect(TestBed.inject(Router).url).toBe(`/${id}`);
    },
  );

  it('supports in-session back and forward (acceptance criterion 2)', async () => {
    const service = createService();
    const router = TestBed.inject(Router);
    // In production `withDisabledInitialNavigation()` registers an app
    // initializer that calls exactly this (@angular/router 22.1.7,
    // `_router_module-chunk.mjs`), so the Router subscribes to `Location`. A
    // bare `TestBed` does not run app initializers, hence the explicit call.
    router.setUpLocationChangeListener();
    const location = TestBed.inject(Location);

    await service.navigateToSurface('settings');
    await service.navigateToSurface('analytics');
    expect(service.currentSurface()).toBe('analytics');

    const backLanded = nextNavigationEnd(router);
    location.back();
    await backLanded;
    expect(service.currentSurface()).toBe('settings');

    const forwardLanded = nextNavigationEnd(router);
    location.forward();
    await forwardLanded;
    expect(service.currentSurface()).toBe('analytics');
  });

  it('falls back to the default surface for a non-routable id, with a warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const service = createService();
    await service.navigateToSurface('settings');

    // 'orchestra-canvas' is a legal `ViewType` with no route. Callers are
    // expected to normalise it first; if one does not, landing on chat is
    // better than staying on settings while `currentView()` claims otherwise.
    await expect(service.navigateToSurface('orchestra-canvas')).resolves.toBe(
      'navigated',
    );

    expect(service.currentSurface()).toBe('chat');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has no route'));
  });

  describe('result semantics (F3)', () => {
    it('reports a repeat navigation as already-there, NOT as a failure', async () => {
      // Angular's default `onSameUrlNavigation: 'ignore'` resolves `false` for
      // this. Forwarding that boolean made `HarnessWorkflowMessageHandler`
      // tell the user the builder "could not be opened" while it was open.
      const service = createService();

      await expect(service.navigateToSurface('harness-builder')).resolves.toBe(
        'navigated',
      );
      await expect(service.navigateToSurface('harness-builder')).resolves.toBe(
        'already-there',
      );

      expect(service.currentSurface()).toBe('harness-builder');
    });

    it('counts already-there as landed', () => {
      expect(surfaceNavigationLanded('navigated')).toBe(true);
      expect(surfaceNavigationLanded('already-there')).toBe(true);
      expect(surfaceNavigationLanded('cancelled')).toBe(false);
      expect(surfaceNavigationLanded('failed')).toBe(false);
    });

    it('reports failed — not cancelled — when the navigation throws', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation();
      const service = createService();
      jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockRejectedValue(new Error('chunk fetch failed'));

      // A rejected lazy chunk arrives here. It must become a value, not an
      // unhandled rejection, and it must be distinguishable from a skip.
      await expect(service.navigateToSurface('marketplace')).resolves.toBe(
        'failed',
      );
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Navigation to "marketplace" failed'),
        'chunk fetch failed',
      );
    });

    it('reports cancelled when a navigation resolves false from elsewhere', async () => {
      const service = createService();
      await service.navigateToSurface('settings');
      // Not at the destination beforehand, and `navigateByUrl` resolved
      // `false`: that is a supersession, not a skip.
      jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(false);

      await expect(service.navigateToSurface('marketplace')).resolves.toBe(
        'cancelled',
      );
    });

    it('leaves the surface alone when a navigation does not land', async () => {
      jest.spyOn(console, 'error').mockImplementation();
      const service = createService();
      await service.navigateToSurface('settings');

      jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockRejectedValue(new Error('chunk fetch failed'));
      const result: SurfaceNavigationResult =
        await service.navigateToSurface('marketplace');

      expect(surfaceNavigationLanded(result)).toBe(false);
      expect(service.currentSurface()).toBe('settings');
    });
  });

  describe('URL parsing agrees with Angular (F5)', () => {
    it('reads the surface off a segment carrying matrix parameters', async () => {
      // String surgery reported `chat` for this, so the outlet hid itself
      // while the Router had settings activated.
      const service = createService();
      const router = TestBed.inject(Router);

      await router.navigateByUrl('/settings;panel=auth');

      expect(router.url).toBe('/settings;panel=auth');
      expect(service.currentSurface()).toBe('settings');
    });

    it('reads the surface off a URL carrying query and fragment', async () => {
      const service = createService();
      await TestBed.inject(Router).navigateByUrl('/analytics?range=7d#totals');

      expect(service.currentSurface()).toBe('analytics');
    });

    it('falls back to chat for an unrecognised URL', async () => {
      const service = createService();
      // The wildcard route redirects, which is itself the fallback; assert the
      // parser agrees rather than reporting something else on the way.
      await TestBed.inject(Router).navigateByUrl('/command-builder');

      expect(service.currentSurface()).toBe('chat');
    });
  });

  describe('remountActiveSurface', () => {
    let service: SurfaceRouterService;
    let router: Router;

    beforeEach(() => {
      RemountSurfaceComponent.constructions = 0;
      RemountParentComponent.constructions = 0;
      const routes: Routes = [
        { path: 'settings', component: RemountSurfaceComponent },
        {
          path: 'marketplace',
          component: RemountParentComponent,
          children: [{ path: 'details', component: RemountSurfaceComponent }],
        },
        { path: 'chat', children: [] },
      ];
      TestBed.configureTestingModule({
        imports: [RemountHostComponent],
        providers: [
          { provide: PlatformLocation, useClass: MemoryPlatformLocation },
          provideRouter(routes, withDisabledInitialNavigation()),
        ],
      });
      service = TestBed.inject(SurfaceRouterService);
      router = TestBed.inject(Router);
    });

    it('re-creates the routed component at the same URL without NavigationStart', async () => {
      const fixture = TestBed.createComponent(RemountHostComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      await router.navigateByUrl('/settings?panel=auth#details');
      fixture.detectChanges();
      await fixture.whenStable();
      const original = fixture.componentInstance.outlet().component;
      expect(original).toBeInstanceOf(RemountSurfaceComponent);
      expect(RemountSurfaceComponent.constructions).toBe(1);
      const navigationStarts: NavigationStart[] = [];
      const subscription = router.events.subscribe((event) => {
        if (event instanceof NavigationStart) navigationStarts.push(event);
      });

      try {
        service.remountActiveSurface();
        fixture.detectChanges();
        await fixture.whenStable();

        expect(fixture.componentInstance.outlet().component).not.toBe(original);
        expect(RemountSurfaceComponent.constructions).toBe(2);
        expect(router.url).toBe('/settings?panel=auth#details');
        expect(navigationStarts).toEqual([]);
      } finally {
        subscription.unsubscribe();
      }
    });

    it('re-creates the parent and child from retained contexts at the same child URL', async () => {
      const fixture = TestBed.createComponent(RemountHostComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      await router.navigateByUrl('/marketplace/details?tab=installed#entry');
      fixture.detectChanges();
      await fixture.whenStable();
      const originalParent = fixture.componentInstance.outlet().component;
      expect(originalParent).toBeInstanceOf(RemountParentComponent);
      if (!(originalParent instanceof RemountParentComponent)) {
        throw new Error('Expected the parent route to be activated');
      }
      const originalChild = originalParent.outlet().component;
      expect(originalChild).toBeInstanceOf(RemountSurfaceComponent);
      expect(RemountParentComponent.constructions).toBe(1);
      expect(RemountSurfaceComponent.constructions).toBe(1);

      service.remountActiveSurface();
      fixture.detectChanges();
      await fixture.whenStable();

      const parent = fixture.componentInstance.outlet().component;
      expect(parent).toBeInstanceOf(RemountParentComponent);
      if (!(parent instanceof RemountParentComponent)) {
        throw new Error('Expected the parent route to be re-activated');
      }
      expect(parent).not.toBe(originalParent);
      expect(parent.outlet().component).not.toBe(originalChild);
      expect(RemountParentComponent.constructions).toBe(2);
      expect(RemountSurfaceComponent.constructions).toBe(2);
      expect(router.url).toBe('/marketplace/details?tab=installed#entry');
    });

    it('does nothing on a component-less route', async () => {
      const fixture = TestBed.createComponent(RemountHostComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      await router.navigateByUrl('/chat');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance.outlet().isActivated).toBe(false);

      expect(() => service.remountActiveSurface()).not.toThrow();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.outlet().isActivated).toBe(false);
      expect(RemountSurfaceComponent.constructions).toBe(0);
      expect(RemountParentComponent.constructions).toBe(0);
      expect(router.url).toBe('/chat');
    });

    it('does nothing when no outlet is rendered', async () => {
      expect(() => service.remountActiveSurface()).not.toThrow();
      await router.navigateByUrl('/settings');

      expect(() => service.remountActiveSurface()).not.toThrow();

      expect(RemountSurfaceComponent.constructions).toBe(0);
      expect(RemountParentComponent.constructions).toBe(0);
      expect(router.url).toBe('/settings');
    });
  });

  describe('pendingSurface (F2)', () => {
    it('is null while the Router is idle', async () => {
      const service = createService();
      expect(service.pendingSurface()).toBeNull();

      await service.navigateToSurface('settings');
      expect(service.pendingSurface()).toBeNull();
    });

    it('reports the in-flight destination while currentSurface still lags', async () => {
      // This is the F2 condition exactly: a lazy route is loading, so
      // `currentSurface()` still says chat, and a consumer that redirects on
      // that reading cancels the user's click.
      const service = createService();
      const router = TestBed.inject(Router);
      router.resetConfig([
        { path: 'chat', children: [] },
        // A chunk that never arrives, so the navigation stays in flight for
        // the whole test.
        {
          path: 'thoth',
          loadComponent: () => new Promise<never>(() => undefined),
        },
      ]);
      await service.navigateToSurface('chat');

      void service.navigateToSurface('thoth');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(service.currentSurface()).toBe('chat');
      expect(service.pendingSurface()).toBe('thoth');
    });
  });

  describe('sub-path navigation (TASK_2026_533)', () => {
    it('navigates to a child of the surface and reports the surface', async () => {
      const service = createServiceWithMarketplaceChildren();

      await expect(
        service.navigateToSurface('marketplace', ['servers', 'smithery']),
      ).resolves.toBe('navigated');

      expect(TestBed.inject(Router).url).toBe('/marketplace/servers/smithery');
      expect(service.currentSurface()).toBe('marketplace');
    });

    it('reports a repeat of the same sub-path as already-there', async () => {
      const service = createServiceWithMarketplaceChildren();

      await service.navigateToSurface('marketplace', ['servers', 'smithery']);

      await expect(
        service.navigateToSurface('marketplace', ['servers', 'smithery']),
      ).resolves.toBe('already-there');
    });

    it('recognises already-there for a segment the router has to encode', async () => {
      // An external plugin id carries `/` inside ONE segment. The comparison
      // is between serialized trees, so the encoded current URL matches the
      // encoded target instead of being mistaken for a cancellation.
      const service = createServiceWithMarketplaceChildren();
      const subPath = ['skills', 'external:owner/repo/plugin'];

      await expect(
        service.navigateToSurface('marketplace', subPath),
      ).resolves.toBe('navigated');
      await expect(
        service.navigateToSurface('marketplace', subPath),
      ).resolves.toBe('already-there');
    });

    it('navigates between two children of the same surface', async () => {
      const service = createServiceWithMarketplaceChildren();
      await service.navigateToSurface('marketplace', ['servers', 'smithery']);

      await expect(
        service.navigateToSurface('marketplace', ['connectors']),
      ).resolves.toBe('navigated');

      expect(TestBed.inject(Router).url).toBe('/marketplace/connectors');
    });

    it('does not report the surface root as already-there while on a child', async () => {
      const service = createServiceWithMarketplaceChildren();
      await service.navigateToSurface('marketplace', ['servers']);

      await expect(service.navigateToSurface('marketplace')).resolves.toBe(
        'navigated',
      );
      expect(TestBed.inject(Router).url).toBe('/marketplace');
    });

    it('reports failed when a sub-path navigation throws', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation();
      const service = createServiceWithMarketplaceChildren();
      jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockRejectedValue(new Error('chunk fetch failed'));

      await expect(
        service.navigateToSurface('marketplace', ['servers', 'smithery']),
      ).resolves.toBe('failed');
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Navigation to "marketplace" failed'),
        'chunk fetch failed',
      );
    });

    it('reports failed — never rejects — when building the URL tree throws', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation();
      const service = createServiceWithMarketplaceChildren();
      const router = TestBed.inject(Router);
      jest.spyOn(router, 'createUrlTree').mockImplementation(() => {
        throw new Error('cannot resolve commands');
      });
      const navigateByUrl = jest.spyOn(router, 'navigateByUrl');

      await expect(
        service.navigateToSurface('marketplace', ['servers', 'smithery']),
      ).resolves.toBe('failed');
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Navigation to "marketplace" failed'),
        'cannot resolve commands',
      );
    });

    it('reports cancelled when a sub-path navigation resolves false from elsewhere', async () => {
      const service = createServiceWithMarketplaceChildren();
      await service.navigateToSurface('settings');
      jest
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(false);

      await expect(
        service.navigateToSurface('marketplace', ['connectors']),
      ).resolves.toBe('cancelled');
    });

    it('drops the sub-path when the surface falls back', async () => {
      // The sub-path addressed a child of the surface that was asked for; the
      // fallback surface has no such child.
      jest.spyOn(console, 'warn').mockImplementation();
      const service = createServiceWithMarketplaceChildren();

      await expect(
        service.navigateToSurface('orchestra-canvas', ['servers']),
      ).resolves.toBe('navigated');

      expect(TestBed.inject(Router).url).toBe('/chat');
    });
  });

  describe('Marketplace redirect probes, real Router (TASK_2026_533 A2, A3)', () => {
    it('A2: the default child redirect injects AppStateManager and restores the remembered page', async () => {
      const probe = await createMarketplaceProbe();
      probe.appState.rememberMarketplaceRoute({
        page: 'servers',
        source: 'smithery',
      });

      const result = await navigateProbe(probe);

      expect(result).toBe('navigated');
      expect(probe.router.url).toBe('/marketplace/servers/smithery');
      expect(probe.service.currentSurface()).toBe('marketplace');
      expect(constructed.serverSource).toBe(1);
    });

    it('A2: with nothing remembered the redirect lands on overview', async () => {
      const probe = await createMarketplaceProbe();

      await expect(navigateProbe(probe)).resolves.toBe('navigated');

      expect(probe.router.url).toBe('/marketplace/overview');
      expect(constructed.overview).toBe(1);
    });

    it('A3: /marketplace while on /marketplace/servers restores in place, re-creating nothing', async () => {
      const probe = await createMarketplaceProbe();
      await navigateProbe(probe, ['servers']);
      // What the shell records on NavigationEnd.
      probe.appState.rememberMarketplaceRoute({ page: 'servers' });
      expect(probe.router.url).toBe('/marketplace/servers');
      expect(constructed).toEqual(
        expect.objectContaining({ shell: 1, installedServers: 1 }),
      );
      const shellElement = probe.harness.routeNativeElement;
      expect(shellElement).not.toBeNull();

      // A bare `setCurrentView('marketplace')` issues exactly this when its
      // re-request rule lets it through (surface unowned or a navigation
      // pending); `App.handleInitialView` issues it directly.
      const result = await navigateProbe(probe);

      // The Router's same-URL skip compares the PRE-redirect URL
      // (`/marketplace`) with the current one, so it does not skip: the
      // redirect runs, lands on the URL already displayed, and reuses every
      // route. Either landed result would be acceptable to callers; this is
      // the one Angular 22 produces.
      expect(result).toBe('navigated');
      expect(probe.router.url).toBe('/marketplace/servers');
      expect(constructed).toEqual({
        shell: 1,
        overview: 0,
        installedServers: 1,
        serverSource: 0,
        installedSkills: 0,
        detail: 0,
      });
      expect(probe.harness.routeNativeElement).toBe(shellElement);
    });

    it('A3: a bare /marketplace navigation keeps the list but closes an open detail', async () => {
      // The shell remembers the PAGE, not the detail, so the redirect lands on
      // the list. The list must be the same instance; the detail closes.
      const probe = await createMarketplaceProbe();
      await navigateProbe(probe, ['servers', 'claude-user:sentry']);
      probe.appState.rememberMarketplaceRoute({ page: 'servers' });
      expect(constructed.detail).toBe(1);

      const result = await navigateProbe(probe);

      expect(['navigated', 'already-there']).toContain(result);
      expect(probe.router.url).toBe('/marketplace/servers');
      expect(constructed.shell).toBe(1);
      expect(constructed.installedServers).toBe(1);
    });

    it('sends an unknown Marketplace child to overview', async () => {
      const probe = await createMarketplaceProbe();

      await expect(navigateProbe(probe, ['nonsense'])).resolves.toBe(
        'navigated',
      );

      expect(probe.router.url).toBe('/marketplace/overview');
    });

    it('restores the remembered page after a workspace switch', async () => {
      // The Marketplace and its page memory are global (TASK_2026_540): a
      // switch while it is open leaves it on screen without navigating, and
      // the next bare /marketplace in ANY workspace restores the same page.
      const probe = await createMarketplaceProbe();
      probe.appState.switchWorkspace('/ws/a');
      await settleProbe(probe);
      probe.appState.setCurrentView('marketplace');
      await settleProbe(probe);
      expect(probe.router.url).toBe('/marketplace/overview');
      // What the shell records on NavigationEnd.
      probe.appState.rememberMarketplaceRoute({ page: 'skills' });

      probe.appState.switchWorkspace('/ws/b');
      await settleProbe(probe);
      expect(probe.router.url).toBe('/marketplace/overview');

      probe.appState.setCurrentView('chat');
      await settleProbe(probe);
      probe.appState.setCurrentView('marketplace');
      await settleProbe(probe);

      expect(probe.router.url).toBe('/marketplace/skills');
      expect(probe.appState.currentView()).toBe('marketplace');
    });
  });
});
