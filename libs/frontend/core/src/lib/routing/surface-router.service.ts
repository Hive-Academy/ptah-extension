import { Injectable, Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChildrenOutletContexts,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  type UrlTree,
} from '@angular/router';
import { filter, map } from 'rxjs/operators';
import {
  DEFAULT_SURFACE_ID,
  isSurfaceRouteId,
  surfaceIdFromSegment,
  surfaceRoutePath,
  type ViewType,
} from './surface-routes';

/**
 * What happened to a requested surface navigation.
 *
 * A boolean could not carry this. `Router.navigateByUrl` resolves `false` for
 * two unrelated outcomes — a navigation that was **skipped** because the URL is
 * already the current one (Angular's default `onSameUrlNavigation: 'ignore'`),
 * and a navigation that was **cancelled** by a newer one. Forwarding that
 * single `false` made `HarnessWorkflowMessageHandler` tell the user "the
 * harness builder could not be opened" when it was already open and a resume
 * arrived (TASK_2026_524 revision 1, F3).
 *
 * - `navigated` — the Router settled on the requested surface.
 * - `already-there` — the requested surface was already displayed, so the
 *   Router had nothing to do. **This is a success for every caller.**
 * - `cancelled` — a newer navigation superseded this one. The user (or the
 *   host) asked for something else; not an error, and not this request's
 *   business to report.
 * - `failed` — the navigation threw. A rejected lazy chunk fetch lands here.
 *
 * Use {@link surfaceNavigationLanded} rather than comparing members, so a
 * caller cannot accidentally treat `already-there` as a failure again.
 */
export type SurfaceNavigationResult =
  'navigated' | 'already-there' | 'cancelled' | 'failed';

/** Whether the caller's requested surface is the one now displayed. */
export function surfaceNavigationLanded(
  result: SurfaceNavigationResult,
): boolean {
  return result === 'navigated' || result === 'already-there';
}

/**
 * The Router, read and written as a surface id.
 *
 * This is the single owner of "which surface is addressed". `AppStateManager`
 * exposes {@link currentSurface} as its own `currentView` computed and delegates
 * every write here, so the two can no longer disagree — which is exactly what
 * happened while `WebviewNavigationService` kept a private mirror of the view
 * and short-circuited on it (TASK_2026_317).
 *
 * Nothing here touches `window.history`: the application binds
 * `MemoryPlatformLocation` at the `PlatformLocation` seam, so every state change
 * the Router makes lands in memory.
 */
@Injectable({ providedIn: 'root' })
export class SurfaceRouterService {
  private readonly router = inject(Router);
  private readonly outletContexts = inject(ChildrenOutletContexts);

  /**
   * The last URL the Router successfully settled on.
   *
   * `NavigationEnd` only — a cancelled or failed navigation must leave the
   * surface where it was. The initial value is `router.url`, which is `/` under
   * `withDisabledInitialNavigation()` until `App.handleInitialView` seeds the
   * first navigation from the host's `initialView`.
   */
  private readonly settledUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** The surface the Router is currently showing. */
  readonly currentSurface: Signal<ViewType> = computed(() =>
    this.surfaceOf(this.router.parseUrl(this.settledUrl())),
  );

  /**
   * The surface a navigation now in flight is heading for, or `null` when the
   * Router is idle.
   *
   * {@link currentSurface} follows `NavigationEnd`, so it still reports the
   * PREVIOUS surface for as long as a lazy route's chunk is loading. That is
   * deliberate — an optimistic mirror of the view is the TASK_2026_317 bug —
   * but a consumer that wants to know whether the user has already moved on
   * needs the intent, not the settlement. `AppShellComponent`'s post-auth
   * redirect reads this so it cannot cancel a click the user made while
   * `loadAuthStatus()` was still pending (revision 1, F2).
   */
  pendingSurface(): ViewType | null {
    const navigation = this.router.currentNavigation();
    if (navigation === null) return null;
    return this.surfaceOf(navigation.finalUrl ?? navigation.extractedUrl);
  }

  /**
   * Navigate to `id`'s route.
   *
   * Never rejects: every outcome is a {@link SurfaceNavigationResult}, so a
   * caller that cannot act on a failure (a navbar click) can fire and forget
   * while `App.handleInitialView` and `HarnessWorkflowMessageHandler` can tell
   * the three interesting cases apart.
   */
  async navigateToSurface(id: ViewType): Promise<SurfaceNavigationResult> {
    const target = isSurfaceRouteId(id) ? id : DEFAULT_SURFACE_ID;
    if (target !== id) {
      console.warn(
        `[SurfaceRouterService] "${id}" has no route — navigating to "${target}" instead.`,
      );
    }

    const targetUrl = surfaceRoutePath(target);
    // Read BEFORE navigating: this is the only honest test of "the Router had
    // nothing to do", because after the call `router.url` looks identical
    // whether the navigation was skipped or completed.
    const startedAtTarget = this.router.url === targetUrl;

    try {
      const navigated = await this.router.navigateByUrl(targetUrl);
      if (navigated) return 'navigated';
      return startedAtTarget && this.router.url === targetUrl
        ? 'already-there'
        : 'cancelled';
    } catch (error: unknown) {
      console.error(
        `[SurfaceRouterService] Navigation to "${target}" failed:`,
        error instanceof Error ? error.message : String(error),
      );
      return 'failed';
    }
  }

  /**
   * Re-create an open configuration surface with fresh workspace data after a
   * workspace switch.
   *
   * Only the routed component is re-created, at the same URL; child outlets
   * re-activate from their retained contexts. There is no navigation because
   * the destination has not changed, only the workspace data it should read.
   *
   * Callers must skip this call while a navigation is in flight (`pendingSurface()`
   * is non-null): concurrent navigation would tear the re-created component
   * down again, wasting construction and risking a flash and duplicate data fetches.
   *
   * The outlet's `(activate)`/`(deactivate)` outputs fire on every remount,
   * not only on real navigations.
   *
   * Callers must NOT call this synchronously inside `AppStateManager.switchWorkspace`:
   * `workspaceInfo` is set only after the coordinator returns
   * (`electron-layout.service.ts:486-503`). The Electron shell calls this from
   * an effect on `configurationSurfaceRemountTick`, after that update.
   */
  remountActiveSurface(): void {
    const ctx = this.outletContexts.getContext(PRIMARY_OUTLET);
    if (!ctx?.outlet?.isActivated || !ctx.route) return;

    const route = ctx.route;
    const injector = ctx.injector;
    ctx.outlet.deactivate();
    ctx.outlet.activateWith(route, injector);
  }

  /**
   * The surface a `UrlTree` addresses, read through Angular's own URL grammar.
   *
   * String surgery on the URL is not enough: a segment may legally carry
   * matrix parameters (`/settings;panel=auth`), and comparing the raw
   * `settings;panel=auth` against the id list reported `chat` while the Router
   * activated the settings route — so the outlet hid itself while Settings was
   * active (revision 1, F5). `UrlSegment.path` is the segment WITHOUT its
   * parameters, which is exactly the id.
   */
  private surfaceOf(tree: UrlTree): ViewType {
    const segments =
      tree.root.children[PRIMARY_OUTLET]?.segments ?? tree.root.segments;
    return surfaceIdFromSegment(segments[0]?.path);
  }
}
