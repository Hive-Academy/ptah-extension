import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import { sparklineGeometry } from '../charts/sparkline-geometry';

/**
 * Bar fills come from the renderer's display tokens (D17); the fallbacks keep
 * the bars visible when the atom renders outside a renderer root. The latest
 * bar is the theme `primary` (decisions.md #12); a failing series uses the
 * error fill instead.
 */
const SPARKLINE_STYLES = `
  :host { display: block; min-width: 0; }
  .dp-spark { display: block; height: 30px; max-width: 100%; }
  .dp-spark-bar { fill: var(--dp-bar-dim, color-mix(in oklab, currentColor 20%, transparent)); }
  .dp-spark-bar--latest { fill: var(--dp-hl, oklch(var(--p))); }
  .dp-spark-bar--failing { fill: var(--dp-er-fill, oklch(var(--er))); }
`;

/** Literal class strings, never concatenated. */
const BAR_CLASSES = {
  dim: 'dp-spark-bar',
  latest: 'dp-spark-bar dp-spark-bar--latest',
  failing: 'dp-spark-bar dp-spark-bar--failing',
} as const;

/**
 * Inline bar sparkline (R4.4). The bars are decoration for assistive tech: the
 * SVG is one `role="img"` whose label lists every point and the latest value.
 * Static markup only, with no timer, observer or animation.
 */
@Component({
  selector: 'ptah-dashboard-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [SPARKLINE_STYLES],
  template: `
    <svg class="dp-spark" role="img" focusable="false" preserveAspectRatio="none" data-testid="stat-spark"
      [attr.aria-label]="label()" [attr.viewBox]="'0 0 ' + geometry().width + ' ' + geometry().height"
      [attr.width]="geometry().width" [attr.height]="geometry().height">
      @for (bar of geometry().bars; track bar.index) {
        <rect rx="2" [attr.x]="bar.x" [attr.y]="bar.y" [attr.width]="bar.width" [attr.height]="bar.height"
          [attr.class]="barClass(bar.latest)" />
      }
    </svg>
  `,
})
export class DashboardSparklineComponent {
  public readonly points: InputSignal<readonly number[]> = input.required<readonly number[]>();
  /** What the series measures, for the accessible label (the stat's title). */
  public readonly subject = input.required<string>();
  /** A failing series draws its latest bar in the error fill. */
  public readonly failing = input(false);

  public readonly geometry = computed(() => sparklineGeometry(this.points()));
  public readonly label = computed(() => {
    const points = this.points();
    return `${this.subject()} trend, ${points.length} points: ${points.join(', ')}; latest ${points.at(-1) ?? ''}`;
  });

  public barClass(latest: boolean): string {
    if (!latest) return BAR_CLASSES.dim;
    return this.failing() ? BAR_CLASSES.failing : BAR_CLASSES.latest;
  }
}
