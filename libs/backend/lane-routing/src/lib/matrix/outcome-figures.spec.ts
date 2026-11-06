import type { LaneOutcomeSummary } from '@ptah-extension/shared';
import { outcomeFigures } from './outcome-figures';

function row(runId: string, verdict: LaneOutcomeSummary['verdict'], failureClass: LaneOutcomeSummary['failureClass'] = null): LaneOutcomeSummary {
  return {
    runId, laneId: 'codex', family: 'codex', model: 'auto', taskKind: 'implement',
    verdict, failureClass, finalReview: null, reviseRounds: 0, durationMs: null,
    endedAt: Date.now(), routingSource: 'ranking', inputTokens: null, outputTokens: null, costUsd: null,
  };
}

it('aggregates delivery and quality failures without capacity failures', () => {
  expect(outcomeFigures([
    row('delivered', 'delivered'),
    row('crash', 'failed', 'crash'),
    row('quota', 'failed', 'usage-limit'),
    row('auth', 'failed', 'auth'),
    row('timeout', 'failed', 'timeout'),
  ])).toEqual([{ laneId: 'codex', taskKind: 'implement', delivered: 1, failed: 1 }]);
});
