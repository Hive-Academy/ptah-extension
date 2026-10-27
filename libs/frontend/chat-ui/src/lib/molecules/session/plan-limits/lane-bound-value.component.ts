import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LANE_EMPTY, splitLowerBound } from './lane-tiles';

/**
 * A lane number for the compact Lanes faces ("≥2.6k", "$0.02").
 *
 * A lower bound keeps its visible `≥`; screen readers hear "at least"
 * instead of the symbol. An empty value renders a muted `—` that reads as
 * `unknownLabel`.
 */
@Component({
  selector: 'ptah-lane-bound-value',
  standalone: true,
  host: { class: 'tabular-nums' },
  // One line per branch: no template whitespace between "≥" and the number.
  template: `
    @let p = parts();
    @if (p) {
      @if (p.atLeast) {<span aria-hidden="true">≥</span><span class="sr-only">at least </span>}{{ p.value }}
    } @else {
      <span class="text-base-content-muted" aria-hidden="true">{{ empty }}</span><span class="sr-only">{{ unknownLabel() }}</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaneBoundValueComponent {
  /** "≥2.6k", "$0.02", `''` or `—` for unknown. */
  readonly text = input.required<string>();
  readonly unknownLabel = input<string>('unknown');

  protected readonly empty = LANE_EMPTY.value;
  protected readonly parts = computed(() => {
    const text = this.text();
    return text && text !== LANE_EMPTY.value ? splitLowerBound(text) : null;
  });
}
