import { Injectable, computed, inject, type Signal } from '@angular/core';
import {
  AgentMonitorStore,
  subagentUsageView,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { PtahUiAgentsInput } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { PtahUiHostSources } from '../../../services/ptah-ui-host-sources';

// The `surface` entry exports only the input type (D6), so the fact types are
// read off it rather than widening the shared barrel.
type SubagentFact = PtahUiAgentsInput['records'][number];
type CliLaneFact = PtahUiAgentsInput['lanes'][number];

/**
 * PtahUiAgentsSource - the `$agents` live source adapter (TASK_2026_623,
 * component 4a).
 *
 * Projects the agent monitor store into the allow-listed pipeline input of one
 * turn. Every fact is built field by field from the allow-list; task text,
 * prompts, summaries, output streams, error text and file paths never leave
 * the store (R5.1). The returned signal follows the store, so a mounted block
 * updates while its turn runs (R5.4).
 *
 * Lazy: only the lazy `ptah-ui` block reaches this file, so the store and
 * `chat-streaming` stay out of the eager closure.
 */
@Injectable({ providedIn: 'root' })
export class PtahUiAgentsSource {
  private readonly monitor = inject(AgentMonitorStore);

  /** The `$agents` input of the turn at `turnIndex` of the host's transcript. */
  agentsInput(
    hostSources: PtahUiHostSources,
    turnIndex: number,
  ): Signal<PtahUiAgentsInput> {
    return computed(() => {
      const sessionId = hostSources.sessionId();
      return {
        turnIndex,
        turns: hostSources.turnFacts(),
        records: sessionId === null ? [] : this.subagentFacts(sessionId),
        lanes:
          sessionId === null
            ? []
            : this.monitor.agentsOwnedBySession(sessionId).map(laneFact),
        capacities: hostSources.capacities(),
      };
    });
  }

  /** SDK subagents spawned by exactly this session (an unresolved one by none). */
  private subagentFacts(sessionId: string): SubagentFact[] {
    const facts: SubagentFact[] = [];
    for (const record of this.monitor.subagents().values()) {
      if (record.parentSessionId === sessionId)
        facts.push(subagentFact(record));
    }
    return facts;
  }
}

function subagentFact(record: SubagentRecord): SubagentFact {
  // Only the clock-independent fields of the view are read (context, cost),
  // so the time passed here changes nothing a block shows.
  const view = subagentUsageView(record, Date.now());
  return {
    parentToolUseId: record.parentToolUseId,
    agentId: record.agentId,
    teammateName: record.teammateName,
    agentType: record.agentType,
    status: record.status,
    totalTokens: record.totalTokens,
    inputTokens: record.usage?.input,
    outputTokens: record.usage?.output,
    cost: view.estimatedCostUsd,
    durationMs: record.durationMs,
    contextTokens: view.contextTokens,
    model: record.usage?.model,
  };
}

/**
 * A CLI lane run. Tokens and cost come from the folded usage totals; absent
 * totals or fields are `null` (unavailable), never 0. The duration is known
 * only once the run finished: a running lane would need a clock.
 */
function laneFact(agent: MonitoredAgent): CliLaneFact {
  const totals = agent.usageTotals ?? null;
  return {
    agentId: agent.agentId,
    cli: agent.cli,
    displayName: agent.displayName,
    status: agent.status,
    startedAt: agent.startedAt,
    tokens: totals === null ? null : laneTokens(totals),
    cost: totals === null ? null : (finite(totals.costUsd) ?? null),
    durationMs:
      agent.completedAt === undefined
        ? undefined
        : finite(agent.completedAt - agent.startedAt),
  };
}

/** Reported total, else input + output when both are known. */
function laneTokens(
  totals: NonNullable<MonitoredAgent['usageTotals']>,
): number | null {
  const total = finite(totals.totalTokens);
  if (total !== undefined) return total;
  const input = finite(totals.inputTokens);
  const output = finite(totals.outputTokens);
  return input !== undefined && output !== undefined ? input + output : null;
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
