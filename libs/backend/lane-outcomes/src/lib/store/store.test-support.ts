import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import type { HeldOutcomeReport } from './lane-outcome.store';

export function outcomeRow(runId: string): LaneOutcomeRecord {
  return {
    runId,
    executorKind: 'subagent',
    laneId: 'subagent',
    agentId: runId,
    family: 'subagent',
    provider: null,
    model: 'lane-default',
    role: 'backend-developer',
    taskKind: 'implement',
    taskId: null,
    verdict: 'unverified',
    failureClass: null,
    startedAt: null,
    endedAt: Date.now(),
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    routingSource: 'not-routed',
    reviseRounds: 0,
    finalReview: null,
    deliverablesDeclaredAt: null,
    telemetryJoin: 'not-applicable',
    skillsLoaded: null,
    sessionEvidenceClass: null,
  };
}

export function heldReport(
  i: number,
  nowMs: number,
  expired = false,
): HeldOutcomeReport {
  return {
    reportId: `report-${i}`,
    runId: 'subagent:a',
    kind: 'deliverables',
    payload: JSON.stringify({ checks: [{ exists: true, mtimeMs: nowMs }] }),
    heldAt: nowMs - 1000,
    expiresAt: expired ? nowMs - 1 : nowMs + 1000,
  };
}
