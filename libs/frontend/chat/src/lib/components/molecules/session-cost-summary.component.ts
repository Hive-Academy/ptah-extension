import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';

/**
 * SessionCostSummaryComponent - Displays session-level cost and token totals
 *
 * Complexity Level: 2 (Molecule with state)
 * Patterns: Standalone component, OnPush change detection, signal-based state
 *
 * Features:
 * - Compact summary view (total cost, total tokens, message count)
 * - Expandable detail view (input/output tokens, average cost per message)
 * - Reactive updates via signal inputs
 * - Graceful handling of edge cases (zero messages, zero cost)
 */
@Component({
  selector: 'ptah-session-cost-summary',
  standalone: true,
  template: `
    <div class="card bg-base-200 shadow-md">
      @if (messageCount() === 0) {
      <!-- No usage data fallback -->
      <div class="card-body p-3">
        <div class="text-sm text-base-content/70">No usage data available</div>
      </div>
      } @else {
      <!-- Summary header (always visible) -->
      <div class="card-body p-3 cursor-pointer" (click)="toggleExpanded()">
        <div class="flex items-center justify-between">
          <div class="flex gap-3 items-baseline">
            <span class="text-sm font-medium">Session Cost:</span>
            <span class="text-lg font-bold text-success">
              {{ formatCost(totalCost()) }}
            </span>
          </div>

          <div class="flex gap-2 text-xs text-base-content/70">
            <span
              >{{
                formatTokens(totalTokensInput() + totalTokensOutput())
              }}
              tokens</span
            >
            <span>•</span>
            <span>{{ messageCount() }} messages</span>
          </div>
        </div>

        <!-- Expanded details -->
        @if (isExpanded()) {
        <div class="divider my-2"></div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span class="text-base-content/70">Input tokens:</span>
            <span class="font-medium ml-2">{{
              formatTokens(totalTokensInput())
            }}</span>
          </div>
          <div>
            <span class="text-base-content/70">Output tokens:</span>
            <span class="font-medium ml-2">{{
              formatTokens(totalTokensOutput())
            }}</span>
          </div>
          <div>
            <span class="text-base-content/70">Avg. cost/message:</span>
            <span class="font-medium ml-2">{{
              formatCost(averageCostPerMessage())
            }}</span>
          </div>
          <div>
            <span class="text-base-content/70">Messages with cost:</span>
            <span class="font-medium ml-2">{{ messageCount() }}</span>
          </div>
        </div>
        }
      </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionCostSummaryComponent {
  // Signal inputs (all required)
  readonly totalCost = input.required<number>();
  readonly totalTokensInput = input.required<number>();
  readonly totalTokensOutput = input.required<number>();
  readonly messageCount = input.required<number>();

  // Local state for expand/collapse
  protected readonly isExpanded = signal(false);

  /**
   * Toggle expanded state
   */
  protected toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }

  /**
   * Calculate average cost per message
   * Edge case: Division by zero - return 0 if messageCount is 0
   */
  protected averageCostPerMessage(): number {
    const count = this.messageCount();
    return count > 0 ? this.totalCost() / count : 0;
  }

  /**
   * Format cost with appropriate precision
   * - $0.00 for zero cost
   * - 4 decimal places for costs < $0.01 (sub-cent accuracy)
   * - 2 decimal places for costs >= $0.01 (standard currency format)
   */
  protected formatCost(cost: number): string {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  }

  /**
   * Format token counts with k/M suffixes
   * - Show as-is for counts < 1,000
   * - Show as "1.2k" for counts >= 1,000
   * - Show as "1.2M" for counts >= 1,000,000
   */
  protected formatTokens(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return `${count}`;
  }
}
