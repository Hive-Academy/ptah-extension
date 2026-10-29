import { Injectable, Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChildrenOutletContexts,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  UrlSerializer,
  type UrlTree,
} from '@angular/router';
import { filter, map } from 'rxjs/operators';
import {
  DEFAULT_SURFACE_ID,
  GENERATION_ROUTE_TAB_VALIDATOR,
  generationRouteBinding,
  isSurfaceRouteId,
  surfaceIdFromSegment,
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
  /** DI seam for main-shell validation of restored generation tab identity. */
  static readonly generationRouteTabValidatorToken =
    GENERATION_ROUTE_TAB_VALIDATOR;
  private readonly router = inject(Router);
  private readonly outletContexts = inject(ChildrenOutletContexts);
  private readonly urlSerializer = inject(UrlSerializer);
  private readonly generationRouteTabValidator = inject(
    GENERATION_ROUTE_TAB_VALIDATOR,
    { optional: true },
  );

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
   * Navigate to `id`'s route, optionally to a child of it.
   *
   * `subPath` is router commands below the surface —
   * `navigateToSurface('marketplace', ['servers', 'smithery'])` lands on
   * `/marketplace/servers/smithery`. The URL is built with
   * `Router.createUrlTree`, never by string concatenation, so a segment that
   * carries `/` or `:` (an external plugin id) is encoded as one segment.
   * Omitting it addresses the surface root, which is what every caller did
   * before sub-paths existed.
   *
   * Never rejects: every outcome is a {@link SurfaceNavigationResult}, so a
   * caller that cannot act on a failure (a navbar click) can fire and forget
   * while `App.handleInitialView` and `HarnessWorkflowMessageHandler` can tell
   * the three interesting cases apart.
   *
   * `extras.replaceUrl` replaces the current history entry instead of pushing
   * one (D6: tab switches replace, surface changes push).
   *
   * `extras.queryParams` is the complete query of the target URL (onboarding
   * carries its hidden `tab`/`run` identity there). It is serialised by the
   * Router, so `already-there` still holds when the current URL carries the
   * same path and query. Like `subPath`, it is dropped when `id` has no route
   * and the call falls back to the default surface.
   */
  async navigateToSurface(
    id: ViewType,
    subPath: readonly string[] = [],
    extras: {
      readonly replaceUrl?: boolean;
      readonly queryParams?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<SurfaceNavigationResult> {
    const target = isSurfaceRouteId(id) ? id : DEFAULT_SURFACE_ID;
    if (target !== id) {
      // The sub-path belonged to the surface that was asked for. Applied under
      // the fallback it would address a child that surface does not have.
      console.warn(
        `[SurfaceRouterService] "${id}" has no route — navigating to "${target}" instead.`,
      );
    }

    // Building the tree is inside the `try` too: `createUrlTree` throws
    // synchronously on commands it cannot resolve, and that must become
    // `failed`, not a rejection.
    try {
      const queryParams = target === id ? extras.queryParams : undefined;
      const targetTree = this.router.createUrlTree(
        ['/', target, ...(target === id ? subPath : [])],
        queryParams ? { queryParams: { ...queryParams } } : undefined,
      );
      return await this.navigateToTree(targetTree, extras.replaceUrl === true);
    } catch (error: unknown) {
      return this.reportFailure(target, error);
    }
  }

  /**
   * Navigate to a whole logical URL — the route a restored webview persisted
   * (`WebviewRouteState.route`).
   *
   * The URL must address a surface: its first primary segment has to be a
   * surface route id as written, not something `surfaceOf` would fall back
   * from. A URL from an older build naming a removed id therefore reports
   * `failed` without navigating, and the boot path falls back to the host's
   * `initialView` (Risk R8) instead of the wildcard silently landing on chat.
   *
   * Parsed with the `UrlSerializer` rather than `Router.parseUrl`, which
   * swallows a malformed URL and returns `/`; here a parse error must become
   * `failed`. Results map exactly as {@link navigateToSurface}'s do, and the
   * method never rejects.
   */
  async navigateToUrl(route: string): Promise<SurfaceNavigationResult> {
    try {
      const targetTree = this.urlSerializer.parse(route);
      const segments =
        targetTree.root.children[PRIMARY_OUTLET]?.segments.map(
          (segment) => segment.path,
        ) ?? [];
      if (segments[0] === 'setup-wizard' && segments[1] === 'generation') {
        const binding = generationRouteBinding(segments);
        if (
          !binding ||
          !this.generationRouteTabValidator?.(binding.tabId, binding.workflow)
        ) {
          return 'failed';
        }
      }
      if (!isSurfaceRouteId(this.firstPrimaryPath(targetTree))) {
        console.warn(
          `[SurfaceRouterService] "${route}" addresses no surface — not navigating.`,
        );
        return 'failed';
      }
      return await this.navigateToTree(targetTree);
    } catch (error: unknown) {
      return this.reportFailure(route, error);
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
    return surfaceIdFromSegment(this.firstPrimaryPath(tree));
  }

  /** The first primary segment's path, without matrix parameters. */
  private firstPrimaryPath(tree: UrlTree): string | undefined {
    const segments =
      tree.root.children[PRIMARY_OUTLET]?.segments ?? tree.root.segments;
    return segments[0]?.path;
  }

  /**
   * Navigate to an already-built tree and name the outcome. Callers wrap this
   * in `try`, because `navigateByUrl` rejects when a lazy chunk fails to load.
   */
  private async navigateToTree(
    targetTree: UrlTree,
    replaceUrl = false,
  ): Promise<SurfaceNavigationResult> {
    // Compared as serialized trees on both sides: `router.url` is the
    // serializer's output for the current tree, so an encoded segment
    // (`external:owner%2Frepo`) matches itself rather than its decoded form.
    const targetUrl = this.router.serializeUrl(targetTree);
    // Read BEFORE navigating: this is the only honest test of "the Router
    // had nothing to do", because after the call `router.url` looks
    // identical whether the navigation was skipped or completed.
    const startedAtTarget = this.router.url === targetUrl;

    // Extras only when replacing, so a pushing call is exactly what it was
    // before the flag existed.
    const navigated = await (replaceUrl
      ? this.router.navigateByUrl(targetTree, { replaceUrl: true })
      : this.router.navigateByUrl(targetTree));
    if (navigated) return 'navigated';
    return startedAtTarget && this.router.url === targetUrl
      ? 'already-there'
      : 'cancelled';
  }

  private reportFailure(
    destination: string,
    error: unknown,
  ): SurfaceNavigationResult {
    console.error(
      `[SurfaceRouterService] Navigation to "${destination}" failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return 'failed';
  }
}
