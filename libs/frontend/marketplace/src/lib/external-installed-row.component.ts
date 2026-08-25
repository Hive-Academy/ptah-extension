import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Check, Unlink } from 'lucide-angular';
import type { ExternalPluginListing } from '@ptah-extension/shared';

/**
 * ExternalInstalledRowComponent — one row of the flat "Installed" list, built
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
 * Complexity Level: 1 — three inputs, one output, no state.
 */
@Component({
  selector: 'ptah-external-installed-row',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-lg border border-base-300 bg-base-200/30 p-2 flex items-start gap-2"
      [attr.data-testid]="'external-installed-' + listing().id"
    >
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-xs font-medium text-base-content truncate">{{
            listing().name
          }}</span>
          @if (listing().installedVersion) {
            <span class="badge badge-xs badge-ghost font-mono text-[10px]">{{
              listing().installedVersion
            }}</span>
          }
          <span class="badge badge-xs badge-primary text-[10px] gap-0.5">
            <lucide-angular
              [img]="CheckIcon"
              class="w-2 h-2"
              aria-hidden="true"
            />
            Installed
          </span>
          @if (orphaned()) {
            <span class="badge badge-xs badge-warning text-[10px] gap-0.5">
              <lucide-angular
                [img]="UnlinkIcon"
                class="w-2 h-2"
                aria-hidden="true"
              />
              Marketplace removed
            </span>
          }
        </div>
        <div
          class="text-[10px] text-base-content-muted font-mono mt-0.5 truncate"
        >
          {{ listing().source }}
        </div>
        @if (orphaned()) {
          <p class="text-[10px] text-base-content-muted mt-0.5">
            Still installed and active. Its marketplace is no longer registered,
            so it cannot be browsed or updated — re-add
            <span class="font-mono">{{ listing().source }}</span> to do that.
          </p>
        }
      </div>

      <div class="shrink-0">
        <button
          class="btn btn-ghost btn-xs text-error"
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
export class ExternalInstalledRowComponent {
  public readonly listing = input.required<ExternalPluginListing>();
  /** True when this plugin's marketplace is no longer registered. */
  public readonly orphaned = input(false);
  public readonly uninstalling = input(false);

  public readonly uninstallRequested = output<void>();

  protected readonly CheckIcon = Check;
  protected readonly UnlinkIcon = Unlink;
}
