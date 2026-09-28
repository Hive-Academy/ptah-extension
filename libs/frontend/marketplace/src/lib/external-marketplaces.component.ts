import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Store,
  Plus,
  Trash2,
  RefreshCw,
  ChevronRight,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  CatalogCardComponent,
  CatalogCardSkeletonComponent,
  CatalogGridComponent,
  MonogramTileComponent,
  StorefrontPanelComponent,
} from '@ptah-extension/ui';
import type {
  ExternalConsentReason,
  ExternalInstallPlan,
  ExternalInstallResult,
  ExternalMarketplace,
  ExternalPluginListing,
  SuggestedMarketplace,
} from '@ptah-extension/shared';
import { ExternalConsentDialogComponent } from './external-consent-dialog.component';
import { ExternalInstallReportComponent } from './external-install-report.component';
import { ExternalInstalledRowComponent } from './external-installed-row.component';
import { ExternalPluginRowComponent } from './external-plugin-row.component';

/**
 * `owner/repo` shape accepted by the Add button.
 *
 * Client-side ONLY, for immediate feedback — `plugins:add-marketplace`
 * re-validates server-side and is the authority. Deliberately identical to the
 * backend's slug rule so the button never disables input the backend would have
 * accepted.
 */
const SOURCE_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/**
 * ExternalMarketplacesComponent — register, browse and install from external
 * plugin marketplaces (any GitHub repo exposing `.claude-plugin/marketplace.json`).
 *
 * Owns the whole external-marketplace RPC surface and hosts the consent gate.
 * Mounted by `SkillSourceHostComponent` on the `marketplaces` source, apart
 * from the bundled plugin catalogue (bundled plugins are enable/disable,
 * external ones are fetch-and-install). It emits `pluginInstalled` /
 * `pluginUninstalled` (the plugin id) after the backend confirms the change.
 *
 * THE INSTALL IS A STRICT TWO-CALL PROTOCOL and this component never shortcuts
 * it:
 *
 *  1. {@link install} calls `plugins:install-external` with `{ source, plugin }`
 *     and NO `consentToken`. By contract that call writes nothing; it returns
 *     `status: 'consent-required'` with a plan.
 *  2. The plan is handed to `ptah-external-consent-dialog`, which renders every
 *     disclosure (skills, footprint, scripts, MCP command lines verbatim,
 *     skipped binaries, shadowing collisions).
 *  3. {@link confirmInstall} repeats the call carrying exactly
 *     `plan.consentToken`. {@link cancelInstall} fires NO RPC at all.
 *
 * Version-change re-consent: the token is bound to the plugin's resolved
 * version and file list, so if upstream moved between plan and confirm the
 * second call answers `consent-required` AGAIN with a fresh plan. That is a
 * normal outcome, not an error — {@link confirmInstall} swaps the dialog to the
 * new plan and asks again rather than throwing or silently retrying.
 *
 * Removing a marketplace deregisters it only; plugins already installed from it
 * stay installed (and stay resolvable, since resolution keys off the consent
 * store rather than the registration list). The confirm copy says so, and the
 * flat Installed section — sourced from `ListMarketplacesResult.installed`,
 * which is built from consent records rather than from the registered
 * marketplaces — is what keeps those plugins reachable afterwards. Without it a
 * deregistered marketplace would strand a still-running plugin with no way to
 * remove it.
 *
 * Suggestions come from `plugins:list-marketplaces` — the backend owns that
 * list. Nothing here hardcodes a marketplace slug.
 *
 * Complexity Level: 3 — list + add + per-source browse expansion + the
 * two-call consent state machine + per-id inflight tracking. Patterns: signal
 * state, per-key inflight Sets, presentational consent dialog, storefront
 * catalog cards (plan C13).
 */
