import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { NEAR_LIMIT_PERCENT } from '@ptah-extension/shared';
import { chipClass, sourceChipClass } from './stats-tile.styles';
import type { PlanWindowDetailModel } from './stats-limit-view-model.types';

/**
 * Full detail of one plan window (design §3.2 expansion, §3.3 different or
 * unknown owner): the used value with a meter, the reset facts with the passed
 * and the next reset kept apart, the aged / not-confirmed note and the
 * per-field source chips.
 *
 * Used by the plan-limit tile panel and by a lane subgroup that shows a
 * window in full. Unknown is never 0: without a percent no meter is drawn and
 * the row reads "Used: unknown". The meter fill is neutral and the percentage
 * is always printed; the stripes on a hot window are decoration.
 */
@Component({
  selector: 'ptah-plan-window-detail',
  standalone: true,
  template: `
    @let w = window();
    <div class="py-1" data-testid="plan-window-detail">
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <span class="font-semibold text-xs">{{ w.label }}</span>
        @if (w.chip; as chip) {
          <span [class]="chipClass(chip.tone)">
            @if (chip.glyph) {
              <span aria-hidden="true">{{ chip.glyph }}</span>
            }
            {{ chip.text }}
          </span>
        }
      </div>
      @if (percent() !== null) {
        <div class="flex items-center gap-2 mt-1">
          <div
            class="relative flex-1 h-1.5 rounded bg-base-content/10 overflow-hidden"
            role="meter"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="percent()"
            [attr.aria-valuetext]="w.usedText"
            [attr.aria-label]="w.label + ' used'"
          >
            <div
              class="h-full rounded bg-base-content/70"
              [class.stripes-error]="w.chip?.tone === 'error'"
              [class.stripes-warning]="w.chip?.tone === 'warning'"
              [style.width.%]="percent()"
            ></div>
            <div
              class="absolute top-0 h-full w-px bg-base-content"
              [style.left.%]="nearLimitPercent"
              aria-hidden="true"
            ></div>
          </div>
          <span class="text-xs font-semibold tabular-nums whitespace-nowrap">{{
            w.usedText
          }}</span>
        </div>
      } @else {
        <div class="text-xs mt-1 font-semibold">Used: {{ w.usedText }}</div>
      }
      @for (fact of w.resetFacts; track $index) {
        <div class="text-[11px] text-base-content-muted mt-0.5">{{ fact }}</div>
      }
      @if (w.note) {
        <div class="text-[11px] text-base-content-muted mt-0.5">
          {{ w.note }}
        </div>
      }
      @if (w.sourceChips.length > 0) {
        <div class="flex flex-wrap gap-1 mt-1">
          @for (source of w.sourceChips; track source) {
            <span [class]="sourceChipClass(source)">{{ source }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .stripes-error {
        background-image: repeating-linear-gradient(
          45deg,
          oklch(var(--er) / 0.85) 0 4px,
          transparent 4px 7px
        );
      }
      .stripes-warning {
        background-image: repeating-linear-gradient(
          45deg,
          oklch(var(--wa) / 0.85) 0 4px,
          transparent 4px 7px
        );
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanWindowDetailComponent {
  readonly window = input.required<PlanWindowDetailModel>();

  protected readonly nearLimitPercent = NEAR_LIMIT_PERCENT;
  protected readonly chipClass = chipClass;
  protected readonly sourceChipClass = sourceChipClass;

  /** Meter value clamped to 0-100; `null` when the used value is unknown. */
  protected readonly percent = computed(() => {
    const value = this.window().percent;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, Math.round(value)));
  });
}
