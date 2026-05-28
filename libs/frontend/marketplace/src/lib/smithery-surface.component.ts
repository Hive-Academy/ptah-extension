import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  input,
  output,
  OnInit,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import {
  LucideAngularModule,
  Search,
  Check,
  ShieldCheck,
  BadgeCheck,
  KeyRound,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { JsonSchemaFormComponent, JsonSchemaObject } from '@ptah-extension/ui';
import type {
  McpRegistryEntry,
  McpRegistryConnection,
} from '@ptah-extension/shared';

/**
 * SmitherySurfaceComponent — the Smithery provider surface mounted by the
 * Marketplace hub for the `smithery` descriptor.
 *
 * Lifecycle / graceful degradation:
 *  - On mount it resolves `mcpDirectory:getSmitheryKeyStatus`. When the key is
 *    NOT configured it renders an API-key entry prompt and fires NO browse RPC.
 *  - Saving a key writes via `mcpDirectory:setSmitheryApiKey`, then re-checks
 *    status and (on success) loads the popular list.
 *  - All browse RPCs (`search`/`getPopular`/`getDetails`) carry `source:'smithery'`.
 *  - Install resolves details, renders {@link JsonSchemaFormComponent} when the
 *    connection carries a `configSchema` with properties (else one-click), then
 *    calls `mcpDirectory:resolveSmithery`. Resolve success/error is surfaced
 *    in-view — no blank screen / unhandled rejection.
 *
 * The hub already gates the whole view on premium; this surface only mounts for
 * premium users. As a defensive measure it still refuses to fire any RPC unless
 * key status has been resolved.
 *
 * Complexity Level: 3 — key-gate state machine + browse + per-server config form
 * + resolve flow. Patterns: signal state, debounced search, DaisyUI cards.
 */
@Component({
  selector: 'ptah-smithery-surface',
  standalone: true,
  imports: [LucideAngularModule, JsonSchemaFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (keyStatus() === 'unknown') {
        <!-- Resolving key status: neutral loading, browse RPC withheld. -->
        <div class="flex items-center justify-center py-8">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      } @else if (keyStatus() === 'not-configured') {
        <!-- Connect prompt: enter an API key before any browse RPC fires. -->
        <div
          class="rounded-lg border border-base-300 bg-base-200/40 p-4 space-y-3"
        >
          <div class="flex items-center gap-2">
            <div
              class="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0"
            >
              <lucide-angular
                [img]="KeyRoundIcon"
                class="w-4 h-4 text-primary"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-base-content">
                Connect Smithery
              </h3>
              <p class="text-[11px] text-base-content/50">
                Enter a Smithery API key to browse and install hosted MCP
                servers.
              </p>
            </div>
          </div>

          @if (keyError()) {
            <div class="alert alert-error alert-sm py-1 px-2">
              <span class="text-xs">{{ keyError() }}</span>
            </div>
          }

          <form class="space-y-2" (submit)="saveKey($event)">
            <input
              type="password"
              autocomplete="off"
              class="input input-bordered input-sm w-full text-xs"
              placeholder="Smithery API key"
              [value]="keyInput()"
              (input)="onKeyInput($event)"
              aria-label="Smithery API key"
            />
            <button
              type="submit"
              class="btn btn-primary btn-sm w-full"
              [disabled]="isSavingKey() || keyInput().trim().length === 0"
            >
              @if (isSavingKey()) {
                <span class="loading loading-spinner loading-xs"></span>
                Connecting...
              } @else {
                Connect
              }
            </button>
          </form>
          <p class="text-[10px] text-base-content/30 text-center">
            Your key is stored encrypted by Ptah and never leaves your machine.
          </p>
        </div>
      } @else {
        <!-- Configured: browse Smithery servers. -->
        <div class="relative">
          <lucide-angular
            [img]="SearchIcon"
            class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40"
            aria-hidden="true"
          />
          <input
            type="text"
            class="input input-bordered input-sm w-full pl-8 text-xs"
            placeholder="Search Smithery servers..."
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            aria-label="Search Smithery servers"
          />
          @if (isSearching()) {
            <span
              class="loading loading-spinner loading-xs absolute right-2.5 top-1/2 -translate-y-1/2"
            ></span>
          }
        </div>

        @if (browseError()) {
          <div class="alert alert-error alert-sm py-1 px-2">
            <span class="text-xs">{{ browseError() }}</span>
            <button
              class="btn btn-ghost btn-xs"
              (click)="browseError.set(null)"
              type="button"
            >
              Dismiss
            </button>
          </div>
        }

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
                  <div class="flex items-start gap-2 p-2">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-xs font-medium text-base-content">{{
                          getDisplayName(server.name)
                        }}</span>
                        @if (server.verified) {
                          <span
                            class="badge badge-xs badge-info text-[10px] gap-0.5"
                          >
                            <lucide-angular
                              [img]="BadgeCheckIcon"
                              class="w-2 h-2"
                              aria-hidden="true"
                            />
                            Verified
                          </span>
                        }
                        @if (server.scanPassed) {
                          <span
                            class="badge badge-xs badge-success text-[10px] gap-0.5"
                          >
                            <lucide-angular
                              [img]="ShieldCheckIcon"
                              class="w-2 h-2"
                              aria-hidden="true"
                            />
                            Scan passed
                          </span>
                        }
                        @if (resolvedNames().has(server.name)) {
                          <span
                            class="badge badge-xs badge-primary text-[10px] gap-0.5"
                          >
                            <lucide-angular
                              [img]="CheckIcon"
                              class="w-2 h-2"
                              aria-hidden="true"
                            />
                            Ready
                          </span>
                        }
                      </div>
                      <p
                        class="text-[11px] text-base-content/60 leading-relaxed line-clamp-2 mt-0.5"
                      >
                        {{ server.description || 'No description available' }}
                      </p>
                    </div>
                    <div class="shrink-0">
                      <button
                        class="btn btn-primary btn-xs"
                        [disabled]="installingNames().has(server.name)"
                        (click)="toggleInstallPanel(server)"
                        type="button"
                        [attr.aria-label]="
                          'Install ' + getDisplayName(server.name)
                        "
                      >
                        @if (installingNames().has(server.name)) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else if (expandedName() === server.name) {
                          Cancel
                        } @else {
                          Install
                        }
                      </button>
                    </div>
                  </div>

                  @if (expandedName() === server.name) {
                    <div class="px-2 pb-2">
                      <div
                        class="p-2 rounded-lg bg-base-300/50 border border-base-300 space-y-2"
                      >
                        @if (isLoadingDetails()) {
                          <div class="skeleton h-8 w-full rounded"></div>
                          <div class="skeleton h-6 w-3/4 rounded"></div>
                        } @else {
                          @if (detailError()) {
                            <div class="text-xs text-error">
                              {{ detailError() }}
                            </div>
                          } @else {
                            @if (activeConfigSchema(); as schema) {
                              <div
                                class="text-[10px] text-base-content/50 uppercase tracking-wide font-medium"
                              >
                                Configuration
                              </div>
                              <ptah-json-schema-form
                                [schema]="schema"
                                [value]="configValue()"
                                (valueChange)="configValue.set($event)"
                                (validChange)="configValid.set($event)"
                              />
                            } @else {
                              <div
                                class="text-[11px] text-base-content/50 py-1"
                              >
                                No configuration required — one-click setup.
                              </div>
                            }

                            @if (resolveError()) {
                              <div class="text-xs text-error">
                                {{ resolveError() }}
                              </div>
                            }
                            @if (resolvedNames().has(server.name)) {
                              <div class="text-xs text-success">
                                Connection resolved — ready to use in a session.
                              </div>
                            }

                            <button
                              class="btn btn-primary btn-xs w-full"
                              [disabled]="
                                !canResolve() ||
                                installingNames().has(server.name)
                              "
                              (click)="resolve(server)"
                              type="button"
                            >
                              @if (installingNames().has(server.name)) {
                                <span
                                  class="loading loading-spinner loading-xs"
                                ></span>
                                Resolving...
                              } @else {
                                Set up server
                              }
                            </button>
                          }
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>

        <div class="text-[10px] text-base-content/30 text-center pt-1">
          Powered by
          <a
            href="https://smithery.ai"
            target="_blank"
            rel="noopener noreferrer"
            class="link link-hover"
            >Smithery</a
          >
        </div>
      }
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
export class SmitherySurfaceComponent implements OnInit, OnDestroy {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  /** Increment to trigger a reload of the browse list (parity with other surfaces). */
  public readonly refreshTrigger = input(0);

  /** Emitted after a server connection is successfully resolved. */
  public readonly serverResolved = output<string>();

  protected readonly SearchIcon = Search;
  protected readonly CheckIcon = Check;
  protected readonly ShieldCheckIcon = ShieldCheck;
  protected readonly BadgeCheckIcon = BadgeCheck;
  protected readonly KeyRoundIcon = KeyRound;

  /** 'unknown' until status RPC resolves; gates ALL browse RPC. */
  public readonly keyStatus = signal<
    'unknown' | 'configured' | 'not-configured'
  >('unknown');

  public readonly keyInput = signal('');
  public readonly isSavingKey = signal(false);
  public readonly keyError = signal<string | null>(null);

  public readonly searchQuery = signal('');
  public readonly searchResults = signal<McpRegistryEntry[]>([]);
  public readonly popularServers = signal<McpRegistryEntry[]>([]);
  public readonly isSearching = signal(false);
  public readonly isLoadingPopular = signal(false);
  public readonly browseError = signal<string | null>(null);

  public readonly expandedName = signal<string | null>(null);
  public readonly isLoadingDetails = signal(false);
  public readonly detailError = signal<string | null>(null);
  public readonly activeConfigSchema = signal<JsonSchemaObject | null>(null);

  public readonly configValue = signal<Record<string, unknown>>({});
  public readonly configValid = signal(true);

  public readonly installingNames = signal<Set<string>>(new Set());
  public readonly resolvedNames = signal<Set<string>>(new Set());
  public readonly resolveError = signal<string | null>(null);

  public readonly displayServers = computed(() =>
    this.searchQuery() ? this.searchResults() : this.popularServers(),
  );

  /** True when the active config form (if any) is satisfied. */
  public readonly canResolve = computed(
    () => this.activeConfigSchema() === null || this.configValid(),
  );

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  public async ngOnInit(): Promise<void> {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    await this.checkKeyStatus();
  }

  public ngOnDestroy(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  }

  public onKeyInput(event: Event): void {
    this.keyInput.set((event.target as HTMLInputElement).value);
  }

  public async saveKey(event: Event): Promise<void> {
    event.preventDefault();
    const apiKey = this.keyInput().trim();
    if (apiKey.length === 0 || this.isSavingKey()) {
      return;
    }
    this.isSavingKey.set(true);
    this.keyError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:setSmitheryApiKey', {
        apiKey,
      });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        this.keyInput.set('');
        await this.checkKeyStatus();
      } else {
        this.keyError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            'Failed to save API key',
        );
      }
    } catch {
      if (this.destroyed) return;
      this.keyError.set('Failed to save API key');
    } finally {
      if (!this.destroyed) this.isSavingKey.set(false);
    }
  }

  public onSearchInput(event: Event): void {
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

  public async toggleInstallPanel(server: McpRegistryEntry): Promise<void> {
    if (this.expandedName() === server.name) {
      this.resetInstallPanel();
      return;
    }
    this.resetInstallPanel();
    this.expandedName.set(server.name);
    this.isLoadingDetails.set(true);
    try {
      const result = await this.rpc.call('mcpDirectory:getDetails', {
        name: server.name,
        source: 'smithery',
      });
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.activeConfigSchema.set(
          this.extractConfigSchema(result.data.connections),
        );
        this.configValid.set(this.activeConfigSchema() === null);
      } else {
        this.detailError.set(result.error ?? 'Failed to load server details');
      }
    } catch {
      if (this.destroyed) return;
      this.detailError.set('Failed to load server details');
    } finally {
      if (!this.destroyed) this.isLoadingDetails.set(false);
    }
  }

  public async resolve(server: McpRegistryEntry): Promise<void> {
    if (!this.canResolve() || this.installingNames().has(server.name)) {
      return;
    }
    this.addToSet(this.installingNames, server.name);
    this.resolveError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:resolveSmithery', {
        qualifiedName: server.name,
        config: this.activeConfigSchema() === null ? {} : this.configValue(),
      });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.config && !result.data.error) {
        this.addToSet(this.resolvedNames, server.name);
        this.serverResolved.emit(server.name);
      } else {
        this.resolveError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            'Failed to resolve server connection',
        );
      }
    } catch {
      if (this.destroyed) return;
      this.resolveError.set('Failed to resolve server connection');
    } finally {
      if (!this.destroyed)
        this.removeFromSet(this.installingNames, server.name);
    }
  }

  public getDisplayName(name: string): string {
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  }

  private async checkKeyStatus(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'mcpDirectory:getSmitheryKeyStatus',
        {},
      );
      if (this.destroyed) return;
      const configured = result.isSuccess() && result.data.configured === true;
      this.keyStatus.set(configured ? 'configured' : 'not-configured');
      if (configured) {
        await this.loadPopular();
      }
    } catch {
      if (this.destroyed) return;
      this.keyStatus.set('not-configured');
    }
  }

  private async loadPopular(): Promise<void> {
    this.isLoadingPopular.set(true);
    this.browseError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:getPopular', {
        source: 'smithery',
      });
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.popularServers.set(result.data.servers);
      } else {
        this.browseError.set(
          result.error ?? 'Failed to load popular Smithery servers',
        );
        this.popularServers.set([]);
      }
    } catch {
      if (this.destroyed) return;
      this.browseError.set('Failed to load popular Smithery servers');
      this.popularServers.set([]);
    } finally {
      if (!this.destroyed) this.isLoadingPopular.set(false);
    }
  }

  private async performSearch(query: string): Promise<void> {
    this.browseError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:search', {
        query,
        source: 'smithery',
      });
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.searchResults.set(result.data.servers);
      } else {
        this.browseError.set(result.error ?? 'Search failed');
        this.searchResults.set([]);
      }
    } catch {
      if (this.destroyed) return;
      this.browseError.set('Search failed');
      this.searchResults.set([]);
    } finally {
      if (!this.destroyed) this.isSearching.set(false);
    }
  }

  private extractConfigSchema(
    connections: McpRegistryConnection[] | undefined,
  ): JsonSchemaObject | null {
    if (!connections) return null;
    for (const connection of connections) {
      const raw = connection.configSchema;
      if (!raw || typeof raw !== 'object') continue;
      const properties = (raw as { properties?: Record<string, unknown> })
        .properties;
      if (properties && Object.keys(properties).length > 0) {
        return { type: 'object', ...raw } as JsonSchemaObject;
      }
    }
    return null;
  }

  private resetInstallPanel(): void {
    this.expandedName.set(null);
    this.activeConfigSchema.set(null);
    this.configValue.set({});
    this.configValid.set(true);
    this.detailError.set(null);
    this.resolveError.set(null);
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
