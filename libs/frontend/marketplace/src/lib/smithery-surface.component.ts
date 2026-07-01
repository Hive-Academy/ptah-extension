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
  Sparkles,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { JsonSchemaFormComponent, JsonSchemaObject } from '@ptah-extension/ui';
import type {
  McpRegistryEntry,
  McpRegistryConnection,
} from '@ptah-extension/shared';

/**
 * A curated category. Smithery has NO category field, so categories are
 * implemented as curated search queries — exactly as smithery.ai does.
 */
interface SmitheryCategory {
  readonly label: string;
  /** Search query this chip drives. Empty string = default browse (All). */
  readonly query: string;
}

/** Curated category chips. `All` ('') browses the full popular list. */
const SMITHERY_CATEGORIES: readonly SmitheryCategory[] = [
  { label: 'All', query: '' },
  { label: 'Web Search', query: 'web search' },
  { label: 'Browser Automation', query: 'browser automation' },
  { label: 'Academic Research', query: 'academic research' },
  { label: 'Finance', query: 'finance' },
  { label: 'Dev Tools', query: 'developer tools' },
  { label: 'Memory', query: 'memory' },
  { label: 'Communication', query: 'communication' },
  { label: 'Productivity', query: 'productivity' },
  { label: 'Data', query: 'database' },
] as const;

