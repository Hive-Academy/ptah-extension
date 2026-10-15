import {
  SUBAGENT_LANE_ID,
  type LaneOutcomeRecord,
} from '@ptah-extension/shared';
import type { LaneOutcomeRow } from './store/lane-outcome.store';
import type { SubagentRunTelemetry } from './skill-telemetry-seam.port';

export function subagentRunId(agentId: string): string {
  return `${SUBAGENT_LANE_ID}:${agentId}`;
}

export function applySubagentJoin(
  row: LaneOutcomeRow,
  telemetry: SubagentRunTelemetry | null,
  available = true,
): LaneOutcomeRecord {
  const verdict = telemetry?.isError === true ? 'failed' : row.verdict;
  return {
    ...row,
    verdict,
    failureClass:
      (verdict === 'failed' || verdict === 'no-deliverable') &&
      row.budgetStopped
        ? 'timeout'
        : telemetry?.isError === true
          ? 'crash'
          : null,
    telemetryJoin: available
      ? (telemetry?.match ?? 'unmatched')
      : 'unavailable',
    inputTokens: telemetry?.inputTokens ?? row.inputTokens,
    outputTokens: telemetry?.outputTokens ?? row.outputTokens,
    costUsd: telemetry?.costUsd ?? row.costUsd,
    durationMs: telemetry?.durationMs ?? row.durationMs,
    taskId: row.taskId ?? telemetry?.taskId ?? null,
  };
}
