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
 */

import { Location, PlatformLocation } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, take } from 'rxjs';
import { provideSurfaceRouterTesting } from '../../testing';
import { MemoryPlatformLocation } from './memory-platform-location';
import {
  SurfaceRouterService,
  surfaceNavigationLanded,
  type SurfaceNavigationResult,
} from './surface-router.service';
import { SURFACE_ROUTE_IDS } from './surface-routes';

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
});
