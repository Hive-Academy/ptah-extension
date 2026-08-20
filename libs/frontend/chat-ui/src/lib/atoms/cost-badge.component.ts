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
 *
 * UNKNOWN vs ZERO: a null/undefined cost renders "cost unavailable", never
 * "$0.00". The two are different facts and the difference is load-bearing —
 * GitHub Copilot and local Ollama really do cost $0, while a user-defined
 * provider with no configured pricing simply has no rate to compute from
 * (TASK_2026_236). Collapsing the second into the first tells the user their
 * paid gateway is free, which is a lie the UI has no business telling.
 */
@Component({
  selector: 'ptah-cost-badge',
  standalone: true,
  template: `
    @if (knownCost(); as cost) {
      <span
        class="badge badge-sm badge-success text-success-content"
        [title]="'$' + cost.value.toFixed(4) + ' USD'"
      >
        {{ formatCost(cost.value) }}
      </span>
    } @else {
      <span
        class="badge badge-sm badge-ghost opacity-70"
        title="No per-token pricing is known for this provider or model, so cost cannot be calculated."
        data-testid="cost-unavailable"
      >
        cost unavailable
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostBadgeComponent {
  /**
   * Cost in USD, or null/undefined when no pricing is known.
   *
   * Accepts the nullable shapes on purpose: `calculateMessageCost` returns
   * `null` for an unpriced model and `ExecutionNode.cost` is optional, so
   * callers were previously forced into `!` assertions that lied at runtime.
   */
  readonly cost = input.required<number | null | undefined>();

  /**
   * The cost when it is genuinely known, wrapped so a real `0` survives the
   * template's `@if` truthiness check — an unwrapped `0` would fall into the
   * "unavailable" branch and hide a legitimately free turn.
   */
  protected readonly knownCost = computed<{ value: number } | null>(() => {
    const cost = this.cost();
    return typeof cost === 'number' && Number.isFinite(cost)
      ? { value: cost }
      : null;
  });

  protected formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }

    return `$${cost.toFixed(2)}`;
  }
}
