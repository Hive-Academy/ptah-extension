import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * StatRowComponent — the aligned stat group of the vitals screens (the
 * designer's `vg()` helper, option-ab.mjs:23-29,47; options.md:272-282; D17).
 *
 * `layout='row'`: one grid of equal 192 px columns with a 24 px gap (150 px /
 * 16 px under 1000 px wide), centred as a group; each projected
 * `ptah-stat-cell` is one column and lays out its own three fixed rows, so
 * columns line up without subgrid. The column count follows the cells.
 *
 * `layout='stack'`: a full-height column with `space-between`, so the first
 * and last numerals meet the top and bottom of whatever the parent sizes it
 * to (the screen-02 activity grid). Cells render label-as-caption there.
 *
 * The row owns `--ptah-stat-value-h` (56 px regular, 52 px compact); cells
 * and `size='value'` rings read it. It also sets `--ptah-stat-num-size`
 * (34 px / 28 px, the `lg` / `md` numeral) for the cells' placeholder dash
 * and loading shimmer.
 */
@Component({
  selector: 'ptah-stat-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-layout]': 'layout()',
    '[attr.data-density]': 'density()',
  },
  template: `<ng-content />`,
  styles: [
    `
      :host {
        --ptah-stat-value-h: 56px;
        --ptah-stat-num-size: 34px;
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 192px;
        column-gap: 24px;
        justify-content: center;
        align-items: start;
        text-align: left;
      }
      :host([data-density='compact']) {
        --ptah-stat-value-h: 52px;
        --ptah-stat-num-size: 28px;
      }
      :host([data-layout='stack']) {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
      }
      @media (max-width: 1000px) {
        :host([data-layout='row']) {
          grid-auto-columns: 150px;
          column-gap: 16px;
        }
      }
    `,
  ],
})
export class StatRowComponent {
  readonly layout = input<'row' | 'stack'>('row');
  readonly density = input<'regular' | 'compact'>('regular');
}
