import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * StatValueComponent — a stat numeral with an optional projected mini chart
 * (spend bars, context meter) after it.
 *
 * The host is an `inline-flex` with `align-items: baseline`, so a projected
 * SVG's bottom edge sits on the numeral's baseline without styling the
 * projected node (options.md:277). Numerals: tabular figures, weight 600,
 * line-height 1; `lg` 34 px, `md` 28 px (the compact chat row).
 */
@Component({
  selector: 'ptah-stat-value',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  template: `
    <span class="ptah-stat-value__num">{{ text() }}</span>
    <ng-content />
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: baseline;
        gap: 12px;
      }
      .ptah-stat-value__num {
        font-size: 34px;
        line-height: 1;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
        color: oklch(var(--bc));
        white-space: nowrap;
      }
      :host([data-size='md']) .ptah-stat-value__num {
        font-size: 28px;
      }
    `,
  ],
})
export class StatValueComponent {
  readonly text = input.required<string>();
  readonly size = input<'lg' | 'md'>('lg');
}
