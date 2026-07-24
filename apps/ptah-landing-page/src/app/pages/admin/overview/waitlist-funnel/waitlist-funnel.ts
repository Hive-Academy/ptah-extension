import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** One horizontal stage bar in the waitlist funnel. */
interface FunnelBar {
  /** Stage label rendered left of the bar. */
  label: string;
  /** Raw count for the stage. */
  count: number;
  /** Fill width as a % of `total` (min 2% so a non-zero stage stays visible). */
  widthPct: number;
  /** Share-of-total % shown on/beside the fill — `null` on the baseline row. */
  ratioPct: number | null;
  /** daisyUI fill color class (literal so Tailwind keeps it). */
  fillClass: string;
}

/**
 * WaitlistFunnel — pure presentational funnel for the Overview hero (§3.4).
 *
 * Three segmented horizontal bars (Total neutral / Notified info / Converted
 * success) plus the page's hero number: the conversion rate. No charting
 * library — hand-built CSS/flex per the spec's lean-bundle constraint. Does
 * NOT surface "not yet invited" (that lives in the Needs Attention queue).
 */
@Component({
  selector: 'ptah-admin-waitlist-funnel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  templateUrl: './waitlist-funnel.html',
})
export class WaitlistFunnel {
  public readonly total = input<number>(0);
  public readonly notified = input<number>(0);
  public readonly converted = input<number>(0);
  public readonly last7Days = input<number>(0);

  /** The three funnel bars, widths relative to `total`. */
  protected readonly bars = computed<FunnelBar[]>(() => {
    const total = this.total();
    const width = (n: number): number => {
      if (total <= 0 || n <= 0) return 0;
      return Math.max((n / total) * 100, 2);
    };
    const ratio = (n: number): number | null =>
      total > 0 ? (n / total) * 100 : null;

    return [
      {
        label: 'Total',
        count: total,
        widthPct: total > 0 ? 100 : 0,
        ratioPct: null,
        fillClass: 'bg-ink-600',
      },
      {
        label: 'Notified',
        count: this.notified(),
        widthPct: width(this.notified()),
        ratioPct: ratio(this.notified()),
        fillClass: 'bg-info',
      },
      {
        label: 'Converted',
        count: this.converted(),
        widthPct: width(this.converted()),
        ratioPct: ratio(this.converted()),
        fillClass: 'bg-success',
      },
    ];
  });

  /** Hero conversion rate — `null` when the waitlist is empty (avoids 0/0). */
  protected readonly conversionPct = computed<number | null>(() => {
    const total = this.total();
    if (total <= 0) return null;
    return (this.converted() / total) * 100;
  });
}
