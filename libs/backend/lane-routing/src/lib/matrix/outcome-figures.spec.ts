import {
  SUBAGENT_LANE_ID,
  type LaneOutcomeSummary,
} from '@ptah-extension/shared';
import { EMPTY_OUTCOME_FIGURES, outcomeFiguresFrom } from './outcome-figures';

function summary(
  runId: string,
  verdict: LaneOutcomeSummary['verdict'],
  overrides: Partial<LaneOutcomeSummary> = {},
): LaneOutcomeSummary {
  return {
    runId,
    laneId: 'codex',
    family: 'openai',
    model: 'gpt-5',
    taskKind: 'implement',
    verdict,
    failureClass: null,
    finalReview: null,
    reviseRounds: 0,
    durationMs: null,
    endedAt: 1000,
    routingSource: 'ranking',
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    ...overrides,
  };
}

describe('outcomeFiguresFrom', () => {
  it('dedupes runs using the newest summary before counting', () => {
    const lookup = outcomeFiguresFrom([
      summary('same', 'failed', { endedAt: 1000 }),
      summary('same', 'delivered', { endedAt: 2000 }),
      summary('other', 'no-deliverable'),
    ]);
    expect(lookup('codex', 'implement')).toEqual({
      laneId: 'codex', taskKind: 'implement', delivered: 1, failed: 1,
    });
  });

  it('skips subagents, blank lanes and null task kinds', () => {
    const lookup = outcomeFiguresFrom([
      summary('subagent', 'delivered', { laneId: SUBAGENT_LANE_ID }),
      summary('blank', 'failed', { laneId: '  ' }),
      summary('null', 'delivered', { taskKind: null }),
    ]);
    expect(lookup(SUBAGENT_LANE_ID, 'implement')).toBeNull();
    expect(lookup('  ', 'implement')).toBeNull();
    expect(lookup('codex', 'implement')).toBeNull();
  });

  it('counts failed and no-deliverable, and ignores unverified', () => {
    const lookup = outcomeFiguresFrom([
      summary('failed', 'failed'),
      summary('missing', 'no-deliverable'),
      summary('unverified', 'unverified'),
    ]);
    expect(lookup('codex', 'implement')).toEqual({
      laneId: 'codex', taskKind: 'implement', delivered: 0, failed: 2,
    });
    expect(outcomeFiguresFrom([summary('only', 'unverified')])('codex', 'implement')).toBeNull();
  });

  it('keeps lane and task-kind pairs separate', () => {
    const lookup = outcomeFiguresFrom([
      summary('a', 'delivered'),
      summary('b', 'failed', { laneId: 'glm' }),
      summary('c', 'delivered', { taskKind: 'review' }),
    ]);
    expect(lookup('codex', 'implement')?.delivered).toBe(1);
    expect(lookup('glm', 'implement')?.failed).toBe(1);
    expect(lookup('codex', 'review')?.delivered).toBe(1);
    expect(lookup('glm', 'review')).toBeNull();
  });

  it('returns null for empty figures', () => {
    expect(outcomeFiguresFrom([])('codex', 'implement')).toBeNull();
    expect(EMPTY_OUTCOME_FIGURES('codex', 'implement')).toBeNull();
  });

  it('exposes only the lane, task kind and two counts', () => {
    const lookup = outcomeFiguresFrom([
      summary('private-run', 'delivered', { family: 'private-family' }),
    ]);
    expect(Object.keys(lookup('codex', 'implement') ?? {}).sort()).toEqual([
      'delivered', 'failed', 'laneId', 'taskKind',
    ]);
    expect(JSON.stringify(lookup('codex', 'implement'))).not.toContain('private');
  });
});
