import { computed, inject, type Signal } from '@angular/core';
import { MarketplaceInventoryStore } from '../data/marketplace-inventory.store';
import { ConnectorLinksStore } from '../data/connector-links.store';

/**
 * Counts for the nav badges and the status bar. Each is a number only while
 * the slice behind it is `ready`, `null` ("unknown") otherwise.
 */
export interface MarketplaceNavCounts {
  /** Installed MCP server groups (incl. claude.ai connector rows). */
  readonly servers: number | null;
  /** Catalogue connectors whose status is `connected`. */
  readonly connectors: number | null;
  /** Enabled Ptah plugins. */
  readonly plugins: number | null;
  /** Installed skills.sh skills. */
  readonly community: number | null;
  /** Installed external marketplace plugins. */
  readonly marketplaces: number | null;
  /** plugins + community + marketplaces, only when all three are known. */
  readonly skills: number | null;
}

/** Which count a nav item shows beside its label. */
export type MarketplaceNavCountKey = keyof Pick<
  MarketplaceNavCounts,
  'servers' | 'connectors' | 'skills'
>;

/**
 * Derive the nav and status-bar counts from the shell-scoped stores.
 *
 * READ-ONLY by construction: it reads `counts`, `state` and `links` and never
 * calls `ensure()`/`reload()`, so a badge can never be the reason an RPC fires
 * (plan D4 — the zero-RPC rule). Must run in an injection context under the
 * Marketplace shell, which provides both stores.
 */
export function injectMarketplaceNavCounts(): Signal<MarketplaceNavCounts> {
  const inventory = inject(MarketplaceInventoryStore);
  const links = inject(ConnectorLinksStore);
  return computed(() => {
    const counts = inventory.counts();
    const connectors =
      links.state() === 'ready'
        ? [...links.links().values()].filter(
            (link) => link.status === 'connected',
          ).length
        : null;
    const skills =
      counts.plugins !== null &&
      counts.community !== null &&
      counts.marketplaces !== null
        ? counts.plugins + counts.community + counts.marketplaces
        : null;
    return {
      servers: counts.installed,
      connectors,
      plugins: counts.plugins,
      community: counts.community,
      marketplaces: counts.marketplaces,
      skills,
    };
  });
}
