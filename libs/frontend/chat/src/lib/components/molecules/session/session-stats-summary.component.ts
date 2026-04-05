import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  signal,
} from '@angular/core';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import {
  calculateSessionCostSummary,
  formatModelDisplayName,
} from '@ptah-extension/shared';

/**
 * Live model stats from current session
 * Updated after each turn completion with context window info
 */
export interface LiveModelStats {
  /** Primary model name (e.g., "claude-sonnet-4-20250514") */
  model: string;
  /** Total context tokens used (input + output) */
  contextUsed: number;
  /** Total context window size */
  contextWindow: number;
  /** Context usage as percentage (0-100) */
  contextPercent: number;
}

/**
 * Per-model usage entry for collapsible breakdown display
 */
export interface ModelUsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  contextWindow: number;
  cacheReadInputTokens?: number;
}

/**
 * SessionStatsSummaryComponent - Compact inline session stats display
 *
 * Complexity Level: 2 (Molecule)
 * Patterns: Standalone component, OnPush change detection, Computed signals
 *
 * Features:
 * - Context usage display (tokens + percentage)
 * - Model name display
 * - Total cost across all messages
 * - Total token usage with tooltip
 * - Total duration
 * - Agent count (if any)
 * - Collapsible per-model usage breakdown (when 2+ models)
 *
 * Design: Compact horizontal inline badges matching VSCode sidebar width
 */
