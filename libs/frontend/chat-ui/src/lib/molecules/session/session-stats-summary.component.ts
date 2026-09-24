import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  signal,
  inject,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  resolveModelDisplayName,
  type SessionStatsEntry,
  type ContextCapacity,
} from '@ptah-extension/shared';
import { ModelStateService } from '@ptah-extension/core';
import { CostBadgeComponent } from '../../atoms/cost-badge.component';

/**
 * Live model stats from current session
 * Updated after each turn completion with context window info
 */
export interface LiveModelStats {
  contextKnown?: boolean;
  contextCapacity?: ContextCapacity;
  /** Primary model name (e.g., "claude-sonnet-4-20250514") */
  model: string;
  /** Total context tokens used (input + output) */
  contextUsed: number;
  /** Total context window size */
  contextWindow: number;
  /** Context usage as percentage (0-100) */
  contextPercent: number;
}

/** One per-model row of the backend snapshot. */
type ModelUsageRow = NonNullable<SessionStatsEntry['modelUsageList']>[number];

/**
 * SessionStatsSummaryComponent - Compact inline session stats display
 *
 * Complexity Level: 2 (Molecule)
 * Patterns: Standalone component, OnPush change detection, Computed signals
 *
 * Every accounting figure — the cost, tokens and agents chips, the per-model
 * rows and the table totals — is read from ONE backend snapshot
 * (`SessionStatsEntry`, TASK_2026_533). The component never derives a total
 * from messages, execution trees or by summing rows, so the chips and the
 * table cannot disagree. A missing snapshot or a missing aggregate renders as
 * unavailable, never as zero. The context badge is the separate live input.
 *
 * Design: Compact horizontal inline badges matching VSCode sidebar width
 */
