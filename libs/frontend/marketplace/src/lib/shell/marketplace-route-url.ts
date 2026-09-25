/**
 * Marketplace route ↔ router URL, for the shell pieces that sit on the router.
 *
 * Core's `marketplace-route.ts` maps a `MarketplaceRoute` to commands RELATIVE
 * to the Marketplace; this file adds the surface prefix both ways — absolute
 * link commands for the nav and breadcrumb, and URL parsing for the shell's
 * `NavigationEnd` route memory — so the prefix is spelt out once.
 */

import { PRIMARY_OUTLET, type Router } from '@angular/router';
import {
  marketplaceRouteCommands,
  marketplaceRouteFromSegments,
  type MarketplaceRoute,
} from '@ptah-extension/core';
import type { ViewType } from '@ptah-extension/shared';

/** The surface id the Marketplace is mounted under (`/marketplace/...`). */
export const MARKETPLACE_SURFACE: ViewType = 'marketplace';

/** Absolute router commands for `route` (`['/', 'marketplace', ...]`). */
export function marketplaceRouteLink(route: MarketplaceRoute): string[] {
  return ['/', MARKETPLACE_SURFACE, ...marketplaceRouteCommands(route)];
}

/**
 * The Marketplace page a URL addresses, or `null` for a URL outside the
 * Marketplace (or one no page matches). A detail id is dropped: the page it
 * sits on is the answer.
 */
export function marketplaceRouteOfUrl(
  router: Router,
  url: string,
): MarketplaceRoute | null {
  const segments =
    router.parseUrl(url).root.children[PRIMARY_OUTLET]?.segments ?? [];
  if (segments[0]?.path !== MARKETPLACE_SURFACE) return null;
  return marketplaceRouteFromSegments(
    segments.slice(1).map((segment) => segment.path),
  );
}
