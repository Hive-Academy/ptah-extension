import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CircleAlert, LucideAngularModule, Plus } from 'lucide-angular';
import type {
  CapabilityEntry,
  CapabilityScope,
  CapabilitySourceRef,
} from '@ptah-extension/shared';

import { CapabilityTogglesStore } from '../../data/capability-toggles.store';
import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import {
  filterProviderRows,
  type ProviderFilter,
} from '../../data/provider-filtering';
import type { ProviderRow } from '../../data/provider-row';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import { injectProviderRows } from '../../data/installed-provider-rows';
import {
  CapabilityToggleComponent,
  notEnforcedProviders,
} from '../../ui/capability-toggle.component';
import { ProviderListViewComponent } from './provider-list-view.component';

/**
 * Rows a live session reported as connected. Session status reaches a row
 * only from the newest session OF THE ACTIVE WORKSPACE (plan Revision 3), so
 * this never counts another workspace's servers. The Overview's Apps & MCP
 * servers card uses it too (`pages/overview/overview-page.component.ts`).
 */
export function liveInLastSession(rows: readonly ProviderRow[]): number {
  return rows.filter(
    (row) => row.statusSource === 'session' && row.status === 'connected',
  ).length;
}

// ── Capability display rules (shared with the server detail) ─────────────────

/** The word for a declaration's scope (AC-2.1). */
export const CAPABILITY_SCOPE_LABELS: Readonly<
  Record<CapabilityScope, string>
> = {
  global: 'Global',
  workspace: 'Workspace',
};

const SCOPE_ORDER: readonly CapabilityScope[] = ['global', 'workspace'];

/** What a server's schema size reads as while no figure exists (AC-5.2). */
export const SCHEMA_SIZE_UNKNOWN = 'size unknown';

/**
 * The scope labels of every place a server is declared, global first, each
 * once: "Global", "Workspace", or both when it is declared in both (AC-2.1).
 */
export function capabilityScopeLabels(
  entry: Pick<CapabilityEntry, 'sources'>,
): string[] {
  const scopes = new Set(entry.sources.map((source) => source.scope));
  return SCOPE_ORDER.filter((scope) => scopes.has(scope)).map(
    (scope) => CAPABILITY_SCOPE_LABELS[scope],
  );
}

/** The scope word of one declaration. */
export function declarationScopeLabel(source: CapabilitySourceRef): string {
  return CAPABILITY_SCOPE_LABELS[source.scope];
}

/** The name a declaration is shown under: its short label, else its path. */
export function declarationName(source: CapabilitySourceRef): string {
  const label = source.label?.trim() ?? '';
  return label.length > 0 ? label : source.path;
}

/**
 * The tool-schema size of one server. A figure only when the backend measured
 * one, labelled as an estimate with its method (AC-5.1); otherwise
 * {@link SCHEMA_SIZE_UNKNOWN}, never zero (AC-5.2). An absent entry (the
 * capability read failed or has not landed) is unknown too.
 */
export function schemaSizeText(
  entry: Pick<CapabilityEntry, 'schemaTokens'> | null | undefined,
): string {
  const tokens = entry?.schemaTokens;
  if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) {
    return SCHEMA_SIZE_UNKNOWN;
  }
  return `about ${formatTokens(tokens)} tokens of tool schemas per request (estimated from its tool list)`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  const thousands = Math.round(tokens / 100) / 10;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
}

/**
 * The "Not enforced for …" note of MCP toggles, from `CAPABILITY_ENFORCEMENT`
 * only (AC-4.8, A-UI); `null` once every provider enforces them. The same for
 * every MCP item, so a list prints it once.
 */
export function mcpNotEnforcedNote(): string | null {
  const providers = notEnforcedProviders({ kind: 'mcp' });
  return providers.length === 0
    ? null
    : `Not enforced for ${providers.join(', ')}`;
}

/** An installed server name the capability state has no row for. */
export interface UnmanagedServer {
  readonly serverKey: string;
  readonly title: string;
}

/** What the "Use in sessions" panel shows under the list's current filter. */
export interface CapabilityPanelLines {
  /** MCP capability rows to show a switch for, in resolver order. */
  readonly entries: readonly CapabilityEntry[];
  /** Installed names with no capability row, so no switch (one per name). */
  readonly unmanaged: readonly UnmanagedServer[];
  /** A search or facet filter is narrowing the lines. */
  readonly filtered: boolean;
}

