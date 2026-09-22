import { PlatformLocation } from '@angular/common';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  withComponentInputBinding,
  withDisabledInitialNavigation,
  type Routes,
} from '@angular/router';
import { MemoryPlatformLocation } from '../lib/routing/memory-platform-location';
import {
  DEFAULT_SURFACE_ID,
  SURFACE_ROUTE_IDS,
} from '../lib/routing/surface-routes';

/**
 * A component-less route per surface id, plus the two fallbacks the real table
 * carries.
 *
 * Built from `SURFACE_ROUTE_IDS`, the same constant
 * `apps/ptah-extension-webview/src/app/app.routes.ts` is built from, so a spec
 * can never navigate to a surface the application cannot reach — or fail to
 * reach one it can. The route COMPONENTS are deliberately absent: a unit spec
 * asserting where navigation landed has no business instantiating the
 * marketplace hub to find out.
 */
export function surfaceTestRoutes(): Routes {
  return [
    ...SURFACE_ROUTE_IDS.map((id) => ({ path: id, children: [] })),
    { path: '', pathMatch: 'full' as const, redirectTo: DEFAULT_SURFACE_ID },
    { path: '**', redirectTo: DEFAULT_SURFACE_ID },
  ];
}

/**
 * Wire the Router the way the webview wires it, for any spec that touches the
 * current surface.
 *
 * Needed by anything that reads `AppStateManager.currentView()` or calls
 * `setCurrentView` / `navigateToSurface`, because the Router — not a signal
 * write — is what answers those now. Without it a `TestBed` gets a Router with
 * an empty route table, every navigation fails to match, and the surface never
 * changes.
 *
 * `MemoryPlatformLocation` is included rather than left to jsdom's `history` on
 * purpose: the test environment should exercise the same seam production does,
 * and `memory-platform-location.spec.ts` pins that `window.history` is never
 * called through it.
 *
 * Navigation is asynchronous, so a spec must `await` it — see
 * {@link settleSurfaceNavigation} for the one rule about how.
 *
 * The Router features match `app.config.ts` exactly, so a spec cannot pass
 * under a configuration production does not use. One caveat:
 * `withDisabledInitialNavigation()` wires `setUpLocationChangeListener()`
 * through an app initializer, and a bare `TestBed` does not run app
 * initializers — a spec that exercises `Location.back()` / `.forward()` has to
 * call `TestBed.inject(Router).setUpLocationChangeListener()` itself.
 */
export function provideSurfaceRouterTesting(): (
  Provider | EnvironmentProviders
)[] {
  return [
    { provide: PlatformLocation, useClass: MemoryPlatformLocation },
    provideRouter(
      surfaceTestRoutes(),
      withComponentInputBinding(),
      withDisabledInitialNavigation(),
    ),
  ];
}

/**
 * Let a surface navigation land, and flush the effects that follow it.
 *
 * **The rule, and there is only one.** A spec that HAS a component fixture
 * awaits `fixture.whenStable()` — the fixture owns change detection, and
 * calling `TestBed.tick()` underneath it raises
 * `NG0101: ApplicationRef.tick is called recursively`. A spec with NO fixture
 * (every service spec) awaits this helper, because nothing else will ever run
 * a change-detection pass and `AppStateManager`'s surface-recording effect
 * would stay pending for ever.
 *
 * It lives here rather than being re-declared per spec file so the rule has one
 * place to be written down (TASK_2026_524 revision 1, author's risk 7).
 *
 * The macrotask tick is what `Router.navigateByUrl` needs to settle over the
 * component-less routes {@link surfaceTestRoutes} installs; `TestBed.tick()` is
 * what flushes the effect afterwards.
 */
export async function settleSurfaceNavigation(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}
