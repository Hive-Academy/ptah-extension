import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { NEAR_LIMIT_PERCENT } from '@ptah-extension/shared';
import type {
  LocalTimeOptions,
  PlanLimitOwnerSnapshot,
} from '@ptah-extension/shared';
import { ProviderMarkComponent } from '@ptah-extension/ui';
import {
  buildPlanTile,
  type PlanTileActionView,
  type Tone,
} from '../provider-account-card/plan-tile-view.model';

/**
 * One compact plan-limit cell for every owner. The card passes one owner
 * snapshot and the shared clock value, and the tile never fetches and never
 * starts a timer of its own. All derived text comes from the pure
 * `buildPlanTile` mapping, so the whole tile stays testable without a DOM.
 */
@Component({
  selector: 'ptah-provider-account-tile',
  standalone: true,
  imports: [ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './provider-account-tile.component.html',
  styles: [
    // Meter and 90% tick use theme tokens in both themes.
    `
      :host {
        display: block;
        min-width: 0;
      }
      .bar-track {
        position: relative;
        height: 0.5rem;
        border-radius: 0.25rem;
        overflow: hidden;
        background-color: oklch(var(--b2, var(--b1)));
      }
      .bar-fill {
        height: 100%;
        border-radius: inherit;
        transition: width 300ms ease;
      }
      /* Decorative 90% (near-limit) tick; the value never has to reach it. */
      .bar-tick {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: oklch(var(--bc) / 0.5);
      }
      /* Success and warning fills are near-white on the light theme; re-tint
         them so the bar keeps contrast in both themes. */
      :host-context([data-theme-mode='light']) .bar-fill.bg-success {
        background-color: color-mix(in oklab, oklch(var(--su)) 60%, black);
      }
      :host-context([data-theme-mode='light']) .bar-fill.bg-warning {
        background-color: color-mix(in oklab, oklch(var(--wa)) 60%, black);
      }
      :host-context([data-theme-mode='light']) .bar-fill.bg-error {
        background-color: color-mix(in oklab, oklch(var(--er)) 75%, black);
      }
    `,
  ],
})
export class ProviderAccountTileComponent {
  /** The one owner this tile presents. */
  readonly owner = input.required<PlanLimitOwnerSnapshot>();
  /** The shared clock value from `PlanLimitsStore.now()`; no tile timer. */
  readonly now = input.required<number>();
  readonly refreshing = input(false);

  /** Refresh this owner's usage; the card routes it to the store. */
  readonly refresh = output<void>();
  /** An inline action (go to chat, add key); the card navigates. */
  readonly actionClick = output<PlanTileActionView>();

  private readonly locale = inject(LOCALE_ID);

  /** Local times with the zone abbreviation in the UI locale. */
  private readonly timeOptions: LocalTimeOptions = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    zoneNameLocale: this.locale,
  };

  /** The near-limit threshold each tile's bar tick marks. */
  protected readonly nearLimitPercent = NEAR_LIMIT_PERCENT;

  protected readonly view = computed(() =>
    buildPlanTile(this.owner(), this.now(), this.timeOptions),
  );

  protected readonly detailLines = computed(() => {
    const view = this.view();
    return [
      view.statusNotice,
      view.cooldown,
      ...view.evidence.map((item) =>
        item.key === '__more-evidence' ? item.title : item.text,
      ),
    ]
      .filter((line): line is string => line !== null);
  });

  protected readonly accessibleLabel = computed(() =>
    [this.view().accessibleLabel, ...this.detailLines()].join(', '),
  );

  /** Label + identity subtitle, plus hidden-window notes as the tooltip. */
  protected readonly headerTitle = computed(() => {
    const view = this.view();
    const notes = [...view.hiddenWindowNotes, ...this.detailLines()];
    return notes.length > 0
      ? `${view.headerTitle}\n\n${notes.join('\n')}`
      : view.headerTitle;
  });

  protected barFillClass(tone: Tone): string {
    switch (tone) {
      case 'error':
        return 'bg-error';
      case 'warning':
        return 'bg-warning';
      case 'success':
        return 'bg-success';
      default:
        return 'bg-base-content/45';
    }
  }

}
