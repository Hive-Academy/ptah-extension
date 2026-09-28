import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import {
  CatalogCardComponent,
  MonogramTileComponent,
  type CatalogCardBadge,
} from '@ptah-extension/ui';
import type { ExternalPluginListing } from '@ptah-extension/shared';

/**
 * ExternalInstalledRowComponent — one card of the flat "Installed" list, built
 * from consent records rather than from any marketplace manifest.
 *
 * Deliberately NOT {@link ExternalPluginRowComponent}. These are different
 * rows for a reason:
 *  - there is no Install action here. Installing requires a REGISTERED
 *    marketplace, and an entry in this list may have outlived its marketplace,
 *    so offering Install would present an action that cannot succeed;
 *  - the two lists overlap. An installed plugin whose marketplace is expanded
 *    appears in BOTH, so they must not share a `data-testid` value or an e2e
 *    lookup would match two elements. Browse rows own `external-plugin-<id>`;
 *    these own `external-installed-<id>`;
 *  - `path` is `''` on these entries (no manifest behind them), so nothing here
 *    displays it.
 *
 * Renders a storefront `ptah-catalog-card` (plan C13) whose badge carries the
 * installed version; a deregistered marketplace is called out in the status
 * slot, in words.
 *
 * Complexity Level: 1 — three inputs, one output, one derived badge.
 */
@Component({
  selector: 'ptah-external-installed-row',
  standalone: true,
  imports: [CatalogCardComponent, MonogramTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-catalog-card
      class="flex-1"
      [attr.data-testid]="'external-installed-' + listing().id"
      [heading]="listing().name"
      [meta]="[listing().source]"
      [badge]="badge()"
    >
      <ptah-monogram-tile card-mark [label]="listing().name" />
      @if (orphaned()) {
        <div card-status class="space-y-0.5 text-[11px]">
          <p class="font-medium text-warning">Marketplace removed</p>
          <p class="text-base-content-muted">
            Still installed and active. Its marketplace is no longer registered,
            so it cannot be browsed or updated — re-add
            <span class="font-mono">{{ listing().source }}</span> to do that.
          </p>
        </div>
      }
      @if (error(); as message) {
        <p
          card-status
          class="mt-1 text-[11px] text-error first:mt-0"
          role="alert"
        >
          {{ message }}
        </p>
      }
      <div card-actions class="flex items-center gap-2">
        <button
          class="btn btn-ghost btn-sm text-error"
          type="button"
          [disabled]="uninstalling()"
          [attr.aria-label]="'Uninstall ' + listing().name"
          (click)="uninstallRequested.emit()"
        >
          @if (uninstalling()) {
            <span class="loading loading-spinner loading-xs"></span>
          } @else {
            Uninstall
          }
        </button>
      </div>
    </ptah-catalog-card>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
    `,
  ],
})
export class ExternalInstalledRowComponent {
  public readonly listing = input.required<ExternalPluginListing>();
  /** True when this plugin's marketplace is no longer registered. */
  public readonly orphaned = input(false);
  public readonly uninstalling = input(false);
  /** Why the last uninstall of this plugin failed, or null. */
  public readonly error = input<string | null>(null);

  public readonly uninstallRequested = output<void>();

  /** "Installed <version>", or plain "Installed" when none was recorded. */
  protected readonly badge = computed<CatalogCardBadge>(() => {
    const version = this.listing().installedVersion;
    return {
      label: version ? `Installed ${version}` : 'Installed',
      tone: 'success',
    };
  });
}
