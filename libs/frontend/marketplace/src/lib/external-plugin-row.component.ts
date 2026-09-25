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
 * ExternalPluginRowComponent — one plugin advertised by an external marketplace.
 *
 * PURELY PRESENTATIONAL: it fires no RPC and holds no install state. Pressing
 * Install only emits `installRequested`; the parent is what starts the two-call
 * consent protocol. That separation is what keeps the rule "a click never
 * installs anything on its own" checkable in one place.
 *
 * Renders a storefront `ptah-catalog-card` (plan C13): a monogram mark, the
 * `owner/repo` source and version as meta, an Installed badge, and the
 * actions. The parent places this host in a `ptah-catalog-grid` with
 * `role="listitem"`, under the heading of the marketplace it belongs to, so the
 * card heading is one level below it (h4).
 *
 * Carries the e2e contract for a plugin row: the card is tagged
 * `external-plugin-<id>` with `listing.id` VERBATIM (e.g.
 * `external:dotnet/skills/dotnet-test`), and the install button is tagged
 * `external-install`.
 *
 * Complexity Level: 1 — three inputs, two outputs, two derived values.
 */
@Component({
  selector: 'ptah-external-plugin-row',
  standalone: true,
  imports: [CatalogCardComponent, MonogramTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-catalog-card
      class="flex-1"
      [attr.data-testid]="'external-plugin-' + listing().id"
      [heading]="listing().name"
      [headingLevel]="4"
      [description]="listing().description || 'No description provided'"
      [meta]="meta()"
      [badge]="badge()"
    >
      <ptah-monogram-tile card-mark [label]="listing().name" />
      @if (upgradeLabel(); as label) {
        <p card-status class="text-[11px] text-warning">{{ label }}</p>
      }
      <div card-actions class="flex items-center gap-2">
        @if (listing().installed) {
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
        }
        <button
          class="btn btn-sm"
          type="button"
          data-testid="external-install"
          [class.btn-primary]="!listing().installed"
          [class.btn-ghost]="listing().installed"
          [class.border-base-300]="listing().installed"
          [disabled]="installing()"
          [attr.aria-label]="
            (listing().installed ? 'Reinstall ' : 'Install ') + listing().name
          "
          (click)="installRequested.emit()"
        >
          @if (installing()) {
            <span class="loading loading-spinner loading-xs"></span>
          } @else if (listing().installed) {
            Reinstall
          } @else {
            Install
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
export class ExternalPluginRowComponent {
  public readonly listing = input.required<ExternalPluginListing>();
  /** True while the parent's tokenless plan request is in flight. */
  public readonly installing = input(false);
  public readonly uninstalling = input(false);

  /** User asked to install — the parent starts the two-call consent protocol. */
  public readonly installRequested = output<void>();
  public readonly uninstallRequested = output<void>();

  protected readonly badge = computed<CatalogCardBadge | null>(() =>
    this.listing().installed ? { label: 'Installed', tone: 'success' } : null,
  );

  /** The card meta line: the `owner/repo` source, then the advertised version. */
  protected readonly meta = computed(() => [
    this.listing().source,
    this.listing().version ?? '',
  ]);

  /**
   * Hint shown on an installed row whose marketplace now advertises a different
   * version. Reinstalling re-enters the consent dialog, because the consent
   * token is bound to the version.
   */
  public readonly upgradeLabel = computed<string | null>(() => {
    const listing = this.listing();
    if (!listing.installed) return null;
    const available = listing.version;
    const installed = listing.installedVersion;
    if (!available || !installed || available === installed) return null;
    return `Installed ${installed} · ${available} available — reinstall to update.`;
  });
}
