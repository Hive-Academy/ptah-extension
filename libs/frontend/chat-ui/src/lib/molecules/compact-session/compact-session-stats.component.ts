import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CompactSummaryMetrics } from './compact-session-summary';

/** Fixed-width-safe metrics footer for the compact status card. */
@Component({
  selector: 'ptah-compact-session-stats',
  standalone: true,
  host: {
    class: 'block min-w-0 overflow-hidden',
  },
  template: `
    <div
      class="flex min-w-0 items-center gap-x-3 overflow-hidden px-3 py-1.5 text-[10px] text-base-content-muted"
      aria-label="Session metrics"
    >
      @if (metrics().model; as model) {
        <span
          class="min-w-0 truncate font-medium text-purple-400"
          [title]="model"
        >
          {{ model }}
        </span>
      }
      <span class="shrink-0 tabular-nums">{{
        formatTokens(metrics().tokens)
      }}</span>
      <span class="shrink-0 tabular-nums">{{
        formatCost(metrics().cost)
      }}</span>
      @if (metrics().agentCount > 0) {
        <span class="shrink-0 tabular-nums"
          >{{ metrics().agentCount }} agents</span
        >
      }
      @if (metrics().compactionCount > 0) {
        <span class="ml-auto shrink-0 tabular-nums">
          {{ metrics().compactionCount }} compacted
        </span>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionStatsComponent {
  readonly metrics = input.required<CompactSummaryMetrics>();

  /** `1.3M tokens`; an unavailable total reads `Tokens —`, like cost. */
  protected formatTokens(count: number | null): string {
    if (count === null) return 'Tokens —';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tokens`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k tokens`;
    return `${count} tokens`;
  }

  protected formatCost(cost: number | null): string {
    if (cost === null) return 'Cost \u2014';
    return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
  }
}
