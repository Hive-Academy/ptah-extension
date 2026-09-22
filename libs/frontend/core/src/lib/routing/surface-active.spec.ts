import { Injector, Signal, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideSurfaceRouterTesting,
  settleSurfaceNavigation,
} from '../../testing/surface-router-testing';
import { SURFACE_ACTIVE, provideSurfaceActive } from './surface-active';
import { SurfaceRouterService } from './surface-router.service';

/**
 * `SURFACE_ACTIVE` is the signal a mounted-but-invisible component reads to
 * pause its work. These specs pin the two things a consumer relies on: the
 * default answers for the always-mounted chrome, and it follows the Router
 * rather than a private mirror.
 */
describe('SURFACE_ACTIVE', () => {
  let surfaceRouter: SurfaceRouterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideSurfaceRouterTesting()],
    });
    surfaceRouter = TestBed.inject(SurfaceRouterService);
  });

  describe('the root default — the always-mounted chrome', () => {
    it('is injectable with no route provider at all', () => {
      // The canvas and the transcript sit OUTSIDE the router outlet, so they
      // never see a route's `providers`. If the token had no root factory they
      // would throw on inject, which is the whole reason the default exists.
      expect(() => TestBed.inject(SURFACE_ACTIVE)).not.toThrow();
    });

    it('reports active while the chat surface is addressed', async () => {
      await surfaceRouter.navigateToSurface('chat');
      await settleSurfaceNavigation();

      expect(TestBed.inject(SURFACE_ACTIVE)()).toBe(true);
    });

    it('reports inactive while a standalone surface is addressed', async () => {
      const active = TestBed.inject(SURFACE_ACTIVE);

      await surfaceRouter.navigateToSurface('settings');
      await settleSurfaceNavigation();

      // This is the case that matters: the chrome is still in the DOM and
      // still in change detection, and now it knows it is not being looked at.
      expect(active()).toBe(false);
    });

    it('follows the Router back and forth without a mirror', async () => {
      const active = TestBed.inject(SURFACE_ACTIVE);

      await surfaceRouter.navigateToSurface('marketplace');
      await settleSurfaceNavigation();
      expect(active()).toBe(false);

      await surfaceRouter.navigateToSurface('chat');
      await settleSurfaceNavigation();
      expect(active()).toBe(true);
    });

    it('stays inactive across two different standalone surfaces', async () => {
      const active = TestBed.inject(SURFACE_ACTIVE);

      await surfaceRouter.navigateToSurface('tasks');
      await settleSurfaceNavigation();
      expect(active()).toBe(false);

      await surfaceRouter.navigateToSurface('tribunal');
      await settleSurfaceNavigation();
      expect(active()).toBe(false);
    });
  });

  describe('provideSurfaceActive — one surface id', () => {
    function activeFor(id: Parameters<typeof provideSurfaceActive>[0]) {
      const injector = Injector.create({
        providers: [provideSurfaceActive(id)],
        parent: TestBed.inject(Injector),
      });
      return runInInjectionContext(injector, () =>
        injector.get(SURFACE_ACTIVE),
      ) as Signal<boolean>;
    }

    it('reports active only while its own surface is addressed', async () => {
      const tasksActive = activeFor('tasks');

      await surfaceRouter.navigateToSurface('tasks');
      await settleSurfaceNavigation();
      expect(tasksActive()).toBe(true);

      await surfaceRouter.navigateToSurface('settings');
      await settleSurfaceNavigation();
      expect(tasksActive()).toBe(false);
    });

    it('does not report active for the chat default', async () => {
      const tasksActive = activeFor('tasks');

      await surfaceRouter.navigateToSurface('chat');
      await settleSurfaceNavigation();

      expect(tasksActive()).toBe(false);
    });

    it('overrides the root default rather than sitting beside it', async () => {
      const marketplaceActive = activeFor('marketplace');

      await surfaceRouter.navigateToSurface('marketplace');
      await settleSurfaceNavigation();

      // The root default would say `false` here, because the chrome is hidden.
      // The per-surface binding must win inside its own injector.
      expect(marketplaceActive()).toBe(true);
      expect(TestBed.inject(SURFACE_ACTIVE)()).toBe(false);
    });
  });
});
