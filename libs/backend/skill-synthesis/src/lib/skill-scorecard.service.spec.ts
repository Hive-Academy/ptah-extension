import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillInvocationEventStore } from './skill-invocation-event.store';
import { SkillScorecardService } from './skill-scorecard.service';
import type {
  SkillTaskGrade,
  SkillTaskGradeAggregate,
} from './skill-task-grade.store';
import type { ScorecardAggregate } from './types';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const workspaceRoot = '/workspace';

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
  const grades = {
    getAggregates: jest.fn((_kind: string, _slugs: readonly string[], _root: string | null): Map<string, SkillTaskGradeAggregate> =>
      new Map([['agent-a', { graded: 1, passed: 0, successRate: 0 }]])),
    listRecent: jest.fn((_kind: string, _slug: string, _limit: number, _root: string | null) => [grade]),
  };
  const events = {
    getScorecardAggregates: jest.fn(() => new Map([['agent-a', aggregate('agent-a')]])),
    getUsageStats: jest.fn(() => ({ invocationCount: 4, distinctContexts: 2 })),
  };
  const service = new SkillScorecardService(logger as never, grades as never, null, events as never);
  return { service, grades, events };
}

describe('SkillScorecardService', () => {
  it('resolves the event store from tsyringe when bundled metadata is absent', () => {
    const child = container.createChildContainer();
    const events = { getUsageStats: jest.fn(() => ({ invocationCount: 4, distinctContexts: 2 })) };
    child.registerInstance(TOKENS.LOGGER, logger);
    child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_TASK_GRADE_STORE, {
      getAggregates: jest.fn(() => new Map()),
    });
    child.registerInstance(SkillInvocationEventStore, events as never);
    const service = child.resolve(SkillScorecardService);
    expect(service.getInvocationStats('skill', 'deep-research', workspaceRoot)).toMatchObject({
      invocationCount: 4,
      distinctContexts: 2,
    });
    expect(events.getUsageStats).toHaveBeenCalledWith('deep-research');
  });
  it('uses only task grades for the scorecard rate and recent verdicts', () => {
    const { service, grades } = makeService();
    const card = service.getScorecards(['agent-a'], workspaceRoot)['agent-a'];
    expect(card.totalInvocations).toBe(4);
    expect(card.gradedCount).toBe(1);
    expect(card.gradedSuccessRate).toBe(0);
    expect(card.recentVerdicts).toEqual([{ taskId: grade.taskId, succeeded: false, reconciledAt: 123 }]);
    expect(grades.getAggregates).toHaveBeenCalledWith('agent', ['agent-a'], workspaceRoot);
    expect(grades.listRecent).toHaveBeenCalledWith('agent', 'agent-a', 5, workspaceRoot);
  });

  it('returns null when no task grade exists despite legacy graded events', () => {
    const { service, grades } = makeService();
    grades.getAggregates.mockReturnValue(new Map());
    const card = service.getScorecards(['agent-a'], workspaceRoot)['agent-a'];
    expect(card.gradedCount).toBe(0);
    expect(card.gradedSuccessRate).toBeNull();
    expect(card.recentVerdicts).toEqual([]);
    expect(grades.listRecent).not.toHaveBeenCalled();
  });

  it('derives win rate from task grades with ungraded uses as unknown', () => {
    const { service } = makeService();
    expect(service.getWinRates(['agent-a', 'absent'], workspaceRoot)).toEqual({
      'agent-a': { slug: 'agent-a', invocations: 4, wins: 0, unknown: 3, winRate: 0 },
      absent: { slug: 'absent', invocations: 0, wins: 0, unknown: 0, winRate: null },
    });
  });

  it('reads detail verdicts from the grade store', async () => {
    const { service, grades } = makeService();
    const detail = await service.getScorecardDetail('agent-a', workspaceRoot);
    expect(grades.listRecent).toHaveBeenCalledWith('agent', 'agent-a', 20, workspaceRoot);
    expect(detail.rows[0]).toMatchObject({ taskId: grade.taskId, succeeded: false, exactAttribution: true });
  });

  it('counts graded tasks while preserving invocation telemetry contexts', () => {
    const { service, grades, events } = makeService();
    grades.getAggregates.mockReturnValue(new Map([['agent-a', { graded: 5, passed: 3, successRate: 0.6 }]]));

    expect(service.getInvocationStats('agent', 'agent-a', workspaceRoot)).toEqual({
      total: 5, succeeded: 3, failed: 2, distinctContexts: 2,
      invocationCount: 4, successRate: 0.6,
    });
    expect(grades.getAggregates).toHaveBeenCalledWith('agent', ['agent-a'], workspaceRoot);
    expect(events.getUsageStats).toHaveBeenCalledWith('agent-a');
    expect(events.getScorecardAggregates).not.toHaveBeenCalled();
  });

  it('returns a null rate with zero grades despite invocation telemetry', () => {
    const { service, grades, events } = makeService();
    grades.getAggregates.mockReturnValue(new Map());

    expect(service.getInvocationStats('skill', 'agent-a', workspaceRoot)).toEqual({
      total: 0, succeeded: 0, failed: 0, distinctContexts: 2,
      invocationCount: 4, successRate: null,
    });
    expect(events.getScorecardAggregates).not.toHaveBeenCalled();
  });

  it('passes the workspace through every grade read and leaves an absent root ungraded', async () => {
    const { service, grades } = makeService();
    grades.getAggregates.mockImplementation((_kind, _slugs, root) => new Map([['agent-a',
      root === '/first' ? { graded: 1, passed: 1, successRate: 1 }
        : root === '/second' ? { graded: 1, passed: 0, successRate: 0 }
          : { graded: 0, passed: 0, successRate: null },
    ]]));
    grades.listRecent.mockImplementation((_kind, _slug, _limit, root) => root === '/first' ? [grade] : []);

    expect(service.getInvocationStats('agent', 'agent-a', '/first').successRate).toBe(1);
    expect(service.getInvocationStats('agent', 'agent-a', '/second').successRate).toBe(0);
    expect(service.getInvocationStats('agent', 'agent-a', null).successRate).toBeNull();
    expect(service.getScorecards(['agent-a'], '/first')['agent-a'].gradedSuccessRate).toBe(1);
    expect(service.getScorecards(['agent-a'], '/second')['agent-a'].gradedSuccessRate).toBe(0);
    expect(service.getScorecards(['agent-a'], null)['agent-a'].gradedSuccessRate).toBeNull();
    expect(service.getWinRates(['agent-a'], null)['agent-a'].winRate).toBeNull();
    expect(service.getWinRates(['agent-a'], '/first')['agent-a'].winRate).toBe(1);
    expect((await service.getScorecardDetail('agent-a', '/first')).rows).toHaveLength(1);
    expect((await service.getScorecardDetail('agent-a', null)).rows).toEqual([]);
    expect(grades.listRecent).toHaveBeenCalledWith('agent', 'agent-a', 20, null);
  });
});
