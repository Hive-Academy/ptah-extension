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
import { LucideAngularModule, Search, KeyRound, Trash2 } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  BrandMarkComponent,
  CatalogCardComponent,
  CatalogCardSkeletonComponent,
  CatalogGridComponent,
  JsonSchemaFormComponent,
  JsonSchemaObject,
  MonogramTileComponent,
  StorefrontPanelComponent,
  resolveListingBrandSlug,
  type CatalogCardBadge,
} from '@ptah-extension/ui';
import type {
  McpRegistryEntry,
  McpRegistryConnection,
  SmitheryConnectionStatus,
  SmitheryConnectionSummary,
} from '@ptah-extension/shared';
import type { ProviderStatus } from './data/provider-row';
import {
  StatusPillComponent,
  statusPresentation,
} from './ui/status-pill.component';

/**
 * Phase of the in-flight setup for the currently expanded server.
 *
 * `validating` → pre-flight `mcpDirectory:resolveSmithery` (fails fast on a bad
 * config / missing API key). `installing` → `mcpDirectory:installSmithery`,
 * which is the ONLY call that actually persists anything.
 */
type SetupPhase = 'idle' | 'validating' | 'installing';

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

/** One browse entry as the catalog card renders it. */
interface SmitheryServerCard {
  readonly server: McpRegistryEntry;
  readonly title: string;
  readonly meta: readonly string[];
  readonly badge: CatalogCardBadge | null;
  /** From `resolveListingBrandSlug`; `null` renders a monogram. */
  readonly brandSlug: string | null;
}

/** The three connection states this surface distinguishes. */
type ConnectionState = 'connected' | 'needs-auth' | 'error';

/** Fold a Smithery connection status into the states this surface shows. */
function connectionState(status: SmitheryConnectionStatus): ConnectionState {
  if (status === 'connected') return 'connected';
  if (status === 'error') return 'error';
  return 'needs-auth';
}

/** The `statusPresentation()` status that words each connection state. */
const PILL_STATUS: Readonly<Record<ConnectionState, ProviderStatus>> = {
  connected: 'connected',
  'needs-auth': 'needs-auth',
  error: 'failed',
};

