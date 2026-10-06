import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LANE_FACE_FILL } from './stats-tile.styles';
import type { LaneSubtotalTileModel } from './stats-limit-view-model.types';

/**
 * "Lanes · subtotal" tile that closes the lane group (design §3.3, Req 8
 * cue 3). Known token and cost sums of the lane runs plus the count of runs
 * whose cost is unknown. It is never added to the session Tokens or Cost
 * cards and carries the "lane · not in totals" caption.
 *
 * Not a disclosure: everything it says is on its face (prototype `.tile.sub`),
 * so it renders as a plain card rather than a button with an empty panel.
 */
@Component({
  selector: 'ptah-lane-subtotal-tile',
  standalone: true,
  host: { class: 'block min-w-0' },
  template: `
    @let t = tile();
    <div [class]="faceClass" data-testid="lane-subtotal-tile">
      <div
        class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
      >
        Lanes · subtotal
      </div>
      <div
        class="text-[10px] text-base-content-muted leading-tight truncate"
        [attr.title]="t.caption"
      >
        {{ t.caption }}
      </div>
      <div
        class="text-sm font-semibold leading-tight mt-0.5 tabular-nums"
        data-testid="lane-subtotal-tokens"
      >
        {{ t.tokensText }}
      </div>
      <div
        class="text-[11px] text-base-content-muted leading-tight mt-0.5"
        data-testid="lane-subtotal-summary"
      >
        {{ t.summary }}
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaneSubtotalTileComponent {
  readonly tile = input.required<LaneSubtotalTileModel>();

  protected readonly faceClass = `rounded px-2 py-1.5 border ${LANE_FACE_FILL} border-base-content/40`;
}
