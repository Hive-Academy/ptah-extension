import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Coins, Hash, LucideAngularModule, Sigma } from 'lucide-angular';
import { LaneBoundValueComponent } from './lane-bound-value.component';
import { LANE_EMPTY } from './lane-tiles';
import {
  LANE_DETAIL_LINE,
  LANE_INFO_BUTTON,
  LANE_ROW_FILL,
  LANE_ROW_GRID,
  newPanelId,
} from './stats-tile.styles';
import type { LaneSubtotalTileModel } from './stats-limit-view-model.types';

/**
 * "Subtotal" row that closes the Lanes section (design §3.3, Req 8 cue 3).
 * Known token and cost sums of the lane runs plus the count of runs whose
 * cost is unknown. It is never added to the session tokens or cost, and its
 * "lane · not in totals" caption shows here only when the section header
 * cannot share it (`captionShared`).
 *
 * Not a disclosure: everything it says is on its face, so it renders as a
 * plain row rather than a button with an empty panel. It sits on the lane
 * rows' shared grid (`LANE_ROW_GRID`) with the same insets, so its tokens
 * start in the lanes' usage column.
 *
 * The `inspector` variant is the compact form `Σ # 2.6k  $0.02`: the
 * "Known subtotal" label, "tokens known", the lane / run / cost-unknown
 * counts and the caption move behind the Σ button: its tooltip on hover,
 * and a visible line under the row when it is pressed (Escape closes).
 */
@Component({
  selector: 'ptah-lane-subtotal-tile',
  standalone: true,
  imports: [LucideAngularModule, LaneBoundValueComponent],
  host: { class: 'block min-w-0' },
  template: `
    @let t = tile();
    @if (variant() === 'inspector') {
      <div
        class="border-t border-surface-border pt-2 pl-1.5 pr-6 text-[10.5px] text-base-content"
        data-testid="lane-subtotal-tile"
      >
        <div class="flex items-center gap-2">
          <span class="flex min-w-0 flex-1 items-center">
            <button
              type="button"
              [class]="infoButtonClass"
              [attr.title]="details()"
              [attr.aria-label]="empty.subtotal + ' details'"
              [attr.aria-expanded]="open()"
              [attr.aria-controls]="open() ? detailId : null"
              data-testid="lane-subtotal-toggle"
              (click)="open.set(!open())"
              (keydown.escape)="closeOnEscape($event)"
            >
              <lucide-angular [img]="SigmaIcon" class="size-3.5" aria-hidden="true" />
            </button>
          </span>
          <span class="inline-flex shrink-0 items-center gap-0.5 font-semibold" data-testid="lane-subtotal-tokens">
            <lucide-angular [img]="HashIcon" class="size-3 text-base-content-muted" aria-hidden="true" />
            <span class="sr-only">Known subtotal tokens </span>
            <ptah-lane-bound-value [text]="t.tokensValue" unknownLabel="unavailable" />
          </span>
          <span class="inline-flex shrink-0 items-center gap-0.5 font-semibold" data-testid="lane-subtotal-cost">
            <lucide-angular [img]="CoinsIcon" class="size-3 text-base-content-muted" aria-hidden="true" />
            <span class="sr-only">Known subtotal cost </span>
            <ptah-lane-bound-value [text]="t.costValue" unknownLabel="unavailable" />
          </span>
        </div>
        @if (open()) {
          <p [id]="detailId" [class]="'mt-1 ' + detailLineClass" data-testid="lane-subtotal-detail">{{ details() }}</p>
        }
      </div>
    } @else {
      <div [class]="stripClass" data-testid="lane-subtotal-tile">
        <div [class]="rowGrid" data-testid="lane-subtotal-grid">
          <span class="min-w-0 truncate text-xs text-base-content"
            >{{ empty.subtotal }}</span
          >
          <span
            class="col-span-2 min-w-0 truncate text-xs font-semibold tabular-nums"
            data-testid="lane-subtotal-tokens"
            [class.text-base-content-muted]="t.tokensText === empty.value"
            [attr.aria-label]="t.tokensText === empty.value ? 'Known subtotal tokens unavailable' : null"
            >{{ t.tokensText }}</span
          >
        </div>
        <div
          class="text-[11px] leading-tight text-base-content-muted"
          data-testid="lane-subtotal-summary"
        >
          {{ t.summary }}
        </div>
        @if (!captionShared()) {
          <div
            class="truncate text-[10px] leading-tight text-base-content-muted"
            [attr.title]="t.caption"
            data-testid="lane-subtotal-caption"
          >
            {{ t.caption }}
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaneSubtotalTileComponent {
  protected readonly empty = LANE_EMPTY;
  readonly tile = input.required<LaneSubtotalTileModel>();
  readonly variant = input<'strip' | 'inspector'>('strip');
  /** The section header already shows this row's caption. */
  readonly captionShared = input<boolean>(false);

  protected readonly rowGrid = LANE_ROW_GRID;
  protected readonly stripClass = `rounded-sm border-l-2 pl-1.5 pr-6 py-1 ${LANE_ROW_FILL} border-base-content/40`;
  protected readonly SigmaIcon = Sigma;
  protected readonly HashIcon = Hash;
  protected readonly CoinsIcon = Coins;

  protected readonly infoButtonClass = LANE_INFO_BUTTON;
  protected readonly detailLineClass = LANE_DETAIL_LINE;
  protected readonly detailId = newPanelId();
  /** The compact row's explanation line, open under the row. */
  protected readonly open = signal(false);

  /**
   * Everything the compact row does not print: label, full sums, counts, and
   * the caption when the section header cannot share it.
   */
  protected readonly details = computed(() => {
    const t = this.tile();
    return [LANE_EMPTY.subtotal, t.tokensText, t.summary, this.captionShared() ? '' : t.caption]
      .filter((line) => line && line !== LANE_EMPTY.value)
      .join(' · ');
  });

  protected closeOnEscape(event: Event): void {
    if (!this.open()) return;
    event.preventDefault();
    event.stopPropagation();
    this.open.set(false);
  }
}
