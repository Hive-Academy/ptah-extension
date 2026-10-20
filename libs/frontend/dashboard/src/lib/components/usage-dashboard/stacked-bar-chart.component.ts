/** Daily stacked bars with keyboard-focusable day columns and unpriced readouts. */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { formatDayShort } from './usage-formatting';
import {
  PAD_L,
  PAD_T,
  PLOT_H,
  PLOT_W,
  SINGLE_DAY_BAR_W,
  VIEW_H,
  VIEW_W,
  niceCeiling,
  sanitizeSeriesValue,
  type DayColumn,
  type Gridline,
  type ReadoutItem,
  type XLabel,
} from './stacked-bar-chart.geometry';

export interface StackedBarSeries {
  readonly id: string;
  readonly label: string;
  /** Any CSS colour (hex or `oklch(var(--…))` token). */
  readonly color: string;
  /** One value per day, oldest first; same length as `days`. */
  readonly values: readonly number[];
}

interface BarRow {
  readonly series: StackedBarSeries;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly day: number;
}

@Component({
  selector: 'ptah-stacked-bar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stacked-bar-chart.component.html',
  styles: [
    `
      .ptah-chart-marker {
        transition: opacity 120ms ease;
      }
      @media (prefers-reduced-motion: reduce) {
        .ptah-chart-marker {
          transition: none;
        }
      }
    `,
  ],
})
export class StackedBarChartComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly series = input.required<readonly StackedBarSeries[]>();
  readonly days = input.required<readonly string[]>();
  readonly valueFormat = input.required<(value: number) => string>();
  /**
   * Per day: true when the day's plotted value is a lower bound (cost mode
   * with unpriced facts) rather than an observed total. The chart draws a
   * hatched marker over such days and never presents them as zero usage.
   */
  readonly unknownDays = input<readonly boolean[]>([]);
  /**
   * Per series, per day: true when that provider's plotted value for the
   * day is a lower bound (cost mode with unpriced facts). The readout then
   * reads "at least …" or "unpriced" for that provider instead of a plain
   * formatted value.
   */
  readonly unknownSeries = input<readonly (readonly boolean[])[]>([]);

  readonly viewW = VIEW_W;
  readonly viewH = VIEW_H;
  readonly padL = PAD_L;
  readonly padT = PAD_T;
  readonly plotW = PLOT_W;
  readonly plotH = PLOT_H;

  readonly focusedDay = signal<number | null>(null);

  /**
   * The only place plotted numbers enter the component: each value that is
   * not finite and non-negative becomes 0, and each value is capped so
   * cumulative sums stay finite. Every geometry, label and readout below
   * reads from this, never from the raw input.
   */
  private readonly clean = computed<readonly StackedBarSeries[]>(() =>
    this.series().map((s) => ({
      ...s,
      values: s.values.map(sanitizeSeriesValue),
    })),
  );

  /** One stacked bar slot per day; zero segments generate no SVG shape. */
  readonly bars = computed<readonly BarRow[]>(() => {
    const days = this.days();
    const series = this.clean();
    if (days.length === 0 || series.length === 0) return [];
    const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    const yMax = niceCeiling(Math.max(...totals, 0) / 4) * 4;
    const toY = (value: number): number =>
      PAD_T + PLOT_H - (value / yMax) * PLOT_H;
    const bars: BarRow[] = [];
    const slot = PLOT_W / days.length;
    const width = days.length === 1 ? SINGLE_DAY_BAR_W : Math.max(2, Math.min(28, slot * 0.7));
    for (let i = 0; i < days.length; i++) {
      let level = 0;
      for (const s of series) {
        const value = s.values[i] ?? 0;
        if (value <= 0) continue;
        const bottom = level;
        level += value;
        bars.push({ series: s, day: i,
          x: PAD_L + slot * (i + 0.5) - width / 2,
          y: toY(level), width, height: toY(bottom) - toY(level) });
      }
    }
    return bars;
  });

  /** Day columns whose plotted value is a lower bound, for the hatch marker. */
  readonly unknownColumns = computed<readonly DayColumn[]>(() =>
    this.columns().filter(
      (column) => this.unknownDays()[column.index] === true,
    ),
  );

  readonly hasUnknownDays = computed(() =>
    this.unknownDays().some((flag) => flag === true),
  );

  readonly gridlines = computed<readonly Gridline[]>(() => {
    const days = this.days();
    if (days.length === 0 || this.clean().length === 0) return [];
    const totals = days.map(() => 0);
    for (const s of this.clean()) {
      s.values.forEach((value, i) => {
        totals[i] = (totals[i] ?? 0) + (value ?? 0);
      });
    }
    const step = niceCeiling(Math.max(...totals, 0) / 4);
    const format = this.valueFormat();
    return [0, 1, 2, 3, 4].map((k) => ({
      y: PAD_T + PLOT_H - (k / 4) * PLOT_H,
      label: format(step * k),
    }));
  });

  readonly xLabels = computed<readonly XLabel[]>(() => {
    const days = this.days();
    if (days.length === 0) return [];
    const step = Math.max(1, Math.ceil(days.length / 6));
    const labels: XLabel[] = [];
    for (let i = 0; i < days.length; i += step) {
      labels.push({
        x: PAD_L + (i + 0.5) * PLOT_W / days.length,
        label: formatDayShort(days[i]!),
      });
    }
    return labels;
  });

  readonly columns = computed<readonly DayColumn[]>(() => {
    const days = this.days();
    const series = this.clean();
    const n = days.length;
    if (n === 0) return [];
    const format = this.valueFormat();
    const spacing = PLOT_W / n;
    const columns: DayColumn[] = [];
    for (let i = 0; i < n; i++) {
      const left = PAD_L + i * spacing;
      const right = left + spacing;
      let total = 0;
      const parts: string[] = [];
      for (const s of series) {
        const value = s.values[i] ?? 0;
        total += value;
        parts.push(`${s.label}: ${format(value)}`);
      }
      const day = days[i]!;
      const unknown = this.unknownDays()[i] === true;
      // An unknown day never reads as its known part or as zero usage: it is
      // a lower bound ("at least …") or explicitly unpriced.
      columns.push({
        index: i,
        x: left,
        width: right - left,
        day,
        aria: unknown
          ? total > 0
            ? `${formatDayShort(day)}: at least ${format(total)}; some usage unpriced`
            : `${formatDayShort(day)}: unpriced usage, cost unknown`
          : total > 0
            ? `${formatDayShort(day)}: total ${format(total)}; ${parts.join('; ')}`
            : `${formatDayShort(day)}: no usage`,
      });
    }
    return columns;
  });

  readonly markerX = computed<number | null>(() => {
    const i = this.focusedDay();
    if (i === null) return null;
    const days = this.days();
    if (i < 0 || i >= days.length || days.length < 1) return null;
    // A one-day range centers its marker on the single bar.
    return PAD_L + (i + 0.5) * PLOT_W / days.length;
  });

  readonly readout = computed<{
    readonly day: string;
    readonly totalLabel: string;
    readonly items: readonly ReadoutItem[];
  } | null>(() => {
    const i = this.focusedDay();
    if (i === null) return null;
    const days = this.days();
    if (i < 0 || i >= days.length) return null;
    const format = this.valueFormat();
    const series = this.clean();
    const total = series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    const unknown = this.unknownDays()[i] === true;
    const unknownSeries = this.unknownSeries();
    const items: ReadoutItem[] = series.map((s, seriesIndex) => {
      const value = s.values[i] ?? 0;
      // A flagged provider never reads as a plain zero: its plotted value
      // is a lower bound, or its cost is unpriced when nothing is priced.
      const valueUnknown = unknownSeries[seriesIndex]?.[i] === true;
      return {
        id: s.id,
        label: s.label,
        color: s.color,
        valueLabel: valueUnknown
          ? value > 0
            ? `at least ${format(value)}`
            : 'unpriced'
          : format(value),
      };
    });
    return {
      day: formatDayShort(days[i]!),
      totalLabel: unknown
        ? total > 0
          ? `at least ${format(total)} (some usage unpriced)`
          : 'cost unpriced'
        : format(total),
      items,
    };
  });

  readonly chartAriaLabel = computed(() => {
    const days = this.days();
    if (days.length === 1) {
      return `Daily usage stacked bar chart, 1 day: ${days[0]}`;
    }
    return `Daily usage stacked bar chart, ${days.length} days from ${
      days[0] ?? ''
    } to ${days.at(-1) ?? ''}`;
  });

  setFocusedDay(index: number | null): void {
    this.focusedDay.set(index);
  }

  onColumnKeydown(event: KeyboardEvent, index: number): void {
    const days = this.days();
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focusColumn(index - 1);
    } else if (event.key === 'ArrowRight' && index < days.length - 1) {
      event.preventDefault();
      this.focusColumn(index + 1);
    }
  }

  private focusColumn(index: number): void {
    const el = this.elementRef.nativeElement.querySelector(
      `#usage-chart-col-${index}`,
    );
    (el as HTMLElement | null)?.focus();
  }
}
