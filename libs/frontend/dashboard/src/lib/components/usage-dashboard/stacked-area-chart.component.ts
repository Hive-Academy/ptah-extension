/**
 * StackedAreaChartComponent
 *
 * Presentational stacked-area chart drawn as one static SVG (TASK_2026_707
 * PR 2): no chart library, no per-point timer or observer. Inputs are
 * normalized series (`id`/`label`/`color`/`values`, oldest day first) plus the
 * day labels and a value formatter; the component owns only focus
 * presentation. Pure geometry (view constants, the monotone cubic path
 * builder, the value sanitization boundary) lives in
 * `stacked-area-chart.geometry.ts`; the markup lives in
 * `stacked-area-chart.component.html`.
 *
 * - Areas are built from smooth monotone cubic curves (Fritsch–Carlson), so a
 *   stacked boundary never overshoots its data and invents negative usage.
 * - Plotted values pass one boundary: anything that is not a finite
 *   non-negative number is dropped to 0, and values are capped so sums can
 *   never overflow into NaN or Infinity geometry or labels.
 * - Days flagged `unknownDays` (cost mode with unpriced facts) draw a
 *   hatched marker; their aria label and readout say the value is unpriced
 *   instead of presenting the known part as the whole day.
 * - Providers flagged through `unknownSeries` read "at least …" or
 *   "unpriced" in the focused readout, never a plain `$0`.
 * - A one-day range draws a centered stacked bar, a centered focus marker
 *   and a centered x label.
 * - Y gridlines use a nice ceiling with compact labels; x labels are thinned.
 * - Every day is a focusable column with a full aria-label (day, total and
 *   each series value), and the readout below mirrors the focused day for
 *   sighted keyboard users. Arrow keys move between columns.
 * - Colour comes from CSS (series `color` is any CSS colour; text uses
 *   `currentColor`), so light and dark themes both hold. The only motion is a
 *   marker fade, disabled under `prefers-reduced-motion`.
 */
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
  areaPath,
  niceCeiling,
  sanitizeSeriesValue,
  type DayColumn,
  type Gridline,
  type Point,
  type ReadoutItem,
  type XLabel,
} from './stacked-area-chart.geometry';

export interface StackedAreaSeries {
  readonly id: string;
  readonly label: string;
  /** Any CSS colour (hex or `oklch(var(--…))` token). */
  readonly color: string;
  /** One value per day, oldest first; same length as `days`. */
  readonly values: readonly number[];
}

interface AreaRow {
  readonly series: StackedAreaSeries;
  readonly area: string;
}

/** One stacked bar of the single-day range. */
interface BarRow {
  readonly series: StackedAreaSeries;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

@Component({
  selector: 'ptah-stacked-area-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stacked-area-chart.component.html',
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
export class StackedAreaChartComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly series = input.required<readonly StackedAreaSeries[]>();
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
  private readonly clean = computed<readonly StackedAreaSeries[]>(() =>
    this.series().map((s) => ({
      ...s,
      values: s.values.map(sanitizeSeriesValue),
    })),
  );

  /** Stacked area path per series, bottom series (largest cost) first. */
  private readonly stacked = computed<readonly {
    top: readonly Point[];
    bottom: readonly Point[];
  }[]>(() => {
    const days = this.days();
    const series = this.clean();
    const n = days.length;
    if (n < 2) return [];
    const totals = days.map(() => 0);
    const cumulative: number[][] = [];
    for (const s of series) {
      const level: number[] = [];
      for (let i = 0; i < n; i++) {
        const value = s.values[i] ?? 0;
        totals[i] = (totals[i] ?? 0) + value;
        level.push((cumulative.at(-1)?.[i] ?? 0) + value);
      }
      cumulative.push(level);
    }
    const yMax = niceCeiling(Math.max(...totals, 0));
    const toX = (i: number): number => PAD_L + (i * PLOT_W) / (n - 1);
    const toY = (value: number): number =>
      PAD_T + PLOT_H - (value / yMax) * PLOT_H;
    const toPoints = (level: readonly number[]): readonly Point[] =>
      level.map((value, i) => ({ x: toX(i), y: toY(value) }));
    const zeroPoints: readonly Point[] = days.map((_, i) => ({
      x: toX(i),
      y: toY(0),
    }));
    return cumulative.map((level, index) => ({
      top: toPoints(level),
      bottom: index === 0 ? zeroPoints : toPoints(cumulative[index - 1]!),
    }));
  });

  readonly areas = computed<readonly AreaRow[]>(() =>
    this.stacked()
      .map((levels, index) => ({
        series: this.clean()[index]!,
        area: areaPath(levels.top, levels.bottom),
      }))
      .filter((row) => row.area !== ''),
  );

  /** Centered stacked bars for a one-day range, bottom series first. */
  readonly singleDayBars = computed<readonly BarRow[]>(() => {
    const days = this.days();
    const series = this.clean();
    if (days.length !== 1 || series.length === 0) return [];
    const total = series.reduce((sum, s) => sum + (s.values[0] ?? 0), 0);
    if (total <= 0) return [];
    const yMax = niceCeiling(total);
    const toY = (value: number): number =>
      PAD_T + PLOT_H - (value / yMax) * PLOT_H;
    const x = PAD_L + PLOT_W / 2 - SINGLE_DAY_BAR_W / 2;
    const bars: BarRow[] = [];
    let level = 0;
    for (const s of series) {
      const value = s.values[0] ?? 0;
      if (value <= 0) continue;
      const bottom = level;
      level += value;
      bars.push({
        series: s,
        x,
        y: toY(level),
        width: SINGLE_DAY_BAR_W,
        height: toY(bottom) - toY(level),
      });
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
    const yMax = niceCeiling(Math.max(...totals, 0));
    const format = this.valueFormat();
    return [0, 1, 2, 3, 4].map((k) => ({
      y: PAD_T + PLOT_H - (k / 4) * PLOT_H,
      label: format((yMax * k) / 4),
    }));
  });

  readonly xLabels = computed<readonly XLabel[]>(() => {
    const days = this.days();
    if (days.length === 0) return [];
    const step = Math.max(1, Math.ceil(days.length / 6));
    const labels: XLabel[] = [];
    for (let i = 0; i < days.length; i += step) {
      labels.push({
        x:
          days.length === 1
            ? PAD_L + PLOT_W / 2
            : PAD_L + (i * PLOT_W) / (days.length - 1),
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
    const spacing = n > 1 ? PLOT_W / (n - 1) : PLOT_W;
    const columns: DayColumn[] = [];
    for (let i = 0; i < n; i++) {
      const center = n > 1 ? PAD_L + i * spacing : PAD_L + PLOT_W / 2;
      const left = n > 1 ? Math.max(PAD_L, center - spacing / 2) : PAD_L;
      const right =
        n > 1 ? Math.min(PAD_L + PLOT_W, center + spacing / 2) : PAD_L + PLOT_W;
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
    return days.length === 1
      ? PAD_L + PLOT_W / 2
      : PAD_L + (i * PLOT_W) / (days.length - 1);
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

  readonly chartAriaLabel = computed(
    () =>
      `Daily usage stacked area chart, ${this.days().length} days from ${
        this.days()[0] ?? ''
      } to ${this.days().at(-1) ?? ''}`,
  );

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