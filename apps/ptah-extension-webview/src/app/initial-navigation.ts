import { inject } from '@angular/core';
import { PRIMARY_OUTLET, Router } from '@angular/router';
import {
  AppStateManager,
  SurfaceRoutePersistence,
  SurfaceRouterService,
  VSCodeService,
  resolveBootNavigation,
  surfaceNavigationLanded,
  type SurfaceNavigationResult,
} from '@ptah-extension/core';
import {
  DEFAULT_SURFACE_ID,
  WEBVIEW_ROUTE_STATE_KEY,
  isAcceptedInitialView,
  parseWebviewRouteState,
  resolveSurfaceAlias,
  type ViewType,
  type WebviewRouteState,
} from '@ptah-extension/shared';

/** The globals the host (or a developer in DevTools) sets before bootstrap. */
interface HostWindow {
  initialView?: string;
  ptahConfig?: { initialView?: string | null };
}

/**
 * The application's ONE initial navigation (TASK_2026_524, decision D5).
 *
 * Call in an injection context; the returned function runs the navigation and
 * resolves with the result of the navigation that ended the boot. It never
 * rejects for a restore problem: every path ends on a landed surface, `chat`
 * at worst.
 *
 * `provideRouter` runs with `withDisabledInitialNavigation()`, so nothing has
 * navigated when this runs — deliberately. Without it the Router resolves the
 * empty URL first and a panel opened on `setup-wizard` paints chat before it.
 *
 * **Inputs.** The host injects its deep link before Angular bootstraps as
 * `ptahConfig.initialView` (null on a restored panel); `window.initialView` is
 * the DevTools override. The saved route is the `ptahRoute` record that
 * `SurfaceRoutePersistence` writes, validated by the shared parser. This is
 * the only place any of the three is read.
 *
 * **Precedence** is `resolveBootNavigation`'s: DevTools override, then a host
 * deep link that differs from the saved seed, then the saved route, then the
 * host value (normalised, so an unknown or missing one falls back to `chat`).
 */
export function injectInitialNavigation(): () => Promise<SurfaceNavigationResult> {
  const appState = inject(AppStateManager);
  const vscodeService = inject(VSCodeService);
  const surfaceRouter = inject(SurfaceRouterService);
  const routePersistence = inject(SurfaceRoutePersistence);

  const router = inject(Router);

  // A navigation that did not land while another is in flight was superseded
  // (a host SWITCH_VIEW, say); a fallback now would cancel the newer one.
  const supersededByNewerNavigation = (): boolean =>
    surfaceRouter.pendingSurface() !== null;

  const navigateToBootSurface = async (
    view: ViewType,
  ): Promise<SurfaceNavigationResult> => {
    const result = await surfaceRouter.navigateToSurface(view);
    if (!surfaceNavigationLanded(result)) {
      // `already-there` is a success, so it is not reported.
      console.warn(`Initial navigation to ${view} did not land: ${result}`);
    }
    return result;
  };

  const navigateToHostSurface = async (
    rawView: string | undefined,
  ): Promise<SurfaceNavigationResult> => {
    const targetView = appState.normalizeInitialView(rawView);
    const result = await navigateToBootSurface(targetView);
    // A superseded navigation is left to the newer one, which chat would
    // cancel. The boot does not wait for that navigation, so its outcome
    // belongs to its own caller.
    if (
      surfaceNavigationLanded(result) ||
      targetView === DEFAULT_SURFACE_ID ||
      supersededByNewerNavigation()
    ) {
      return result;
    }
    // Chat is the last resort: if it does not land either, the boot reports
    // that result rather than throwing or trying again.
    return navigateToBootSurface(DEFAULT_SURFACE_ID);
  };

  return async () => {
    const hostWindow = window as unknown as HostWindow;
    const hostInitialView = hostWindow.ptahConfig?.initialView;
    const plan = resolveBootNavigation({
      devToolsOverride: hostWindow.initialView,
      hostInitialView,
      restored: readSavedRoute(vscodeService),
    });

    // Before navigating, so the boot's own NavigationEnd is persisted. The seed
    // is the host deep link, letting the next boot tell a new one from this.
    routePersistence.start(plan.seed);

    if (plan.kind === 'surface') {
      return navigateToHostSurface(plan.rawView);
    }

    // SurfaceRouterService normalizes legacy setup URLs before navigating.
    const result = await surfaceRouter.navigateToUrl(plan.route);
    if (!surfaceNavigationLanded(result)) {
      if (supersededByNewerNavigation()) return result;
      console.warn(
        `[App] Restored route ${plan.route} did not land: ${result}; falling back to the host view.`,
      );
      return navigateToHostSurface(hostInitialView ?? undefined);
    }
    // Landing says only that some route settled. A redirect inside the surface
    // (`/thoth` to `/thoth/memory`) is the restore; the wildcard sending a
    // stale `/settings/obsolete` to `/chat` is not.
    const settledSegment = firstSegmentPath(router, router.url);
    const savedSegment = firstSegmentPath(router, plan.route);
    const plannedSegment = isAcceptedInitialView(savedSegment)
      ? resolveSurfaceAlias(savedSegment)
      : savedSegment;
    if (settledSegment === plannedSegment) return result;
    // A restore that settles on onboarding went through the first-run guard
    // (its only producer), whether `/chat` was restored or a stale route fell
    // through the wildcard to chat. The guard already spent the one-time
    // showing; falling back here would navigate to chat again and hide it.
    if (settledSegment === 'onboarding') return result;
    console.warn(
      `[App] Restored route ${plan.route} settled on ${router.url}; falling back to the host view.`,
    );
    return navigateToHostSurface(hostInitialView ?? undefined);
  };
}

/**
 * The first primary segment's path of `url`, without matrix parameters, query
 * or fragment.
 */
function firstSegmentPath(router: Router, url: string): string | undefined {
  const tree = router.parseUrl(url);
  const segments =
    tree.root.children[PRIMARY_OUTLET]?.segments ?? tree.root.segments;
  return segments[0]?.path;
}

/**
 * The saved route, or `null` when there is none or it falls outside the
 * contract. Saved state is untrusted input, and a failed read only costs the
 * restore.
 */
function readSavedRoute(
  vscodeService: VSCodeService,
): WebviewRouteState | null {
  try {
    return parseWebviewRouteState({
      [WEBVIEW_ROUTE_STATE_KEY]: vscodeService.getState<unknown>(
        WEBVIEW_ROUTE_STATE_KEY,
      ),
    });
  } catch (error: unknown) {
    // degradation-audit: reported — warned below; a failed read only costs the restore.
    // Electron's `getState` is synchronous IPC and can throw.
    console.warn(
      '[App] Could not read the saved route:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
