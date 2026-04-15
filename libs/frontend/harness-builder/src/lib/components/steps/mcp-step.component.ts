/**
 * McpStepComponent
 *
 * Step 5: MCP server configuration. Shows recommended servers based on persona,
 * allows browsing the MCP Registry, lists discovered servers as toggleable
 * cards, and provides an "Add Custom Server" form.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Server,
  Plus,
  X,
  RefreshCw,
  Search,
  Check,
  Sparkles,
} from 'lucide-angular';
import type {
  McpServerEntry,
  McpRegistryEntry,
  McpInstallTarget,
  McpServerConfig,
  McpServerSuggestion,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from '@ptah-extension/core';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { ConfigCardComponent } from '../atoms/config-card.component';

/** A suggestion enriched with registry search results */
interface ResolvedSuggestion {
  suggestion: McpServerSuggestion;
  registryEntry: McpRegistryEntry | null;
  isLoading: boolean;
  isInstalling: boolean;
  installed: boolean;
  error: string | null;
}

const ALL_TARGETS: McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'gemini',
  'copilot',
];

@Component({
  selector: 'ptah-mcp-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, ConfigCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold flex items-center gap-2">
            <lucide-angular
              [img]="ServerIcon"
              class="w-5 h-5 text-primary"
              aria-hidden="true"
            />
            MCP Servers
          </h2>
          <p class="text-sm text-base-content/60 mt-1">
            Configure Model Context Protocol servers. This step is optional.
          </p>
        </div>
        <button
          class="btn btn-ghost btn-sm gap-1"
          (click)="discoverServers()"
          [disabled]="isDiscovering()"
          aria-label="Refresh MCP server discovery"
        >
          @if (isDiscovering()) {
            <span class="loading loading-spinner loading-sm"></span>
          } @else {
            <lucide-angular
              [img]="RefreshCwIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
          }
          Discover
        </button>
      </div>

      @if (discoverError()) {
        <div class="alert alert-error text-xs">
          <span>{{ discoverError() }}</span>
        </div>
      }

      <!-- ===== Recommended for Your Persona ===== -->
      @if (resolvedSuggestions().length > 0) {
        <div>
          <div
            class="text-xs text-base-content/50 uppercase tracking-wide mb-2 font-medium flex items-center gap-1.5"
          >
            <lucide-angular
              [img]="SparklesIcon"
              class="w-3 h-3 text-primary"
              aria-hidden="true"
            />
            Recommended for your persona
          </div>
          <div class="space-y-2">
            @for (
              resolved of resolvedSuggestions();
              track resolved.suggestion.query
            ) {
              <div class="p-3 rounded-lg border border-primary/30 bg-primary/5">
                <div class="flex items-start gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-sm font-medium">{{
                        resolved.suggestion.displayName
                      }}</span>
                      @if (resolved.registryEntry) {
                        <span
                          class="badge badge-xs badge-outline text-[10px]"
                          >{{
                            getRegistryTransport(resolved.registryEntry)
                          }}</span
                        >
                      }
                      @if (resolved.installed) {
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
                    <p class="text-xs text-base-content/60 mt-0.5">
                      {{ resolved.suggestion.reason }}
                    </p>
                    @if (resolved.registryEntry?.description; as description) {
                      <p
                        class="text-[11px] text-base-content/40 mt-0.5 line-clamp-1"
                      >
                        {{ description }}
                      </p>
                    }
                    @if (resolved.error) {
                      <p class="text-[11px] text-error mt-1">
                        {{ resolved.error }}
                      </p>
                    }
                  </div>
                  <div class="shrink-0">
                    @if (resolved.isLoading) {
                      <span class="loading loading-spinner loading-sm"></span>
                    } @else if (resolved.installed) {
                      <span class="text-xs text-success">Done</span>
                    } @else if (resolved.registryEntry) {
                      <button
                        class="btn btn-primary btn-xs"
                        [disabled]="resolved.isInstalling"
                        (click)="
                          installSuggestedServer(resolved.suggestion.query)
                        "
                        type="button"
                      >
                        @if (resolved.isInstalling) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else {
                          Install
                        }
                      </button>
                    } @else {
                      <span class="text-[10px] text-base-content/40"
                        >Not found</span
                      >
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- ===== Browse MCP Registry ===== -->
      <div>
        <div
          class="text-xs text-base-content/50 uppercase tracking-wide mb-2 font-medium"
        >
          Browse MCP Registry
        </div>
        <div class="flex gap-2 mb-2">
          <div class="relative flex-1">
            <lucide-angular
              [img]="SearchIcon"
              class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40"
              aria-hidden="true"
            />
            <input
              type="text"
              class="input input-bordered input-sm w-full pl-8 text-xs"
              placeholder="Search MCP servers..."
              [ngModel]="registrySearchQuery()"
              (ngModelChange)="registrySearchQuery.set($event)"
              (keydown.enter)="searchRegistry()"
              aria-label="Search MCP registry"
            />
          </div>
          <button
            class="btn btn-primary btn-sm"
            (click)="searchRegistry()"
            [disabled]="isSearchingRegistry()"
            aria-label="Search"
          >
            @if (isSearchingRegistry()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular
                [img]="SearchIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
            }
          </button>
        </div>

        @if (registryResults().length > 0) {
          <div class="space-y-1.5 max-h-60 overflow-y-auto">
            @for (server of registryResults(); track server.name) {
              <div
                class="flex items-start gap-2 p-2 rounded-lg border border-base-300 bg-base-200/30"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-xs font-medium">{{
                      getDisplayName(server.name)
                    }}</span>
                    @if (getRegistryTransport(server); as transport) {
                      <span class="badge badge-xs badge-outline text-[10px]">{{
                        transport
                      }}</span>
                    }
                  </div>
                  <p
                    class="text-[11px] text-base-content/60 line-clamp-1 mt-0.5"
                  >
                    {{ server.description || 'No description' }}
                  </p>
                </div>
                <button
                  class="btn btn-primary btn-xs shrink-0"
                  [disabled]="installingRegistryServer() === server.name"
                  (click)="installRegistryServer(server)"
                  type="button"
                >
                  @if (installingRegistryServer() === server.name) {
                    <span class="loading loading-spinner loading-xs"></span>
                  } @else {
                    Install
                  }
                </button>
              </div>
            }
          </div>
        } @else if (registrySearched() && !isSearchingRegistry()) {
          <div class="text-xs text-base-content/50 text-center py-3">
            No servers found. Try a different search term.
          </div>
        }

        @if (registryError()) {
          <div class="alert alert-error alert-sm py-1 px-2 mt-2">
            <span class="text-xs">{{ registryError() }}</span>
          </div>
        }
      </div>

      <!-- ===== Discovered Servers (local) ===== -->
      @if (servers().length > 0) {
        <div>
          <div
            class="text-xs text-base-content/50 uppercase tracking-wide mb-2 font-medium"
          >
            Discovered Servers
          </div>
          <div class="space-y-3">
            @for (server of servers(); track server.name) {
              <ptah-config-card
                [title]="server.name"
                [description]="server.description ?? server.url"
                [enabled]="server.enabled"
                (toggled)="toggleServer(server.name, $event)"
              />
            }
          </div>
        </div>
      }

      <!-- Add Custom Server -->
      <div class="divider text-xs text-base-content/40">Add Custom Server</div>

      @if (!showAddForm()) {
        <button
          class="btn btn-outline btn-sm w-full gap-2"
          (click)="showAddForm.set(true)"
        >
          <lucide-angular [img]="PlusIcon" class="w-4 h-4" aria-hidden="true" />
          Add Custom MCP Server
        </button>
      } @else {
        <div class="card bg-base-200 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-medium text-sm">New MCP Server</h3>
            <button
              class="btn btn-ghost btn-xs btn-circle"
              (click)="showAddForm.set(false)"
              aria-label="Close add form"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="form-control">
            <label class="label py-0" for="server-name">
              <span class="label-text text-xs">Name</span>
            </label>
            <input
              id="server-name"
              type="text"
              class="input input-bordered input-sm"
              placeholder="my-mcp-server"
              [ngModel]="newServerName()"
              (ngModelChange)="newServerName.set($event)"
            />
          </div>

          <div class="form-control">
            <label class="label py-0" for="server-url">
              <span class="label-text text-xs">URL</span>
            </label>
            <input
              id="server-url"
              type="text"
              class="input input-bordered input-sm"
              placeholder="http://localhost:3100"
              [ngModel]="newServerUrl()"
              (ngModelChange)="newServerUrl.set($event)"
            />
          </div>

          <div class="form-control">
            <label class="label py-0" for="server-desc">
              <span class="label-text text-xs">Description (optional)</span>
            </label>
            <input
              id="server-desc"
              type="text"
              class="input input-bordered input-sm"
              placeholder="What this server provides"
              [ngModel]="newServerDescription()"
              (ngModelChange)="newServerDescription.set($event)"
            />
          </div>

          <button
            class="btn btn-primary btn-sm w-full"
            (click)="addCustomServer()"
            [disabled]="!newServerName().trim() || !newServerUrl().trim()"
          >
            Add Server
          </button>
        </div>
      }

      <!-- Summary -->
      <div class="text-xs text-base-content/50 text-right">
        {{ enabledCount() }} of {{ servers().length }} servers enabled
      </div>
    </div>
  `,
})
export class McpStepComponent implements OnInit {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly rpcService = inject(ClaudeRpcService);

  // Icons
  protected readonly ServerIcon = Server;
  protected readonly PlusIcon = Plus;
  protected readonly XIcon = X;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly SearchIcon = Search;
  protected readonly CheckIcon = Check;
  protected readonly SparklesIcon = Sparkles;

  // Local state — discovery
  public readonly isDiscovering = signal(false);
  public readonly discoverError = signal<string | null>(null);

  // Local state — custom server form
  public readonly showAddForm = signal(false);
  public readonly newServerName = signal('');
  public readonly newServerUrl = signal('');
  public readonly newServerDescription = signal('');

  // Local state — registry search
  public readonly registrySearchQuery = signal('');
  public readonly registryResults = signal<McpRegistryEntry[]>([]);
  public readonly isSearchingRegistry = signal(false);
  public readonly registrySearched = signal(false);
  public readonly registryError = signal<string | null>(null);
  public readonly installingRegistryServer = signal<string | null>(null);

  // Local state — resolved suggestions
  public readonly resolvedSuggestions = signal<ResolvedSuggestion[]>([]);

  // Derived from harness state
  public readonly servers = computed(
    () => this.state.config().mcp?.servers ?? [],
  );

  public readonly enabledCount = computed(
    () => this.servers().filter((s) => s.enabled).length,
  );

  public ngOnInit(): void {
    // Auto-discover on first visit if no servers configured
    if (this.servers().length === 0) {
      this.discoverServers();
    }

    // Resolve persona-based MCP suggestions from the registry
    const suggestions = this.state.suggestedMcpServers();
    if (suggestions.length > 0) {
      this.resolveSuggestions(suggestions);
    }
  }

  // ===== Discovery =====

  public async discoverServers(): Promise<void> {
    if (this.isDiscovering()) return;

    this.isDiscovering.set(true);
    this.discoverError.set(null);

    try {
      const response = await this.rpc.discoverMcp();

      const discoveredNames = new Set(response.servers.map((s) => s.name));
      const existingCustomServers = (
        this.state.config().mcp?.servers ?? []
      ).filter((s) => !discoveredNames.has(s.name));
      const mergedServers = [...response.servers, ...existingCustomServers];

      this.state.updateMcp({
        servers: mergedServers,
        enabledTools: this.state.config().mcp?.enabledTools ?? {},
      });
    } catch (err) {
      this.discoverError.set(
        err instanceof Error ? err.message : 'Failed to discover MCP servers',
      );
    } finally {
      this.isDiscovering.set(false);
    }
  }

  public toggleServer(serverName: string, enabled: boolean): void {
    const updated = this.servers().map((s) =>
      s.name === serverName ? { ...s, enabled } : s,
    );
    this.state.updateMcp({
      servers: updated,
      enabledTools: this.state.config().mcp?.enabledTools ?? {},
    });
  }

  // ===== Custom Server =====

  public addCustomServer(): void {
    const name = this.newServerName().trim();
    const url = this.newServerUrl().trim();
    if (!name || !url) return;

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return;
      }
    } catch {
      return;
    }

    const newServer: McpServerEntry = {
      name,
      url,
      description: this.newServerDescription().trim() || undefined,
      enabled: true,
    };

    this.state.updateMcp({
      servers: [...this.servers(), newServer],
      enabledTools: this.state.config().mcp?.enabledTools ?? {},
    });

    this.newServerName.set('');
    this.newServerUrl.set('');
    this.newServerDescription.set('');
    this.showAddForm.set(false);
  }

  // ===== Registry Search =====

  public async searchRegistry(): Promise<void> {
    const query = this.registrySearchQuery().trim();
    if (!query) return;

    this.isSearchingRegistry.set(true);
    this.registryError.set(null);
    this.registrySearched.set(true);

    try {
      const result = await this.rpcService.call('mcpDirectory:search', {
        query,
        limit: 10,
      });

      if (result.isSuccess()) {
        this.registryResults.set(result.data.servers);
      } else {
        this.registryError.set('Search failed');
        this.registryResults.set([]);
      }
    } catch {
      this.registryError.set('Search failed');
      this.registryResults.set([]);
    } finally {
      this.isSearchingRegistry.set(false);
    }
  }

  public async installRegistryServer(server: McpRegistryEntry): Promise<void> {
    if (this.installingRegistryServer()) return;

    this.installingRegistryServer.set(server.name);
    this.registryError.set(null);

    try {
      // Fetch full details if we don't have version_detail
      let entry = server;
      if (!entry.version_detail) {
        const detailResult = await this.rpcService.call(
          'mcpDirectory:getDetails',
          { name: server.name },
        );
        if (detailResult.isSuccess()) {
          entry = detailResult.data;
        }
      }

      const config = this.generateConfig(entry);
      if (!config) {
        this.registryError.set('Could not auto-detect config for this server');
        return;
      }

      const result = await this.rpcService.call('mcpDirectory:install', {
        serverName: server.name,
        serverKey: this.deriveServerKey(server.name),
        config,
        targets: [...ALL_TARGETS],
      });

      if (result.isSuccess()) {
        const failures = result.data.results.filter((r) => !r.success);
        if (failures.length > 0) {
          this.registryError.set(
            `Partial: ${failures.map((r) => r.target).join(', ')} failed`,
          );
        }
      }
    } catch {
      this.registryError.set('Install failed');
    } finally {
      this.installingRegistryServer.set(null);
    }
  }

  // ===== Persona Suggestions =====

  /**
   * Resolve persona MCP suggestions by searching the registry for each one.
   */
  private async resolveSuggestions(
    suggestions: McpServerSuggestion[],
  ): Promise<void> {
    // Initialize with loading state
    this.resolvedSuggestions.set(
      suggestions.map((s) => ({
        suggestion: s,
        registryEntry: null,
        isLoading: true,
        isInstalling: false,
        installed: false,
        error: null,
      })),
    );

    // Resolve each suggestion concurrently
    const resolved = await Promise.all(
      suggestions.map(async (suggestion) => {
        try {
          const result = await this.rpcService.call('mcpDirectory:search', {
            query: suggestion.query,
            limit: 1,
          });

          const entry =
            result.isSuccess() && result.data.servers.length > 0
              ? result.data.servers[0]
              : null;

          return {
            suggestion,
            registryEntry: entry,
            isLoading: false,
            isInstalling: false,
            installed: false,
            error: null,
          } as ResolvedSuggestion;
        } catch {
          return {
            suggestion,
            registryEntry: null,
            isLoading: false,
            isInstalling: false,
            installed: false,
            error: null,
          } as ResolvedSuggestion;
        }
      }),
    );

    this.resolvedSuggestions.set(resolved);
  }

  public async installSuggestedServer(query: string): Promise<void> {
    const current = this.resolvedSuggestions();
    const idx = current.findIndex((r) => r.suggestion.query === query);
    if (idx === -1) return;

    const resolved = current[idx];
    if (!resolved.registryEntry || resolved.isInstalling) return;

    // Set installing state
    this.updateSuggestion(idx, { isInstalling: true, error: null });

    try {
      let entry = resolved.registryEntry;
      if (!entry.version_detail) {
        const detailResult = await this.rpcService.call(
          'mcpDirectory:getDetails',
          { name: entry.name },
        );
        if (detailResult.isSuccess()) {
          entry = detailResult.data;
        }
      }

      const config = this.generateConfig(entry);
      if (!config) {
        this.updateSuggestion(idx, {
          isInstalling: false,
          error: 'Could not auto-detect configuration',
        });
        return;
      }

      const result = await this.rpcService.call('mcpDirectory:install', {
        serverName: entry.name,
        serverKey: this.deriveServerKey(entry.name),
        config,
        targets: [...ALL_TARGETS],
      });

      if (result.isSuccess()) {
        const successes = result.data.results.filter((r) => r.success);
        if (successes.length > 0) {
          this.updateSuggestion(idx, {
            isInstalling: false,
            installed: true,
          });
        } else {
          this.updateSuggestion(idx, {
            isInstalling: false,
            error: 'Install failed for all targets',
          });
        }
      }
    } catch {
      this.updateSuggestion(idx, {
        isInstalling: false,
        error: 'Install failed',
      });
    }
  }

  // ===== Helpers =====

  getDisplayName(name: string): string {
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  }

  getRegistryTransport(server: McpRegistryEntry): string | null {
    return server.version_detail?.transports?.[0]?.type || null;
  }

  private updateSuggestion(
    index: number,
    updates: Partial<ResolvedSuggestion>,
  ): void {
    this.resolvedSuggestions.update((list) =>
      list.map((item, i) => (i === index ? { ...item, ...updates } : item)),
    );
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
}