/**
 * The panel lines for the list's active filter. Rows join capability rows by
 * name: `ProviderRow.serverKey` and `CapabilityEntry.id` are both the server
 * name exactly as declared (the resolver reads the same declarations), and a
 * name installed in two places is one capability row.
 *
 * - No filter: every MCP capability row, plus each installed name that has
 *   none.
 * - A filter: a capability row whose name has an installed row shows when one
 *   of those rows passes the filter. A row with no installed row (Ptah's own
 *   server, a repository-only server) can only be judged by its name, so it
 *   shows when every search term is in its name and no origin, target or
 *   status facet is set. Installed names without a capability row follow the
 *   filtered rows.
 */
export function capabilityPanelLines(
  entries: readonly CapabilityEntry[],
  rows: readonly ProviderRow[],
  filter: ProviderFilter,
): CapabilityPanelLines {
  const terms = (filter.search ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const facets = !!filter.origin || !!filter.target || !!filter.status;
  const filtered = terms.length > 0 || facets;
  const visibleRows = filtered ? filterProviderRows(rows, filter) : rows;
  const visibleKeys = new Set(visibleRows.map((row) => row.serverKey));
  const installedKeys = new Set(rows.map((row) => row.serverKey));

  const mcp = entries.filter((entry) => entry.kind === 'mcp');
  const shown = mcp.filter((entry) => {
    if (!filtered) return true;
    if (installedKeys.has(entry.id)) return visibleKeys.has(entry.id);
    const name = `${entry.label}\n${entry.id}`.toLowerCase();
    return !facets && terms.every((term) => name.includes(term));
  });

  const known = new Set(mcp.map((entry) => entry.id));
  const unmanaged: UnmanagedServer[] = [];
  const seen = new Set<string>();
  for (const row of visibleRows) {
    if (known.has(row.serverKey) || seen.has(row.serverKey)) continue;
    seen.add(row.serverKey);
    unmanaged.push({ serverKey: row.serverKey, title: row.title });
  }
  return { entries: shown, unmanaged, filtered };
}

/**
 * InstalledServersPageComponent — `/marketplace/servers` (plan C7, C10).
 *
 * A thin page over {@link ProviderListViewComponent}: it owns the one `<h1>`,
 * a one-line summary, and the loads. It ensures exactly the installed slice,
 * the connector links (`listInstalled` plus the OAuth / Smithery reads) and
 * the capability state (`capabilities:getState`); nothing else loads here.
 * The origin chips in the filter bar are filters, not navigation. Rows group
 * by origin at the wide tier.
 *
 * ## Session access (TASK_2026_560)
 *
 * Under the rows, projected into the list column, one line per MCP server the
 * capability store knows: its scope labels, where it is declared, its schema
 * size and a workspace toggle. Every toggle here writes THIS workspace only
 * (AC-2.3); the global control lives in the server detail. The store's rows,
 * not the installed rows, drive it: Ptah's own server and a server declared
 * only by the repository have no installed row but still have a switch, and an
 * installed name the store has no row for gets a line saying it has no
 * switch. The panel narrows with the list's filter
 * ({@link capabilityPanelLines}) and prints the "Not enforced for …" note once.
 * The capability read failing leaves the installed list untouched (AC-5.2).
 */
@Component({
  selector: 'ptah-installed-servers-page',
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    ProviderListViewComponent,
    CapabilityToggleComponent,
  ],
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
      >
        <section
          class="space-y-2 rounded-lg border border-base-300 bg-base-100 p-3"
          aria-labelledby="server-capabilities-heading"
          data-testid="server-capabilities"
          [attr.data-state]="capabilities.state()"
        >
          <div class="space-y-0.5">
            <h2
              id="server-capabilities-heading"
              class="text-sm font-semibold text-base-content"
            >
              Use in sessions
            </h2>
            <p class="text-xs text-base-content-muted">
              Which MCP servers new sessions in this workspace start with.
            </p>
            @if (notEnforcedNote; as note) {
              <p
                class="text-[11px] text-base-content-muted"
                data-testid="capability-not-enforced"
              >
                {{ note }}
              </p>
            }
          </div>

          @switch (capabilities.state()) {
            @case ('error') {
              <div
                role="alert"
                class="flex flex-wrap items-center gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-base-content"
                data-testid="server-capabilities-error"
              >
                <span class="inline-flex text-error" aria-hidden="true">
                  <lucide-angular [img]="ErrorIcon" class="h-3.5 w-3.5" />
                </span>
                <p class="min-w-0 flex-1">
                  {{ capabilities.loadError() }}. The server list above is
                  unaffected.
                </p>
                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  data-testid="server-capabilities-retry"
                  (click)="reloadCapabilities()"
                >
                  Retry
                </button>
              </div>
            }
            @case ('ready') {
              @if (panel().filtered) {
                <p
                  class="text-[11px] text-base-content-muted"
                  data-testid="server-capabilities-filtered"
                >
                  Showing the servers that match the filters above.
                </p>
              }
              <ul class="divide-y divide-base-300" aria-label="MCP servers">
                @for (entry of panel().entries; track entry.id) {
                  <li
                    class="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    data-testid="server-capability-row"
                    [attr.data-capability-id]="entry.id"
                  >
                    <div class="min-w-0 space-y-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span
                          class="truncate text-sm font-medium text-base-content"
                          [attr.title]="entry.label"
                          >{{ entry.label }}</span
                        >
                        @for (scope of scopeLabels(entry); track scope) {
                          <span
                            class="badge badge-ghost badge-sm"
                            data-testid="capability-scope-label"
                            >{{ scope }}</span
                          >
                        }
                      </div>
                      @if (entry.sources.length > 0) {
                        <ul class="space-y-0.5" aria-label="Declared in">
                          @for (
                            source of entry.sources;
                            track source.scope + source.path
                          ) {
                            <li
                              class="break-all font-mono text-[11px] text-base-content-muted"
                              data-testid="capability-declaration"
                              [attr.data-scope]="source.scope"
                              [attr.title]="source.path"
                            >
                              {{ scopeLabel(source) }} ·
                              {{ declarationName(source) }}
                            </li>
                          }
                        </ul>
                      }
                      <p
                        class="text-[11px] text-base-content-muted"
                        data-testid="capability-size"
                      >
                        Tool schemas: {{ sizeText(entry) }}
                      </p>
                    </div>
                    <ptah-capability-toggle
                      data-testid="server-capability-toggle-workspace"
                      [entry]="entry"
                      scope="workspace"
                      [pending]="capabilities.isPending(entry)"
                      [error]="capabilities.errorFor(entry)"
                      [showNotEnforced]="false"
                      (toggled)="setWorkspaceEnabled(entry, $event)"
                    />
                  </li>
                }
                @for (server of panel().unmanaged; track server.serverKey) {
                  <li
                    class="grid gap-1 py-2.5"
                    data-testid="server-capability-unmanaged"
                    [attr.data-server-key]="server.serverKey"
                  >
                    <span
                      class="truncate text-sm font-medium text-base-content"
                      [attr.title]="server.title"
                      >{{ server.title }}</span
                    >
                    <p class="text-[11px] text-base-content-muted">
                      No switch: Ptah's session settings don't list this server
                      name, so Ptah can't turn it on or off here.
                    </p>
                  </li>
                }
                @if (
                  panel().entries.length === 0 && panel().unmanaged.length === 0
                ) {
                  <li
                    class="py-2 text-xs text-base-content-muted"
                    data-testid="server-capabilities-empty"
                  >
                    {{
                      panel().filtered
                        ? 'No servers here match the filters above.'
                        : 'No MCP servers are declared for this workspace.'
                    }}
                  </li>
                }
              </ul>
            }
            @default {
              <div
                role="status"
                aria-busy="true"
                class="space-y-2"
                data-testid="server-capabilities-loading"
              >
                <span class="sr-only">Loading on/off settings…</span>
                <div
                  class="skeleton h-4 w-1/2 rounded"
                  aria-hidden="true"
                ></div>
                <div
                  class="skeleton h-4 w-1/3 rounded"
                  aria-hidden="true"
                ></div>
              </div>
            }
          }
        </section>
      </ptah-provider-list-view>
    </div>
  `,
})
export class InstalledServersPageComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly links = inject(ConnectorLinksStore);
  protected readonly capabilities = inject(CapabilityTogglesStore);
  private readonly rows = injectProviderRows();

  protected readonly AddIcon = Plus;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly connectorsLink = marketplaceRouteLink({
    page: 'connectors',
  });

  protected readonly scopeLabels = capabilityScopeLabels;
  protected readonly scopeLabel = declarationScopeLabel;
  protected readonly declarationName = declarationName;
  protected readonly sizeText = schemaSizeText;
  protected readonly notEnforcedNote = mcpNotEnforcedNote();

  private readonly listView = viewChild(ProviderListViewComponent);

  /** The panel narrows with the list's own search and facet filter. */
  protected readonly panel = computed(() =>
    capabilityPanelLines(
      this.capabilities.entries(),
      this.rows(),
      this.listView()?.activeFilter() ?? {},
    ),
  );

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
    void this.capabilities.ensure();
  }

  /** A row toggle: this workspace only, never the global layer (AC-2.3). */
  protected setWorkspaceEnabled(
    entry: CapabilityEntry,
    enabled: boolean,
  ): void {
    void this.capabilities.setEnabled(entry, 'workspace', enabled);
  }

  protected reloadCapabilities(): void {
    void this.capabilities.reload();
  }
}
