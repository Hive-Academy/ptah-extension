import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { QualityHistoryEntry } from '@ptah-extension/shared';

/**
 * QualityTrendChartComponent
 *
 * Displays quality score history as an inline SVG line chart.
 * Uses pure SVG rendering to avoid external Chart.js dependency.
 *
 * Features:
 * - Responsive SVG container with fixed viewBox
 * - Line path colored based on latest score threshold
 * - Y-axis labels (0, 25, 50, 75, 100)
 * - X-axis date labels for first and last entries
 * - "No history data" state when empty
 * - Grid lines for visual reference
 * - Data point circles on hover
 */

/** SVG chart constants */
const CHART_WIDTH = 400;
const CHART_HEIGHT = 200;
const PADDING_LEFT = 40;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 30;
const PLOT_WIDTH = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

@Component({
  selector: 'ptah-quality-trend-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <h3 class="card-title text-sm font-semibold">Quality Trend</h3>

        @if (history().length === 0) {
        <div
          class="flex items-center justify-center h-40 text-base-content/50 text-sm"
          role="status"
        >
          No history data yet. Run an assessment to start tracking trends.
        </div>
        } @else {
        <div class="w-full overflow-hidden">
          <svg
            [attr.viewBox]="'0 0 ' + chartWidth + ' ' + chartHeight"
            class="w-full h-auto"
            role="img"
            aria-label="Quality score trend chart showing scores over time"
            preserveAspectRatio="xMidYMid meet"
          >
            <!-- Grid lines -->
            @for (y of yGridLines(); track y.value) {
            <line
              [attr.x1]="paddingLeft"
              [attr.y1]="y.yPos"
              [attr.x2]="paddingLeft + plotWidth"
              [attr.y2]="y.yPos"
              stroke="currentColor"
              stroke-opacity="0.1"
              stroke-width="1"
            />
            <text
              [attr.x]="paddingLeft - 6"
              [attr.y]="y.yPos + 4"
              text-anchor="end"
              fill="currentColor"
              fill-opacity="0.4"
              font-size="10"
            >
              {{ y.value }}
            </text>
            }

            <!-- Line path -->
            <path
              [attr.d]="linePath()"
              fill="none"
              [attr.stroke]="lineColor()"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />

            <!-- Area fill (gradient) -->
            <path
              [attr.d]="areaPath()"
              [attr.fill]="lineColor()"
              fill-opacity="0.08"
            />

            <!-- Data points -->
            @for (point of dataPoints(); track point.index) {
            <circle
              [attr.cx]="point.x"
              [attr.cy]="point.y"
              r="3"
              [attr.fill]="lineColor()"
              stroke="white"
              stroke-width="1.5"
            >
              <title>Score: {{ point.score }} | {{ point.dateLabel }}</title>
            </circle>
            }

            <!-- X-axis date labels -->
            @if (xLabels().length > 0) { @for (label of xLabels(); track
            label.text) {
            <text
              [attr.x]="label.x"
              [attr.y]="chartHeight - 6"
              [attr.text-anchor]="label.anchor"
              fill="currentColor"
              fill-opacity="0.4"
              font-size="10"
            >
              {{ label.text }}
            </text>
            } }
          </svg>
        </div>
        }
      </div>
    </div>
  `,
})
export class QualityTrendChartComponent {
  readonly history = input.required<QualityHistoryEntry[]>();

  // Expose constants for template
  readonly chartWidth = CHART_WIDTH;
  readonly chartHeight = CHART_HEIGHT;
  readonly paddingLeft = PADDING_LEFT;
  readonly plotWidth = PLOT_WIDTH;

  /** Entries sorted oldest-to-newest for left-to-right rendering */
  readonly sortedEntries = computed(() => {
    const entries = [...this.history()];
    return entries.sort((a, b) => a.timestamp - b.timestamp);
  });

  /** Y-axis grid lines at 0, 25, 50, 75, 100 */
  readonly yGridLines = computed(() => {
    return [0, 25, 50, 75, 100].map((value) => ({
      value,
      yPos: PADDING_TOP + PLOT_HEIGHT - (value / 100) * PLOT_HEIGHT,
    }));
  });

  /** Map each history entry to SVG coordinates */
  readonly dataPoints = computed(() => {
    const entries = this.sortedEntries();
    if (entries.length === 0) return [];

    return entries.map((entry, index) => {
      const x =
        entries.length === 1
          ? PADDING_LEFT + PLOT_WIDTH / 2
          : PADDING_LEFT + (index / (entries.length - 1)) * PLOT_WIDTH;
      const y =
        PADDING_TOP +
        PLOT_HEIGHT -
        (Math.min(Math.max(entry.score, 0), 100) / 100) * PLOT_HEIGHT;

      return {
        index,
        x,
        y,
        score: entry.score,
        dateLabel: this.formatDate(entry.timestamp),
      };
    });
  });

  /** SVG path data for the line */
  readonly linePath = computed(() => {
    const points = this.dataPoints();
    if (points.length === 0) return '';
    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    }

    return points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');
  });

  /** SVG path data for the area fill under the line */
  readonly areaPath = computed(() => {
    const points = this.dataPoints();
    if (points.length === 0) return '';

    const baseline = PADDING_TOP + PLOT_HEIGHT;
    const first = points[0];
    const last = points[points.length - 1];

    const lineSegments = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    return `${lineSegments} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
  });

  /** Line color based on the most recent score */
  readonly lineColor = computed(() => {
    const entries = this.sortedEntries();
    if (entries.length === 0) return '#3abff8'; // info blue

    const latestScore = entries[entries.length - 1].score;
    if (latestScore >= 80) return '#36d399'; // success green
    if (latestScore >= 60) return '#fbbd23'; // warning yellow
    return '#f87272'; // error red
  });

  /** X-axis labels: first and last dates */
  readonly xLabels = computed(() => {
    const entries = this.sortedEntries();
    if (entries.length === 0) return [];

    const labels: { text: string; x: number; anchor: string }[] = [];

    labels.push({
      text: this.formatDate(entries[0].timestamp),
      x: PADDING_LEFT,
      anchor: 'start',
    });

    if (entries.length > 1) {
      labels.push({
        text: this.formatDate(entries[entries.length - 1].timestamp),
        x: PADDING_LEFT + PLOT_WIDTH,
        anchor: 'end',
      });
    }

    return labels;
  });

  /** Format timestamp to short date string */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate();
    return `${month} ${day}`;
  }
}
