import 'reflect-metadata';
import { SkillScorecardService } from './skill-scorecard.service';
import type { SkillTaskGrade } from './skill-task-grade.store';
import type { ScorecardAggregate } from './types';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function aggregate(slug: string): ScorecardAggregate {
  return {
    slug, total: 4, graded: 4, gradedSucceeded: 4,
    avgInputTokens: null, avgOutputTokens: null, avgCacheReadTokens: null,
    totalInputTokens: null, totalOutputTokens: null, avgCostUsd: null,
    avgDurationMs: null, avgToolCount: null,
  };
}

const grade: SkillTaskGrade = {
  taskId: 'TASK_2026_001', subjectKind: 'agent', subjectSlug: 'agent-a',
  attributionKey: 'run:1', runId: '1', verdict: 'fail', sourceFile: null,
  sourceDigest: null, evidenceSource: 'spec:TASK_2026_001',
  workspaceRoot: null, gradedAt: 123, findingsRef: null,
};

function makeService() {
  const store = {
    getScorecardAggregates: jest.fn(() => new Map([['agent-a', aggregate('agent-a')]])),
  };
  const grades = {
    getAggregates: jest.fn(() => new Map([['agent-a', { graded: 1, passed: 0, successRate: 0 }]])),
    listRecent: jest.fn(() => [grade]),
  };
  const events = {
    getUsageStats: jest.fn(() => ({ invocationCount: 4, distinctContexts: 2 })),
  };
  const service = new SkillScorecardService(logger as never, store as never, grades as never, null, events as never);
  return { service, store, grades, events };
}

describe('SkillScorecardService', () => {
  it('uses only task grades for the scorecard rate and recent verdicts', () => {
    const { service, grades } = makeService();
    const card = service.getScorecards(['agent-a'])['agent-a'];
    expect(card.totalInvocations).toBe(4);
    expect(card.gradedCount).toBe(1);
    expect(card.gradedSuccessRate).toBe(0);
    expect(card.recentVerdicts).toEqual([{ taskId: grade.taskId, succeeded: false, reconciledAt: 123 }]);
    expect(grades.getAggregates).toHaveBeenCalledWith('agent', ['agent-a']);
  });

  it('returns null when no task grade exists despite legacy graded events', () => {
    const { service, grades } = makeService();
    grades.getAggregates.mockReturnValue(new Map());
    const card = service.getScorecards(['agent-a'])['agent-a'];
    expect(card.gradedCount).toBe(0);
    expect(card.gradedSuccessRate).toBeNull();
    expect(card.recentVerdicts).toEqual([]);
    expect(grades.listRecent).not.toHaveBeenCalled();
  });

  it('derives win rate from task grades with ungraded uses as unknown', () => {
    const { service } = makeService();
    expect(service.getWinRates(['agent-a', 'absent'])).toEqual({
      'agent-a': { slug: 'agent-a', invocations: 4, wins: 0, unknown: 3, winRate: 0 },
      absent: { slug: 'absent', invocations: 0, wins: 0, unknown: 0, winRate: null },
    });
  });

  it('reads detail verdicts from the grade store', async () => {
    const { service, grades } = makeService();
    const detail = await service.getScorecardDetail('agent-a');
    expect(grades.listRecent).toHaveBeenCalledWith('agent', 'agent-a', 20);
    expect(detail.rows[0]).toMatchObject({ taskId: grade.taskId, succeeded: false, exactAttribution: true });
  });

  it('counts graded tasks while preserving invocation telemetry contexts', () => {
    const { service, grades, store, events } = makeService();
    grades.getAggregates.mockReturnValue(new Map([['agent-a', { graded: 5, passed: 3, successRate: 0.6 }]]));

    expect(service.getInvocationStats('agent', 'agent-a')).toEqual({
      total: 5, succeeded: 3, failed: 2, distinctContexts: 2,
      invocationCount: 4, successRate: 0.6,
    });
    expect(grades.getAggregates).toHaveBeenCalledWith('agent', ['agent-a']);
    expect(events.getUsageStats).toHaveBeenCalledWith('agent-a');
    expect(store.getScorecardAggregates).not.toHaveBeenCalled();
  });

  it('returns a null rate with zero grades despite invocation telemetry', () => {
    const { service, grades, store } = makeService();
    grades.getAggregates.mockReturnValue(new Map());

    expect(service.getInvocationStats('skill', 'agent-a')).toEqual({
      total: 0, succeeded: 0, failed: 0, distinctContexts: 2,
      invocationCount: 4, successRate: null,
    });
    expect(store.getScorecardAggregates).not.toHaveBeenCalled();
  });
});