@Component({
  selector: 'ptah-session-stats-summary',
  standalone: true,
  imports: [CostBadgeComponent, NgTemplateOutlet],
  template: `
    <div class="stats-grid" style="container-type: inline-size">
      <!-- Collapsed: compact summary bar -->
      @if (isStatsCollapsed()) {
        <div
          class="flex items-center gap-2 bg-base-200/50 rounded px-2 py-1 border border-base-content/10"
        >
          <div
            class="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto text-xs"
          >
            @if (!hasMultipleModels() && primaryModelName(); as modelName) {
              <span
                class="inline-flex items-center gap-1 bg-purple-600/15 border border-purple-600/25 rounded px-1.5 py-0.5 whitespace-nowrap"
                [title]="modelName"
              >
                <span class="text-[10px] uppercase text-base-content-muted"
                  >Model</span
                >
                <span class="text-purple-400 font-semibold">{{
                  formatModelName(modelName)
                }}</span>
              </span>
            }
            @if (liveModelStats()) {
              <span
                class="inline-flex items-center gap-1 bg-cyan-600/15 border border-cyan-600/25 rounded px-1.5 py-0.5 whitespace-nowrap"
                [title]="contextTooltip()"
              >
                <span class="text-[10px] uppercase text-base-content-muted"
                  >Main context</span
                >
                <span class="text-cyan-400" data-testid="stats-context">{{
                  contextPercentLabel()
                }}</span>
              </span>
            }
            <span
              class="inline-flex items-center gap-1 bg-base-content/5 border border-base-content/10 rounded px-1.5 py-0.5 whitespace-nowrap"
              [title]="tokenTooltip()"
            >
              <span class="text-[10px] uppercase text-base-content-muted"
                >Tokens</span
              >
              <span class="tabular-nums" data-testid="stats-tokens">{{
                tokensLabel()
              }}</span>
            </span>
            <span
              class="inline-flex items-center gap-1 bg-success/10 border border-success/20 rounded px-1.5 py-0.5 whitespace-nowrap"
            >
              <span class="text-[10px] uppercase text-base-content-muted"
                >Cost</span
              >
              <span data-testid="stats-cost">
                <ptah-cost-badge [cost]="totalCost()" />
              </span>
              @if (knownSubtotal(); as known) {
                <span
                  class="text-[10px] text-base-content-muted tabular-nums"
                  data-testid="stats-known-subtotal"
                  [title]="knownSubtotalTooltip"
                  >known subtotal {{ formatCost(known.value) }}</span
                >
              }
            </span>
            @if (durationMs(); as duration) {
              <span
                class="inline-flex items-center gap-1 bg-base-content/5 border border-base-content/10 rounded px-1.5 py-0.5 whitespace-nowrap"
              >
                <span class="text-[10px] uppercase text-base-content-muted"
                  >Time</span
                >
                <span class="tabular-nums" data-testid="stats-duration">{{
                  formatDuration(duration)
                }}</span>
              </span>
            }
            @if (agentCount(); as agents) {
              <span
                class="inline-flex items-center gap-1 bg-info/10 border border-info/20 rounded px-1.5 py-0.5 whitespace-nowrap"
                [title]="agentsTooltip"
              >
                <span class="text-[10px] uppercase text-base-content-muted"
                  >Agents</span
                >
                <span
                  class="text-info tabular-nums"
                  data-testid="stats-agents"
                  >{{ agents }}</span
                >
              </span>
            }
            @if (compactionCount() > 0) {
              <span
                class="inline-flex items-center gap-1 bg-warning/10 border border-warning/20 rounded px-1.5 py-0.5 whitespace-nowrap"
              >
                <span class="text-[10px] uppercase text-base-content-muted"
                  >Compactions</span
                >
                <span class="text-warning tabular-nums">{{
                  compactionCount()
                }}</span>
              </span>
            }
            @if (hasMultipleModels()) {
              <button
                class="inline-flex items-center gap-1 bg-purple-600/15 border border-purple-600/25 rounded px-1.5 py-0.5 whitespace-nowrap cursor-pointer hover:bg-purple-600/25 transition-colors"
                data-testid="stats-models-toggle"
                (click)="
                  isExpanded.set(!isExpanded()); $event.stopPropagation()
                "
                type="button"
                [attr.aria-expanded]="isExpanded()"
                [title]="
                  isExpanded()
                    ? 'Hide per-model breakdown'
                    : 'Show per-model breakdown'
                "
              >
                <span class="text-[10px] uppercase text-base-content-muted"
                  >Models</span
                >
                <span class="text-purple-400 font-semibold"
                  >{{ modelRows().length }}
                  <span class="text-[10px] font-normal" aria-hidden="true">{{
                    isExpanded() ? '▲' : '▼'
                  }}</span></span
                >
              </button>
            }
          </div>
          <button
            class="text-base-content-muted hover:text-base-content transition-colors flex-shrink-0 p-0.5"
            data-testid="stats-expand"
            (click)="isStatsCollapsed.set(false)"
            type="button"
            title="Expand stats"
            aria-label="Expand stats"
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
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      } @else {
        <!-- Expanded: full card grid with inline collapse button -->
        <div class="stats-cards grid grid-cols-2 gap-1.5">
          <!-- Model Card -->
          @if (!hasMultipleModels() && primaryModelName(); as modelName) {
            <div
              class="bg-base-200/50 rounded px-2 py-1.5 border border-purple-600/20"
              [title]="modelName"
            >
              <div
                class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
              >
                Model
              </div>
              <div
                class="text-sm font-semibold text-purple-400 truncate leading-tight mt-0.5"
              >
                {{ formatModelName(modelName) }}
              </div>
            </div>
          }

          <!-- Context Card -->
          @if (liveModelStats(); as live) {
            <div
              class="bg-base-200/50 rounded px-2 py-1.5 border border-cyan-600/20"
              [title]="contextTooltip()"
            >
              <div
                class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
              >
                Main context
              </div>
              <div
                class="text-sm font-semibold text-cyan-400 leading-tight mt-0.5"
              >
                <span data-testid="stats-context">{{
                  contextPercentLabel()
                }}</span>
                @if (hasKnownContextWindow()) {
                  <span class="text-[10px] font-normal text-base-content-muted">
                    ({{ formatTokens(live.contextUsed) }})
                  </span>
                }
              </div>
            </div>
          }

          <!-- Tokens Card -->
          <div
            class="bg-base-200/50 rounded px-2 py-1.5 border border-base-content/10"
            [title]="tokenTooltip()"
          >
            <div
              class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
            >
              Tokens
            </div>
            <div
              class="text-sm font-semibold tabular-nums leading-tight mt-0.5"
              data-testid="stats-tokens"
            >
              {{ tokensLabel() }}
            </div>
          </div>

          <!-- Cost Card -->
          <div
            class="bg-base-200/50 rounded px-2 py-1.5 border border-success/20"
          >
            <div
              class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
            >
              Cost
            </div>
            <div data-testid="stats-cost">
              <ptah-cost-badge [cost]="totalCost()" />
            </div>
            @if (knownSubtotal(); as known) {
              <div
                class="text-[10px] text-base-content-muted tabular-nums leading-tight mt-0.5"
                data-testid="stats-known-subtotal"
                [title]="knownSubtotalTooltip"
              >
                known subtotal {{ formatCost(known.value) }}
              </div>
            }
          </div>

          <!-- Duration Card (backend-supplied only) -->
          @if (durationMs(); as duration) {
            <div
              class="bg-base-200/50 rounded px-2 py-1.5 border border-base-content/10"
            >
              <div
                class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
              >
                Duration
              </div>
              <div
                class="text-sm font-semibold tabular-nums leading-tight mt-0.5"
                data-testid="stats-duration"
              >
                {{ formatDuration(duration) }}
              </div>
            </div>
          }

          <!-- Agents Card (backend lifetime count) -->
          @if (agentCount(); as agents) {
            <div
              class="bg-base-200/50 rounded px-2 py-1.5 border border-info/20"
              [title]="agentsTooltip"
            >
              <div
                class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
              >
                Agents
              </div>
              <div
                class="text-sm font-semibold text-info tabular-nums leading-tight mt-0.5"
                data-testid="stats-agents"
              >
                {{ agents }}
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
                class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
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
              data-testid="stats-models-toggle"
              (click)="isExpanded.set(!isExpanded())"
              type="button"
              [attr.aria-expanded]="isExpanded()"
              [title]="
                isExpanded()
                  ? 'Hide per-model breakdown'
                  : 'Show per-model breakdown'
              "
            >
              <div
                class="text-[10px] uppercase tracking-wider text-base-content-muted leading-tight"
              >
                Models
              </div>
              <div
                class="text-sm font-semibold text-purple-400 leading-tight mt-0.5"
              >
                {{ modelRows().length }}
                <span class="text-[10px] font-normal" aria-hidden="true">{{
                  isExpanded() ? '▲' : '▼'
                }}</span>
              </div>
            </button>
          }

          <!-- Collapse button card -->
          <button
            class="bg-base-200/50 rounded px-2 py-1.5 border border-base-content/10 cursor-pointer hover:bg-base-200/80 flex items-center justify-center transition-colors"
            data-testid="stats-collapse"
            (click)="isStatsCollapsed.set(true)"
            type="button"
            title="Collapse stats"
            aria-label="Collapse stats"
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
              class="text-base-content-muted"
              aria-hidden="true"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      }

      <!-- Per-model breakdown: one table, shown under either layout -->
      @if (isExpanded() && hasMultipleModels()) {
        <ng-container [ngTemplateOutlet]="modelUsageTable" />
      }

      <!-- Context usage progress bar — always visible when context data
           exists AND the model's context window is known. When the window
           is unknown (third-party providers) we suppress the bar entirely;
           a 0%-width track would otherwise look like a stuck zero usage. -->
      @if (liveModelStats(); as live) {
        @if (hasKnownContextWindow()) {
          <div class="mt-1.5" [title]="contextTooltip()">
            <div class="context-bar-track">
              <div
                class="context-bar-fill"
                [class.context-bar-warning]="showContextWarning()"
                [class.context-bar-critical]="live.contextPercent >= 90"
                [style.width.%]="live.contextPercent"
              ></div>
            </div>
          </div>
        }
      }
    </div>

    <ng-template #modelUsageTable>
      @if (snapshot(); as stats) {
        <div
          class="mt-1.5 bg-base-200/50 rounded border border-purple-600/20 overflow-hidden"
          role="table"
          aria-label="Per-model usage"
          data-testid="model-usage-table"
        >
          <div
            class="model-usage-row px-2 py-1 border-b border-base-content/10"
            role="row"
            data-testid="model-usage-header"
          >
            <div
              class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted"
              role="columnheader"
            >
              Model
            </div>
            <div
              class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
              role="columnheader"
              title="Uncached input tokens"
            >
              In
            </div>
            <div
              class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
              role="columnheader"
              title="Output tokens"
            >
              Out
            </div>
            <div
              class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
              role="columnheader"
              title="Cache read tokens"
            >
              Cache Read
            </div>
            <div
              class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
              role="columnheader"
              title="Cache creation tokens"
            >
              Cache Creation
            </div>
            <div
              class="text-[10px] leading-tight uppercase tracking-wider text-base-content-muted text-right"
              role="columnheader"
            >
              Cost
            </div>
          </div>
          @for (usage of modelRows(); track usage.model) {
            <div
              class="model-usage-row px-2 py-1.5 border-b border-base-content/5 last:border-b-0"
              role="row"
              data-testid="model-usage-row"
            >
              <div
                class="text-xs font-semibold text-purple-400 truncate"
                role="cell"
                [title]="usage.model"
              >
                {{ formatModelName(usage.model) }}
              </div>
              <div
                class="text-xs text-right tabular-nums text-base-content-muted"
                role="cell"
              >
                {{ formatTokens(usage.inputTokens) }}
              </div>
              <div
                class="text-xs text-right tabular-nums text-base-content-muted"
                role="cell"
              >
                {{ formatTokens(usage.outputTokens) }}
              </div>
              <div
                class="text-xs text-right tabular-nums text-base-content-muted"
                role="cell"
              >
                {{ formatOptionalTokens(usage.cacheRead) }}
              </div>
              <div
                class="text-xs text-right tabular-nums text-base-content-muted"
                role="cell"
              >
                {{ formatOptionalTokens(usage.cacheCreation) }}
              </div>
              <div
                class="text-xs text-right tabular-nums text-success"
                role="cell"
              >
                {{ formatCost(usage.costUSD) }}
              </div>
            </div>
          }
          <!-- Totals row: the snapshot's own totals, never a sum of rows -->
          <div
            class="model-usage-row px-2 py-1.5 border-t border-base-content/10 bg-base-300/30"
            role="row"
            data-testid="model-usage-total"
          >
            <div class="text-xs font-semibold" role="cell">Total</div>
            <div
              class="text-xs text-right tabular-nums font-semibold"
              role="cell"
            >
              {{ formatTokens(stats.tokens.input) }}
            </div>
            <div
              class="text-xs text-right tabular-nums font-semibold"
              role="cell"
            >
              {{ formatTokens(stats.tokens.output) }}
            </div>
            <div
              class="text-xs text-right tabular-nums font-semibold"
              role="cell"
            >
              {{ formatTokens(stats.tokens.cacheRead) }}
            </div>
            <div
              class="text-xs text-right tabular-nums font-semibold"
              role="cell"
            >
              {{ formatTokens(stats.tokens.cacheCreation) }}
            </div>
            <div
              class="text-xs text-right tabular-nums font-semibold text-success"
              role="cell"
            >
              {{ formatCost(stats.totalCost) }}
            </div>
          </div>
        </div>
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      @container (min-width: 380px) {
        .stats-grid .stats-cards {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @container (min-width: 500px) {
        .stats-grid .stats-cards {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      .model-usage-row {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) repeat(5, minmax(0, 1fr));
        gap: 0.25rem;
        align-items: end;
      }

      .context-bar-track {
        height: 4px;
        border-radius: 2px;
        background: oklch(0.3 0 0 / 0.4);
        overflow: hidden;
      }

      .context-bar-fill {
        height: 100%;
        border-radius: 2px;
        background: oklch(0.72 0.15 200 / 0.5);
        transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      }

      .context-bar-fill.context-bar-warning {
        background: linear-gradient(
          90deg,
          oklch(0.795 0.184 86.047 / 0.7),
          oklch(0.795 0.184 86.047 / 0.9)
        );
        animation: context-bar-pulse 3s ease-in-out infinite;
      }

      .context-bar-fill.context-bar-critical {
        background: linear-gradient(
          90deg,
          oklch(0.637 0.237 25.331 / 0.7),
          oklch(0.637 0.237 25.331 / 0.95)
        );
        animation: context-bar-pulse-critical 1.5s ease-in-out infinite;
      }

      @keyframes context-bar-pulse {
        0%,
        100% {
          opacity: 0.75;
        }
        50% {
          opacity: 1;
        }
      }

      @keyframes context-bar-pulse-critical {
        0%,
        100% {
          opacity: 0.65;
        }
        50% {
          opacity: 1;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionStatsSummaryComponent {
  private readonly modelState = inject(ModelStateService);

  /**
   * The backend's session-lifetime accounting snapshot. The ONLY source of
   * every accounting number this component shows. `null` renders the
   * unavailable state.
   */
  readonly snapshot = input<SessionStatsEntry | null>(null);

  /**
   * Live model stats from current session (updated after each turn completion)
   * Includes context window info for percentage display and model name.
   * Drives the context badge only; it is not an accounting figure.
   */
  readonly liveModelStats = input<LiveModelStats | null>(null);

  /** Number of context compactions in this session */
  readonly compactionCount = input<number>(0);

  /** Whether the stats section is collapsed to a compact bar */
  readonly isStatsCollapsed = signal(true);

  /** Whether the per-model breakdown table is expanded */
  readonly isExpanded = signal(false);

  protected readonly knownSubtotalTooltip =
    'Only part of this session has a known price. This is the sum of the priced part, not the session total.';

  protected readonly agentsTooltip =
    'Unique subagents this session has run, over its whole lifetime.';

  /** Only a measured main request and matching capacity evidence permit fill. */
  readonly hasKnownContextWindow = computed(() => {
    const stats = this.liveModelStats();
    const capacity = stats?.contextCapacity;
    return (
      !!stats &&
      stats.contextKnown !== false &&
      Number.isFinite(stats.contextUsed) &&
      stats.contextUsed >= 0 &&
      Number.isFinite(stats.contextPercent) &&
      !!capacity &&
      capacity.model === stats.model &&
      (capacity.source === 'sdk-native' ||
        (capacity.source === 'provider-catalog' &&
          typeof capacity.providerId === 'string' &&
          capacity.providerId.length > 0)) &&
      typeof capacity.tokens === 'number' &&
      Number.isFinite(capacity.tokens) &&
      capacity.tokens > 0 &&
      stats.contextWindow === capacity.tokens
    );
  });

  /**
   * Display label for the context percentage. Falls back to an em-dash when
   * the context window is unknown, so the badge visibly communicates
   * "no data" rather than a misleading "0%".
   */
  readonly contextPercentLabel = computed(() => {
    const stats = this.liveModelStats();
    if (!stats) return '—';
    if (!this.hasKnownContextWindow()) return '—';
    return `${stats.contextPercent}%`;
  });

  /**
   * Whether context usage exceeds the warning threshold (70%). Suppressed
   * when the context window is unknown — we cannot meaningfully warn about
   * a fill ratio we have no denominator for.
   */
  readonly showContextWarning = computed(() => {
    const stats = this.liveModelStats();
    if (!stats) return false;
    if (!this.hasKnownContextWindow()) return false;
    return stats.contextPercent >= 70;
  });

  /** The snapshot's per-model rows, as the backend sent them. */
  readonly modelRows = computed<readonly ModelUsageRow[]>(
    () => this.snapshot()?.modelUsageList ?? [],
  );

  /** Whether there are multiple models to display */
  readonly hasMultipleModels = computed(() => this.modelRows().length >= 2);

  /**
   * Model name to surface in the single-model badge/card. Prefers the live
   * session model; falls back to the snapshot's primary model, then its sole
   * row, so the model still shows when live stats are absent.
   */
  readonly primaryModelName = computed(() => {
    const live = this.liveModelStats()?.model;
    if (live) return live;
    const stats = this.snapshot();
    return stats?.model ?? this.modelRows()[0]?.model ?? null;
  });

  /** Session cost; `null` renders "cost unavailable" (CostBadge semantics). */
  readonly totalCost = computed(() => this.snapshot()?.totalCost ?? null);

  /**
   * The priced part of a partially priced session, shown only as an
   * explicitly labeled subtotal next to the unavailable total. Wrapped so a
   * genuine `0` survives the template's truthiness check.
   */
  readonly knownSubtotal = computed<{ value: number } | null>(() => {
    const stats = this.snapshot();
    if (!stats || stats.totalCost !== null) return null;
    if (stats.pricingCoverage !== 'partial') return null;
    const known = stats.knownCost;
    return typeof known === 'number' && Number.isFinite(known)
      ? { value: known }
      : null;
  });

  /** Backend lifetime subagent count; hidden when absent or zero. */
  readonly agentCount = computed(() => {
    const count = this.snapshot()?.agentSessionCount;
    return typeof count === 'number' && count > 0 ? count : null;
  });

  /** Backend-supplied session duration; never derived from messages. */
  readonly durationMs = computed(() => {
    const duration = this.snapshot()?.durationMs;
    return typeof duration === 'number' && duration > 0 ? duration : null;
  });

  /** Tokens chip: the backend's all-four-class `tokenCount`, or "—". */
  readonly tokensLabel = computed(() => {
    const count = this.snapshot()?.tokenCount;
    return typeof count === 'number' ? this.formatTokens(count) : '—';
  });

  /** Tooltip with the backend's token breakdown. */
  readonly tokenTooltip = computed(() => {
    const stats = this.snapshot();
    if (!stats) return 'Token usage unavailable.';
    const t = stats.tokens;
    const lines = [
      `Input (uncached): ${t.input.toLocaleString()}`,
      `Output: ${t.output.toLocaleString()}`,
      `Cache Read: ${t.cacheRead.toLocaleString()}`,
      `Cache Creation: ${t.cacheCreation.toLocaleString()}`,
      typeof stats.tokenCount === 'number'
        ? `Total: ${stats.tokenCount.toLocaleString()}`
        : 'Total: unavailable',
    ];
    if (stats.coverage === 'partial') {
      lines.push('Some usage could not be counted.');
    }
    return lines.join('\n');
  });

  /** Tooltip with context window details */
  readonly contextTooltip = computed(() => {
    const stats = this.liveModelStats();
    if (!stats) return '';
    if (!this.hasKnownContextWindow()) {
      return 'Main context unknown: the latest main request or its verified capacity is unavailable.';
    }
    return [
      `Main context used (latest main request): ${stats.contextUsed.toLocaleString()} tokens`,
      `Context Window: ${stats.contextWindow.toLocaleString()} tokens`,
      `Usage: ${stats.contextPercent}%`,
    ].join('\n');
  });

  /** Format cost for display */
  protected formatCost(cost: number | null): string {
    if (cost === null) {
      return '—';
    }
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

  /** A row field an older producer may omit: absent is "—", never 0. */
  protected formatOptionalTokens(count: number | undefined): string {
    return typeof count === 'number' ? this.formatTokens(count) : '—';
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

  protected formatModelName(modelId: string): string {
    return resolveModelDisplayName(modelId, this.modelState.availableModels());
  }
}
