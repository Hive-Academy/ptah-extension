import { DestroyRef, Injectable, inject } from '@angular/core';
import { NavigationEnd, PRIMARY_OUTLET, Router } from '@angular/router';
import {
  WEBVIEW_ROUTE_STATE_KEY,
  parseWebviewRouteState,
  type WebviewRouteState,
} from '@ptah-extension/shared';
import { filter } from 'rxjs/operators';
import { VSCodeService } from '../services/vscode.service';
import {
  GENERATION_ROUTE_TAB_VALIDATOR,
  generationRouteBinding,
} from './surface-routes';

/**
 * Persists every URL the Router settles on, so a reloaded or restored webview
 * can return to it (TASK_2026_524, Batch 4).
 *
 * The record is the {@link WebviewRouteState} contract from
 * `@ptah-extension/shared`, written under {@link WEBVIEW_ROUTE_STATE_KEY} into
 * the mergeable `setState` record. The boot path reads it back through
 * `parseWebviewRouteState`, and the VS Code host's panel serializer reads the
 * same key.
 *
 * Only records the shared parser accepts are written, so the stored route is
 * always one a restore can use.
 *
 * Persistence is best effort and never sits in the navigation path: the write
 * happens after `NavigationEnd`, a failed write is logged and dropped, and the
 * write is not awaited (Electron's `setState` is asynchronous IPC — Risk R7).
 */
@Injectable({ providedIn: 'root' })
export class SurfaceRoutePersistence {
  private readonly router = inject(Router);
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly generationRouteTabValidator = inject(
    GENERATION_ROUTE_TAB_VALIDATOR,
    { optional: true },
  );
  private started = false;
  private warnedRejected = false;

  /**
   * Start persisting settled URLs, tagged with `seed` — the raw host
   * `initialView` this webview consumed (`BootPlan.seed`, decision D5).
   *
   * Idempotent: the first call subscribes for the application's lifetime and
   * fixes the seed; later calls are ignored.
   */
  start(seed: string | null): void {
    if (this.started) return;
    this.started = true;
    const persistedSeed = acceptedSeed(seed);

    const subscription = this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
      )
      .subscribe((event) =>
        this.persist(event.urlAfterRedirects, persistedSeed),
      );
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  private persist(route: string, seed: string | null): void {
    // Outside a host (a plain browser) there is nothing to persist into, and
    // `VSCodeService.setState` would warn on every navigation.
    if (!this.vscodeService.isConnected()) return;
    const segments =
      this.router
        .parseUrl(route)
        .root.children[PRIMARY_OUTLET]?.segments.map(
          (segment) => segment.path,
        ) ?? [];
    // Onboarding is never a restore target: the first-run guard on chat
    // redirects there once, and restoring it would reopen it on every boot.
    // Skipping keeps the last route, so the next boot lands on chat.
    if (segments[0] === 'onboarding') return;
    if (segments[0] === 'setup-wizard' && segments[1] === 'generation') {
      const binding = generationRouteBinding(segments);
      if (
        !binding ||
        !this.generationRouteTabValidator?.(binding.tabId, binding.workflow)
      )
        return;
    }

    // Only a record the shared parser accepts is written. `setState` replaces
    // the whole `ptahRoute` entry, so writing a rejected one (a colon in the
    // query, an auxiliary outlet, an over-long URL) would erase the last
    // restorable route; skipping keeps it.
    const state = parseWebviewRouteState({
      [WEBVIEW_ROUTE_STATE_KEY]: {
        v: 1,
        route,
        seed,
        panelId: this.vscodeService.config().panelId ?? '',
      } satisfies WebviewRouteState,
    });
    if (state === null) {
      if (!this.warnedRejected) {
        this.warnedRejected = true;
        console.warn(
          '[SurfaceRoutePersistence] Not persisting a route the restore contract rejects; keeping the last one. Further skips are silent.',
        );
      }
      return;
    }

    try {
      this.vscodeService.setState(WEBVIEW_ROUTE_STATE_KEY, state);
    } catch (error: unknown) {
      // A lost write costs only the next restore; the navigation already
      // landed and must not be affected.
      console.warn(
        '[SurfaceRoutePersistence] Could not persist the route:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/**
 * `seed` as the restore contract will accept it, or `null`.
 *
 * Checked through the shared parser against a minimal valid record, so the
 * 64-character cap (and any later seed rule) is not duplicated here. Without
 * this, an over-long host `initialView` would make every record this webview
 * writes unrestorable.
 *
 * `null` preserves D5: `resolveBootNavigation` lets the host win whenever its
 * non-null `initialView` differs from the saved seed, and every non-null value
 * differs from `null`. The next boot therefore honours the host deep link,
 * exactly as it would with no saved state.
 */
function acceptedSeed(seed: string | null): string | null {
  const probe = parseWebviewRouteState({
    [WEBVIEW_ROUTE_STATE_KEY]: { v: 1, route: '/', seed, panelId: '' },
  });
  return probe === null ? null : seed;
}
