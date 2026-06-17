import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';

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
      class="badge badge-sm badge-success text-success-content"
      [title]="'$' + safeCost().toFixed(4) + ' USD'"
    >
      {{ formatCost() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostBadgeComponent {
  readonly cost = input.required<number>();

  /**
   * Coalesces null/undefined/NaN/Infinity to 0 so the template never calls
   * toFixed on a non-finite value. Callers pass `agentCost()!` with a non-null
   * assertion that can lie at runtime when a model has no pricing; an unguarded
   * toFixed there throws every change-detection cycle.
   */
  protected readonly safeCost = computed(() => {
    const cost = this.cost();
    return typeof cost === 'number' && Number.isFinite(cost) ? cost : 0;
  });

  protected formatCost(): string {
    const cost = this.safeCost();

    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }

    return `$${cost.toFixed(2)}`;
  }
}
