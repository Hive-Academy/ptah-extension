import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  input,
  output,
  OnInit,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import { LucideAngularModule, Search } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  McpRegistryEntry,
  McpInstallTarget,
  McpServerConfig,
  InstalledMcpServer,
} from '@ptah-extension/shared';
import {
  CatalogCardComponent,
  CatalogCardSkeletonComponent,
  CatalogGridComponent,
  MonogramTileComponent,
  StorefrontPanelComponent,
  resolveListingBrandSlug,
  type CatalogCardBadge,
} from '@ptah-extension/ui';
// Its own declaration, used only inside @defer: the compiler then emits a
// dynamic import, keeping the vendored logo table out of the eager chunk (R7).
import { BrandMarkComponent } from '@ptah-extension/ui/brand-mark';
import { mcpTargetLabel } from './installed-mcp-groups';

const ALL_TARGETS: McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'copilot',
  'codex',
  'antigravity',
  'opencode',
];

const INSTALLED_BADGE: CatalogCardBadge = {
  label: 'Installed',
  tone: 'success',
};

/** One registry listing, resolved once per list change for the card. */
interface RegistryCardView {
  readonly server: McpRegistryEntry;
  readonly displayName: string;
  /** Version, transport and repository id; blanks are dropped by the card. */
  readonly meta: readonly string[];
  /** Vendor mark only on a catalogue URL or allowlisted namespace, else null. */
  readonly brandSlug: string | null;
  readonly installed: boolean;
}

/**
 * McpDirectoryBrowserComponent - Browse, search and install MCP servers from
 * the Official MCP Registry.
 *
 * A discovery view only (plan C11): what is already installed is listed by the
 * marketplace, so this view keeps no Installed tab and no removal path. It
 * still reads `mcpDirectory:listInstalled` itself, only to badge results that
 * are already installed.
 *
 * Results render as storefront catalog cards (plan C13); the install step for
 * the expanded result is a storefront panel spanning the grid row under it.
 * A result's mark comes from `resolveListingBrandSlug`: a listing's name is
 * chosen by its publisher, so it never earns a vendor mark on its own.
 */
