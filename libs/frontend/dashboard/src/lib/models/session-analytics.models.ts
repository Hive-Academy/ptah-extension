import type {
  SessionStatsCoverage,
  SessionStatsPricingCoverage,
} from '@ptah-extension/shared';

/**
 * Where a session's stats are in the progressive load.
 *
 * `'pending'` means its page has not arrived yet. The other three are the
 * host's own `SessionStatsEntry.status`.
 */
export type DashboardStatsStatus = 'pending' | 'ok' | 'error' | 'empty';

/**
 * Merged session data: metadata from session:list + stats from session:stats-batch.
 *
 * Combines trusted metadata (name, dates) from SessionMetadataStore with
 * per-session usage read from the transcript for the selected range.
 */
export interface DashboardSessionEntry {
  readonly sessionId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly model: string | null;
  readonly modelDisplayName: string;
  /**
   * Estimate from recorded usage and the CURRENT rate card. `null` means
   * unknown (no counted model has a price, or the stats are not in yet) —
   * never render it as $0.
   */
  readonly totalCost: number | null;
  /**
   * Sum of the usage whose price IS known. Equals `totalCost` when pricing is
   * full; a lower bound when pricing is partial; `null` when nothing is
   * priced. Displayed only through {@link sessionCostEstimate}, which labels
   * it as a lower bound whenever it stands in for an unknown total.
   */
  readonly knownCost: number | null;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  readonly messageCount: number;
  /** Number of agent/subagent sessions (from agent-*.jsonl files). */
  readonly agentSessionCount: number;
  /** CLI agent types used in this session (e.g., ['codex', 'copilot']). */
  readonly cliAgents: readonly string[];
  /** Per-model usage breakdown (model, tokens, cost). Empty when single/unknown model. */
  readonly modelUsageList: ReadonlyArray<{
    readonly model: string;
    readonly modelDisplayName: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUSD: number | null;
  }>;
  readonly status: DashboardStatsStatus;
  /** `null` while pending. `'partial'` when some usage could not be counted. */
  readonly coverage: SessionStatsCoverage | null;
  /** Usage records left out of the range because they carry no timestamp. */
  readonly untimestampedCount: number;
  /** `null` while pending or when the host did not report it. */
  readonly pricingCoverage: SessionStatsPricingCoverage | null;
}

/** The cost figure a session shows, and whether it is only a lower bound. */
export interface SessionCostEstimate {
  /** `null` when nothing in the session has a price — shown as unknown. */
  readonly cost: number | null;
  /** True when some usage has no price: the real cost is at least `cost`. */
  readonly isLowerBound: boolean;
}

/**
 * The one rule for which figure a session contributes and displays: the full
 * `totalCost` when every contribution is priced, else the priced subtotal
 * (`knownCost`) marked as a lower bound, else unknown. The subtotal is never
 * presented as a total.
 *
 * Relies on the wire contract that a non-null `totalCost` means every
 * contribution is priced (`SessionStatsEntry.totalCost`; the backend sets it
 * only for `pricingCoverage: 'full'`). A missing coverage value is therefore
 * not treated as partial: older producers omit it on fully priced totals.
 * An explicit `'partial'` beside a total is still marked.
 */
export function sessionCostEstimate(
  session: Pick<
    DashboardSessionEntry,
    'totalCost' | 'knownCost' | 'pricingCoverage'
  >,
): SessionCostEstimate {
  if (session.totalCost !== null) {
    return {
      cost: session.totalCost,
      isLowerBound: session.pricingCoverage === 'partial',
    };
  }
  if (session.knownCost !== null) {
    return { cost: session.knownCost, isLowerBound: true };
  }
  return { cost: null, isLowerBound: false };
}