@Component({
  selector: 'ptah-session-stats-summary',
  standalone: true,
  template: `
    @if (hasStats()) {
      <div class="stats-grid" style="container-type: inline-size">
        <!-- Collapsed: compact summary bar -->
        @if (isStatsCollapsed()) {
          <div
            class="flex items-center gap-2 bg-base-200/50 rounded px-2 py-1 border border-base-content/10"
          >
            <div
              class="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto text-xs"
            >
              @if (liveModelStats()) {
                <span class="text-purple-400 font-semibold whitespace-nowrap">{{
                  formatModelName(liveModelStats()!.model)
                }}</span>
                <span class="text-base-content/20">|</span>
                <span class="text-cyan-400 whitespace-nowrap"
                  >{{ liveModelStats()!.contextPercent }}%</span
                >
                <span class="text-base-content/20">|</span>
              }
              <span class="tabular-nums whitespace-nowrap">{{
                formatTokens(totalTokenCount())
              }}</span>
              <span class="text-base-content/20">|</span>
              <span class="text-success tabular-nums whitespace-nowrap">{{
                formatCost(summary().totalCost)
              }}</span>
              @if (summary().totalDuration > 0) {
                <span class="text-base-content/20">|</span>
                <span class="tabular-nums whitespace-nowrap">{{
                  formatDuration(summary().totalDuration)
                }}</span>
              }
              @if (compactionCount() > 0) {
                <span class="text-base-content/20">|</span>
                <span class="text-warning whitespace-nowrap"
                  >{{ compactionCount() }}x compacted</span
                >
              }
            </div>
            <button
              class="text-base-content/40 hover:text-base-content/70 transition-colors flex-shrink-0 p-0.5"
              (click)="isStatsCollapsed.set(false)"
              type="button"
              title="Expand stats"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        } @else {
          <!-- Expanded: full card grid with inline collapse button -->
          <div class="grid grid-cols-2 gap-1.5">
            <!-- Model Card -->
            @if (liveModelStats()) {
              <div
                class="bg-base-200/50 rounded px-2 py-1.5 border border-purple-600/20"
                [title]="liveModelStats()!.model"
              >
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
                >
                  Model
                </div>
                <div
                  class="text-sm font-semibold text-purple-400 truncate leading-tight mt-0.5"
                >
                  {{ formatModelName(liveModelStats()!.model) }}
                </div>
              </div>
            }

            <!-- Context Card -->
            @if (liveModelStats()) {
              <div
                class="bg-base-200/50 rounded px-2 py-1.5 border border-cyan-600/20"
                [title]="contextTooltip()"
              >
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
                >
                  Context
                </div>
                <div
                  class="text-sm font-semibold text-cyan-400 leading-tight mt-0.5"
                >
                  {{ liveModelStats()!.contextPercent }}%
                  <span class="text-[10px] font-normal text-base-content/40">
                    ({{ formatTokens(liveModelStats()!.contextUsed) }})
                  </span>
                </div>
              </div>
            }

            <!-- Tokens Card -->
            <div
              class="bg-base-200/50 rounded px-2 py-1.5 border border-base-content/10"
              [title]="tokenTooltip()"
            >
              <div
                class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
              >
                Tokens
              </div>
              <div
                class="text-sm font-semibold tabular-nums leading-tight mt-0.5"
              >
                {{ formatTokens(totalTokenCount()) }}
              </div>
            </div>

            <!-- Cost Card -->
            <div
              class="bg-base-200/50 rounded px-2 py-1.5 border border-success/20"
            >
              <div
                class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
              >
                Cost
              </div>
              <div
                class="text-sm font-semibold text-success tabular-nums leading-tight mt-0.5"
              >
                {{ formatCost(summary().totalCost) }}
              </div>
            </div>

            <!-- Duration Card (conditional) -->
            @if (summary().totalDuration > 0) {
              <div
                class="bg-base-200/50 rounded px-2 py-1.5 border border-base-content/10"
              >
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
                >
                  Duration
                </div>
                <div
                  class="text-sm font-semibold tabular-nums leading-tight mt-0.5"
                >
                  {{ formatDuration(summary().totalDuration) }}
                </div>
              </div>
            }

            <!-- Agents Card (conditional) -->
            @if (summary().agentCount > 0) {
              <div
                class="bg-base-200/50 rounded px-2 py-1.5 border border-info/20"
              >
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
                >
                  Agents
                </div>
                <div
                  class="text-sm font-semibold text-info tabular-nums leading-tight mt-0.5"
                >
                  {{ summary().agentCount }}
                </div>
              </div>
            }

            <!-- Compactions Card (conditional) -->
            @if (compactionCount() > 0) {
              <div
                class="bg-base-200/50 rounded px-2 py-1.5 border border-warning/20"
                title="Number of context compactions during this session"
              >
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
                >
                  Compactions
                </div>
                <div
                  class="text-sm font-semibold text-warning tabular-nums leading-tight mt-0.5"
                >
                  {{ compactionCount() }}
                </div>
              </div>
            }

            <!-- Multi-model Toggle Card (conditional) -->
            @if (hasMultipleModels()) {
              <button
                class="bg-base-200/50 rounded px-2 py-1.5 border border-purple-600/20 cursor-pointer hover:bg-base-200/80 text-left transition-colors"
                (click)="isExpanded.set(!isExpanded())"
                type="button"
                [title]="
                  isExpanded()
                    ? 'Hide per-model breakdown'
                    : 'Show per-model breakdown'
                "
              >
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight"
                >
                  Models
                </div>
                <div
                  class="text-sm font-semibold text-purple-400 leading-tight mt-0.5"
                >
                  {{ modelUsageList()!.length }}
                  <span class="text-[10px] font-normal">{{
                    isExpanded() ? '▲' : '▼'
                  }}</span>
                </div>
              </button>
            }

            <!-- Collapse button card -->
            <button
              class="bg-base-200/50 rounded px-2 py-1.5 border border-base-content/10 cursor-pointer hover:bg-base-200/80 flex items-center justify-center transition-colors"
              (click)="isStatsCollapsed.set(true)"
              type="button"
              title="Collapse stats"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-base-content/40"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          </div>

          <!-- Expanded per-model breakdown -->
          @if (isExpanded() && hasMultipleModels()) {
            <div
              class="mt-1.5 bg-base-200/50 rounded border border-purple-600/20 overflow-hidden"
            >
              <!-- Header row -->
              <div
                class="grid grid-cols-4 gap-1 px-2 py-1 border-b border-base-content/10"
              >
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50"
                >
                  Model
                </div>
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 text-right"
                >
                  In
                </div>
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 text-right"
                >
                  Out
                </div>
                <div
                  class="text-[10px] uppercase tracking-wider text-base-content/50 text-right"
                >
                  Cost
                </div>
              </div>

              <!-- Model rows -->
              @for (usage of modelUsageList()!; track usage.model) {
                <div
                  class="grid grid-cols-4 gap-1 px-2 py-1.5 border-b border-base-content/5 last:border-b-0"
                >
                  <div
                    class="text-xs font-semibold text-purple-400 truncate"
                    [title]="usage.model"
                  >
                    {{ formatModelName(usage.model) }}
                  </div>
                  <div
                    class="text-xs text-right tabular-nums text-base-content/70"
                  >
                    {{ formatTokens(usage.inputTokens) }}
                  </div>
                  <div
                    class="text-xs text-right tabular-nums text-base-content/70"
                  >
                    {{ formatTokens(usage.outputTokens) }}
                  </div>
                  <div class="text-xs text-right tabular-nums text-success">
                    {{ formatCost(usage.costUSD) }}
                  </div>
                </div>
              }

              <!-- Totals row -->
              <div
                class="grid grid-cols-4 gap-1 px-2 py-1.5 border-t border-base-content/10 bg-base-300/30"
              >
                <div class="text-xs font-semibold">Total</div>
                <div class="text-xs text-right tabular-nums font-semibold">
                  {{ formatTokens(totalModelInputTokens()) }}
                </div>
                <div class="text-xs text-right tabular-nums font-semibold">
                  {{ formatTokens(totalModelOutputTokens()) }}
                </div>
                <div
                  class="text-xs text-right tabular-nums font-semibold text-success"
                >
                  {{ formatCost(totalModelCost()) }}
                </div>
              </div>
            </div>
          }
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      @container (min-width: 380px) {
        .stats-grid .grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @container (min-width: 500px) {
        .stats-grid .grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
    `,
  ],
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
    agentSessionCount?: number;
  } | null>(null);

  /**
   * Live model stats from current session (updated after each turn completion)
   * Includes context window info for percentage display and model name.
   */
  readonly liveModelStats = input<LiveModelStats | null>(null);

  /**
   * Full per-model usage breakdown from backend.
   * Contains all models used in the session with their individual stats.
   */
  readonly modelUsageList = input<ModelUsageEntry[] | null>(null);

  /** Number of context compactions in this session */
  readonly compactionCount = input<number>(0);

  /** Whether the stats section is collapsed to a compact bar */
  readonly isStatsCollapsed = signal(false);

  /** Whether the per-model breakdown table is expanded */
  readonly isExpanded = signal(false);

  /** Whether there are multiple models to display */
  readonly hasMultipleModels = computed(
    () => (this.modelUsageList()?.length ?? 0) >= 2,
  );

  /** Total input tokens across all models in the breakdown */
  readonly totalModelInputTokens = computed(() => {
    const list = this.modelUsageList();
    if (!list) return 0;
    return list.reduce((sum, m) => sum + m.inputTokens, 0);
  });

  /** Total output tokens across all models in the breakdown */
  readonly totalModelOutputTokens = computed(() => {
    const list = this.modelUsageList();
    if (!list) return 0;
    return list.reduce((sum, m) => sum + m.outputTokens, 0);
  });

  /** Total cost across all models in the breakdown */
  readonly totalModelCost = computed(() => {
    const list = this.modelUsageList();
    if (!list) return 0;
    return list.reduce((sum, m) => sum + m.costUSD, 0);
  });

  /** Computed session summary using utility functions or preloaded stats */
  readonly summary = computed(() => {
    const preloaded = this.preloadedStats();
    if (preloaded) {
      // Use preloaded stats from backend (old sessions)
      return {
        totalCost: preloaded.totalCost,
        totalTokens: preloaded.tokens,
        totalDuration: 0, // Duration not available in preloaded stats
        agentCount: preloaded.agentSessionCount ?? 0,
      };
    }
    // Calculate from messages (live sessions)
    return calculateSessionCostSummary([...this.messages()]);
  });

  /** Whether we have any stats to display */
  readonly hasStats = computed(() => {
    const s = this.summary();
    return (
      s.totalCost > 0 ||
      s.totalDuration > 0 ||
      this.totalTokenCount() > 0 ||
      this.liveModelStats() !== null
    );
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

  /** Tooltip with context window details */
  readonly contextTooltip = computed(() => {
    const stats = this.liveModelStats();
    if (!stats) return '';
    return [
      `Context Used: ${stats.contextUsed.toLocaleString()} tokens`,
      `Context Window: ${stats.contextWindow.toLocaleString()} tokens`,
      `Usage: ${stats.contextPercent}%`,
    ].join('\n');
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

  /**
   * Format model name for display
   * Delegates to shared utility for consistent model name formatting across the application.
   * Extracts readable name from full model ID (e.g., "claude-sonnet-4-20250514" -> "Sonnet 4")
   */
  protected formatModelName(modelId: string): string {
    return formatModelDisplayName(modelId);
  }
}
