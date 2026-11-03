/**
 * Pure adapters from the monitor's lane records to the chat-ui lane stats bar
 * view model (`ptah-agent-lane-stats`). A figure the producer did not report
 * maps to `null` (`—` in the bar), never to 0.
 */
import {
  subagentUsageView,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import {
  formatAgentDuration,
  type AgentLaneStatsView,
} from '@ptah-extension/chat-ui';
import {
  calculateMessageCost,
  cliUsageTokenTotal,
  findExactModelPricing,
  isValidTokenCount,
  messageTokenTotal,
  pricesCacheTokens,
  type CliUsageTotals,
} from '@ptah-extension/shared';
import {
  NOT_REPORTED,
  extractCliAgentStats,
  usageTotalsFromSegments,
} from '../components/molecules/agent-card/stats-bar.utils';

const positive = (value: number | undefined): value is number =>
  isValidTokenCount(value) && value > 0;

/** "in 1,200 · out 300 · cache read 4,000" for the parts that were reported. */
function tokenBreakdown(
  parts: readonly (readonly [string, number | undefined])[],
): string | null {
  const shown = parts
    .filter((part): part is readonly [string, number] => part[1] !== undefined)
    .map(([label, value]) => `${label} ${value.toLocaleString('en-US')}`);
  return shown.length > 0 ? shown.join(' · ') : null;
}

/** Stats bar figures of a Claude sub-agent at time `now`. */
export function subagentLaneStats(
  record: SubagentRecord,
  now: number,
): AgentLaneStatsView {
  const view = subagentUsageView(record, now);
  const usage = record.usage;
  const usageSum = usage
    ? messageTokenTotal({
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheCreation: usage.cacheWrite,
      })
    : null;
  const tokens = positive(record.totalTokens)
    ? record.totalTokens
    : usageSum !== null && positive(usageSum)
      ? usageSum
      : null;
  const cache = view.cacheState === 'unknown' ? null : view.cacheState;
  const idle =
    view.idleMs === undefined
      ? 'unknown'
      : (formatAgentDuration(view.idleMs) ?? '<1s');
  return {
    model: usage?.model ?? null,
    contextTokens: view.contextTokens ?? null,
    tokens,
    tokensPartial: false,
    tokensTitle: usage
      ? tokenBreakdown([
          ['in', usage.input],
          ['out', usage.output],
          ['cache read', usage.cacheRead],
          ['cache write', usage.cacheWrite],
        ])
      : null,
    cost: view.estimatedCostUsd,
    costPartial: false,
    cache,
    cacheTitle: cache
      ? `Prompt cache ${cache} (TTL ${view.effectiveTtl ?? NOT_REPORTED}, idle ${idle})`
      : null,
  };
}

/** One CLI lane's reported usage, with retained output identified as partial. */
export interface CliLaneUsage {
  usage: CliUsageTotals | null;
  structured: CliUsageTotals | null;
  partial: boolean;
  tokens: number | null;
  tokensExact: boolean;
}

export function resolveCliLaneUsage(source: MonitoredAgent): CliLaneUsage {
  const structured = source.usageTotals ?? null;
  const fallback = structured === null
    ? usageTotalsFromSegments(source.segments)
    : null;
  const usage = structured ?? fallback;
  const tokenTotal = cliUsageTokenTotal(usage);
  return {
    usage,
    structured,
    partial: fallback !== null,
    tokens: tokenTotal?.value ?? null,
    tokensExact: tokenTotal?.exact ?? false,
  };
}

/**
 * Estimated USD cost of a CLI lane's tokens at the shared rate card's price
 * for its model, for a lane whose CLI reports tokens but no cost. `null` when
 * that is not knowable: another CLI, no model, no exact rate for the model
 * (or for a cache class the lane used), or incomplete counts.
 *
 * Codex only. Its `inputTokens` include the cached and cache-written input
 * (`counters` in codex-runtime's event translator subtracts both to get the
 * uncached part), so the classes are split before pricing. Other CLIs do not
 * document how their counts overlap, and a guessed split is a wrong price.
 * A lane that reports cache writes is not priced: the translator marks Codex
 * cache-write semantics as ambiguous, and their retention tier is unknown.
 */
export function estimateCliLaneCost(
  agent: Pick<MonitoredAgent, 'cli' | 'model'>,
  usage: CliUsageTotals | null,
): number | null {
  if (agent.cli !== 'codex' || !usage) return null;
  const model = usage.model ?? agent.model;
  const { inputTokens, outputTokens } = usage;
  if (!model || !isValidTokenCount(inputTokens) || !isValidTokenCount(outputTokens)) {
    return null;
  }
  const cacheHit = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheWriteTokens ?? 0;
  if (!isValidTokenCount(cacheHit) || !isValidTokenCount(cacheCreation)) {
    return null;
  }
  if (cacheCreation > 0) return null;
  const uncached = inputTokens - cacheHit - cacheCreation;
  if (uncached < 0) return null;
  const pricing = findExactModelPricing(model)?.pricing ?? null;
  const tokens = { input: uncached, output: outputTokens, cacheHit, cacheCreation };
  if (!pricing || !pricesCacheTokens(pricing, tokens)) return null;
  return calculateMessageCost(model, tokens, pricing);
}

/** Stats bar figures of a CLI lane (structured totals, else retained segments). */
export function cliLaneStats(agent: MonitoredAgent): AgentLaneStatsView {
  const { usage, structured, partial, tokens, tokensExact } =
    resolveCliLaneUsage(agent);
  // Restored cards have no structured totals. Their retained usage segments
  // still carry the cache split needed to price a Codex lane.
  const costUsage = structured ?? (agent.restored ? extractCliAgentStats(agent.segments) : usage);
  const cost = usage?.costUsd ?? estimateCliLaneCost(agent, costUsage);
  return {
    model: agent.model ?? costUsage?.model ?? null,
    contextTokens: structured?.contextTokens ?? null,
    tokens,
    // Only a host-reported total is safe to display as exact. Split counts
    // and retained output may miss turns.
    tokensPartial: partial || !tokensExact,
    tokensTitle: usage
      ? tokenBreakdown([
          ['in', usage.inputTokens],
          ['out', usage.outputTokens],
          ['cache read', structured?.cacheReadTokens],
          ['cache write', structured?.cacheWriteTokens],
        ])
      : null,
    cost: cost ?? undefined,
    costPartial: partial && cost != null,
    cache: null,
    cacheTitle: null,
  };
}
