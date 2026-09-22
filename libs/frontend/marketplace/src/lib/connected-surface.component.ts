import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  type OnInit,
  type WritableSignal,
} from '@angular/core';
import { LucideAngularModule, RefreshCw } from 'lucide-angular';
import {
  ClaudeRpcService,
  PluginCatalogService,
  type MarketplaceSection,
  type MarketplaceSourceId,
} from '@ptah-extension/core';
import {
  groupInstalledServers,
  mcpTargetLabel,
  removeInstalledGroup,
  type InstalledServerGroup,
} from '@ptah-extension/chat-ui';
import type {
  ExternalPluginListing,
  InstalledMcpServer,
  SessionMcpServerEntry,
} from '@ptah-extension/shared';
import { toConnectorRows } from './mcp-connector-rows';

/** What a Connected row represents; drives nothing but the row's test id. */
export type ConnectedRowKind =
  'mcp' | 'ptah-plugin' | 'community-skill' | 'marketplace-plugin';

/** What the row's trailing control does. */
export type ConnectedRemoveAction =
  | {
      kind: 'mcp';
      label: 'Disconnect' | 'Uninstall';
      group: InstalledServerGroup;
    }
  | { kind: 'community-skill'; label: 'Uninstall'; name: string }
  | {
      kind: 'marketplace-plugin';
      label: 'Uninstall';
      listing: ExternalPluginListing;
    }
  | {
      kind: 'navigate';
      label: 'Manage';
      section: MarketplaceSection;
      source: MarketplaceSourceId;
    }
  | { kind: 'blocked'; reason: string };

/** One thing the user currently has connected, installed or enabled. */
export interface ConnectedRow {
  /** Unique across every group; the `@for` track. */
  id: string;
  kind: ConnectedRowKind;
  title: string;
  subtitle?: string;
  /** Where it came from: an origin label, a repo slug, or `Ptah`. */
  origin: string;
  /** Live state, when one is known. Decoration only — never load-bearing. */
  status?: string;
  removeAction: ConnectedRemoveAction;
}

/** The four disjoint groups the Connected view renders. */
export type ConnectedGroupId =
  'apps' | 'plugins' | 'community' | 'marketplaces';

/** One rendered group, with its OWN load state. */
export interface ConnectedGroup {
  id: ConnectedGroupId;
  label: string;
  state: 'loading' | 'ready' | 'error';
  /** A load failure, or an inline removal failure on an otherwise ready group. */
  error?: string;
  rows: readonly ConnectedRow[];
  emptyAction: {
    label: string;
    section: MarketplaceSection;
    source: MarketplaceSourceId;
  };
}

/** Load state of one group, without its rows. */
interface GroupLoad {
  state: 'loading' | 'ready' | 'error';
  error?: string;
}

const LOADING: GroupLoad = { state: 'loading' };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * ConnectedSurfaceComponent — "everything I currently have", in one list.
 *
 * ## One row source per group, four groups, four independent failures
 *
 * The four groups are disjoint by construction (MCP servers, bundled Ptah
 * plugins, skills.sh skills, external marketplace plugins), so nothing is
 * de-duplicated ACROSS them. Within the Apps group `mcpDirectory:listInstalled`
 * is the ONLY row source — it already concatenates harness-config, Claude-user,
 * Smithery and OAuth rows — and `groupInstalledServers` collapses them on
 * `` `${origin} ${serverKey}` ``, the Installed tab's own identity rule. Reading
 * `listSmitheryConnections` or `listOAuthConnected` for ROWS as well would
 * produce duplicates the grouper cannot merge, so they are used here for status
 * DECORATION only, and each failure of a decoration read costs a badge and
 * nothing else.
 *
 * The four loads run under one `Promise.allSettled` and each group owns its own
 * `state`. A failing group renders an inline error and a Retry that re-runs only
 * that group; the other three render their rows. There is deliberately no
 * surface-wide banner and no surface-wide spinner.
 */