@Component({
  selector: 'ptah-external-marketplaces',
  standalone: true,
  imports: [
    LucideAngularModule,
    CatalogCardComponent,
    CatalogCardSkeletonComponent,
    CatalogGridComponent,
    MonogramTileComponent,
    StorefrontPanelComponent,
    ExternalConsentDialogComponent,
    ExternalInstallReportComponent,
    ExternalInstalledRowComponent,
    ExternalPluginRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <!-- Add an owner/repo -->
      <ptah-storefront-panel
        heading="External marketplaces"
        subtitle="Add any GitHub repository that publishes a plugin marketplace, then browse and install its skills. Every install shows you exactly what lands on disk first."
        [headingLevel]="2"
      >
        <span
          panel-mark
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-secondary/20 bg-secondary/10 text-secondary"
          aria-hidden="true"
        >
          <lucide-angular [img]="StoreIcon" class="h-4 w-4" />
        </span>
        @if (addError()) {
          <div class="alert alert-error alert-sm py-1 px-2 mb-2" role="alert">
            <span class="text-xs">{{ addError() }}</span>
            <button
              class="btn btn-ghost btn-xs"
              type="button"
              (click)="addError.set(null)"
            >
              Dismiss
            </button>
          </div>
        }

        <form class="flex items-start gap-2" (submit)="addMarketplace($event)">
          <div class="flex-1 min-w-0">
            <input
              type="text"
              autocomplete="off"
              spellcheck="false"
              data-testid="marketplace-source"
              class="input input-bordered input-sm w-full text-xs font-mono"
              placeholder="owner/repo"
              [value]="sourceInput()"
              (input)="onSourceInput($event)"
              aria-label="Marketplace repository, as owner/repo"
              [attr.aria-invalid]="showSourceHint() ? 'true' : null"
            />
            @if (showSourceHint()) {
              <p class="text-[10px] text-error mt-1">
                Enter a GitHub repository as <code>owner/repo</code>.
              </p>
            }
          </div>
          <button
            type="submit"
            data-testid="marketplace-add"
            class="btn btn-primary btn-sm shrink-0"
            [disabled]="!canAdd()"
          >
            @if (isAdding()) {
              <span class="loading loading-spinner loading-xs"></span>
              Adding…
            } @else {
              <lucide-angular
                [img]="PlusIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
              Add
            }
          </button>
        </form>

        <!-- Suggestions come from the backend; nothing is hardcoded here. -->
        @if (suggestions().length > 0) {
          <div class="mt-3 space-y-1">
            <div
              class="text-[10px] text-base-content-muted uppercase tracking-wide font-medium"
            >
              Suggested
            </div>
            <div class="flex gap-1 flex-wrap">
              @for (suggestion of suggestions(); track suggestion.source) {
                <button
                  type="button"
                  class="btn btn-ghost btn-xs h-auto py-1 normal-case font-medium border-base-300 text-left"
                  [disabled]="isAdding()"
                  [attr.title]="suggestion.description"
                  [attr.aria-label]="
                    'Add ' + suggestion.name + '. ' + suggestion.description
                  "
                  (click)="addSuggestion(suggestion)"
                >
                  <lucide-angular
                    [img]="PlusIcon"
                    class="w-3 h-3 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="truncate max-w-[16rem]">{{
                    suggestion.name
                  }}</span>
                </button>
              }
            </div>
          </div>
        }
      </ptah-storefront-panel>

      <!-- Registered marketplaces -->
      <div>
        <h2 [class]="sectionHeadingClass">Registered</h2>

        @if (isLoading()) {
          <ptah-catalog-grid>
            @for (i of [1, 2]; track i) {
              <ptah-catalog-card-skeleton role="listitem" />
            }
          </ptah-catalog-grid>
        } @else if (loadError()) {
          <div class="alert alert-error alert-sm py-1 px-2" role="alert">
            <span class="text-xs">{{ loadError() }}</span>
            <button
              class="btn btn-ghost btn-xs"
              type="button"
              (click)="reload()"
            >
              Retry
            </button>
          </div>
        } @else if (marketplaces().length === 0) {
          <div
            class="text-xs text-base-content-muted text-center py-6 rounded-lg border border-dashed border-base-300"
          >
            No external marketplaces yet. Add an <code>owner/repo</code> above,
            or pick one of the suggestions.
          </div>
        } @else {
          <ptah-catalog-grid>
            @for (marketplace of marketplaces(); track marketplace.source) {
              <ptah-catalog-card
                role="listitem"
                [heading]="marketplace.name"
                [meta]="[
                  marketplace.source,
                  marketplace.pluginCount +
                    (marketplace.pluginCount === 1 ? ' plugin' : ' plugins'),
                ]"
              >
                <ptah-monogram-tile card-mark [label]="marketplace.name" />
                <!-- Remove confirmation: deregisters only. -->
                @if (pendingRemoveSource() === marketplace.source) {
                  <div
                    card-status
                    class="rounded-lg border border-warning/40 bg-warning/10 p-2 space-y-1.5"
                  >
                    <p class="text-[11px] text-base-content">
                      Remove
                      <span class="font-mono">{{ marketplace.source }}</span
                      >? You will stop seeing its plugins here.
                      <span class="font-medium">
                        Plugins you already installed from it are NOT
                        uninstalled
                      </span>
                      — remove those individually if you want them gone.
                    </p>
                    <div class="flex gap-1 justify-end">
                      <button
                        class="btn btn-ghost btn-xs"
                        type="button"
                        (click)="pendingRemoveSource.set(null)"
                      >
                        Keep
                      </button>
                      <button
                        class="btn btn-error btn-xs"
                        type="button"
                        (click)="removeMarketplace(marketplace)"
                      >
                        Remove marketplace
                      </button>
                    </div>
                  </div>
                }
                <div card-actions class="flex items-center gap-2">
                  <button
                    class="btn btn-ghost btn-sm border-base-300"
                    type="button"
                    [disabled]="isBrowsing(marketplace.source)"
                    [attr.aria-expanded]="
                      expandedSource() === marketplace.source
                    "
                    [attr.aria-label]="'Browse ' + marketplace.source"
                    (click)="toggleBrowse(marketplace)"
                  >
                    @if (isBrowsing(marketplace.source)) {
                      <span class="loading loading-spinner loading-xs"></span>
                    } @else {
                      <lucide-angular
                        [img]="ChevronRightIcon"
                        class="w-3 h-3 transition-transform motion-reduce:transition-none"
                        [class.rotate-90]="
                          expandedSource() === marketplace.source
                        "
                        aria-hidden="true"
                      />
                    }
                    Browse
                  </button>
                  <button
                    class="btn btn-ghost btn-sm text-error"
                    type="button"
                    [disabled]="removingSources().has(marketplace.source)"
                    [attr.aria-label]="'Remove ' + marketplace.source"
                    (click)="requestRemove(marketplace)"
                  >
                    @if (removingSources().has(marketplace.source)) {
                      <span class="loading loading-spinner loading-xs"></span>
                    } @else {
                      <lucide-angular
                        [img]="Trash2Icon"
                        class="w-3 h-3"
                        aria-hidden="true"
                      />
                      Remove
                    }
                  </button>
                </div>
              </ptah-catalog-card>

              <!-- Browse results: a full-width panel under the source card. -->
              @if (expandedSource() === marketplace.source) {
                <div role="listitem" class="col-span-full">
                  <ptah-storefront-panel
                    [heading]="'Plugins in ' + marketplace.name"
                    [subtitle]="marketplace.source"
                  >
                    @if (browseError()) {
                      <div
                        class="alert alert-error alert-sm py-1 px-2 mb-3"
                        role="alert"
                      >
                        <span class="text-xs">{{ browseError() }}</span>
                        <button
                          class="btn btn-ghost btn-xs"
                          type="button"
                          (click)="
                            refreshBrowse(marketplace.source, { refresh: true })
                          "
                        >
                          Retry
                        </button>
                      </div>
                    } @else if (
                      isBrowsing(marketplace.source) && listings().length === 0
                    ) {
                      <ptah-catalog-grid>
                        @for (i of [1, 2]; track i) {
                          <ptah-catalog-card-skeleton role="listitem" />
                        }
                      </ptah-catalog-grid>
                    } @else if (listings().length === 0) {
                      <div
                        class="text-[11px] text-base-content-muted text-center py-3"
                      >
                        This marketplace advertises no plugins.
                      </div>
                    }

                    @if (listings().length > 0) {
                      <ptah-catalog-grid>
                        @for (listing of listings(); track listing.id) {
                          <ptah-external-plugin-row
                            role="listitem"
                            [listing]="listing"
                            [installing]="installingIds().has(listing.id)"
                            [uninstalling]="uninstallingIds().has(listing.id)"
                            (installRequested)="install(listing)"
                            (uninstallRequested)="uninstall(listing)"
                          />
                        }
                      </ptah-catalog-grid>
                    }
                  </ptah-storefront-panel>
                </div>
              }
            }
          </ptah-catalog-grid>
        }
      </div>

      <!--
        Installed plugins, flat. Built from consent records, so it still lists a
        plugin whose marketplace was deregistered — the only surface that can
        uninstall one.
      -->
      @if (installed().length > 0) {
        <div>
          <h2 [class]="sectionHeadingClass">Installed</h2>
          <ptah-catalog-grid>
            @for (entry of installed(); track entry.id) {
              <ptah-external-installed-row
                role="listitem"
                [listing]="entry"
                [orphaned]="isOrphaned(entry)"
                [uninstalling]="uninstallingIds().has(entry.id)"
                [error]="uninstallErrors()[entry.id] ?? null"
                (uninstallRequested)="uninstall(entry)"
              />
            }
          </ptah-catalog-grid>
        </div>
      }

      <!-- Post-install report: only what the user still needs to know. -->
      @if (lastInstall(); as report) {
        <ptah-external-install-report
          [report]="report"
          (dismissed)="lastInstall.set(null)"
        />
      }

      <div class="flex justify-end">
        <button
          class="btn btn-ghost btn-xs"
          type="button"
          [disabled]="isLoading()"
          (click)="reload()"
        >
          <lucide-angular
            [img]="RefreshCwIcon"
            class="w-3 h-3"
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>
    </div>

    @if (pendingPlan(); as plan) {
      <ptah-external-consent-dialog
        [plan]="plan"
        [reason]="pendingReason()"
        [busy]="isConfirming()"
        [errorMessage]="consentError()"
        (confirmed)="confirmInstall()"
        (cancelled)="cancelInstall()"
      />
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ExternalMarketplacesComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  /** Increment to reload the marketplace list (parity with the other surfaces). */
  public readonly refreshTrigger = input(0);

  /** Emitted with the plugin id after an install the backend confirmed. */
  public readonly pluginInstalled = output<string>();
  /** Emitted with the plugin id after an uninstall removed the plugin. */
  public readonly pluginUninstalled = output<string>();

  protected readonly sectionHeadingClass =
    'text-[11px] text-base-content-muted uppercase tracking-wide mb-1.5 font-medium';
  protected readonly StoreIcon = Store;
  protected readonly PlusIcon = Plus;
  protected readonly Trash2Icon = Trash2;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly ChevronRightIcon = ChevronRight;

  // ── Registered list ─────────────────────────────────────────────────────────

  public readonly marketplaces = signal<ExternalMarketplace[]>([]);
  public readonly suggestions = signal<SuggestedMarketplace[]>([]);
  /**
   * Every plugin with a consent record, independent of the marketplace list.
   * Includes plugins whose marketplace has since been deregistered.
   */
  public readonly installed = signal<ExternalPluginListing[]>([]);
  public readonly isLoading = signal(false);
  public readonly loadError = signal<string | null>(null);

  // ── Add form ────────────────────────────────────────────────────────────────

  public readonly sourceInput = signal('');
  public readonly isAdding = signal(false);
  public readonly addError = signal<string | null>(null);

  /** True when the typed slug matches `owner/repo`. Empty input is not "invalid". */
  public readonly isSourceValid = computed(() =>
    SOURCE_PATTERN.test(this.sourceInput().trim()),
  );

  /** Inline hint only once the user has typed something that cannot be a slug. */
  public readonly showSourceHint = computed(
    () => this.sourceInput().trim().length > 0 && !this.isSourceValid(),
  );

  /** Add is enabled only for a well-formed slug with no add in flight. */
  public readonly canAdd = computed(
    () => this.isSourceValid() && !this.isAdding(),
  );

  /** Source awaiting removal confirmation, or null. */
  public readonly pendingRemoveSource = signal<string | null>(null);
  public readonly removingSources = signal<Set<string>>(new Set());

  // ── Browse ──────────────────────────────────────────────────────────────────

  /** The single expanded marketplace, or null when all are collapsed. */
  public readonly expandedSource = signal<string | null>(null);
  public readonly listings = signal<ExternalPluginListing[]>([]);
  public readonly browsingSources = signal<Set<string>>(new Set());
  public readonly browseError = signal<string | null>(null);

  // ── Install / consent ───────────────────────────────────────────────────────

  /**
   * The plan returned by the tokenless first call. Non-null ⇒ the consent
   * dialog is on screen and NOTHING has been written yet.
   */
  public readonly pendingPlan = signal<ExternalInstallPlan | null>(null);
  /**
   * Why the dialog is open. `approval-expired` means a token was presented and
   * rejected, so the dialog says so instead of silently re-appearing.
   */
  public readonly pendingReason =
    signal<ExternalConsentReason>('not-yet-approved');
  /** True while the authorized (token-carrying) second call is in flight. */
  public readonly isConfirming = signal(false);
  /** Error rendered inside the dialog, without dismissing it. */
  public readonly consentError = signal<string | null>(null);
  /** Listing ids with a first (plan) call in flight. */
  public readonly installingIds = signal<Set<string>>(new Set());
  public readonly uninstallingIds = signal<Set<string>>(new Set());
  /** Failed uninstalls (by id) whose source has no open browse panel. */
  public readonly uninstallErrors = signal<Readonly<Record<string, string>>>(
    {},
  );
  /** Result of the most recent successful install, for the post-install report. */
  public readonly lastInstall = signal<ExternalInstallResult | null>(null);

  /** Reload when the host bumps `refreshTrigger` (skips the initial 0). */
  private readonly refreshEffect = effect(() => {
    if (this.refreshTrigger() > 0) {
      void this.loadMarketplaces();
    }
  });

  public async ngOnInit(): Promise<void> {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    await this.loadMarketplaces();
  }

  // ── Registered list ─────────────────────────────────────────────────────────

  /**
   * Public re-entry for the Retry / Refresh buttons.
   *
   * An explicit user refresh also bypasses the manifest TTL cache for the
   * expanded marketplace — otherwise pressing Refresh could not change the
   * answer, which is the whole point of pressing it.
   */
  public reload(): void {
    void this.loadMarketplaces();
    const expanded = this.expandedSource();
    if (expanded !== null) {
      void this.refreshBrowse(expanded, { refresh: true });
    }
  }

  /** True when this installed plugin's marketplace is no longer registered. */
  public isOrphaned(listing: ExternalPluginListing): boolean {
    return !this.marketplaces().some((m) => m.source === listing.source);
  }

  private async loadMarketplaces(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set(null);
    try {
      const result = await this.rpc.call('plugins:list-marketplaces', {});
      if (this.destroyed) return;
      if (result.isSuccess()) {
        // Guard each list: a reply missing one of them would write `undefined`
        // into a signal the template reads `.length` off, which throws on every
        // change-detection pass and silently freezes the rest of this
        // component's bindings rather than failing loudly.
        this.marketplaces.set(result.data.marketplaces ?? []);
        this.suggestions.set(result.data.suggestions ?? []);
        this.installed.set(result.data.installed ?? []);
      } else {
        this.loadError.set(result.error ?? 'Failed to load marketplaces');
        this.marketplaces.set([]);
        this.suggestions.set([]);
        this.installed.set([]);
      }
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.loadError.set(messageOf(error, 'Failed to load marketplaces'));
      this.marketplaces.set([]);
      this.suggestions.set([]);
      this.installed.set([]);
    } finally {
      if (!this.destroyed) this.isLoading.set(false);
    }
  }

  // ── Add ─────────────────────────────────────────────────────────────────────

  public onSourceInput(event: Event): void {
    this.sourceInput.set((event.target as HTMLInputElement).value);
    this.addError.set(null);
  }

  /** Add the typed slug. Client validation is feedback; the backend re-validates. */
  public async addMarketplace(event?: Event): Promise<void> {
    event?.preventDefault();
    if (!this.canAdd()) return;
    const added = await this.addSource(this.sourceInput().trim());
    if (added && !this.destroyed) {
      this.sourceInput.set('');
    }
  }

  /** One-click add from a backend-provided suggestion. */
  public async addSuggestion(suggestion: SuggestedMarketplace): Promise<void> {
    if (this.isAdding()) return;
    await this.addSource(suggestion.source);
  }

  private async addSource(source: string): Promise<boolean> {
    if (source.length === 0) return false;
    this.isAdding.set(true);
    this.addError.set(null);
    try {
      const result = await this.rpc.call('plugins:add-marketplace', { source });
      if (this.destroyed) return false;
      if (!result.isSuccess()) {
        this.addError.set(result.error ?? `Failed to add ${source}`);
        return false;
      }
      await this.loadMarketplaces();
      return true;
    } catch (error: unknown) {
      if (this.destroyed) return false;
      this.addError.set(messageOf(error, `Failed to add ${source}`));
      return false;
    } finally {
      if (!this.destroyed) this.isAdding.set(false);
    }
  }

  // ── Remove ──────────────────────────────────────────────────────────────────

  /** Open the confirm affordance. Deregistering never uninstalls plugins. */
  public requestRemove(marketplace: ExternalMarketplace): void {
    this.pendingRemoveSource.set(marketplace.source);
  }

  public async removeMarketplace(
    marketplace: ExternalMarketplace,
  ): Promise<void> {
    const source = marketplace.source;
    if (this.removingSources().has(source)) return;
    this.pendingRemoveSource.set(null);
    addToSet(this.removingSources, source);
    this.loadError.set(null);
    try {
      const result = await this.rpc.call('plugins:remove-marketplace', {
        source,
      });
      if (this.destroyed) return;
      if (!result.isSuccess()) {
        this.loadError.set(result.error ?? `Failed to remove ${source}`);
        return;
      }
      if (this.expandedSource() === source) {
        this.collapseBrowse();
      }
      await this.loadMarketplaces();
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.loadError.set(messageOf(error, `Failed to remove ${source}`));
    } finally {
      if (!this.destroyed) removeFromSet(this.removingSources, source);
    }
  }

  // ── Browse ──────────────────────────────────────────────────────────────────

  public isBrowsing(source: string): boolean {
    return this.browsingSources().has(source);
  }

  /** Expand a marketplace (fetching its listings) or collapse the open one. */
  public async toggleBrowse(marketplace: ExternalMarketplace): Promise<void> {
    if (this.expandedSource() === marketplace.source) {
      this.collapseBrowse();
      return;
    }
    await this.refreshBrowse(marketplace.source);
  }

  /**
   * Fetch (or re-fetch) the listings for a source and expand it.
   *
   * `refresh` bypasses the backend's manifest TTL cache and is sent ONLY for an
   * explicit user Retry/Refresh. Ordinary browsing, and the re-read after an
   * install or uninstall, leave it unset: `installed` is derived from the local
   * consent store rather than the manifest, so those re-reads do not need a
   * fresh GitHub fetch and must not spend one.
   */
  public async refreshBrowse(
    source: string,
    options?: { refresh?: boolean },
  ): Promise<void> {
    if (this.browsingSources().has(source)) return;
    this.expandedSource.set(source);
    this.browseError.set(null);
    addToSet(this.browsingSources, source);
    try {
      const params: { source: string; refresh?: boolean } = { source };
      if (options?.refresh === true) {
        params.refresh = true;
      }
      const result = await this.rpc.call('plugins:browse-marketplace', params);
      if (this.destroyed) return;
      if (result.isSuccess()) {
        this.listings.set(result.data.plugins ?? []);
      } else {
        this.browseError.set(result.error ?? `Failed to browse ${source}`);
        this.listings.set([]);
      }
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.browseError.set(messageOf(error, `Failed to browse ${source}`));
      this.listings.set([]);
    } finally {
      if (!this.destroyed) removeFromSet(this.browsingSources, source);
    }
  }

  private collapseBrowse(): void {
    this.expandedSource.set(null);
    this.listings.set([]);
    this.browseError.set(null);
  }

  // ── Install: call 1 of 2 (no token, writes nothing) ─────────────────────────

  /**
   * FIRST call. Deliberately omits `consentToken`, so the backend returns a
   * plan and touches no files. The plan opens the consent dialog; installing is
   * only ever authorized from {@link confirmInstall}.
   */
  public async install(listing: ExternalPluginListing): Promise<void> {
    if (this.installingIds().has(listing.id) || this.pendingPlan() !== null) {
      return;
    }
    addToSet(this.installingIds, listing.id);
    this.consentError.set(null);
    this.browseError.set(null);
    try {
      const result = await this.rpc.call('plugins:install-external', {
        source: listing.source,
        plugin: listing.name,
      });
      if (this.destroyed) return;
      if (!result.isSuccess()) {
        this.browseError.set(result.error ?? `Failed to plan ${listing.name}`);
        return;
      }
      if (result.data.status === 'consent-required') {
        // No token was sent, so a missing reason can only mean the ordinary
        // first ask.
        this.pendingReason.set(result.data.reason ?? 'not-yet-approved');
        this.pendingPlan.set(result.data.plan);
        return;
      }
      // Defensive: the contract says a tokenless call cannot install, but if a
      // backend ever answers 'installed' the UI must still report it truthfully.
      await this.applyInstalled(result.data.result, listing.source);
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.browseError.set(messageOf(error, `Failed to plan ${listing.name}`));
    } finally {
      if (!this.destroyed) removeFromSet(this.installingIds, listing.id);
    }
  }

  // ── Install: call 2 of 2 (carries the plan's token) ─────────────────────────

  /**
   * SECOND call, echoing back exactly `plan.consentToken`.
   *
   * A `consent-required` answer here means the token was presented and did not
   * validate. The backend reports that as `approval-expired`, which covers a
   * lapsed plan TTL, a host restart that lost the pending plan, AND upstream
   * content changing — so the UI must not assert which one happened. It swaps
   * in the freshly built plan, carries the reason into the dialog so the copy
   * can explain itself, and asks again. Never an error, never a retry with the
   * old token.
   */
  public async confirmInstall(): Promise<void> {
    const plan = this.pendingPlan();
    if (plan === null || this.isConfirming()) return;
    this.isConfirming.set(true);
    this.consentError.set(null);
    try {
      const result = await this.rpc.call('plugins:install-external', {
        source: plan.source,
        plugin: plan.plugin,
        consentToken: plan.consentToken,
      });
      if (this.destroyed) return;
      if (!result.isSuccess()) {
        this.consentError.set(
          result.error ?? `Failed to install ${plan.displayName}`,
        );
        return;
      }
      if (result.data.status === 'consent-required') {
        // A token WAS presented and did not validate, so this is a re-approval
        // whatever the payload says — defaulting to the first-ask copy here
        // would tell the user their approval is still pending when it was in
        // fact rejected.
        this.pendingReason.set(result.data.reason ?? 'approval-expired');
        this.pendingPlan.set(result.data.plan);
        return;
      }
      this.pendingPlan.set(null);
      await this.applyInstalled(result.data.result, plan.source);
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.consentError.set(
        messageOf(error, `Failed to install ${plan.displayName}`),
      );
    } finally {
      if (!this.destroyed) this.isConfirming.set(false);
    }
  }

  /** Decline. Fires NO RPC — nothing was written, so nothing needs undoing. */
  public cancelInstall(): void {
    this.pendingPlan.set(null);
    this.pendingReason.set('not-yet-approved');
    this.consentError.set(null);
  }

  /**
   * Record the outcome, then re-read both lists so `installed` comes from the
   * backend rather than from this component's optimism. Neither re-read asks
   * for a cache bypass — installed state is local, not manifest-derived.
   */
  private async applyInstalled(
    result: ExternalInstallResult,
    source: string,
  ): Promise<void> {
    this.lastInstall.set(result);
    this.pluginInstalled.emit(result.pluginId);
    await this.loadMarketplaces();
    if (this.expandedSource() === source) {
      await this.refreshBrowse(source);
    }
  }

  // ── Uninstall ───────────────────────────────────────────────────────────────

  /**
   * Remove an installed external plugin: `removed: true` means the directory
   * is gone AND the consent record is dropped, so the id no longer resolves.
   *
   * Reachable from a browse row and from the flat Installed list, so it must
   * NOT assume the plugin's marketplace is expanded — or even registered. It
   * re-reads the flat list unconditionally and the browse list only when that
   * marketplace happens to be open (never expanding one as a side effect).
   * A failure shows in the open browse panel of that source, else on the
   * plugin's Installed card — the only place an orphaned plugin renders.
   */
  public async uninstall(listing: ExternalPluginListing): Promise<void> {
    if (this.uninstallingIds().has(listing.id)) return;
    addToSet(this.uninstallingIds, listing.id);
    if (this.expandedSource() === listing.source) this.browseError.set(null);
    this.uninstallErrors.update(({ [listing.id]: _cleared, ...rest }) => rest);
    const fallback = `Failed to uninstall ${listing.name}`;
    try {
      const result = await this.rpc.call('plugins:uninstall-external', {
        pluginId: listing.id,
      });
      if (this.destroyed) return;
      if (!result.isSuccess()) {
        this.uninstallFailed(listing, result.error ?? fallback);
        return;
      }
      this.lastInstall.set(null);
      // `removed: false` means there was no record, so nothing changed.
      if (result.data.removed) this.pluginUninstalled.emit(listing.id);
      await this.loadMarketplaces();
      if (!this.destroyed && this.expandedSource() === listing.source) {
        await this.refreshBrowse(listing.source);
      }
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.uninstallFailed(listing, messageOf(error, fallback));
    } finally {
      if (!this.destroyed) removeFromSet(this.uninstallingIds, listing.id);
    }
  }

  private uninstallFailed(item: ExternalPluginListing, message: string): void {
    if (this.expandedSource() === item.source) {
      this.browseError.set(message);
    } else {
      this.uninstallErrors.update((prev) => ({ ...prev, [item.id]: message }));
    }
  }
}

/** Narrow an unknown throwable to a displayable message. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function addToSet(
  sig: ReturnType<typeof signal<Set<string>>>,
  value: string,
): void {
  sig.update((s) => new Set([...s, value]));
}

function removeFromSet(
  sig: ReturnType<typeof signal<Set<string>>>,
  value: string,
): void {
  sig.update((s) => {
    const next = new Set(s);
    next.delete(value);
    return next;
  });
}
