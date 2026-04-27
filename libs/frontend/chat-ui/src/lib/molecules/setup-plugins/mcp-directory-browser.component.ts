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
import { LucideAngularModule, Search, Check } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  McpRegistryEntry,
  McpInstallTarget,
  McpServerConfig,
  InstalledMcpServer,
} from '@ptah-extension/shared';

/** Grouped installed servers for the Installed tab */
interface InstalledServerGroup {
  key: string;
  servers: InstalledMcpServer[];
  targets: McpInstallTarget[];
}

const ALL_TARGETS: McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'gemini',
  'copilot',
];

const TARGET_LABELS: Record<McpInstallTarget, string> = {
  vscode: 'VS Code',
  claude: 'Claude / Codex',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  copilot: 'Copilot CLI',
};

/**
 * McpDirectoryBrowserComponent - Browse, search, install, and manage MCP servers
 *
 * Mirrors the SkillShBrowserComponent pattern for the Official MCP Registry.
 * Supports multi-target installation (VS Code, Claude, Cursor, Gemini, Copilot).
 *
 * Complexity Level: 2 (Medium - RPC communication + search debounce + install flow + dual views)
 * Patterns: Signal-based state, DaisyUI compact styling, debounced search, inline install panel
 */
@Component({
  selector: 'ptah-mcp-directory-browser',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <!-- View Toggle -->
      <div class="tabs tabs-boxed tabs-xs bg-base-300/50 p-0.5">
        <button
          class="tab tab-xs"
          [class.tab-active]="activeView() === 'browse'"
          (click)="activeView.set('browse')"
          type="button"
        >
          Browse
        </button>
        <button
          class="tab tab-xs"
          [class.tab-active]="activeView() === 'installed'"
          (click)="activeView.set('installed')"
          type="button"
        >
          Installed ({{ installedCount() }})
        </button>
      </div>

      <!-- ===== Browse View ===== -->
      @if (activeView() === 'browse') {
        <!-- Search Input -->
        <div class="relative">
          <lucide-angular
            [img]="SearchIcon"
            class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40"
            aria-hidden="true"
          />
          <input
            type="text"
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

        <!-- Error -->
        @if (error()) {
          <div class="alert alert-error alert-sm py-1 px-2">
            <span class="text-xs">{{ error() }}</span>
            <button
              class="btn btn-ghost btn-xs"
              (click)="error.set(null)"
              type="button"
            >
              Dismiss
            </button>
          </div>
        }

        <!-- Popular / Search Results -->
        <div>
          @if (isLoadingPopular() && !searchQuery()) {
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <div class="skeleton h-16 w-full rounded-lg mb-1.5"></div>
            }
          } @else {
            <div
              class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium"
            >
              {{ searchQuery() ? 'Search Results' : 'Popular Servers' }}
            </div>
            @if (displayServers().length === 0) {
              <div class="text-xs text-base-content/50 text-center py-4">
                {{
                  searchQuery()
                    ? 'No servers found for "' + searchQuery() + '"'
                    : 'No servers available'
                }}
              </div>
            }
            <div class="space-y-1.5">
              @for (server of displayServers(); track server.name) {
                <div
                  class="rounded-lg border border-base-300 bg-base-200/30 hover:bg-base-200/60 transition-colors"
                >
                  <!-- Server Card Row -->
                  <div class="flex items-start gap-2 p-2">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-xs font-medium text-base-content">{{
                          getDisplayName(server.name)
                        }}</span>
                        @if (getTransportType(server); as transport) {
                          <span
                            class="badge badge-xs badge-outline text-[10px]"
                            >{{ transport }}</span
                          >
                        }
                        @if (isServerInstalled(server.name)) {
                          <span
                            class="badge badge-xs badge-success text-[10px] gap-0.5"
                          >
                            <lucide-angular
                              [img]="CheckIcon"
                              class="w-2 h-2"
                              aria-hidden="true"
                            />
                            Installed
                          </span>
                        }
                      </div>
                      <p
                        class="text-[11px] text-base-content/60 leading-relaxed line-clamp-2 mt-0.5"
                      >
                        {{ server.description || 'No description available' }}
                      </p>
                      @if (server.repository?.id) {
                        <span
                          class="text-[10px] text-base-content/40 font-mono"
                          >{{ server.repository?.id }}</span
                        >
                      }
                    </div>
                    <div class="shrink-0">
                      <button
                        class="btn btn-primary btn-xs"
                        [disabled]="installingServerNames().has(server.name)"
                        (click)="toggleInstallPanel(server)"
                        type="button"
                        [attr.aria-label]="
                          'Install ' + getDisplayName(server.name)
                        "
                      >
                        @if (installingServerNames().has(server.name)) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else if (expandedServerName() === server.name) {
                          Cancel
                        } @else {
                          Install
                        }
                      </button>
                    </div>
                  </div>

                  <!-- Inline Install Panel -->
                  @if (expandedServerName() === server.name) {
                    <div class="px-2 pb-2">
                      <div
                        class="p-2 rounded-lg bg-base-300/50 border border-base-300 space-y-2"
                      >
                        @if (isLoadingDetails()) {
                          <div class="skeleton h-8 w-full rounded"></div>
                          <div class="skeleton h-6 w-3/4 rounded"></div>
                        } @else if (suggestedConfig()) {
                          <!-- Config Preview -->
                          <div
                            class="text-[10px] text-base-content/50 uppercase tracking-wide font-medium"
                          >
                            Configuration
                          </div>
                          <div
                            class="text-[11px] bg-base-100 p-1.5 rounded font-mono break-all"
                          >
                            <span class="badge badge-xs badge-neutral mr-1">{{
                              suggestedConfig()!.type
                            }}</span>
                            {{ getConfigSummary() }}
                          </div>

                          <!-- Target Selection -->
                          <div
                            class="text-[10px] text-base-content/50 uppercase tracking-wide font-medium"
                          >
                            Install to
                          </div>
                          <div class="flex flex-wrap gap-x-3 gap-y-1">
                            @for (target of allTargets; track target) {
                              <label
                                class="flex items-center gap-1 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  class="checkbox checkbox-xs checkbox-primary"
                                  [checked]="selectedTargets().has(target)"
                                  (change)="toggleTarget(target)"
                                />
                                <span class="text-[11px]">{{
                                  getTargetLabel(target)
                                }}</span>
                              </label>
                            }
                          </div>

                          <!-- Confirm Install Button -->
                          <button
                            class="btn btn-primary btn-xs w-full"
                            [disabled]="
                              selectedTargets().size === 0 ||
                              installingServerNames().has(server.name)
                            "
                            (click)="confirmInstall(server)"
                            type="button"
                          >
                            @if (installingServerNames().has(server.name)) {
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
                        } @else {
                          <div
                            class="text-xs text-base-content/50 text-center py-2"
                          >
                            Could not auto-detect configuration for this server.
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ===== Installed View ===== -->
      @if (activeView() === 'installed') {
        @if (isLoadingInstalled()) {
          @for (i of [1, 2, 3]; track i) {
            <div class="skeleton h-14 w-full rounded-lg mb-1.5"></div>
          }
        } @else if (installedGroups().length === 0) {
          <div class="text-xs text-base-content/50 text-center py-6">
            <p class="mb-1">No MCP servers installed yet</p>
            <button
              class="btn btn-ghost btn-xs"
              (click)="activeView.set('browse')"
              type="button"
            >
              Browse servers
            </button>
          </div>
        } @else {
          <div class="space-y-1.5">
            @for (group of installedGroups(); track group.key) {
              <div
                class="flex items-start gap-2 p-2 rounded-lg border border-base-300 bg-base-200/30"
              >
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium">{{ group.key }}</div>
                  <div class="flex flex-wrap gap-1 mt-0.5">
                    @for (target of group.targets; track target) {
                      <span class="badge badge-xs badge-outline text-[9px]">{{
                        getTargetLabel(target)
                      }}</span>
                    }
                  </div>
                  <div class="flex items-center gap-1 mt-0.5">
                    <span class="badge badge-xs badge-neutral text-[9px]">{{
                      group.servers[0].config.type
                    }}</span>
                    @if (group.servers[0].managedByPtah) {
                      <span class="text-[9px] text-base-content/40"
                        >managed by Ptah</span
                      >
                    }
                  </div>
                </div>
                <button
                  class="btn btn-ghost btn-xs text-error shrink-0"
                  [disabled]="uninstallingServerKeys().has(group.key)"
                  (click)="uninstallServer(group.key, group.targets)"
                  type="button"
                  [attr.aria-label]="'Remove ' + group.key"
                >
                  @if (uninstallingServerKeys().has(group.key)) {
                    <span class="loading loading-spinner loading-xs"></span>
                  } @else {
                    Remove
                  }
                </button>
              </div>
            }
          </div>
        }
      }

      <!-- MCP Registry attribution -->
      <div class="text-[10px] text-base-content/30 text-center pt-1">
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
  /** Emitted when a server is successfully uninstalled */
  readonly serverUninstalled = output<string>();

  /** Lucide icon references */
  protected readonly SearchIcon = Search;
  protected readonly CheckIcon = Check;
  protected readonly allTargets = ALL_TARGETS;

  // ===== State Signals =====

  readonly searchQuery = signal('');
  readonly searchResults = signal<McpRegistryEntry[]>([]);
  readonly popularServers = signal<McpRegistryEntry[]>([]);
  readonly installedServers = signal<InstalledMcpServer[]>([]);
  readonly isSearching = signal(false);
  readonly isLoadingPopular = signal(false);
  readonly isLoadingInstalled = signal(false);
  readonly isLoadingDetails = signal(false);
  readonly installingServerNames = signal<Set<string>>(new Set());
  readonly uninstallingServerKeys = signal<Set<string>>(new Set());
  readonly error = signal<string | null>(null);
  readonly activeView = signal<'browse' | 'installed'>('browse');

  // Install panel state
  readonly expandedServerName = signal<string | null>(null);
  readonly suggestedConfig = signal<McpServerConfig | null>(null);
  readonly selectedTargets = signal<Set<McpInstallTarget>>(
    new Set(ALL_TARGETS),
  );

  // ===== Computed Signals =====

  readonly installedCount = computed(() => {
    const keys = new Set(this.installedServers().map((s) => s.serverKey));
    return keys.size;
  });

  readonly displayServers = computed(() =>
    this.searchQuery() ? this.searchResults() : this.popularServers(),
  );

  readonly installedGroups = computed<InstalledServerGroup[]>(() => {
    const servers = this.installedServers();
    const map = new Map<string, InstalledMcpServer[]>();
    for (const server of servers) {
      const existing = map.get(server.serverKey) || [];
      existing.push(server);
      map.set(server.serverKey, existing);
    }
    return Array.from(map.entries()).map(([key, grouped]) => ({
      key,
      servers: grouped,
      targets: grouped.map((s) => s.target),
    }));
  });

  private readonly installedKeySet = computed(
    () => new Set(this.installedServers().map((s) => s.serverKey)),
  );

  // ===== Private =====

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // ===== Lifecycle =====

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

  // ===== Event Handlers =====

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
    // Toggle off if already expanded
    if (this.expandedServerName() === server.name) {
      this.expandedServerName.set(null);
      this.suggestedConfig.set(null);
      return;
    }

    this.expandedServerName.set(server.name);
    this.selectedTargets.set(new Set(ALL_TARGETS));
    this.suggestedConfig.set(null);

    // If we already have version_detail, generate config immediately
    if (server.version_detail) {
      this.suggestedConfig.set(this.generateConfig(server));
      return;
    }

    // Otherwise, fetch details from the registry
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
            `Failed for: ${failures.map((r) => `${r.target} (${r.error})`).join(', ')}`,
          );
        }
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Install failed');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.installingServerNames, server.name);
    }
  }

  async uninstallServer(
    serverKey: string,
    targets: McpInstallTarget[],
  ): Promise<void> {
    if (this.uninstallingServerKeys().has(serverKey)) return;

    this.addToSet(this.uninstallingServerKeys, serverKey);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('mcpDirectory:uninstall', {
        serverKey,
        targets,
      });

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.serverUninstalled.emit(serverKey);
        await this.loadInstalled();
      }
    } catch {
      if (this.destroyed) return;
      this.error.set('Uninstall failed');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.uninstallingServerKeys, serverKey);
    }
  }

  // ===== Template Helpers =====

  isServerInstalled(serverName: string): boolean {
    const key = this.deriveServerKey(serverName);
    return this.installedKeySet().has(key);
  }

  getDisplayName(name: string): string {
    // "io.github.user/server-name" → "server-name"
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  }

  getTransportType(server: McpRegistryEntry): string | null {
    const transport = server.version_detail?.transports?.[0];
    return transport?.type || null;
  }

  getTargetLabel(target: McpInstallTarget): string {
    return TARGET_LABELS[target];
  }

  getConfigSummary(): string {
    const config = this.suggestedConfig();
    if (!config) return '';
    if (config.type === 'stdio') {
      return `${config.command} ${config.args?.join(' ') || ''}`.trim();
    }
    // http or sse — both have .url
    return config.url;
  }

  // ===== Private Methods =====

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

    try {
      const result = await this.rpcService.call('mcpDirectory:getPopular', {});

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.popularServers.set(result.data.servers);
      }
    } catch {
      if (this.destroyed) return;
    } finally {
      if (!this.destroyed) this.isLoadingPopular.set(false);
    }
  }

  private async loadInstalled(): Promise<void> {
    this.isLoadingInstalled.set(true);

    try {
      const result = await this.rpcService.call(
        'mcpDirectory:listInstalled',
        {},
      );

      if (this.destroyed) return;

      if (result.isSuccess()) {
        this.installedServers.set(result.data.servers);
      }
    } catch {
      if (this.destroyed) return;
    } finally {
      if (!this.destroyed) this.isLoadingInstalled.set(false);
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
