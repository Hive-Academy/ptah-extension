/**
 * Usage figures of one lane row (sub-agent, background agent or CLI lane)
 * for the inspector AGENTS list. Pure: the caller resolves the monitor
 * records. Same precedence as the lane stats bar: the lane record's stats,
 * then the roster's structured totals, then retained usage segments.
 */
import type {
  MonitoredAgent,
  SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import {
  cliLaneStats,
  subagentLaneStats,
} from '../../../utils/lane-stats.adapters';
import { usageTotalsFromSegments } from '../../molecules/agent-card/stats-bar.utils';
import type { AgentUsageFigures } from './inspector-agent-list';

export interface LaneUsageSources {
  readonly subagent: SubagentRecord | null;
  readonly cli: MonitoredAgent | null;
  /** Tray-reported token total of a sub-agent / background agent. */
  readonly trayTokens: number | null;
  /** Model the tray knows for this row. */
  readonly trayModel: string | null;
}

export interface LaneUsage {
  readonly usage: AgentUsageFigures;
  readonly modelRaw: string | null;
}

export function laneUsage(
  agent: SessionAgent,
  sources: LaneUsageSources,
  now: number,
): LaneUsage {
  const { subagent, cli } = sources;
  const stats = subagent
    ? subagentLaneStats(subagent, now)
    : cli
      ? cliLaneStats(cli)
      : null;
  const fallback =
    agent.usageTotals == null
      ? usageTotalsFromSegments(agent.segments ?? [])
      : null;
  const usage = agent.usageTotals ?? fallback;
  const usageTotal =
    typeof usage?.totalTokens === 'number'
      ? usage.totalTokens
      : typeof usage?.inputTokens === 'number' &&
          typeof usage?.outputTokens === 'number'
        ? usage.inputTokens + usage.outputTokens
        : null;
  const tokens =
    stats?.tokens ?? (agent.kind === 'cli' ? usageTotal : sources.trayTokens);
  const partial = stats ? stats.tokensPartial : fallback?.partial === true;
  return {
    usage: {
      tokens,
      tokensPartial: tokens !== null && partial,
      cost: (stats ? stats.cost : usage?.costUsd) ?? null,
      costPartial: stats ? stats.costPartial : fallback?.partial === true,
      costEstimated: true,
      input: subagent?.usage?.input ?? usage?.inputTokens ?? null,
      output: subagent?.usage?.output ?? usage?.outputTokens ?? null,
    },
    modelRaw: stats?.model ?? sources.trayModel,
  };
}
