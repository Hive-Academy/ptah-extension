import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * CostBadgeComponent - Displays message cost with formatting
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Formats costs:
 * - < $0.01: "$0.0042" (4 decimal places)
 * - >= $0.01: "$0.12" (2 decimal places)
 * - >= $1.00: "$1.23" (2 decimal places)
 */
@Component({
  selector: 'ptah-cost-badge',
  standalone: true,
  template: `
    <span
      class="badge badge-outline badge-sm badge-success"
      [title]="'$' + cost().toFixed(4) + ' USD'"
    >
      {{ formatCost() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostBadgeComponent {
  readonly cost = input.required<number>();

  protected formatCost(): string {
    const cost = this.cost();

    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }

    return `$${cost.toFixed(2)}`;
  }
}
