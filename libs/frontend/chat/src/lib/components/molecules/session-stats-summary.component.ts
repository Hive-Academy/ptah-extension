import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { calculateSessionCostSummary } from '@ptah-extension/shared';

/**
 * SessionStatsSummaryComponent - Compact inline session stats display
 *
 * Complexity Level: 2 (Molecule)
 * Patterns: Standalone component, OnPush change detection, Computed signals
 *
 * Features:
 * - Total cost across all messages
 * - Total token usage with tooltip
 * - Total duration
 * - Agent count (if any)
 *
 * Design: Compact horizontal inline badges matching VSCode sidebar width
 */
@Component({
  selector: 'ptah-session-stats-summary',
  standalone: true,
  template: `
    @if (hasStats()) {
    <div class="flex flex-wrap items-center gap-1.5">
      <!-- Tokens badge -->
      <span class="badge badge-outline badge-sm" [title]="tokenTooltip()">
        {{ formatTokens(totalTokenCount()) }} tokens
      </span>

      <!-- Cost badge -->
      <span class="badge badge-sm badge-success text-success-content">
        {{ formatCost(summary().totalCost) }}
      </span>

      <!-- Duration badge -->
      <span class="badge badge-sm badge-ghost">
        {{ formatDuration(summary().totalDuration) }}
      </span>

      <!-- Agent count (if any) -->
      @if (summary().agentCount > 0) {
      <span class="badge badge-sm badge-info badge-outline">
        {{ summary().agentCount }} agent{{
          summary().agentCount > 1 ? 's' : ''
        }}
      </span>
      }
    </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionStatsSummaryComponent {
  /** All messages in the session */
  readonly messages = input.required<readonly ExecutionChatMessage[]>();

  /**
   * Optional preloaded stats from backend (for old sessions loaded from JSONL)
   * When provided, these are used instead of calculating from messages.
   */
  readonly preloadedStats = input<{
    totalCost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    messageCount: number;
  } | null>(null);

  /** Computed session summary using utility functions or preloaded stats */
  readonly summary = computed(() => {
    const preloaded = this.preloadedStats();
    if (preloaded) {
      // Use preloaded stats from backend (old sessions)
      return {
        totalCost: preloaded.totalCost,
        totalTokens: preloaded.tokens,
        totalDuration: 0, // Duration not available in preloaded stats
        agentCount: 0, // Agent count not tracked in preloaded stats
      };
    }
    // Calculate from messages (live sessions)
    return calculateSessionCostSummary([...this.messages()]);
  });

  /** Whether we have any stats to display */
  readonly hasStats = computed(() => {
    const s = this.summary();
    return s.totalCost > 0 || s.totalDuration > 0 || this.totalTokenCount() > 0;
  });

  /** Total token count (input + output) */
  readonly totalTokenCount = computed(() => {
    const tokens = this.summary().totalTokens;
    return tokens.input + tokens.output;
  });

  /** Tooltip with detailed token breakdown */
  readonly tokenTooltip = computed(() => {
    const t = this.summary().totalTokens;
    const lines = [
      `Input: ${t.input.toLocaleString()}`,
      `Output: ${t.output.toLocaleString()}`,
    ];
    if (t.cacheRead && t.cacheRead > 0) {
      lines.push(`Cache Read: ${t.cacheRead.toLocaleString()}`);
    }
    if (t.cacheCreation && t.cacheCreation > 0) {
      lines.push(`Cache Creation: ${t.cacheCreation.toLocaleString()}`);
    }
    lines.push(`Total: ${this.totalTokenCount().toLocaleString()}`);
    return lines.join('\n');
  });

  /** Format cost for display */
  protected formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }
    return `$${cost.toFixed(2)}`;
  }

  /** Format tokens for display */
  protected formatTokens(count: number): string {
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}k`;
    }
    return count.toString();
  }

  /** Format duration for display */
  protected formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }
}
