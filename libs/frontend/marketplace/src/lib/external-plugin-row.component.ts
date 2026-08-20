import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Check } from 'lucide-angular';
import type { ExternalPluginListing } from '@ptah-extension/shared';

/**
 * ExternalPluginRowComponent — one plugin advertised by an external marketplace.
 *
 * PURELY PRESENTATIONAL: it fires no RPC and holds no install state. Pressing
 * Install only emits `installRequested`; the parent is what starts the two-call
 * consent protocol. That separation is what keeps the rule "a click never
 * installs anything on its own" checkable in one place.
 *
 * Carries the e2e contract for a plugin row: the root is tagged
 * `external-plugin-<id>` with `listing.id` VERBATIM (e.g.
 * `external:dotnet/skills/dotnet-test`), and the install button is tagged
 * `external-install`.
 *
 * Complexity Level: 1 — three inputs, two outputs, one derived label.
 */
@Component({
  selector: 'ptah-external-plugin-row',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-lg border border-base-300 bg-base-100/40 p-2 flex items-start gap-2"
      [attr.data-testid]="'external-plugin-' + listing().id"
    >
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="text-xs font-medium text-base-content truncate">{{
            listing().name
          }}</span>
          @if (listing().version) {
            <span class="badge badge-xs badge-ghost font-mono text-[10px]">{{
              listing().version
            }}</span>
          }
          @if (listing().installed) {
            <span class="badge badge-xs badge-primary text-[10px] gap-0.5">
              <lucide-angular
                [img]="CheckIcon"
                class="w-2 h-2"
                aria-hidden="true"
              />
              Installed
            </span>
          }
        </div>
        <p class="text-[11px] text-base-content-muted leading-relaxed mt-0.5">
          {{ listing().description || 'No description provided' }}
        </p>
        @if (upgradeLabel(); as label) {
          <p class="text-[10px] text-warning mt-0.5">{{ label }}</p>
        }
      </div>

      <div class="shrink-0 flex items-center gap-1">
        @if (listing().installed) {
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
        }
        <button
          class="btn btn-xs"
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
export class ExternalPluginRowComponent {
  public readonly listing = input.required<ExternalPluginListing>();
  /** True while the parent's tokenless plan request is in flight. */
  public readonly installing = input(false);
  public readonly uninstalling = input(false);

  /** User asked to install — the parent starts the two-call consent protocol. */
  public readonly installRequested = output<void>();
  public readonly uninstallRequested = output<void>();

  protected readonly CheckIcon = Check;

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
