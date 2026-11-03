import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  formatUsdCost,
  type SessionCostBasis,
  type SessionCostUnavailableReason,
} from '@ptah-extension/shared';

/** Final price meaning shared by cost badges and session stats views. */
export function costBasisLabel(
  cost: number | null | undefined,
  basis: SessionCostBasis | undefined,
): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  if (basis === 'estimated') return 'estimated';
  if (basis === 'covered-by-subscription') return 'covered by subscription';
  return null;
}

/**
 * CostBadgeComponent - Displays message cost with formatting
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Formatting lives in the shared `formatUsdCost` (`@ptah-extension/shared`),
 * so this badge and every other surface print the same string for the same
 * cost.
 *
 * UNKNOWN vs ZERO: a null/undefined cost renders "cost unavailable", never
 * "$0.00". The two are different facts and the difference is load-bearing —
 * GitHub Copilot and local Ollama really do cost $0, while a user-defined
 * provider with no configured pricing simply has no rate to compute from
 * (TASK_2026_236). Collapsing the second into the first tells the user their
 * paid gateway is free, which is a lie the UI has no business telling.
 *
 * INK: the solid `badge-success` fill carries the measured `.ok-solid-text`
 * ink, not daisyUI's `text-success-content` — that stock pairing measures
 * 2.64:1 on this theme's success fill in `anubis` (FU-PHASE6). The override is
 * dark-theme-only; `anubis-light` keeps the stock pairing (6.01:1). Same
 * pattern as the git badges (task-pr-panel).
 */
@Component({
  selector: 'ptah-cost-badge',
  standalone: true,
  template: `
    @if (knownCost(); as cost) {
      <span
        class="badge badge-sm badge-success ok-solid-text"
        [title]="'$' + cost.value.toFixed(4) + ' USD' + (basisLabel() ? ' — ' + basisLabel() : '')"
      >
        {{ formatUsdCost(cost.value) }}
        @if (basisLabel(); as label) {
          <span class="ml-1" data-testid="cost-basis-label">{{ label }}</span>
        }
      </span>
    } @else {
      @if (notPriced()) {
        <span
          class="badge badge-sm badge-ghost opacity-70"
          title="Ptah does not have the rate needed to calculate this cost."
          data-testid="cost-not-priced"
        >
          not priced
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

  /** Optional final price meaning; absent snapshots keep the legacy badge. */
  readonly costBasis = input<SessionCostBasis>();

  /**
   * Backend's narrow cause of a null cost. Only `rate-missing` changes the
   * label: Ptah lacks a rate needed for the model, while
   * every other null-cost reason (unknown billing, unusable usage) keeps
   * "cost unavailable" so the badge never claims more than it knows.
   */
  readonly costUnavailableReason = input<SessionCostUnavailableReason>();

  protected readonly basisLabel = computed(() =>
    costBasisLabel(this.cost(), this.costBasis()),
  );

  /**
   * Whether the null cost is a model without a rate available to Ptah, from the same
   * known-cost gate the template's `@if` uses, so a genuine `0` stays priced.
   */
  protected readonly notPriced = computed(() =>
    this.knownCost() === null &&
    this.costUnavailableReason() === 'rate-missing',
  );

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

  /** Shared formatter; the known-cost branch always passes a finite number. */
  protected readonly formatUsdCost = formatUsdCost;
}
