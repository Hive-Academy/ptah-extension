import type { LaneOutcomeRow } from './store/lane-outcome.store';
import {
  applySubagentJoin,
  isSubagentRunId,
  subagentRunId,
} from './subagent-join';

const row: LaneOutcomeRow = {
  runId: subagentRunId('a'),
  executorKind: 'subagent',
  laneId: 'subagent',
  agentId: 'a',
  family: 'claude',
  provider: null,
  model: 'lane-default',
  role: 'review',
  taskKind: null,
  taskId: null,
  verdict: 'no-deliverable',
  failureClass: null,
  startedAt: null,
  endedAt: 1,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  routingSource: 'not-routed',
  reviseRounds: 0,
  finalReview: null,
  deliverablesDeclaredAt: null,
  telemetryJoin: 'unavailable',
  skillsLoaded: null,
  sessionEvidenceClass: null,
  budgetStopped: true,
};

describe('applySubagentJoin', () => {
  it('recognizes only subagent run ids', () => {
    expect(isSubagentRunId(subagentRunId('x'))).toBe(true);
    expect(isSubagentRunId('lane:x')).toBe(false);
    expect(isSubagentRunId('subagentx')).toBe(false);
  });
  it('derives timeout from budget stop without changing stored row', () => {
    expect(applySubagentJoin(row, null)).toMatchObject({
      failureClass: 'timeout',
      telemetryJoin: 'unmatched',
    });
    expect(row.failureClass).toBeNull();
  });
  it('treats telemetry errors as failures and joins metrics', () => {
    const result = applySubagentJoin(
      { ...row, budgetStopped: false, verdict: 'delivered' },
      {
        match: 'matched',
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.1,
        durationMs: 100,
        taskId: 'TASK_X',
        isError: true,
        specVerdictSource: null,
      },
    );
    expect(result).toMatchObject({
      verdict: 'failed',
      failureClass: 'crash',
      telemetryJoin: 'matched',
      inputTokens: 10,
      taskId: 'TASK_X',
    });
  });
});
