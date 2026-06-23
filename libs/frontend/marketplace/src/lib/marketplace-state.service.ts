import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { MARKETPLACE_PROVIDERS } from './providers.registry';
import { MarketplaceProviderSpec } from './provider-spec';

/**
 * Owns the marketplace's selected-provider selection and an in-view refresh
 * trigger. Selection is persisted through {@link AppStateManager} (mirroring
 * the Thoth active-tab pattern) so navigating away from and back to the
 * Marketplace view restores the user's last provider.
 *
 * The {@link refreshTrigger} signal is incremented after an install/uninstall
 * so the active surface re-loads its installed list without a full remount.
 */
@Injectable({ providedIn: 'root' })
export class MarketplaceStateService {
  private readonly appState = inject(AppStateManager);

  private readonly _selectedProviderId = signal<string | null>(
    this.resolveInitialProviderId(),
  );
  /** Currently selected provider id (null = no selection / show overview). */
  public readonly selectedProviderId = this._selectedProviderId.asReadonly();

  private readonly _refreshTrigger = signal(0);
  /** Increment-on-change counter consumed by surfaces to reload installed state. */
  public readonly refreshTrigger = this._refreshTrigger.asReadonly();

  /** Resolved descriptor for the current selection (null when none/invalid). */
  public readonly selectedProvider = computed<MarketplaceProviderSpec | null>(
    () => {
      const id = this._selectedProviderId();
      if (!id) return null;
      return MARKETPLACE_PROVIDERS.find((p) => p.id === id) ?? null;
    },
  );

  public constructor() {
    // Persist selection so re-entering the marketplace view restores it.
    effect(() => {
      this.appState.setMarketplaceActiveProvider(this._selectedProviderId());
    });
  }

  /** Select a provider by id (validated against the registry). */
  public select(id: string): void {
    const exists = MARKETPLACE_PROVIDERS.some((p) => p.id === id);
    this._selectedProviderId.set(exists ? id : null);
  }

  /** Clear the current selection (return to the provider overview). */
  public clearSelection(): void {
    this._selectedProviderId.set(null);
  }

  /** Signal that installed content changed so surfaces reload in-view. */
  public notifyContentChanged(): void {
    this._refreshTrigger.update((n) => n + 1);
  }

  private resolveInitialProviderId(): string | null {
    const persisted = this.appState.marketplaceActiveProvider();
    if (persisted && MARKETPLACE_PROVIDERS.some((p) => p.id === persisted)) {
      return persisted;
    }
    return null;
  }
}
