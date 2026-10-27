import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** Viewbox of the mini chart; the host scales it from the value-row height. */
const VIEW_W = 64;
const VIEW_H = 26;
const MAX_GAP = 5;
const MIN_BAR_H = 3;
const DOT_R = 1.5;

interface SpendBar {
  readonly key: number;
  readonly x: number;
  readonly width: number;
  /** `null` when the day has no value: a dot is drawn instead. */
  readonly height: number | null;
  readonly last: boolean;
}

/**
 * SpendBarsComponent — the 7-day spend mini chart that sits on a numeral's
 * baseline inside `ptah-stat-value`. The last (most recent) bar is
 * highlighted; a `null` day draws a dot on the baseline. All-zero input draws
 * flat bars. One `role="img"` with the caller's accessible name.
 */
@Component({
  selector: 'ptah-spend-bars',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'ariaLabel()',
    '[style.aspect-ratio]': 'aspectRatio',
  },
  template: `
    <svg
      class="ptah-spend-bars__svg"
      [attr.viewBox]="viewBox"
      aria-hidden="true"
      focusable="false"
    >
      @for (bar of bars(); track bar.key) {
        @if (bar.height === null) {
          <circle
            class="ptah-spend-bars__dot"
            [class.ptah-spend-bars--last]="bar.last"
            [attr.cx]="bar.x + bar.width / 2"
            [attr.cy]="viewH - dotR"
            [attr.r]="dotR"
          />
        } @else {
          <rect
            class="ptah-spend-bars__bar"
            [class.ptah-spend-bars--last]="bar.last"
            [attr.x]="bar.x"
            [attr.y]="viewH - bar.height"
            [attr.width]="bar.width"
            [attr.height]="bar.height"
            rx="2.5"
          />
        }
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        flex: none;
        height: calc(var(--ptah-stat-value-h, 56px) - 30px);
      }
      .ptah-spend-bars__svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .ptah-spend-bars__bar,
      .ptah-spend-bars__dot {
        fill: oklch(var(--p) / 0.38);
      }
      .ptah-spend-bars--last {
        fill: oklch(var(--p));
      }
      @media (prefers-reduced-motion: no-preference) {
        .ptah-spend-bars__svg {
          animation: ptah-spend-bars-in 500ms var(--ptah-ease-soft, ease-out)
            both;
        }
      }
      @keyframes ptah-spend-bars-in {
        from {
          opacity: 0;
        }
      }
    `,
  ],
})
export class SpendBarsComponent {
  readonly values = input.required<readonly (number | null)[]>();
  readonly ariaLabel = input.required<string>();

  protected readonly viewBox = `0 0 ${VIEW_W} ${VIEW_H}`;
  protected readonly aspectRatio = `${VIEW_W} / ${VIEW_H}`;
  protected readonly viewH = VIEW_H;
  protected readonly dotR = DOT_R;

  protected readonly bars = computed<readonly SpendBar[]>(() => {
    const values = this.values().map((value) =>
      value === null || !Number.isFinite(value) ? null : Math.max(0, value),
    );
    const count = values.length;
    if (count === 0) return [];
    const gap = count > 1 ? Math.min(MAX_GAP, VIEW_W / 2 / (count - 1)) : 0;
    const width = (VIEW_W - gap * (count - 1)) / count;
    const max = Math.max(0, ...values.map((value) => value ?? 0));
    return values.map((value, index) => ({
      key: index,
      x: index * (width + gap),
      width,
      height:
        value === null
          ? null
          : max > 0
            ? Math.max(MIN_BAR_H, (value / max) * (VIEW_H - 2))
            : MIN_BAR_H,
      last: index === count - 1,
    }));
  });
}
