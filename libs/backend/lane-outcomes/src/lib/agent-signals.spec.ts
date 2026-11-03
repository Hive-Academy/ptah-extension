import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import { computeAgentSignals } from './agent-signals';

const base: LaneOutcomeRecord = {
  runId: 'one',
  executorKind: 'subagent',
  laneId: 'subagent',
  agentId: 'a',
  family: 'claude',
  provider: null,
  model: 'lane-default',
  role: 'review',
  taskKind: null,
  taskKindSource: null,
  taskId: null,
  verdict: 'delivered',
  failureClass: null,
  startedAt: null,
  endedAt: 1,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  routingSource: 'not-routed',
  reviseRounds: 0,
  finalReview: 'approved',
  deliverablesDeclaredAt: null,
  telemetryJoin: 'unavailable',
  skillsLoaded: null,
  sessionEvidenceClass: null,
};

describe('computeAgentSignals', () => {
  it('counts verified runs and reviews, rounds the average, and breaks failure ties by recency', () => {
    const result = computeAgentSignals(
      [
        base,
        {
          ...base,
          runId: 'two',
          verdict: 'failed',
          failureClass: 'crash',
          finalReview: 'rejected',
          reviseRounds: 1,
          endedAt: 2,
        },
        {
          ...base,
          runId: 'three',
          verdict: 'unverified',
          failureClass: 'timeout',
          finalReview: null,
          endedAt: 3,
        },
      ],
      30,
    ).review;
    expect(result).toMatchObject({
      runCount: 3,
      delivered: { numerator: 1, denominator: 2 },
      reviewPass: { numerator: 1, denominator: 2 },
      avgReviseRounds: 0.5,
      topFailureClass: 'timeout',
    });
  });
});
