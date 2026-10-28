import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';

/** Design-spec "library stale" row, Marketplace copy (C10). */
export const INSTALLED_LIBRARY_STALE_COPY =
  'The Library may be out of date until its next refresh.';

/**
 * C10 on the installed page: a non-fatal warning while the inventory says the
 * last Library pass for this workspace's root failed after its files were
 * written ({@link MarketplaceInventoryStore.libraryPassFailed}). The page
 * renders it in Electron only; the store keeps it `false` elsewhere too.
 */
@Component({
  selector: 'ptah-installed-library-stale-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block empty:hidden' },
  template: `
    @if (failed()) {
      <div
        class="alert alert-warning block text-xs"
        role="status"
        data-testid="installed-library-stale-notice"
      >
        {{ copy }}
      </div>
    }
  `,
})
export class InstalledLibraryStaleNoticeComponent {
  protected readonly failed = inject(MarketplaceInventoryStore)
    .libraryPassFailed;
  protected readonly copy = INSTALLED_LIBRARY_STALE_COPY;
}