@Component({
  selector: 'ptah-mcp-directory-browser',
  standalone: true,
  imports: [
    LucideAngularModule,
    BrandMarkComponent,
    CatalogCardComponent,
    CatalogCardSkeletonComponent,
    CatalogGridComponent,
    MonogramTileComponent,
    StorefrontPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (error()) {
        <div class="alert alert-error alert-sm py-1 px-2" role="alert">
          <span class="text-xs" data-testid="mcp-error">{{ error() }}</span>
          <button
            class="btn btn-ghost btn-xs"
            (click)="error.set(null)"
            type="button"
          >
            Dismiss
          </button>
        </div>
      }

      <div class="relative">
        <span
          class="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 text-base-content-muted"
          aria-hidden="true"
        >
          <lucide-angular [img]="SearchIcon" class="h-3.5 w-3.5" />
        </span>
        <input
          type="search"
          class="input input-bordered input-sm w-full pl-8 text-xs"
          placeholder="Search MCP servers..."
          [value]="searchQuery()"
          (input)="onSearchInput($event)"
          aria-label="Search MCP servers"
        />
        @if (isSearching()) {
          <span
            class="loading loading-spinner loading-xs absolute right-2.5 top-1/2 -translate-y-1/2"
          ></span>
        }
      </div>

      <section class="space-y-2" aria-labelledby="mcp-registry-results-heading">
        <h2
          id="mcp-registry-results-heading"
          class="text-[11px] font-medium uppercase tracking-wide text-base-content-muted"
        >
          {{ searchQuery() ? 'Search Results' : 'Popular Servers' }}
        </h2>

        @if (isLoadingPopular() && !searchQuery()) {
          <ptah-catalog-grid ariaLabel="MCP servers loading" aria-busy="true">
            @for (i of [1, 2, 3, 4]; track i) {
              <ptah-catalog-card-skeleton role="listitem" />
            }
          </ptah-catalog-grid>
        } @else if (cards().length === 0) {
          <p class="py-4 text-center text-xs text-base-content-muted">
            {{
              searchQuery()
                ? 'No servers found for "' + searchQuery() + '"'
                : 'No servers available'
            }}
          </p>
        } @else {
          <ptah-catalog-grid
            [ariaLabel]="
              searchQuery()
                ? 'MCP server search results'
                : 'Popular MCP servers'
            "
          >
            @for (card of cards(); track card.server.name) {
              <ptah-catalog-card
                role="listitem"
                [heading]="card.displayName"
                [description]="
                  card.server.description || 'No description available'
                "
                [meta]="card.meta"
                [badge]="card.installed ? installedBadge : null"
              >
                @if (card.brandSlug; as slug) {
                  <!-- Deferred: the mark's artwork table is a lazy chunk (R7). -->
                  <span card-mark class="flex">
                    @defer (on immediate) {
                      <ptah-brand-mark
                        [brandSlug]="slug"
                        [label]="card.displayName"
                      />
                    } @placeholder {
                      <ptah-monogram-tile [label]="card.displayName" />
                    } @error {
                      <ptah-monogram-tile [label]="card.displayName" />
                    }
                  </span>
                } @else {
                  <ptah-monogram-tile card-mark [label]="card.displayName" />
                }
                <div card-actions>
                  <button
                    class="btn btn-primary btn-sm"
                    [disabled]="installingServerNames().has(card.server.name)"
                    (click)="toggleInstallPanel(card.server)"
                    type="button"
                    [attr.aria-expanded]="
                      expandedServerName() === card.server.name
                    "
                    [attr.aria-label]="'Install ' + card.displayName"
                  >
                    @if (installingServerNames().has(card.server.name)) {
                      <span class="loading loading-spinner loading-xs"></span>
                    } @else if (expandedServerName() === card.server.name) {
                      Cancel
                    } @else {
                      Install
                    }
                  </button>
                </div>
              </ptah-catalog-card>

              @if (expandedServerName() === card.server.name) {
                <div role="listitem" class="col-span-full">
                  <ptah-storefront-panel
                    [heading]="'Install ' + card.displayName"
                    [subtitle]="card.server.name"
                  >
                    @if (isLoadingDetails()) {
                      <div class="space-y-2" aria-busy="true">
                        <span class="sr-only">Loading server details</span>
                        <div class="skeleton h-8 w-full rounded"></div>
                        <div class="skeleton h-6 w-3/4 rounded"></div>
                      </div>
                    } @else if (suggestedConfig(); as config) {
                      <div class="space-y-3">
                        <div class="space-y-1.5">
                          <p
                            class="text-[11px] font-medium uppercase tracking-wide text-base-content-muted"
                          >
                            Configuration
                          </p>
                          <p
                            class="break-all rounded-lg bg-base-100 p-2 font-mono text-xs"
                          >
                            <span class="badge badge-sm badge-neutral mr-1">{{
                              config.type
                            }}</span>
                            {{ getConfigSummary() }}
                          </p>
                        </div>

                        <fieldset class="space-y-1.5">
                          <legend
                            class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-base-content-muted"
                          >
                            Install to
                          </legend>
                          <div class="flex flex-wrap gap-x-3 gap-y-1">
                            @for (target of allTargets; track target) {
                              <label
                                class="flex cursor-pointer items-center gap-1"
                              >
                                <input
                                  type="checkbox"
                                  class="checkbox checkbox-xs checkbox-primary"
                                  [checked]="selectedTargets().has(target)"
                                  (change)="toggleTarget(target)"
                                />
                                <span class="text-xs">{{
                                  getTargetLabel(target)
                                }}</span>
                              </label>
                            }
                          </div>
                        </fieldset>
                      </div>
                    } @else {
                      <p
                        class="py-2 text-center text-xs text-base-content-muted"
                      >
                        Could not auto-detect configuration for this server.
                      </p>
                    }

                    @if (!isLoadingDetails() && suggestedConfig()) {
                      <div panel-footer>
                        <button
                          class="btn btn-primary btn-sm"
                          [disabled]="
                            selectedTargets().size === 0 ||
                            installingServerNames().has(card.server.name)
                          "
                          (click)="confirmInstall(card.server)"
                          type="button"
                        >
                          @if (installingServerNames().has(card.server.name)) {
                            <span
                              class="loading loading-spinner loading-xs"
                            ></span>
                            Installing...
                          } @else {
                            Install to {{ selectedTargets().size }}
                            {{
                              selectedTargets().size === 1
                                ? 'target'
                                : 'targets'
                            }}
                          }
                        </button>
                      </div>
                    }
                  </ptah-storefront-panel>
                </div>
              }
            }
          </ptah-catalog-grid>
        }
      </section>

      <!-- MCP Registry attribution -->
      <div class="text-[10px] text-base-content-muted text-center pt-1">
        Powered by the
        <a
          href="https://registry.modelcontextprotocol.io"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover"
          >Official MCP Registry</a
        >
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class McpDirectoryBrowserComponent implements OnInit, OnDestroy {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  /** Increment to trigger a reload of the installed servers list */
  readonly refreshTrigger = input(0);

  /** Emitted when a server is successfully installed */
  readonly serverInstalled = output<{
    serverName: string;
    targets: McpInstallTarget[];
  }>();

  /** Lucide icon references */
  protected readonly SearchIcon = Search;
  protected readonly allTargets = ALL_TARGETS;
  protected readonly installedBadge = INSTALLED_BADGE;

  readonly searchQuery = signal('');
  readonly searchResults = signal<McpRegistryEntry[]>([]);
  readonly popularServers = signal<McpRegistryEntry[]>([]);
  /** Installed servers from `mcpDirectory:listInstalled`, for the badges. */
  readonly installedServers = signal<InstalledMcpServer[]>([]);
  readonly isSearching = signal(false);
  readonly isLoadingPopular = signal(false);
  readonly isLoadingDetails = signal(false);
  readonly installingServerNames = signal<Set<string>>(new Set());
  readonly error = signal<string | null>(null);
  readonly expandedServerName = signal<string | null>(null);
  readonly suggestedConfig = signal<McpServerConfig | null>(null);
  readonly selectedTargets = signal<Set<McpInstallTarget>>(
    new Set(ALL_TARGETS),
  );

  readonly displayServers = computed(() =>
    this.searchQuery() ? this.searchResults() : this.popularServers(),
  );

  private readonly installedKeySet = computed(
    () => new Set(this.installedServers().map((s) => s.serverKey)),
  );

  protected readonly cards = computed<RegistryCardView[]>(() => {
    const installed = this.installedKeySet();
    return this.displayServers().map((server) => {
      const transports = server.version_detail?.transports ?? [];
      const version = server.version_detail?.version;
      return {
        server,
        displayName: this.getDisplayName(server.name),
        meta: [
          version ? `v${version}` : '',
          this.getTransportType(server) ?? '',
          server.repository?.id ?? '',
        ],
        brandSlug: resolveListingBrandSlug({
          registryName: server.name,
          remoteUrls: transports
            .map((t) => t.url)
            .filter((url): url is string => !!url),
        }),
        installed: installed.has(this.deriveServerKey(server.name)),
      };
    });
  });

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Re-load installed servers when refreshTrigger changes (skips initial value of 0) */
  private readonly refreshEffect = effect(() => {
    const trigger = this.refreshTrigger();
    if (trigger > 0) {
      this.loadInstalled();
    }
  });

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    this.loadInstalled();
    this.loadPopular();
  }

  ngOnDestroy(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  }

  onSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.searchQuery.set(query);

    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    if (!query.trim()) {
      this.searchResults.set([]);
      this.isSearching.set(false);
      return;
    }

    this.isSearching.set(true);
    this.searchTimeout = setTimeout(() => this.performSearch(query), 300);
  }

  async toggleInstallPanel(server: McpRegistryEntry): Promise<void> {
    if (this.expandedServerName() === server.name) {
      this.expandedServerName.set(null);
      this.suggestedConfig.set(null);
      return;
    }

    this.expandedServerName.set(server.name);
    this.selectedTargets.set(new Set(ALL_TARGETS));
    this.suggestedConfig.set(null);
    if (server.version_detail) {
      this.suggestedConfig.set(this.generateConfig(server));
      return;
    }
    this.isLoadingDetails.set(true);
    try {
      const result = await this.rpcService.call('mcpDirectory:getDetails', {
        name: server.name,
      });

      if (this.destroyed) return;

      if (result.isSuccess() && result.data.version_detail) {
        this.suggestedConfig.set(this.generateConfig(result.data));
      } else {
        this.suggestedConfig.set(null);
      }
    } catch {
      if (this.destroyed) return;
      this.suggestedConfig.set(null);
    } finally {
      if (!this.destroyed) this.isLoadingDetails.set(false);
    }
  }

  toggleTarget(target: McpInstallTarget): void {
    this.selectedTargets.update((set) => {
      const next = new Set(set);
      if (next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
  }

  async confirmInstall(server: McpRegistryEntry): Promise<void> {
    const config = this.suggestedConfig();
    if (!config || this.selectedTargets().size === 0) return;
    if (this.installingServerNames().has(server.name)) return;

    this.addToSet(this.installingServerNames, server.name);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('mcpDirectory:install', {
        serverName: server.name,
        serverKey: this.deriveServerKey(server.name),
        config,
        targets: Array.from(this.selectedTargets()),
      });

      if (this.destroyed) return;

      if (result.isSuccess()) {
        const successes = result.data.results.filter((r) => r.success);
        const failures = result.data.results.filter((r) => !r.success);

        if (successes.length > 0) {
          this.serverInstalled.emit({
            serverName: server.name,
            targets: successes.map((r) => r.target),
          });
          await this.loadInstalled();
          this.expandedServerName.set(null);
          this.suggestedConfig.set(null);
        }

        if (failures.length > 0) {
          this.error.set(
            `Failed for: ${failures
              .map(
                (r) =>
                  `${this.getTargetLabel(r.target)} (${r.error ?? 'unknown error'})`,
              )
              .join(', ')}`,
          );
        }
      } else {
        // A refused install used to leave the panel open and say nothing.
        this.error.set(result.error ?? `Could not install "${server.name}".`);
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Install failed');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.installingServerNames, server.name);
    }
  }

  getDisplayName(name: string): string {
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  }

  getTransportType(server: McpRegistryEntry): string | null {
    const transport = server.version_detail?.transports?.[0];
    return transport?.type || null;
  }

  /** Template-facing alias for the shared label table. */
  getTargetLabel(target: McpInstallTarget): string {
    return mcpTargetLabel(target);
  }

  getConfigSummary(): string {
    const config = this.suggestedConfig();
    if (!config) return '';
    if (config.type === 'stdio') {
      return `${config.command} ${config.args?.join(' ') || ''}`.trim();
    }
    return config.url;
  }

  private deriveServerKey(name: string): string {
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  }

  private generateConfig(entry: McpRegistryEntry): McpServerConfig | null {
    const vd = entry.version_detail;
    if (!vd) return null;

    const stdioTransport = vd.transports.find((t) => t.type === 'stdio');
    const httpTransport = vd.transports.find((t) => t.type === 'http');
    const sseTransport = vd.transports.find((t) => t.type === 'sse');

    if (stdioTransport) {
      const npmPkg = vd.packages.find((p) => p.registry_name === 'npm');
      const pypiPkg = vd.packages.find((p) => p.registry_name === 'pypi');
      const dockerPkg = vd.packages.find((p) => p.registry_name === 'docker');

      if (npmPkg) {
        return { type: 'stdio', command: 'npx', args: ['-y', npmPkg.name] };
      }
      if (pypiPkg) {
        return { type: 'stdio', command: 'uvx', args: [pypiPkg.name] };
      }
      if (dockerPkg) {
        return {
          type: 'stdio',
          command: 'docker',
          args: ['run', '-i', '--rm', dockerPkg.name],
        };
      }
    }

    if (httpTransport?.url) {
      return { type: 'http', url: httpTransport.url };
    }

    if (sseTransport?.url) {
      return { type: 'sse', url: sseTransport.url };
    }

    return null;
  }

  private async performSearch(query: string): Promise<void> {
    this.error.set(null);

    try {
      const result = await this.rpcService.call('mcpDirectory:search', {
        query,
      });

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.searchResults.set(result.data.servers);
      } else {
        this.error.set('Search failed');
        this.searchResults.set([]);
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Search failed');
      this.searchResults.set([]);
    } finally {
      if (!this.destroyed) this.isSearching.set(false);
    }
  }

  private async loadPopular(): Promise<void> {
    this.isLoadingPopular.set(true);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('mcpDirectory:getPopular', {});

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.popularServers.set(result.data.servers);
      } else {
        this.error.set('Failed to load popular MCP servers');
        this.popularServers.set([]);
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Failed to load popular MCP servers');
      this.popularServers.set([]);
    } finally {
      if (!this.destroyed) this.isLoadingPopular.set(false);
    }
  }

  /** Reads the installed servers; only the "Installed" badges consume them. */
  private async loadInstalled(): Promise<void> {
    try {
      const result = await this.rpcService.call(
        'mcpDirectory:listInstalled',
        {},
      );

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.installedServers.set(result.data.servers);
      } else {
        this.error.set(
          result.error ?? 'Could not load the installed MCP servers.',
        );
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Could not load the installed MCP servers.');
    }
  }

  private addToSet(
    sig: ReturnType<typeof signal<Set<string>>>,
    value: string,
  ): void {
    sig.update((s) => new Set([...s, value]));
  }

  private removeFromSet(
    sig: ReturnType<typeof signal<Set<string>>>,
    value: string,
  ): void {
    sig.update((s) => {
      const next = new Set(s);
      next.delete(value);
      return next;
    });
  }
}