@Component({
  selector: 'ptah-connected-surface',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6" data-testid="connected-surface">
      @for (group of groups(); track group.id) {
        <section
          class="rounded-xl border border-base-300/40 bg-base-200/40"
          [attr.data-testid]="'connected-group-' + group.id"
          [attr.aria-busy]="group.state === 'loading'"
        >
          <header
            class="flex items-center gap-2 px-4 py-3 border-b border-base-300/40"
          >
            <h2 class="text-sm font-semibold text-base-content">
              {{ group.label }}
            </h2>
            @if (group.state === 'ready') {
              <span
                class="badge badge-sm badge-ghost tabular-nums"
                [attr.data-testid]="'connected-count-' + group.id"
                >{{ group.rows.length }}</span
              >
            }
          </header>

          @if (group.state === 'loading') {
            <p class="px-4 py-4 text-xs text-base-content-muted">Loading…</p>
          } @else if (group.state === 'error') {
            <div class="px-4 py-4 flex items-start gap-3">
              <p
                class="text-xs text-error flex-1"
                role="alert"
                [attr.data-testid]="'connected-error-' + group.id"
              >
                {{ group.error }}
              </p>
              <button
                type="button"
                class="btn btn-xs btn-ghost gap-1"
                [attr.data-testid]="'connected-retry-' + group.id"
                (click)="retry(group.id)"
              >
                <lucide-angular
                  [img]="RefreshIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
                Retry
              </button>
            </div>
          } @else {
            @if (group.error) {
              <p
                class="mx-4 mt-3 text-xs text-error"
                role="alert"
                [attr.data-testid]="'connected-error-' + group.id"
              >
                {{ group.error }}
              </p>
            }
            @if (group.rows.length === 0) {
              <div class="px-4 py-5 text-center">
                <p class="text-xs text-base-content-muted mb-2">
                  Nothing here yet.
                </p>
                <button
                  type="button"
                  class="btn btn-xs btn-primary"
                  [attr.data-testid]="'connected-empty-' + group.id"
                  (click)="
                    navigate(
                      group.emptyAction.section,
                      group.emptyAction.source
                    )
                  "
                >
                  {{ group.emptyAction.label }}
                </button>
              </div>
            } @else {
              <ul class="divide-y divide-base-300/40">
                @for (row of group.rows; track row.id) {
                  <li
                    class="flex items-center gap-3 px-4 py-3"
                    data-testid="connected-row"
                    [attr.data-row-id]="row.id"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span
                          class="text-sm text-base-content truncate"
                          data-testid="connected-row-title"
                          >{{ row.title }}</span
                        >
                        <span class="badge badge-xs badge-ghost">{{
                          row.origin
                        }}</span>
                        @if (row.status) {
                          <span
                            class="badge badge-xs badge-outline"
                            data-testid="connected-row-status"
                            >{{ row.status }}</span
                          >
                        }
                      </div>
                      @if (row.subtitle) {
                        <p class="text-xs text-base-content-muted mt-0.5">
                          {{ row.subtitle }}
                        </p>
                      }
                    </div>

                    @let action = row.removeAction;
                    @if (action.kind === 'blocked') {
                      <span
                        class="text-[11px] text-base-content-muted max-w-[16rem] text-right"
                        data-testid="removal-blocked"
                        >{{ action.reason }}</span
                      >
                    } @else if (action.kind === 'navigate') {
                      <button
                        type="button"
                        class="btn btn-xs btn-ghost shrink-0"
                        data-testid="connected-manage"
                        [attr.aria-label]="action.label + ' ' + row.title"
                        (click)="navigate(action.section, action.source)"
                      >
                        {{ action.label }}
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="btn btn-xs btn-ghost text-error shrink-0"
                        data-testid="connected-remove"
                        [disabled]="pendingId() === row.id"
                        [attr.aria-label]="action.label + ' ' + row.title"
                        (click)="onRemove(group.id, row)"
                      >
                        {{
                          pendingId() === row.id ? 'Removing…' : action.label
                        }}
                      </button>
                    }
                  </li>
                }
              </ul>
            }
          }
        </section>
      }
    </div>
  `,
})
export class ConnectedSurfaceComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly catalog = inject(PluginCatalogService);

  /** Bumped by the hub after any install/uninstall; `0` is the initial value. */
  public readonly refreshTrigger = input(0);

  /**
   * claude.ai account connectors the hub read off the newest session, already
   * shaped as installed rows. Re-filtered here against THIS surface's own
   * `listInstalled` result so the two reads can never disagree.
   */
  public readonly connectorServers = input<InstalledMcpServer[]>([]);

  /** A removal landed; the hub clears caches and bumps `refreshTrigger`. */
  public readonly contentChanged = output<void>();

  /** "Manage" and the per-group empty states ask the hub to change section. */
  public readonly navigateRequested = output<{
    section: MarketplaceSection;
    source: MarketplaceSourceId;
  }>();

  protected readonly RefreshIcon = RefreshCw;

  /** The row whose removal is in flight, so its button can disable itself. */
  protected readonly pendingId = signal<string | null>(null);

  private readonly appsLoad = signal<GroupLoad>(LOADING);
  private readonly appGroups = signal<readonly InstalledServerGroup[]>([]);
  /** `group.key` → live state text, from the two decoration reads. */
  private readonly appStatuses = signal<ReadonlyMap<string, string>>(new Map());

  private readonly pluginsLoad = signal<GroupLoad>(LOADING);

  private readonly communityLoad = signal<GroupLoad>(LOADING);
  private readonly communityRows = signal<readonly ConnectedRow[]>([]);

  private readonly marketplacesLoad = signal<GroupLoad>(LOADING);
  private readonly marketplacesRows = signal<readonly ConnectedRow[]>([]);

  private destroyed = false;

  /**
   * Per-group load generation. A load captures its generation on entry and
   * publishes nothing if a newer load for the same group started meanwhile, so
   * a Retry racing a `refreshTrigger` reload cannot land out of order.
   */
  private readonly generation: Record<ConnectedGroupId, number> = {
    apps: 0,
    plugins: 0,
    community: 0,
    marketplaces: 0,
  };

  private beginLoad(group: ConnectedGroupId): number {
    return ++this.generation[group];
  }

  private isStale(group: ConnectedGroupId, gen: number): boolean {
    return this.destroyed || this.generation[group] !== gen;
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });
  }

  private readonly appRows = computed<readonly ConnectedRow[]>(() => {
    const statuses = this.appStatuses();
    return this.appGroups().map((group) => this.toAppRow(group, statuses));
  });

  private readonly pluginRows = computed<readonly ConnectedRow[]>(() =>
    this.catalog.enabledPlugins().map((plugin) => ({
      id: `plugin:${plugin.id}`,
      kind: 'ptah-plugin' as const,
      title: plugin.name,
      subtitle: `${plugin.skillCount} skills · ${plugin.commandCount} commands`,
      origin: 'Ptah',
      removeAction: {
        kind: 'navigate' as const,
        label: 'Manage' as const,
        section: 'skills' as const,
        source: 'ptah-plugins' as const,
      },
    })),
  );

  /** The rendered model. One entry per group, each with its own state. */
  public readonly groups = computed<readonly ConnectedGroup[]>(() => [
    {
      id: 'apps',
      label: 'Apps & MCP servers',
      ...this.appsLoad(),
      rows: this.appRows(),
      emptyAction: {
        label: 'Connect an app',
        section: 'apps',
        source: 'connectors',
      },
    },
    {
      id: 'plugins',
      label: 'Ptah plugins',
      ...this.pluginsLoad(),
      rows: this.pluginRows(),
      emptyAction: {
        label: 'Browse Ptah plugins',
        section: 'skills',
        source: 'ptah-plugins',
      },
    },
    {
      id: 'community',
      label: 'Community skills',
      ...this.communityLoad(),
      rows: this.communityRows(),
      emptyAction: {
        label: 'Browse community skills',
        section: 'skills',
        source: 'community',
      },
    },
    {
      id: 'marketplaces',
      label: 'Marketplace plugins',
      ...this.marketplacesLoad(),
      rows: this.marketplacesRows(),
      emptyAction: {
        label: 'Add a marketplace',
        section: 'skills',
        source: 'marketplaces',
      },
    },
  ]);

  /**
   * Reload on every bump AFTER the initial value. `0` is skipped because
   * `ngOnInit` owns the first load — the same convention every sibling surface
   * uses.
   */
  private readonly refreshEffect = effect(() => {
    const trigger = this.refreshTrigger();
    if (trigger === 0) return;
    void this.loadAll();
  });

  public ngOnInit(): void {
    void this.loadAll();
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  private async loadAll(): Promise<void> {
    await Promise.allSettled([
      this.loadApps(),
      this.loadPlugins(),
      this.loadCommunity(),
      this.loadMarketplaces(),
    ]);
  }

  protected retry(group: ConnectedGroupId): void {
    switch (group) {
      case 'apps':
        void this.loadApps();
        return;
      case 'plugins':
        void this.loadPlugins();
        return;
      case 'community':
        void this.loadCommunity();
        return;
      case 'marketplaces':
        void this.loadMarketplaces();
        return;
    }
  }

  private async loadApps(): Promise<void> {
    const gen = this.beginLoad('apps');
    this.appsLoad.set(LOADING);
    try {
      const result = await this.rpc.call('mcpDirectory:listInstalled', {});
      if (this.isStale('apps', gen)) return;
      if (!result.isSuccess()) {
        this.appGroups.set([]);
        this.appsLoad.set({
          state: 'error',
          error: result.error ?? 'Could not read installed MCP servers.',
        });
        return;
      }
      const installed = result.data.servers;
      // Re-derive the connector rows against THIS read's keys rather than
      // trusting the hub's: `groupInstalledServers` keys on origin AND server
      // key, so a connector that also reaches us from disk would otherwise
      // render twice under two origins with two different Remove buttons.
      const entries: SessionMcpServerEntry[] = this.connectorServers().map(
        (row) => ({ name: row.serverKey, status: 'connected' }),
      );
      const connectors = toConnectorRows(
        entries,
        installed.map((server) => server.serverKey),
      );
      const groups = groupInstalledServers([...installed, ...connectors]);
      this.appGroups.set(groups);
      this.appStatuses.set(new Map());
      this.appsLoad.set({ state: 'ready' });
      void this.decorateAppStatuses(groups);
    } catch (error) {
      // degradation-audit: reported — the failure is rendered inline as the
      // group's error state with a Retry button.
      if (this.isStale('apps', gen)) return;
      this.appGroups.set([]);
      this.appsLoad.set({
        state: 'error',
        error: messageOf(error, 'Could not read installed MCP servers.'),
      });
    }
  }

  private async loadPlugins(): Promise<void> {
    const gen = this.beginLoad('plugins');
    this.pluginsLoad.set(LOADING);
    try {
      await this.catalog.ensureLoaded();
      if (this.isStale('plugins', gen)) return;
      this.pluginsLoad.set({ state: 'ready' });
    } catch (error) {
      // degradation-audit: reported — the failure is rendered inline as the
      // group's error state with a Retry button.
      if (this.isStale('plugins', gen)) return;
      this.pluginsLoad.set({
        state: 'error',
        error: messageOf(error, 'Could not read the Ptah plugin catalogue.'),
      });
    }
  }

  private async loadCommunity(): Promise<void> {
    const gen = this.beginLoad('community');
    this.communityLoad.set(LOADING);
    try {
      const result = await this.rpc.call('skillsSh:listInstalled', {});
      if (this.isStale('community', gen)) return;
      if (!result.isSuccess()) {
        this.communityRows.set([]);
        this.communityLoad.set({
          state: 'error',
          error: result.error ?? 'Could not read installed community skills.',
        });
        return;
      }
      this.communityRows.set(
        result.data.skills.map((skill) => ({
          id: `skill:${skill.path}`,
          kind: 'community-skill' as const,
          title: skill.name,
          subtitle: skill.description || undefined,
          origin: skill.source,
          removeAction: {
            kind: 'community-skill' as const,
            label: 'Uninstall' as const,
            name: skill.name,
          },
        })),
      );
      this.communityLoad.set({ state: 'ready' });
    } catch (error) {
      // degradation-audit: reported — the failure is rendered inline as the
      // group's error state with a Retry button.
      if (this.isStale('community', gen)) return;
      this.communityRows.set([]);
      this.communityLoad.set({
        state: 'error',
        error: messageOf(error, 'Could not read installed community skills.'),
      });
    }
  }

  private async loadMarketplaces(): Promise<void> {
    const gen = this.beginLoad('marketplaces');
    this.marketplacesLoad.set(LOADING);
    try {
      const result = await this.rpc.call('plugins:list-marketplaces', {});
      if (this.isStale('marketplaces', gen)) return;
      if (!result.isSuccess()) {
        this.marketplacesRows.set([]);
        this.marketplacesLoad.set({
          state: 'error',
          error:
            result.error ?? 'Could not read installed marketplace plugins.',
        });
        return;
      }
      this.marketplacesRows.set(
        result.data.installed.map((listing) => ({
          id: `external:${listing.id}`,
          kind: 'marketplace-plugin' as const,
          title: listing.name,
          subtitle: listing.installedVersion
            ? `v${listing.installedVersion}`
            : undefined,
          origin: listing.source,
          removeAction: {
            kind: 'marketplace-plugin' as const,
            label: 'Uninstall' as const,
            listing,
          },
        })),
      );
      this.marketplacesLoad.set({ state: 'ready' });
    } catch (error) {
      // degradation-audit: reported — the failure is rendered inline as the
      // group's error state with a Retry button.
      if (this.isStale('marketplaces', gen)) return;
      this.marketplacesRows.set([]);
      this.marketplacesLoad.set({
        state: 'error',
        error: messageOf(
          error,
          'Could not read installed marketplace plugins.',
        ),
      });
    }
  }

  /**
   * Add live state to the Smithery and OAuth rows.
   *
   * Every read here is optional: a failure costs a badge, never a row and never
   * the group's `state`. Nothing here can add or remove a row, so it cannot
   * duplicate anything `listInstalled` already returned.
   */
  private async decorateAppStatuses(
    groups: readonly InstalledServerGroup[],
  ): Promise<void> {
    const statuses = new Map<string, string>();

    const smithery = groups.filter((g) => g.origin === 'smithery');
    if (smithery.length > 0) {
      try {
        const result = await this.rpc.call(
          'mcpDirectory:listSmitheryConnections',
          {},
        );
        if (result.isSuccess()) {
          for (const group of smithery) {
            const match = result.data.connections.find(
              (c) => c.serverKey === group.serverKey,
            );
            if (match) statuses.set(group.key, match.status);
          }
        }
      } catch {
        // Decoration only — no status text is the correct degradation.
      }
    }

    await Promise.all(
      groups
        .filter((g) => g.origin === 'oauth')
        .map(async (group) => {
          try {
            const status = await this.rpc.call('mcpDirectory:oauthStatus', {
              serverKey: group.serverKey,
            });
            if (status.isSuccess()) statuses.set(group.key, status.data.state);
          } catch {
            // Same: silent.
          }
        }),
    );

    if (this.destroyed) return;
    // Only publish if the groups we decorated are still the rendered ones.
    if (this.appGroups() !== groups) return;
    this.appStatuses.set(statuses);
  }

  // ── Rows ───────────────────────────────────────────────────────────────────

  private toAppRow(
    group: InstalledServerGroup,
    statuses: ReadonlyMap<string, string>,
  ): ConnectedRow {
    const targets = group.targets.map(mcpTargetLabel);
    return {
      id: `mcp:${group.key}`,
      kind: 'mcp',
      title: group.serverKey,
      subtitle: targets.length > 0 ? targets.join(', ') : undefined,
      origin: group.originLabel,
      status: statuses.get(group.key),
      removeAction: this.appRemoveAction(group),
    };
  }

  private appRemoveAction(group: InstalledServerGroup): ConnectedRemoveAction {
    switch (group.removal) {
      case 'smithery':
      case 'oauth':
        return { kind: 'mcp', label: 'Disconnect', group };
      case 'ptah-managed':
      case 'direct':
        return { kind: 'mcp', label: 'Uninstall', group };
      case 'none':
        return {
          kind: 'blocked',
          reason:
            group.removalBlockedReason ??
            'Ptah cannot remove this server from here.',
        };
    }
  }

  // ── Removal ────────────────────────────────────────────────────────────────

  protected onRemove(groupId: ConnectedGroupId, row: ConnectedRow): void {
    void this.remove(groupId, row);
  }

  private async remove(
    groupId: ConnectedGroupId,
    row: ConnectedRow,
  ): Promise<void> {
    if (this.pendingId() !== null) return;
    this.pendingId.set(row.id);
    try {
      const failure = await this.performRemoval(row.removeAction);
      if (this.destroyed) return;
      if (failure !== null) {
        this.setGroupError(groupId, failure);
        return;
      }
      this.setGroupError(groupId, undefined);
      // No direct reload here: the hub answers `contentChanged` by bumping
      // `refreshTrigger`, which reloads every group. A second, concurrent
      // single-group load would only race that one.
      this.contentChanged.emit();
    } catch (error) {
      // degradation-audit: reported — the failure is rendered inline as the
      // group's error message; the row stays in place.
      if (this.destroyed) return;
      this.setGroupError(groupId, messageOf(error, 'Removal failed.'));
    } finally {
      if (!this.destroyed) this.pendingId.set(null);
    }
  }

  /** `null` on full success, a user-facing message otherwise. */
  private async performRemoval(
    action: ConnectedRemoveAction,
  ): Promise<string | null> {
    switch (action.kind) {
      case 'mcp':
        return removeInstalledGroup(this.rpc, action.group);

      case 'community-skill': {
        const result = await this.rpc.call('skillsSh:uninstall', {
          name: action.name,
        });
        if (!result.isSuccess()) {
          return result.error ?? `Could not uninstall "${action.name}".`;
        }
        return result.data.success
          ? null
          : (result.data.error ?? `Could not uninstall "${action.name}".`);
      }

      case 'marketplace-plugin': {
        const result = await this.rpc.call('plugins:uninstall-external', {
          pluginId: action.listing.id,
        });
        if (!result.isSuccess()) {
          return (
            result.error ?? `Could not uninstall "${action.listing.name}".`
          );
        }
        return result.data.removed
          ? null
          : `"${action.listing.name}" was already gone; nothing was removed.`;
      }

      case 'navigate':
      case 'blocked':
        // Neither is wired to a Remove button; nothing to do.
        return null;
    }
  }

  private setGroupError(
    groupId: ConnectedGroupId,
    error: string | undefined,
  ): void {
    const load = this.loadSignal(groupId);
    load.update((current) =>
      current.state === 'error' ? current : { state: current.state, error },
    );
  }

  private loadSignal(groupId: ConnectedGroupId): WritableSignal<GroupLoad> {
    switch (groupId) {
      case 'apps':
        return this.appsLoad;
      case 'plugins':
        return this.pluginsLoad;
      case 'community':
        return this.communityLoad;
      case 'marketplaces':
        return this.marketplacesLoad;
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  protected navigate(
    section: MarketplaceSection,
    source: MarketplaceSourceId,
  ): void {
    this.navigateRequested.emit({ section, source });
  }
}
