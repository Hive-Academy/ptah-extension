import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

/** Viewbox side and stroke per size (TASK_2026_721 component 10, D10). */
const RING_GEOMETRY = {
  value: { side: 56, stroke: 6 },
  lg: { side: 112, stroke: 10 },
} as const;

/** Arc length shown while the value is unknown, as a fraction of the circle. */
const INDETERMINATE_FRACTION = 0.25;

/**
 * ProgressRingComponent — the shared ring of the vitals screens (plan ring,
 * readiness ring).
 *
 * `size='value'` makes the diameter equal to the stat value-row height
 * (`--ptah-stat-value-h`, 56 px by default, 52 px in a compact row) so a ring
 * and a numeral share one centre line; `size='lg'` is the fixed 112 px
 * readiness ring. The SVG is square and scales from that one height.
 *
 * `value` is 0-1; `null` means indeterminate (a quarter arc that turns, only
 * when the user allows motion). The whole ring is one `role="img"` with the
 * caller's accessible name; the centre text is decorative for assistive tech.
 */
@Component({
  selector: 'ptah-progress-ring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.data-size]': 'size()',
    '[attr.data-tone]': 'tone()',
    '[class.ptah-ring--lg]': "size() === 'lg'",
    '[class.ptah-ring--indeterminate]': 'fraction() === null',
    '[style.width.px]': 'fixedSide()',
    '[style.height.px]': 'fixedSide()',
  },
  template: `
    <svg
      class="ptah-ring__svg"
      [attr.viewBox]="viewBox()"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        class="ptah-ring__track"
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        fill="none"
        [attr.stroke-width]="stroke()"
      />
      <g class="ptah-ring__spinner">
        <circle
          class="ptah-ring__arc"
          [attr.cx]="center()"
          [attr.cy]="center()"
          [attr.r]="radius()"
          fill="none"
          [attr.stroke-width]="stroke()"
          stroke-linecap="round"
          [attr.stroke-dasharray]="dashArray()"
          [attr.transform]="arcTransform()"
          [attr.opacity]="arcLength() > 0 ? null : 0"
        />
      </g>
    </svg>
    @if (centerText() || subText()) {
      <span class="ptah-ring__center" aria-hidden="true">
        @if (centerText()) {
          <span class="ptah-ring__value tabular-nums">{{ centerText() }}</span>
        }
        @if (subText()) {
          <span class="ptah-ring__sub text-base-content-muted">{{
            subText()
          }}</span>
        }
      </span>
    }
  `,
  styles: [
    `
      :host {
        position: relative;
        display: inline-block;
        flex: none;
        width: var(--ptah-stat-value-h, 56px);
        height: var(--ptah-stat-value-h, 56px);
        --ptah-ring-ink: oklch(var(--p));
      }
      :host([data-tone='teal']) {
        --ptah-ring-ink: oklch(var(--a));
      }
      .ptah-ring__svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .ptah-ring__track {
        stroke: oklch(var(--bc) / 0.12);
      }
      .ptah-ring__arc {
        stroke: var(--ptah-ring-ink);
      }
      .ptah-ring__spinner {
        transform-box: view-box;
        transform-origin: 50% 50%;
      }
      .ptah-ring__center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        line-height: 1;
      }
      .ptah-ring__value {
        font-weight: 600;
        font-size: calc(var(--ptah-stat-value-h, 56px) * 0.25);
        color: oklch(var(--bc));
      }
      .ptah-ring__sub {
        margin-top: 4px;
        font-size: 12px;
      }
      :host(.ptah-ring--lg) .ptah-ring__value {
        font-size: 28px;
      }
      @media (prefers-reduced-motion: no-preference) {
        .ptah-ring__arc {
          animation: ptah-ring-in 600ms var(--ptah-ease-soft, ease-out) both;
        }
        :host(.ptah-ring--indeterminate) .ptah-ring__spinner {
          animation: ptah-ring-spin 1.1s linear infinite;
        }
      }
      @keyframes ptah-ring-in {
        from {
          opacity: 0;
        }
      }
      @keyframes ptah-ring-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class ProgressRingComponent {
  /** 0-1; `null` (or NaN) = indeterminate. Out-of-range values are clamped. */
  readonly value = input.required<number | null>();
  readonly centerText = input<string>('');
  readonly subText = input<string>('');
  readonly tone = input<'gold' | 'teal'>('gold');
  readonly size = input<'value' | 'lg'>('value');
  readonly ariaLabel = input.required<string>();

  private readonly geometry = computed(() => RING_GEOMETRY[this.size()]);

  protected readonly stroke = computed(() => this.geometry().stroke);
  protected readonly center = computed(() => this.geometry().side / 2);
  protected readonly radius = computed(
    () => (this.geometry().side - this.geometry().stroke) / 2,
  );
  protected readonly viewBox = computed(
    () => `0 0 ${this.geometry().side} ${this.geometry().side}`,
  );
  protected readonly arcTransform = computed(
    () => `rotate(-90 ${this.center()} ${this.center()})`,
  );

  /** `lg` has a fixed side; `value` sizes from the CSS variable (null). */
  protected readonly fixedSide = computed(() =>
    this.size() === 'lg' ? RING_GEOMETRY.lg.side : null,
  );

  /** 0-1, or `null` when indeterminate (null or NaN input). ±Infinity clamps. */
  protected readonly fraction = computed(() => {
    const value = this.value();
    if (value === null || Number.isNaN(value)) return null;
    return Math.min(1, Math.max(0, value));
  });

  private readonly circumference = computed(() => 2 * Math.PI * this.radius());

  protected readonly arcLength = computed(
    () => this.circumference() * (this.fraction() ?? INDETERMINATE_FRACTION),
  );

  protected readonly dashArray = computed(
    () => `${this.arcLength()} ${this.circumference()}`,
  );
}