/**
 * SmitherySurfaceComponent — the Smithery provider surface mounted by the
 * Marketplace hub for the `smithery` descriptor.
 *
 * Lifecycle / graceful degradation:
 *  - On mount it resolves `mcpDirectory:getSmitheryKeyStatus`. When the key is
 *    NOT configured it renders an API-key entry prompt and fires NO browse RPC.
 *  - Saving a key writes via `mcpDirectory:setSmitheryApiKey`, then re-checks
 *    status and (on success) loads the first browse page.
 *  - Browse is unified behind the cursor-paginated `mcpDirectory:search`
 *    (`source:'smithery'`). The "effective query" is the search box text, the
 *    active category's query, or '' for All — `q:''` returns the popular list.
 *    Pages accumulate; "Load more" appends the next cursor page.
 *  - Install resolves details, renders {@link JsonSchemaFormComponent} when the
 *    connection carries a `configSchema` with properties (else one-click), then
 *    calls `mcpDirectory:resolveSmithery`. Resolve success/error is surfaced
 *    in-view — no blank screen / unhandled rejection.
 *
 * The hub already gates the whole view on premium; this surface only mounts for
 * premium users. As a defensive measure it still refuses to fire any browse RPC
 * unless key status has been resolved to `configured`.
 *
 * Complexity Level: 3 — key-gate state machine + paginated browse + category
 * chips + per-server config form + resolve flow. Patterns: signal state,
 * debounced search, cursor pagination, DaisyUI cards.
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

        <!-- Category chips: curated search queries (Smithery has no category field). -->
        <div class="flex gap-1 flex-wrap">
          @for (cat of categories; track cat.label) {
            <button
              type="button"
              class="btn btn-xs rounded-full normal-case font-medium"
              [class.btn-primary]="isCategoryActive(cat)"
              [class.btn-ghost]="!isCategoryActive(cat)"
              [class.border-base-300]="!isCategoryActive(cat)"
              [attr.aria-pressed]="isCategoryActive(cat)"
              (click)="selectCategory(cat)"
            >
              {{ cat.label }}
            </button>
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
          @if (isLoadingInitial()) {
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <div class="skeleton h-16 w-full rounded-lg mb-1.5"></div>
            }
          } @else {
            <div
              class="text-[11px] text-base-content/50 uppercase tracking-wide mb-1.5 font-medium"
            >
              {{ listHeading() }}
            </div>
            @if (servers().length === 0) {
              <div class="text-xs text-base-content/50 text-center py-4">
                {{ emptyMessage() }}
              </div>
            }
            <div class="space-y-1.5">
              @for (server of servers(); track server.name) {
                <div
                  class="rounded-lg border border-base-300 bg-base-200/30 hover:bg-base-200/60 transition-colors"
                >
                  <div class="flex items-start gap-2 p-2">
                    <!-- Logo / lettered fallback avatar -->
                    @if (iconSrc(server); as src) {
                      <!-- eslint-disable @angular-eslint/template/prefer-ngsrc -- remote logos have unknown dimensions and need an (error) fallback; NgOptimizedImage is unsuitable -->
                      <img
                        [attr.src]="src"
                        [attr.alt]="cardTitle(server) + ' logo'"
                        class="w-8 h-8 rounded-lg object-cover bg-base-300 shrink-0"
                        loading="lazy"
                        (error)="onIconError(src)"
                      />
                      <!-- eslint-enable @angular-eslint/template/prefer-ngsrc -->
                    } @else {
                      <div
                        class="w-8 h-8 rounded-lg bg-base-300 border border-base-300 flex items-center justify-center shrink-0"
                        aria-hidden="true"
                      >
                        <span
                          class="text-sm font-semibold text-base-content/60"
                        >
                          {{ avatarLetter(server) }}
                        </span>
                      </div>
                    }

                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span
                          class="text-xs font-medium text-base-content truncate"
                          >{{ cardTitle(server) }}</span
                        >
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
                        @if (server.bySmithery) {
                          <span
                            class="badge badge-xs badge-neutral text-[10px] gap-0.5"
                          >
                            <lucide-angular
                              [img]="SparklesIcon"
                              class="w-2 h-2"
                              aria-hidden="true"
                            />
                            Managed
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
                      <div
                        class="flex items-center gap-1 text-[10px] text-base-content/40 font-mono mt-0.5 truncate"
                      >
                        <span class="truncate">{{ server.name }}</span>
                        @if (hasUseCount(server)) {
                          <span aria-hidden="true">·</span>
                          <span class="whitespace-nowrap"
                            >{{
                              formatUseCount(server.useCount ?? 0)
                            }}
                            uses</span
                          >
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
                        [attr.aria-label]="'Install ' + cardTitle(server)"
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

            <!-- Load more: appends the next cursor page. -->
            @if (nextCursor()) {
              <button
                class="btn btn-ghost btn-sm w-full mt-1.5 border border-base-300"
                type="button"
                [disabled]="isLoadingMore()"
                (click)="loadMore()"
              >
                @if (isLoadingMore()) {
                  <span class="loading loading-spinner loading-xs"></span>
                  Loading...
                } @else {
                  Load more
                }
              </button>
            }
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
  protected readonly SparklesIcon = Sparkles;

  /** Curated category chips exposed to the template. */
  protected readonly categories = SMITHERY_CATEGORIES;

  /** 'unknown' until status RPC resolves; gates ALL browse RPC. */
  public readonly keyStatus = signal<
    'unknown' | 'configured' | 'not-configured'
  >('unknown');

  public readonly keyInput = signal('');
  public readonly isSavingKey = signal(false);
  public readonly keyError = signal<string | null>(null);

  /** Free-text search box content. */
  public readonly searchQuery = signal('');
  /**
   * Active category. `null` means "free-text mode" (driven by the search box).
   * Defaults to the All chip ('' query) so the popular list loads on mount.
   */
  public readonly activeCategory = signal<SmitheryCategory | null>(
    SMITHERY_CATEGORIES[0],
  );

  /** Unified, accumulated browse list (all pages). */
  public readonly servers = signal<McpRegistryEntry[]>([]);
  /** Cursor for the next page, or null when exhausted. */
  public readonly nextCursor = signal<string | null>(null);

  public readonly isLoadingInitial = signal(false);
  public readonly isLoadingMore = signal(false);
  public readonly isSearching = signal(false);
  public readonly browseError = signal<string | null>(null);

  /** Remote icon srcs that failed to load → render the lettered fallback. */
  public readonly failedIcons = signal<Set<string>>(new Set());

  public readonly expandedName = signal<string | null>(null);
  public readonly isLoadingDetails = signal(false);
  public readonly detailError = signal<string | null>(null);
  public readonly activeConfigSchema = signal<JsonSchemaObject | null>(null);

  public readonly configValue = signal<Record<string, unknown>>({});
  public readonly configValid = signal(true);

  public readonly installingNames = signal<Set<string>>(new Set());
  public readonly resolvedNames = signal<Set<string>>(new Set());
  public readonly resolveError = signal<string | null>(null);

  /**
   * Back-compat accessor: the rendered list. Tests and any consumers can read
   * `displayServers()` as the single source of the visible browse list.
   */
  public readonly displayServers = computed(() => this.servers());

  /** True when the active config form (if any) is satisfied. */
  public readonly canResolve = computed(
    () => this.activeConfigSchema() === null || this.configValid(),
  );

  /** Heading above the list, reflecting the current browse mode. */
  public readonly listHeading = computed(() => {
    if (this.searchQuery().trim()) return 'Search Results';
    const cat = this.activeCategory();
    if (cat && cat.query) return cat.label;
    return 'Popular Servers';
  });

  /** Empty-state message reflecting the current browse mode. */
  public readonly emptyMessage = computed(() => {
    const q = this.searchQuery().trim();
    if (q) return `No servers found for "${q}"`;
    const cat = this.activeCategory();
    if (cat && cat.query) return `No servers found for "${cat.label}"`;
    return 'No servers available';
  });

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

  // ── Key gate ───────────────────────────────────────────────────────────────

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

  // ── Category chips ──────────────────────────────────────────────────────────

  /** A chip is active when it matches the current category AND no free text is active. */
  public isCategoryActive(cat: SmitheryCategory): boolean {
    return !this.searchQuery().trim() && this.activeCategory() === cat;
  }

  /** Selecting a chip clears free-text mode and drives a fresh browse. */
  public selectCategory(cat: SmitheryCategory): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
    this.searchQuery.set('');
    this.isSearching.set(false);
    this.activeCategory.set(cat);
    void this.runBrowse();
  }

  // ── Search box ──────────────────────────────────────────────────────────────

  public onSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.searchQuery.set(query);
    // Typing exits category mode into free-text mode.
    this.activeCategory.set(null);

    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
    if (!query.trim()) {
      // Empty box → fall back to the All (popular) browse.
      this.isSearching.set(false);
      this.activeCategory.set(SMITHERY_CATEGORIES[0]);
      void this.runBrowse();
      return;
    }
    this.isSearching.set(true);
    this.searchTimeout = setTimeout(() => this.performSearch(query), 300);
  }

  // ── Logos / avatars ─────────────────────────────────────────────────────────

  /** Effective icon src for a card, or null when absent / previously failed. */
  public iconSrc(server: McpRegistryEntry): string | null {
    const src = server.icons?.[0]?.src;
    if (!src) return null;
    return this.failedIcons().has(src) ? null : src;
  }

  /** Remember a failed remote icon so the lettered avatar renders instead. */
  public onIconError(src: string): void {
    this.failedIcons.update((s) => new Set([...s, src]));
  }

  /** First letter of the card title for the fallback avatar. */
  public avatarLetter(server: McpRegistryEntry): string {
    const title = this.cardTitle(server).trim();
    return (title.charAt(0) || '?').toUpperCase();
  }

  // ── Card display helpers ────────────────────────────────────────────────────

  /** Preferred card title: friendly displayName, else the qualified-name leaf. */
  public cardTitle(server: McpRegistryEntry): string {
    return server.displayName?.trim() || this.getDisplayName(server.name);
  }

  public getDisplayName(name: string): string {
    const parts = name.split('/');
    return parts[parts.length - 1] || name;
  }

  /** Whether a useCount popularity signal is present (null/undefined → false). */
  public hasUseCount(server: McpRegistryEntry): boolean {
    return server.useCount !== null && server.useCount !== undefined;
  }

  /** Compact popularity formatter: 41630 → "41.6k", 2_400_000 → "2.4M". */
  public formatUseCount(count: number): string {
    if (count >= 1_000_000) {
      return `${this.trimZero(count / 1_000_000)}M`;
    }
    if (count >= 1_000) {
      return `${this.trimZero(count / 1_000)}k`;
    }
    return `${count}`;
  }

  private trimZero(value: number): string {
    // One decimal, but drop a trailing ".0" (e.g. 2.0 → "2").
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
  }

  // ── Install / resolve ───────────────────────────────────────────────────────

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

  // ── Browse / pagination ─────────────────────────────────────────────────────

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
        await this.runBrowse();
      }
    } catch {
      if (this.destroyed) return;
      this.keyStatus.set('not-configured');
    }
  }

  /** The query to browse with: free text, else active category, else ''. */
  private effectiveQuery(): string {
    const text = this.searchQuery().trim();
    if (text) return text;
    return this.activeCategory()?.query ?? '';
  }

  /**
   * Reset the list and load the first page for the current effective query.
   * Gated on `keyStatus() === 'configured'` — defence in depth.
   */
  private async runBrowse(): Promise<void> {
    if (this.keyStatus() !== 'configured') return;
    this.isLoadingInitial.set(true);
    this.browseError.set(null);
    this.nextCursor.set(null);
    try {
      const result = await this.searchPage(this.effectiveQuery(), undefined);
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.servers.set(result.data.servers);
        this.nextCursor.set(result.data.nextCursor ?? null);
      } else {
        this.browseError.set(result.error ?? 'Failed to load Smithery servers');
        this.servers.set([]);
      }
    } catch {
      if (this.destroyed) return;
      this.browseError.set('Failed to load Smithery servers');
      this.servers.set([]);
    } finally {
      if (!this.destroyed) this.isLoadingInitial.set(false);
    }
  }

  /** Append the next cursor page. No-op when no cursor or already loading. */
  public async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.isLoadingMore() || this.keyStatus() !== 'configured') {
      return;
    }
    this.isLoadingMore.set(true);
    this.browseError.set(null);
    try {
      const result = await this.searchPage(this.effectiveQuery(), cursor);
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.servers.update((prev) => [...prev, ...result.data.servers]);
        this.nextCursor.set(result.data.nextCursor ?? null);
      } else {
        this.browseError.set(result.error ?? 'Failed to load more servers');
      }
    } catch {
      if (this.destroyed) return;
      this.browseError.set('Failed to load more servers');
    } finally {
      if (!this.destroyed) this.isLoadingMore.set(false);
    }
  }

  /** Debounced free-text search. Resets the list (page 1). */
  private async performSearch(query: string): Promise<void> {
    if (this.keyStatus() !== 'configured') {
      this.isSearching.set(false);
      return;
    }
    this.browseError.set(null);
    this.nextCursor.set(null);
    try {
      const result = await this.searchPage(query, undefined);
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.servers.set(result.data.servers);
        this.nextCursor.set(result.data.nextCursor ?? null);
      } else {
        this.browseError.set(result.error ?? 'Search failed');
        this.servers.set([]);
      }
    } catch {
      if (this.destroyed) return;
      this.browseError.set('Search failed');
      this.servers.set([]);
    } finally {
      if (!this.destroyed) this.isSearching.set(false);
    }
  }

  /**
   * Single cursor-paginated `mcpDirectory:search` call. `cursor` is omitted
   * from the params object when undefined to keep the wire payload minimal.
   */
  private searchPage(query: string, cursor: string | undefined) {
    const params: {
      query: string;
      source: 'smithery';
      cursor?: string;
    } = { query, source: 'smithery' };
    if (cursor !== undefined) {
      params.cursor = cursor;
    }
    return this.rpc.call('mcpDirectory:search', params);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

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
