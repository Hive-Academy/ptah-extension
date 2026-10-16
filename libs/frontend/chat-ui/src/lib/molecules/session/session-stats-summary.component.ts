import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  signal,
  inject,
} from '@angular/core';
import {
  resolveModelDisplayName,
  type SessionBudgetState,
  type SessionStatsEntry,
  type ContextCapacity,
} from '@ptah-extension/shared';
import { ModelStateService } from '@ptah-extension/core';
import { CostBadgeComponent } from '../../atoms/cost-badge.component';
import { LaneSubtotalTileComponent } from './plan-limits/lane-subtotal-tile.component';
import { LaneUsageTileComponent } from './plan-limits/lane-usage-tile.component';
import { LimitsAlertComponent } from './plan-limits/limits-alert.component';
import { PlanLimitTileComponent } from './plan-limits/plan-limit-tile.component';
import {
  planSectionProvenance,
  sharedLaneCaption,
} from './plan-limits/stats-limit-sections';
import type { StatsLimitViewModel } from './plan-limits/stats-limit-view-model.types';
import { StatsTileExpansionState } from './plan-limits/stats-tile-expansion.state';
import { sourceChipClass } from './plan-limits/stats-tile.styles';
import {
  costBudgetSuffix,
  costBudgetText,
  tokensBudgetSuffix,
} from './session-budget-format';
import {
  formatCost,
  formatDuration,
  formatTokens,
} from './session-stats-format';
import { SessionModelBreakdownComponent } from './session-model-breakdown.component';
import {
  AGENTS_DETAILS, KNOWN_SUBTOTAL_DETAILS, agentCountOf, contextDetailsText,
  costDetailsText, durationMsOf, knownSubtotalOf, lanesAriaLabelFor,
  sessionContextCue, tokenDetailsText,
} from './session-stats-view';

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
  imports: [
    CostBadgeComponent,
    LimitsAlertComponent,
    PlanLimitTileComponent,
    LaneUsageTileComponent,
    LaneSubtotalTileComponent,
    SessionModelBreakdownComponent,
  ],
  templateUrl: './session-stats-summary.component.html',
  styleUrl: './session-stats-summary.component.css',
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

  /**
   * Plan-limit and lane tiles (TASK_2026_596). `null` renders exactly the
   * pre-limits output, so a host that passes nothing is unaffected.
   */
  readonly limits = input<StatsLimitViewModel | null>(null);

  /** Session the tiles belong to; part of every expansion key (A3). */
  readonly sessionId = input<string | null>(null);

  /**
   * Tile open/closed state. The chat view provides one per view so a choice
   * survives re-renders and pushes; a host without it (the harness builder)
   * gets a component-local instance.
   */
  private readonly expansion =
    inject(StatsTileExpansionState, { optional: true }) ??
    new StatsTileExpansionState();

  /** "LANES n" pill; hidden when there are no lane runs. */
  readonly lanesCount = computed(() => {
    const count = this.limits()?.lanesCount ?? 0;
    return count > 0 ? count : null;
  });

  /** Caption and source chips the plan rows share, shown once in the header. */
  protected readonly planProvenance = computed(() =>
    planSectionProvenance(this.limits()?.planTiles ?? []),
  );

  /** Caption every lane row and the subtotal share ("lane · not in totals"). */
  protected readonly laneCaption = computed(() => {
    const vm = this.limits();
    return vm ? sharedLaneCaption(vm.laneTiles, vm.subtotal) : null;
  });

  protected readonly sourceChipClass = sourceChipClass;

  protected readonly lanesTooltip =
    'Lane runs are counted separately from session totals';

  /**
   * Accessible name of the LANES pill ("<n> lane runs, not in session
   * totals"), from the same count source as `lanesTooltip`; the visible face
   * is just the number, so the pill needs its own label for screen readers.
   */
  protected readonly lanesAriaLabel = computed(() => {
    const count = this.lanesCount() ?? 0;
    return lanesAriaLabelFor(count);
  });

  /**
   * The session budget computed from the same snapshot (TASK_2026_597 N7).
   * It adds the limit beside the TOKENS or COST figure; the numerator for
   * `tokens` and `cost` stays the snapshot's own figure. Only the two cost
   * fallbacks show the budget's `used`, because the snapshot has no total
   * for them. `null` leaves the chip exactly as without a budget.
   */
  readonly budget = input<SessionBudgetState | null>(null);

  /** Whether the stats section is collapsed to a compact bar */
  readonly isStatsCollapsed = signal(true);

  /** Whether the per-model breakdown table is expanded */
  readonly isExpanded = signal(false);

  protected readonly knownSubtotalTooltip = KNOWN_SUBTOTAL_DETAILS;

  protected readonly agentsTooltip = AGENTS_DETAILS;

  /** Only a measured main request and matching capacity evidence permit fill. */
  readonly hasKnownContextWindow = computed(() => sessionContextCue(this.liveModelStats()).known);

  /**
   * Display label for the context percentage. Falls back to an em-dash when
   * the context window is unknown, so the badge visibly communicates
   * "no data" rather than a misleading "0%".
   */
  readonly contextPercentLabel = computed(() => sessionContextCue(this.liveModelStats()).label);

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
  readonly modelRows = computed(() => this.snapshot()?.modelUsageList ?? []);

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
  readonly knownSubtotal = computed(() => knownSubtotalOf(this.snapshot()));

  /** Backend lifetime subagent count; hidden when absent or zero. */
  readonly agentCount = computed(() => agentCountOf(this.snapshot()));

  /** Backend-supplied session duration; never derived from messages. */
  readonly durationMs = computed(() => durationMsOf(this.snapshot()));

  /** Tokens chip: the backend's all-four-class `tokenCount`, or "—". */
  readonly tokensLabel = computed(() => {
    const count = this.snapshot()?.tokenCount;
    return typeof count === 'number' ? formatTokens(count) : '—';
  });

  readonly tokensBudgetSuffix = computed(() =>
    tokensBudgetSuffix(this.budget()),
  );

  readonly costBudgetSuffix = computed(() => costBudgetSuffix(this.budget()));

  readonly costBudgetText = computed(() => costBudgetText(this.budget()));

  /**
   * Whether the snapshot carries an in-turn estimate (`session:stats-live`).
   * Only then do the TOKENS and COST chips show a leading `~` and the
   * estimate tooltip line; any other value leaves them unchanged.
   */
  readonly isEstimate = computed(() => this.snapshot()?.provisional === true);

  /** COST chip tooltip: any budget line, led by the estimate line while estimating. */
  readonly costTooltip = computed(() => {
    const details = costDetailsText(this.snapshot(), this.budget());
    if (!this.knownSubtotal() || !details) return details;
    return details === KNOWN_SUBTOTAL_DETAILS
      ? null
      : details.replace(`\n\n${KNOWN_SUBTOTAL_DETAILS}`, '');
  });

  /**
   * Tooltip with the backend's token breakdown, plus any budget line, led by
   * the estimate line while estimating.
   */
  readonly tokenTooltip = computed(() => tokenDetailsText(this.snapshot(), this.budget()));

  /** Tooltip with context window details */
  readonly contextTooltip = computed(() => contextDetailsText(this.liveModelStats(), 0) ?? '');

  protected isTileOpen(tileId: string): boolean {
    return this.expansion.isOpen(this.expansion.sessionKey(this, this.sessionId()), tileId);
  }

  protected toggleTile(tileId: string): void {
    this.expansion.toggle(this.expansion.sessionKey(this, this.sessionId()), tileId);
  }

  protected readonly formatCost = formatCost;
  protected readonly formatTokens = formatTokens;
  protected readonly formatDuration = formatDuration;

  protected formatModelName(modelId: string): string {
    return resolveModelDisplayName(modelId, this.modelState.availableModels());
  }
}