const INSTALLED_BADGE: CatalogCardBadge = {
  label: 'Installed',
  tone: 'success',
};
const VERIFIED_BADGE: CatalogCardBadge = { label: 'Verified', tone: 'info' };

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
 *    runs the two-step setup below. Every failure is surfaced in-view — no
 *    blank screen / unhandled rejection.
 *
 * Setup is two RPCs, in order:
 *  1. `mcpDirectory:resolveSmithery` — PRE-FLIGHT ONLY. It validates the config
 *     against the server's schema and proves the Smithery key works, returning
 *     a connection it does NOT persist. A failure here is a fast, precise error
 *     before anything touches disk.
 *  2. `mcpDirectory:installSmithery` — the real persistence path. Non-secret
 *     metadata lands in `~/.ptah/smithery-installed.json`; the credential-bearing
 *     config is routed to the encrypted secret store. Chat sessions rebuild the
 *     live URL from that manifest at query time.
 *
 * Installed state is read back from `mcpDirectory:listSmitheryInstalled` (source
 * of truth: the manifest, not this component's memory) and `Remove` maps to
 * `mcpDirectory:uninstallSmithery`.
 *
 * This surface refuses to fire any browse RPC unless key status has been
 * resolved to `configured`.
 *
 * Complexity Level: 3 — key-gate state machine + paginated browse + category
 * chips + per-server config form + validate→install→installed flow. Patterns:
 * signal state, debounced search, cursor pagination, storefront catalog cards.
 *
 * Marks come from `resolveListingBrandSlug` (a vendor mark only for a
 * catalogue endpoint or an allowlisted namespace, else a monogram); remote
 * listing icons are never rendered. Status words come from
 * `statusPresentation()`.
 */
@Component({
  selector: 'ptah-smithery-surface',
  standalone: true,
  imports: [
    LucideAngularModule,
    JsonSchemaFormComponent,
    BrandMarkComponent,
    CatalogCardComponent,
    CatalogCardSkeletonComponent,
    CatalogGridComponent,
    MonogramTileComponent,
    StorefrontPanelComponent,
    StatusPillComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (keyStatus() === 'unknown') {
        <!-- Resolving key status: neutral loading, browse RPC withheld. -->
        <div class="flex items-center justify-center py-8">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      } @else {
        @if (keyStatus() === 'not-configured' || showKeyForm()) {
          <!-- Connect prompt: enter an API key before any browse RPC fires. -->
          <ptah-storefront-panel
            heading="Connect Smithery"
            subtitle="Enter a Smithery API key to browse and install hosted MCP servers."
            [headingLevel]="2"
          >
            <span panel-mark [class]="keyTileClass" aria-hidden="true">
              <lucide-angular [img]="KeyRoundIcon" class="w-4 h-4" />
            </span>
            @if (keyError()) {
              <div class="alert alert-error alert-sm py-1 px-2 mb-3">
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
            <p class="text-[10px] text-base-content-muted text-center mt-2">
              Your key is stored encrypted by Ptah and never leaves your
              machine.
            </p>
          </ptah-storefront-panel>
        }

        @if (keyStatus() === 'configured') {
          <!-- Account: the namespace every Ptah install lands in, and its connections. -->
          <ptah-storefront-panel heading="Smithery account" [headingLevel]="2">
            <span panel-mark [class]="keyTileClass" aria-hidden="true">
              <lucide-angular [img]="KeyRoundIcon" class="w-4 h-4" />
            </span>
            @if (activeNamespace(); as namespace) {
              <div class="text-xs font-medium text-base-content truncate">
                {{ namespace }}
              </div>
              @if (namespaces().length > 1) {
                <div class="text-[10px] text-base-content-muted">
                  {{ namespaces().length }} namespaces — Ptah installs into the
                  first.
                </div>
              }
            } @else {
              <div class="text-xs text-warning">
                {{ accountError() ?? 'No namespace found for this API key.' }}
              </div>
            }

            @if (connections().length > 0) {
              <h3
                class="text-[11px] text-base-content-muted uppercase tracking-wide mt-3 mb-1.5 font-medium"
              >
                Connections
              </h3>
              <ul class="space-y-1.5">
                @for (
                  connection of connections();
                  track connection.connectionId
                ) {
                  <li
                    class="rounded-lg border border-base-300 bg-base-100 flex items-start gap-2 p-2"
                  >
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5 flex-wrap">
                        <span
                          class="text-xs font-medium text-base-content truncate"
                          >{{ connection.name }}</span
                        >
                        <ptah-status-pill
                          [status]="connectionPillStatus(connection)"
                        />
                        @if (connection.managedByPtah) {
                          <span
                            class="badge badge-xs badge-neutral text-[10px]"
                          >
                            Managed by Ptah
                          </span>
                        }
                      </div>
                      <div
                        class="text-[10px] text-base-content-muted font-mono mt-0.5 truncate"
                      >
                        {{ connection.server || connection.connectionId }}
                      </div>
                    </div>
                    <div class="shrink-0 flex items-center gap-1">
                      @if (
                        connection.managedByPtah &&
                        connection.serverKey &&
                        connection.status !== 'connected'
                      ) {
                        <button
                          class="btn btn-ghost btn-xs border border-base-300"
                          type="button"
                          [disabled]="isConnectionBusy(connection)"
                          (click)="authorizeConnection(connection)"
                          [attr.aria-label]="'Authorize ' + connection.name"
                        >
                          @if (isConnectionBusy(connection)) {
                            <span
                              class="loading loading-spinner loading-xs"
                            ></span>
                          } @else {
                            Authorize
                          }
                        </button>
                      }
                      @if (connection.managedByPtah && connection.serverKey) {
                        <button
                          class="btn btn-ghost btn-xs text-error"
                          type="button"
                          [disabled]="isConnectionBusy(connection)"
                          (click)="removeConnection(connection)"
                          [attr.aria-label]="'Remove ' + connection.name"
                        >
                          <lucide-angular
                            [img]="Trash2Icon"
                            class="w-3 h-3"
                            aria-hidden="true"
                          />
                          Remove
                        </button>
                      }
                    </div>
                  </li>
                }
              </ul>
              @if (connectionsError(); as error) {
                <p class="text-[10px] text-warning mt-1">{{ error }}</p>
              }
            } @else if (connectionsError(); as error) {
              <div class="alert alert-warning alert-sm py-1 px-2 mt-3">
                <span class="text-xs">{{ error }}</span>
              </div>
            }
            <div panel-footer>
              <button
                class="btn btn-ghost btn-xs border border-base-300"
                type="button"
                (click)="toggleKeyForm()"
              >
                {{ showKeyForm() ? 'Cancel' : 'Change key' }}
              </button>
            </div>
          </ptah-storefront-panel>

          <!-- Configured: browse Smithery servers. -->
          <div class="relative">
            <span
              class="absolute left-2.5 top-1/2 -translate-y-1/2 flex text-base-content-muted"
              aria-hidden="true"
            >
              <lucide-angular [img]="SearchIcon" class="w-3.5 h-3.5" />
            </span>
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
          <div
            class="flex gap-1 flex-wrap"
            role="group"
            aria-label="Filter by category"
          >
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
              <ptah-catalog-grid ariaLabel="Loading Smithery servers">
                @for (i of [1, 2, 3, 4]; track i) {
                  <ptah-catalog-card-skeleton role="listitem" />
                }
              </ptah-catalog-grid>
            } @else {
              <h2
                class="text-[11px] text-base-content-muted uppercase tracking-wide mb-1.5 font-medium"
              >
                {{ listHeading() }}
              </h2>
              @if (serverCards().length === 0) {
                <div class="text-xs text-base-content-muted text-center py-4">
                  {{ emptyMessage() }}
                </div>
              } @else {
                <ptah-catalog-grid>
                  @for (card of serverCards(); track card.server.name) {
                    <ptah-catalog-card
                      role="listitem"
                      [heading]="card.title"
                      [description]="
                        card.server.description || 'No description available'
                      "
                      [meta]="card.meta"
                      [badge]="card.badge"
                    >
                      @if (card.brandSlug; as slug) {
                        <ptah-brand-mark
                          card-mark
                          size="lg"
                          [brandSlug]="slug"
                          [label]="card.title"
                        />
                      } @else {
                        <ptah-monogram-tile
                          card-mark
                          size="lg"
                          [label]="card.title"
                        />
                      }
                      <div card-actions class="flex items-center gap-2">
                        @if (isInstalled(card.server.name)) {
                          <button
                            class="btn btn-ghost btn-sm border border-base-300"
                            [disabled]="isUninstalling(card.server.name)"
                            (click)="uninstall(card.server)"
                            type="button"
                            [attr.aria-label]="'Remove ' + card.title"
                          >
                            @if (isUninstalling(card.server.name)) {
                              <span
                                class="loading loading-spinner loading-xs"
                              ></span>
                              Removing...
                            } @else {
                              Remove
                            }
                          </button>
                        }
                        <button
                          class="btn btn-sm"
                          [class.btn-primary]="!isInstalled(card.server.name)"
                          [class.btn-ghost]="isInstalled(card.server.name)"
                          [class.border-base-300]="
                            isInstalled(card.server.name)
                          "
                          [disabled]="isBusy(card.server.name)"
                          (click)="toggleInstallPanel(card.server)"
                          type="button"
                          [attr.aria-expanded]="
                            expandedName() === card.server.name
                          "
                          [attr.aria-label]="
                            (isInstalled(card.server.name)
                              ? 'Reconfigure '
                              : 'Install ') + card.title
                          "
                        >
                          @if (isBusy(card.server.name)) {
                            <span
                              class="loading loading-spinner loading-xs"
                            ></span>
                          } @else if (expandedName() === card.server.name) {
                            Cancel
                          } @else if (isInstalled(card.server.name)) {
                            Reconfigure
                          } @else {
                            Install
                          }
                        </button>
                      </div>
                    </ptah-catalog-card>

                    @if (expandedName() === card.server.name) {
                      <!-- Setup form: a full-width row under the card that opened it. -->
                      <div role="listitem" class="col-span-full">
                        <ptah-storefront-panel
                          [heading]="'Set up ' + card.title"
                          [subtitle]="card.server.name"
                        >
                          @if (isLoadingDetails()) {
                            <div class="skeleton h-8 w-full rounded"></div>
                            <div class="skeleton h-6 w-3/4 rounded mt-2"></div>
                          } @else if (detailError()) {
                            <div class="text-xs text-error">
                              {{ detailError() }}
                            </div>
                          } @else {
                            <div class="space-y-2">
                              @if (activeConfigSchema(); as schema) {
                                <div
                                  class="text-[10px] text-base-content-muted uppercase tracking-wide font-medium"
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
                                  class="text-[11px] text-base-content-muted"
                                >
                                  No configuration required — one-click setup.
                                </div>
                              }

                              @if (setupError()) {
                                <div class="text-xs text-error" role="alert">
                                  {{ setupError() }}
                                </div>
                              }
                              @switch (setupPhase()) {
                                @case ('validating') {
                                  <div
                                    class="text-[11px] text-base-content-muted flex items-center gap-1.5"
                                    aria-live="polite"
                                  >
                                    <span
                                      class="loading loading-spinner loading-xs"
                                    ></span>
                                    Validating configuration with Smithery...
                                  </div>
                                }
                                @case ('installing') {
                                  <div
                                    class="text-[11px] text-base-content-muted flex items-center gap-1.5"
                                    aria-live="polite"
                                  >
                                    <span
                                      class="loading loading-spinner loading-xs"
                                    ></span>
                                    Installing server...
                                  </div>
                                }
                                @default {
                                  @if (
                                    isInstalled(card.server.name) &&
                                    !setupError()
                                  ) {
                                    <div class="text-xs text-success">
                                      Installed — available in new chat
                                      sessions.
                                    </div>
                                  }
                                }
                              }
                            </div>
                          }
                          @if (!isLoadingDetails() && !detailError()) {
                            <div panel-footer>
                              <button
                                class="btn btn-primary btn-sm"
                                [disabled]="
                                  !canSetup() || isBusy(card.server.name)
                                "
                                (click)="setupServer(card.server)"
                                type="button"
                              >
                                @switch (setupPhase()) {
                                  @case ('validating') {
                                    <span
                                      class="loading loading-spinner loading-xs"
                                    ></span>
                                    Validating...
                                  }
                                  @case ('installing') {
                                    <span
                                      class="loading loading-spinner loading-xs"
                                    ></span>
                                    Installing...
                                  }
                                  @default {
                                    @if (isInstalled(card.server.name)) {
                                      Update configuration
                                    } @else {
                                      Install server
                                    }
                                  }
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

              <!-- Load more: appends the next cursor page. -->
              @if (nextCursor()) {
                <button
                  class="btn btn-ghost btn-sm w-full mt-3 border border-base-300"
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

          <div class="text-[10px] text-base-content-muted text-center pt-1">
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

  /** Emitted with the serverKey after a server is successfully installed. */
  public readonly serverInstalled = output<string>();
  /** Emitted with the serverKey after a server is successfully removed. */
  public readonly serverUninstalled = output<string>();

  protected readonly SearchIcon = Search;
  protected readonly KeyRoundIcon = KeyRound;
  protected readonly Trash2Icon = Trash2;

  /** Key icon tile of the gate and account panels; the tone sits on the tile. */
  protected readonly keyTileClass =
    'w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary';

  /** Curated category chips exposed to the template. */
  protected readonly categories = SMITHERY_CATEGORIES;

  /** 'unknown' until status RPC resolves; gates ALL browse RPC. */
  public readonly keyStatus = signal<
    'unknown' | 'configured' | 'not-configured'
  >('unknown');

  public readonly keyInput = signal('');
  public readonly isSavingKey = signal(false);
  public readonly keyError = signal<string | null>(null);
  /**
   * Whether the API-key form is shown while a key IS configured. The
   * not-configured branch shows it unconditionally; this only drives the
   * "Change key" affordance on the Account row, so one form serves both.
   */
  public readonly showKeyForm = signal(false);

  // ── Account + connections (Smithery Connections API) ──────────────────────

  /** Namespace names the stored key can reach, in the order Smithery gave. */
  public readonly namespaces = signal<string[]>([]);
  /** The namespace Ptah installs into — the first one, or null. */
  public readonly activeNamespace = signal<string | null>(null);
  /** Why the account could not be read (revoked key, API unreachable). */
  public readonly accountError = signal<string | null>(null);

  /** Connections in {@link activeNamespace}, Ptah's and the user's alike. */
  public readonly connections = signal<SmitheryConnectionSummary[]>([]);
  /** Why the connection list could not be read. Rendered, never fatal. */
  public readonly connectionsError = signal<string | null>(null);
  /** Connection ids with an Authorize / Remove action in flight. */
  public readonly connectionBusyIds = signal<Set<string>>(new Set());

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

  public readonly expandedName = signal<string | null>(null);
  public readonly isLoadingDetails = signal(false);
  public readonly detailError = signal<string | null>(null);
  public readonly activeConfigSchema = signal<JsonSchemaObject | null>(null);

  public readonly configValue = signal<Record<string, unknown>>({});
  public readonly configValid = signal(true);

  /**
   * Installed servers, keyed by qualifiedName → serverKey. Sourced from
   * `mcpDirectory:listSmitheryInstalled` (the on-disk manifest), so a reload
   * shows what is genuinely installed rather than what this session did.
   */
  public readonly installedByName = signal<ReadonlyMap<string, string>>(
    new Map(),
  );
  /** Phase of the in-flight setup for the expanded server. */
  public readonly setupPhase = signal<SetupPhase>('idle');
  /** In-flight uninstall tracking, by serverKey. */
  public readonly uninstallingKeys = signal<Set<string>>(new Set());
  /** Setup (validate or install) failure, rendered inside the expanded panel. */
  public readonly setupError = signal<string | null>(null);

  /**
   * Back-compat accessor: the rendered list. Tests and any consumers can read
   * `displayServers()` as the single source of the visible browse list.
   */
  public readonly displayServers = computed(() => this.servers());

  /** The browse list as catalog cards; re-derived when install state changes. */
  public readonly serverCards = computed(() =>
    this.servers().map((server) => this.toCard(server)),
  );

  /** True when the active config form (if any) is satisfied. */
  public readonly canSetup = computed(
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
        this.showKeyForm.set(false);
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

  /** Show or hide the API-key form while a key is already configured. */
  public toggleKeyForm(): void {
    this.showKeyForm.update((open) => !open);
    if (!this.showKeyForm()) {
      this.keyInput.set('');
      this.keyError.set(null);
    }
  }

  // ── Account + connections ─────────────────────────────────────────────────

  /**
   * Read the Smithery account. A failure here is a state to render — a revoked
   * key or an unreachable API — so it sets {@link accountError} and never
   * blanks the browse list.
   */
  private async loadAccount(): Promise<void> {
    try {
      const result = await this.rpc.call('mcpDirectory:smitheryAccount', {});
      if (this.destroyed) return;
      if (!result.isSuccess()) {
        this.accountError.set(
          result.error ?? 'Failed to read Smithery account',
        );
        return;
      }
      this.namespaces.set(result.data.namespaces);
      this.activeNamespace.set(result.data.activeNamespace);
      this.accountError.set(result.data.error ?? null);
    } catch {
      if (this.destroyed) return;
      this.accountError.set('Failed to read Smithery account');
    }
  }

  /** Read the connections in the active namespace. Same failure rule as above. */
  private async loadConnections(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'mcpDirectory:listSmitheryConnections',
        {},
      );
      if (this.destroyed) return;
      if (!result.isSuccess()) {
        this.connectionsError.set(
          result.error ?? 'Failed to load Smithery connections',
        );
        return;
      }
      this.connections.set(result.data.connections);
      this.connectionsError.set(result.data.error ?? null);
    } catch {
      if (this.destroyed) return;
      this.connectionsError.set('Failed to load Smithery connections');
    }
  }

  /** True while an Authorize / Remove for this connection is in flight. */
  public isConnectionBusy(connection: SmitheryConnectionSummary): boolean {
    return this.connectionBusyIds().has(connection.connectionId);
  }

  /**
   * Open the Smithery setup page for a connection that is not connected. The
   * handler mints a FRESH setup URL — the one the install returned is single
   * use — and opens it in the browser.
   */
  public async authorizeConnection(
    connection: SmitheryConnectionSummary,
  ): Promise<void> {
    const serverKey = connection.serverKey;
    if (!serverKey || this.isConnectionBusy(connection)) return;
    this.addToSet(this.connectionBusyIds, connection.connectionId);
    this.connectionsError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:openSmitherySetup', {
        serverKey,
      });
      if (this.destroyed) return;
      if (!result.isSuccess() || !result.data.opened) {
        // Nothing changed upstream, so do NOT re-read the list: a successful
        // read would clear the message the user has to act on.
        this.connectionsError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            `Could not open the setup page for ${connection.name}`,
        );
        return;
      }
      await this.loadConnections();
    } catch {
      if (this.destroyed) return;
      this.connectionsError.set(
        `Could not open the setup page for ${connection.name}`,
      );
    } finally {
      if (!this.destroyed) {
        this.removeFromSet(this.connectionBusyIds, connection.connectionId);
      }
    }
  }

  /** Remove a Ptah-managed connection: drops the record AND the connection. */
  public async removeConnection(
    connection: SmitheryConnectionSummary,
  ): Promise<void> {
    const serverKey = connection.serverKey;
    if (!serverKey || this.isConnectionBusy(connection)) return;
    this.addToSet(this.connectionBusyIds, connection.connectionId);
    this.connectionsError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:uninstallSmithery', {
        serverKey,
      });
      if (this.destroyed) return;
      if (!result.isSuccess() || !result.data.success) {
        this.connectionsError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            `Failed to remove ${connection.name}`,
        );
        return;
      }
      this.serverUninstalled.emit(serverKey);
      await Promise.all([this.loadConnections(), this.loadInstalled()]);
    } catch {
      if (this.destroyed) return;
      this.connectionsError.set(`Failed to remove ${connection.name}`);
    } finally {
      if (!this.destroyed) {
        this.removeFromSet(this.connectionBusyIds, connection.connectionId);
      }
    }
  }

  /**
   * The badge an installed card shows. Reads the CONNECTION status, so a server
   * whose upstream authorization never completed says so instead of claiming to
   * be installed and working. Falls back to `'installed'` for a legacy record
   * that has no connection behind it.
   */
  public installedBadge(
    qualifiedName: string,
  ): 'installed' | 'connected' | 'needs-auth' | 'error' {
    const status = this.connectionStatusOf(qualifiedName);
    return status === null ? 'installed' : connectionState(status);
  }

  /** A connection row's pill status; the words come from `statusPresentation()`. */
  public connectionPillStatus(
    connection: SmitheryConnectionSummary,
  ): ProviderStatus {
    return PILL_STATUS[connectionState(connection.status)];
  }

  /** Connection status for a qualified name, or null when there is none. */
  public connectionStatusOf(
    qualifiedName: string,
  ): SmitheryConnectionStatus | null {
    const match = this.connections().find((c) => c.server === qualifiedName);
    return match?.status ?? null;
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

  // ── Card display helpers ────────────────────────────────────────────────────

  /**
   * One browse entry as a catalog card. The badge is the install state when
   * installed, else Verified; the other trust signals move into the meta line.
   */
  private toCard(server: McpRegistryEntry): SmitheryServerCard {
    const installed = this.isInstalled(server.name);
    const trust = [
      installed && server.verified ? VERIFIED_BADGE.label : '',
      server.scanPassed ? 'Scan passed' : '',
      server.bySmithery ? 'By Smithery' : '',
    ].filter((word) => word.length > 0);
    const uses = this.hasUseCount(server)
      ? `${this.formatUseCount(server.useCount ?? 0)} uses`
      : '';
    return {
      server,
      title: this.cardTitle(server),
      meta: [server.name, uses, trust.join(', ')],
      badge: installed
        ? this.installedCardBadge(server.name)
        : server.verified
          ? VERIFIED_BADGE
          : null,
      brandSlug: resolveListingBrandSlug({
        registryName: server.name,
        remoteUrls: (server.connections ?? []).flatMap((c) =>
          c.deploymentUrl ? [c.deploymentUrl] : [],
        ),
      }),
    };
  }

  /** An installed card's badge: its connection status, or plain Installed. */
  private installedCardBadge(qualifiedName: string): CatalogCardBadge {
    const state = this.installedBadge(qualifiedName);
    if (state === 'installed') return INSTALLED_BADGE;
    const { label, tone } = statusPresentation(PILL_STATUS[state]);
    return { label, tone };
  }

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
    // Never tear the panel down mid-setup (the button is disabled too).
    if (this.isBusy(server.name)) {
      return;
    }
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

  /** True while the expanded server is mid-setup (validate or install). */
  public isBusy(qualifiedName: string): boolean {
    return (
      this.expandedName() === qualifiedName && this.setupPhase() !== 'idle'
    );
  }

  /** True when the manifest reports this qualified name as installed. */
  public isInstalled(qualifiedName: string): boolean {
    return this.installedByName().has(qualifiedName);
  }

  /** The installed serverKey for a qualified name, or null when not installed. */
  public serverKeyOf(qualifiedName: string): string | null {
    return this.installedByName().get(qualifiedName) ?? null;
  }

  /** True while an uninstall for this qualified name is in flight. */
  public isUninstalling(qualifiedName: string): boolean {
    const key = this.serverKeyOf(qualifiedName);
    return key !== null && this.uninstallingKeys().has(key);
  }

  /**
   * Validate, then actually install.
   *
   * Step 1 (`resolveSmithery`) persists nothing — it exists to fail fast with a
   * precise message when the config or the Smithery key is wrong. Step 2
   * (`installSmithery`) is what makes the server available to chat sessions.
   */
  public async setupServer(server: McpRegistryEntry): Promise<void> {
    if (!this.canSetup() || this.setupPhase() !== 'idle') {
      return;
    }
    const config = this.activeConfigSchema() === null ? {} : this.configValue();

    this.setupError.set(null);
    this.setupPhase.set('validating');
    try {
      const validation = await this.rpc.call('mcpDirectory:resolveSmithery', {
        qualifiedName: server.name,
        config,
      });
      if (this.destroyed) return;
      if (!validation.isSuccess() || !validation.data.config) {
        this.setupError.set(
          (validation.isSuccess() ? validation.data.error : validation.error) ??
            'Failed to validate server connection',
        );
        return;
      }

      this.setupPhase.set('installing');
      const installed = await this.rpc.call('mcpDirectory:installSmithery', {
        qualifiedName: server.name,
        config,
      });
      if (this.destroyed) return;
      if (!installed.isSuccess() || !installed.data.success) {
        this.setupError.set(
          (installed.isSuccess() ? installed.data.error : installed.error) ??
            'Failed to install server',
        );
        return;
      }

      const serverKey = installed.data.serverKey;
      if (serverKey) {
        this.installedByName.update(
          (prev) => new Map([...prev, [server.name, serverKey]]),
        );
        this.serverInstalled.emit(serverKey);
      }
      // Reconcile against the manifest — authoritative, and covers the case
      // where the backend derived a serverKey it did not echo back. The
      // connection list refreshes with it so the card's badge reports the real
      // connection state rather than "Installed" for a server still awaiting
      // its upstream authorization.
      await Promise.all([this.loadInstalled(), this.loadConnections()]);
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.setupError.set(this.messageOf(error, 'Failed to install server'));
    } finally {
      if (!this.destroyed) this.setupPhase.set('idle');
    }
  }

  /** Remove an installed server: drops its manifest record + encrypted config. */
  public async uninstall(server: McpRegistryEntry): Promise<void> {
    const serverKey = this.serverKeyOf(server.name);
    if (serverKey === null || this.uninstallingKeys().has(serverKey)) {
      return;
    }
    this.addToSet(this.uninstallingKeys, serverKey);
    this.setupError.set(null);
    try {
      const result = await this.rpc.call('mcpDirectory:uninstallSmithery', {
        serverKey,
      });
      if (this.destroyed) return;
      if (result.isSuccess() && result.data.success) {
        this.installedByName.update((prev) => {
          const next = new Map(prev);
          next.delete(server.name);
          return next;
        });
        this.serverUninstalled.emit(serverKey);
      } else {
        this.setupError.set(
          (result.isSuccess() ? result.data.error : result.error) ??
            'Failed to remove server',
        );
      }
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.setupError.set(this.messageOf(error, 'Failed to remove server'));
    } finally {
      if (!this.destroyed) this.removeFromSet(this.uninstallingKeys, serverKey);
    }
  }

  /**
   * Refresh the installed map from the manifest. Deliberately quiet: a failure
   * here must not blank the browse list or clobber optimistic state — the row
   * badge simply stays as-is until the next successful read.
   */
  private async loadInstalled(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'mcpDirectory:listSmitheryInstalled',
        {},
      );
      if (this.destroyed || !result.isSuccess()) return;
      this.installedByName.set(
        new Map(
          result.data.servers.map((record) => [
            record.qualifiedName,
            record.serverKey,
          ]),
        ),
      );
    } catch {
      // Non-fatal: keep the previously known installed state.
    }
  }

  /** Narrow an unknown throwable to a displayable message. */
  private messageOf(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return fallback;
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
        // Four independent reads: the browse list, the manifest, the account
        // and the connections. None of them gates another.
        await Promise.all([
          this.runBrowse(),
          this.loadInstalled(),
          this.loadAccount(),
          this.loadConnections(),
        ]);
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
    this.setupError.set(null);
    this.setupPhase.set('idle');
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
