/**
 * The installed-server rows every servers page renders, read from the two
 * shell-scoped stores (plan C5 → C7). One place builds them, so the list view
 * and the detail show the same status for the same server.
 *
 * `ProviderRow` carries no raw `InstalledServerGroup` (Batch 8 decision): a
 * page that has to act on a server — remove it, list its per-target config
 * paths — looks the group up by `row.ref` with {@link findGroupByRef}.
 */

import { computed, inject, type Signal } from '@angular/core';
import type { InstalledServerGroup } from '@ptah-extension/chat-ui';

import { ConnectorLinksStore } from './connector-links.store';
import { MarketplaceInventoryStore } from './marketplace-inventory.store';
import { toProviderRows, type ProviderRow } from './provider-row';
import { encodeServerRef } from './server-ref';

/**
 * The installed MCP servers as rows, decorated with the active workspace's
 * newest session report and the live OAuth / Smithery state. Reads only: it
 * never calls `ensure()`, so the page decides what loads.
 *
 * Must run in an injection context below the Marketplace shell.
 */
export function injectProviderRows(): Signal<readonly ProviderRow[]> {
  const inventory = inject(MarketplaceInventoryStore);
  const links = inject(ConnectorLinksStore);
  return computed(() =>
    toProviderRows(inventory.installed().data, {
      sessionServers: inventory.newestSessionStatus()?.servers ?? [],
      statusFor: (server) => links.statusFor(server),
      datesFor: (serverKey) => links.datesFor(serverKey),
    }),
  );
}

/** The group behind a row ref, or `null` when it is no longer installed. */
export function findGroupByRef(
  groups: readonly InstalledServerGroup[],
  ref: string | null,
): InstalledServerGroup | null {
  if (ref === null) return null;
  return (
    groups.find(
      (group) =>
        encodeServerRef({
          origin: group.origin,
          serverKey: group.serverKey,
        }) === ref,
    ) ?? null
  );
}
