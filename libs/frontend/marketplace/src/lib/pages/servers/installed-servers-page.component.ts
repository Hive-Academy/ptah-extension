import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Plus } from 'lucide-angular';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import type { ProviderRow } from '../../data/provider-row';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import { injectProviderRows } from '../../data/installed-provider-rows';
import { ProviderListViewComponent } from './provider-list-view.component';

/**
 * Rows a live session reported as connected. Session status reaches a row
 * only from the newest session OF THE ACTIVE WORKSPACE (plan Revision 3), so
 * this never counts another workspace's servers.
 */
export function liveInLastSession(rows: readonly ProviderRow[]): number {
  return rows.filter(
    (row) => row.statusSource === 'session' && row.status === 'connected',
  ).length;
}

/**
 * InstalledServersPageComponent — `/marketplace/servers` (plan C7).
 *
 * A thin page over {@link ProviderListViewComponent}: it owns the one `<h1>`,
 * a one-line summary, and the loads. It ensures exactly the installed slice
 * and the connector links (`listInstalled` plus the OAuth / Smithery reads);
 * nothing else loads here. The origin chips in the filter bar are filters,
 * not navigation. Rows group by origin at the wide tier.
 */
@Component({
  selector: 'ptah-installed-servers-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, ProviderListViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'installed-servers-page' },
  template: `
    <div class="space-y-4 p-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <p
            class="text-[11px] font-semibold uppercase tracking-wider text-secondary"
          >
            Installed
          </p>
          <h1 class="text-xl font-semibold text-base-content">MCP servers</h1>
          <p
            class="text-xs text-base-content-muted"
            aria-live="polite"
            data-testid="servers-summary"
          >
            @if (summary(); as text) {
              {{ text }}
            }
          </p>
        </div>
        <a
          class="btn btn-primary btn-sm gap-1"
          [routerLink]="connectorsLink"
          data-testid="servers-add"
        >
          <lucide-angular
            [img]="AddIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
          Add connection
        </a>
      </header>

      <ptah-provider-list-view
        heading="Installed MCP servers"
        [groupByOrigin]="true"
      />
    </div>
  `,
})
export class InstalledServersPageComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly links = inject(ConnectorLinksStore);
  private readonly rows = injectProviderRows();

  protected readonly AddIcon = Plus;
  protected readonly connectorsLink = marketplaceRouteLink({
    page: 'connectors',
  });

  /**
   * "12 servers · 3 live in last session". The live part appears only while a
   * session of the active workspace has reported; nothing before the slice
   * is ready.
   */
  protected readonly summary = computed((): string | null => {
    if (this.inventory.installed().state !== 'ready') return null;
    const rows = this.rows();
    const count = `${rows.length} ${rows.length === 1 ? 'server' : 'servers'}`;
    if (this.inventory.newestSessionStatus() === null) return count;
    return `${count} · ${liveInLastSession(rows)} live in last session`;
  });

  public constructor() {
    void this.inventory.ensure('installed');
    void this.links.ensure();
  }
}
