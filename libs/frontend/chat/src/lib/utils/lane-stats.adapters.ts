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
  NOT_REPORTED,
  usageTotalsFromSegments,
} from '../components/molecules/agent-card/stats-bar.utils';

const positive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

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
    ? usage.input +
      usage.output +
      (usage.cacheRead ?? 0) +
      (usage.cacheWrite ?? 0)
    : undefined;
  const tokens = positive(record.totalTokens)
    ? record.totalTokens
    : positive(usageSum)
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

/** Stats bar figures of a CLI lane (structured totals, else retained segments). */
export function cliLaneStats(agent: MonitoredAgent): AgentLaneStatsView {
  const structured = agent.usageTotals ?? null;
  const usage = structured ?? usageTotalsFromSegments(agent.segments);
  const summed =
    usage?.inputTokens !== undefined || usage?.outputTokens !== undefined
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : undefined;
  const tokens = usage?.totalTokens ?? summed;
  const segmentFallback = structured === null && usage !== null;
  return {
    model: agent.model ?? null,
    contextTokens: structured?.contextTokens ?? null,
    tokens: positive(tokens) ? tokens : null,
    // Only a reported total is exact; a sum of in/out or a retained-segment
    // fold may miss turns (the former header-meta rule).
    tokensPartial: structured?.totalTokens === undefined,
    tokensTitle: usage
      ? tokenBreakdown([
          ['in', usage.inputTokens],
          ['out', usage.outputTokens],
          ['cache read', structured?.cacheReadTokens],
          ['cache write', structured?.cacheWriteTokens],
        ])
      : null,
    cost: usage?.costUsd,
    costPartial: segmentFallback && usage?.costUsd !== undefined,
    cache: null,
    cacheTitle: null,
  };
}
