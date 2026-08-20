import { Injectable, inject, signal, computed } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { MARKETPLACE_PROVIDERS } from './providers.registry';
import { MarketplaceProviderSpec } from './provider-spec';

/**
 * Owns the marketplace's selected-provider selection and an in-view refresh
 * trigger. Selection lives in {@link AppStateManager} (mirroring the Thoth
 * active-tab pattern) so navigating away from and back to the Marketplace view
 * restores the user's last provider.
 *
 * {@link AppStateManager} is the single source of truth, read through a
 * `computed` rather than snapshotted into a local signal. This service is
 * `providedIn: 'root'`, so a snapshot taken in the field initializer would be
 * read exactly once for the lifetime of the app and the selection would then
 * survive a workspace switch even though the app-state value behind it is
 * partitioned per workspace (TASK_2026_228). Deriving also removes the
 * write-back `effect` the snapshot needed to stay in sync.
 *
 * The {@link refreshTrigger} signal is incremented after an install/uninstall
 * so the active surface re-loads its installed list without a full remount.
 */
@Injectable({ providedIn: 'root' })
export class MarketplaceStateService {
  private readonly appState = inject(AppStateManager);

  /**
   * Currently selected provider id (null = no selection / show overview).
   * Validated against the registry on read so a stale or unknown persisted id
   * degrades to the overview rather than to a blank surface.
   */
  public readonly selectedProviderId = computed<string | null>(() => {
    const id = this.appState.marketplaceActiveProvider();
    if (!id) return null;
    return MARKETPLACE_PROVIDERS.some((p) => p.id === id) ? id : null;
  });

  private readonly _refreshTrigger = signal(0);
  /** Increment-on-change counter consumed by surfaces to reload installed state. */
  public readonly refreshTrigger = this._refreshTrigger.asReadonly();

  /** Resolved descriptor for the current selection (null when none/invalid). */
  public readonly selectedProvider = computed<MarketplaceProviderSpec | null>(
    () => {
      const id = this.selectedProviderId();
      if (!id) return null;
      return MARKETPLACE_PROVIDERS.find((p) => p.id === id) ?? null;
    },
  );

  /** Select a provider by id (validated against the registry). */
  public select(id: string): void {
    const exists = MARKETPLACE_PROVIDERS.some((p) => p.id === id);
    this.appState.setMarketplaceActiveProvider(exists ? id : null);
  }

  /** Clear the current selection (return to the provider overview). */
  public clearSelection(): void {
    this.appState.setMarketplaceActiveProvider(null);
  }

  /** Signal that installed content changed so surfaces reload in-view. */
  public notifyContentChanged(): void {
    this._refreshTrigger.update((n) => n + 1);
  }
}
