import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LANE_EMPTY } from './lane-tiles';
import { LANE_ROW_FILL } from './stats-tile.styles';
import type { LaneSubtotalTileModel } from './stats-limit-view-model.types';

/**
 * "Subtotal" row that closes the Lanes section (design §3.3, Req 8 cue 3).
 * Known token and cost sums of the lane runs plus the count of runs whose
 * cost is unknown. It is never added to the session tokens or cost, and its
 * "lane · not in totals" caption shows here only when the section header
 * cannot share it (`captionShared`).
 *
 * Not a disclosure: everything it says is on its face, so it renders as a
 * plain row rather than a button with an empty panel.
 */
@Component({
  selector: 'ptah-lane-subtotal-tile',
  standalone: true,
  host: { class: 'block min-w-0' },
  template: `
    @let t = tile();
    <div [class]="faceClass()" data-testid="lane-subtotal-tile">
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-16 shrink-0 text-xs text-base-content"
          >{{ empty.subtotal }}</span
        >
        <span
          class="text-xs font-semibold tabular-nums"
          data-testid="lane-subtotal-tokens"
          [class.text-base-content-muted]="t.tokensText === empty.value"
          [attr.aria-label]="t.tokensText === empty.value ? 'Known subtotal tokens unavailable' : null"
          >{{ t.tokensText }}</span
        >
      </div>
      <div
        class="pl-[4.5rem] text-[11px] leading-tight text-base-content-muted"
        data-testid="lane-subtotal-summary"
      >
        {{ t.summary }}
      </div>
      @if (!captionShared()) {
        <div
          class="truncate pl-[4.5rem] text-[10px] leading-tight text-base-content-muted"
          [attr.title]="t.caption"
          data-testid="lane-subtotal-caption"
        >
          {{ t.caption }}
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaneSubtotalTileComponent {
  protected readonly empty = LANE_EMPTY;
  readonly tile = input.required<LaneSubtotalTileModel>();
  readonly variant = input<'strip' | 'inspector'>('strip');
  /** The section header already shows this row's caption. */
  readonly captionShared = input<boolean>(false);

  protected readonly faceClass = computed(() => this.variant() === 'inspector'
    ? 'border-t border-surface-border pt-2 text-base-content'
    : `rounded-sm border-l-2 pl-1.5 pr-5 py-1 ${LANE_ROW_FILL} border-base-content/40`);
}
