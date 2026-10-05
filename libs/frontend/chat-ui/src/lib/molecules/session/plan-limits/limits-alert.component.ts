import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { StatsLimitIndicator } from './stats-limit-view-model.types';

/**
 * Collapsed-row limits alert, P4 variant A (design §3.1): a full-width,
 * wrapping line above the scrolling chip strip, shown only while the
 * session's applicable state is At limit or Near limit. It wraps instead of
 * clipping at 280 px, so state, window and reset stay readable.
 *
 * The tone is a border and a 15% tint behind `base-content` text; semantic
 * colour is never the text colour (design §8).
 */
@Component({
  selector: 'ptah-limits-alert',
  standalone: true,
  host: { class: 'block' },
  template: `
    <div
      role="status"
      [class]="alertClass()"
      [attr.data-state]="indicator().state"
      data-testid="limits-alert"
    >
      <!-- &ngsp; keeps a real space so the announced text is "Limits Near …" -->
      <span class="text-[10px] uppercase tracking-wider">Limits</span
      >&ngsp;<span>{{ indicator().text }}</span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LimitsAlertComponent {
  readonly indicator = input.required<StatsLimitIndicator>();

  protected readonly alertClass = computed(() => {
    const tone =
      this.indicator().tone === 'error'
        ? 'border-error bg-error/15'
        : 'border-warning bg-warning/15';
    return `flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mb-1 rounded border px-2 py-0.5 text-xs font-semibold text-base-content ${tone}`;
  });
}
