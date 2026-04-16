import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import {
  calculateSessionCostSummary,
  formatModelDisplayName,
} from '@ptah-extension/shared';

/**
 * CompactSessionStatsComponent - Inline stats badges for compact session card.
 *
 * Shows token count, cost, agent count, and model as compact inline badges.
 *
 * Complexity Level: 1 (Molecule-level presentational)
 * Patterns: Signal inputs, computed signals, OnPush
 */
@Component({
  selector: 'ptah-compact-session-stats',
  standalone: true,
  template: `
    <div
      class="flex items-center gap-1.5 px-3 py-1.5 border-b border-base-content/10 overflow-x-auto text-[10px]"
    >
      @if (modelName()) {
        <span
          class="inline-flex items-center gap-0.5 bg-purple-600/15 border border-purple-600/25 rounded px-1 py-0.5 whitespace-nowrap"
        >
          <span class="text-purple-400 font-semibold">{{ modelName() }}</span>
        </span>
      }
      <span
        class="inline-flex items-center gap-0.5 bg-base-content/5 border border-base-content/10 rounded px-1 py-0.5 whitespace-nowrap"
      >
        <span class="text-base-content/50">Tokens</span>
        <span class="tabular-nums">{{ formattedTokens() }}</span>
      </span>
      <span
        class="inline-flex items-center gap-0.5 bg-success/10 border border-success/20 rounded px-1 py-0.5 whitespace-nowrap"
      >
        <span class="text-base-content/50">Cost</span>
        <span class="text-success tabular-nums">{{ formattedCost() }}</span>
      </span>
      @if (agentCount() > 0) {
        <span
          class="inline-flex items-center gap-0.5 bg-info/10 border border-info/20 rounded px-1 py-0.5 whitespace-nowrap"
        >
          <span class="text-base-content/50">Agents</span>
          <span class="text-info tabular-nums">{{ agentCount() }}</span>
        </span>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionStatsComponent {
  readonly messages = input.required<readonly ExecutionChatMessage[]>();
  readonly preloadedStats = input<{
    totalCost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    messageCount: number;
    agentSessionCount?: number;
  } | null>(null);
  readonly liveModelStats = input<{
    model: string;
    contextUsed: number;
    contextWindow: number;
    contextPercent: number;
  } | null>(null);

  private readonly summary = computed(() => {
    const preloaded = this.preloadedStats();
    if (preloaded) {
      return {
        totalCost: preloaded.totalCost,
        totalTokens: preloaded.tokens,
        agentCount: preloaded.agentSessionCount ?? 0,
      };
    }
    const calc = calculateSessionCostSummary([...this.messages()]);
    return {
      totalCost: calc.totalCost,
      totalTokens: calc.totalTokens,
      agentCount: calc.agentCount,
    };
  });

  readonly modelName = computed(() => {
    const stats = this.liveModelStats();
    return stats ? formatModelDisplayName(stats.model) : null;
  });

  readonly formattedTokens = computed(() => {
    const t = this.summary().totalTokens;
    const total = t.input + (t.cacheRead ?? 0) + t.output;
    return this.formatTokens(total);
  });

  readonly formattedCost = computed(() => {
    const cost = this.summary().totalCost;
    return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
  });

  readonly agentCount = computed(() => this.summary().agentCount);

  private formatTokens(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return count.toString();
  }
}
