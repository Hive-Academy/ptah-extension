/**
 * SkillScorecardService specs — composition of store aggregates + graded
 * verdicts + (detail-only) findings excerpt into the shared scorecard DTOs.
 *
 * The store and findings port are plain fakes; the SQL itself is covered by
 * skill-candidate.store.spec.ts.
 */
import 'reflect-metadata';
import { SkillScorecardService } from './skill-scorecard.service';
import type { ScorecardAggregate, GradedInvocationRow } from './types';
import type { SpecFindingsPort } from './spec-findings.port';

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function zeroAggregate(slug: string): ScorecardAggregate {
  return {
    slug,
    total: 0,
    graded: 0,
    gradedSucceeded: 0,
    avgInputTokens: null,
    avgOutputTokens: null,
    avgCacheReadTokens: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    avgCostUsd: null,
    avgDurationMs: null,
    avgToolCount: null,
  };
}

interface FakeStore {
  getScorecardAggregates: jest.Mock;
  listGradedInvocations: jest.Mock;
}

function makeStore(): FakeStore {
  return {
    getScorecardAggregates: jest.fn(
      () => new Map<string, ScorecardAggregate>(),
    ),
    listGradedInvocations: jest.fn((): GradedInvocationRow[] => []),
  };
}

function makeFindings(excerpt: string | null): SpecFindingsPort {
  return { getRecentFindings: jest.fn(async () => excerpt) };
}

function makeService(
  store: FakeStore,
  findings: SpecFindingsPort | null = null,
): SkillScorecardService {
  return new SkillScorecardService(
    makeLogger() as never,
    store as never,
    findings,
  );
}

const gradedRow = (
  over: Partial<GradedInvocationRow> = {},
): GradedInvocationRow => ({
  taskId: 'TASK_2026_001',
  succeeded: true,
  verdictSource: 'spec:TASK_2026_001',
  inputTokens: 100,
  outputTokens: 10,
  costUsd: 0.2,
  durationMs: 1000,
  invokedAt: 1000,
  reconciledAt: 5000,
  ...over,
});

describe('SkillScorecardService.getScorecards', () => {
  it('returns {} for an empty slug list without touching the store', () => {
    const store = makeStore();
    const service = makeService(store);
    expect(service.getScorecards([])).toEqual({});
    expect(store.getScorecardAggregates).not.toHaveBeenCalled();
  });

  it('assembles a scorecard from aggregate + recent verdicts', () => {
    const store = makeStore();
    store.getScorecardAggregates.mockReturnValue(
      new Map<string, ScorecardAggregate>([
        [
          'backend-developer',
          {
            slug: 'backend-developer',
            total: 12,
            graded: 7,
            gradedSucceeded: 5,
            avgInputTokens: 48200,
            avgOutputTokens: 6100,
            avgCacheReadTokens: 210000,
            totalInputTokens: 578400,
            totalOutputTokens: 73200,
            avgCostUsd: 0.41,
            avgDurationMs: 252000,
            avgToolCount: 23,
          },
        ],
      ]),
    );
    store.listGradedInvocations.mockReturnValue([
      gradedRow({ taskId: 'TASK_2026_155', succeeded: false, reconciledAt: 9 }),
      gradedRow({ taskId: 'TASK_2026_154', succeeded: true, reconciledAt: 8 }),
    ]);
    const service = makeService(store);

    const cards = service.getScorecards(['backend-developer']);
    const card = cards['backend-developer'];
    expect(card.totalInvocations).toBe(12);
    expect(card.gradedCount).toBe(7);
    expect(card.gradedSuccessRate).toBeCloseTo(5 / 7);
    expect(card.avgInputTokens).toBe(48200);
    expect(card.avgCostUsd).toBeCloseTo(0.41);
    expect(card.recentVerdicts).toEqual([
      { taskId: 'TASK_2026_155', succeeded: false, reconciledAt: 9 },
      { taskId: 'TASK_2026_154', succeeded: true, reconciledAt: 8 },
    ]);
    // Verdicts fetched with the ≤5 cap.
    expect(store.listGradedInvocations).toHaveBeenCalledWith(
      'backend-developer',
      5,
    );
  });

  it('does not query verdicts for slugs with no graded events', () => {
    const store = makeStore();
    store.getScorecardAggregates.mockReturnValue(
      new Map([['idle-agent', zeroAggregate('idle-agent')]]),
    );
    const service = makeService(store);

    const cards = service.getScorecards(['idle-agent']);
    expect(cards['idle-agent'].gradedSuccessRate).toBeNull();
    expect(cards['idle-agent'].recentVerdicts).toEqual([]);
    expect(store.listGradedInvocations).not.toHaveBeenCalled();
  });

  it('returns a typed empty scorecard for a no-data slug (never an error)', () => {
    const store = makeStore();
    store.getScorecardAggregates.mockReturnValue(
      new Map([['no-data', zeroAggregate('no-data')]]),
    );
    const service = makeService(store);

    const card = service.getScorecards(['no-data'])['no-data'];
    expect(card).toMatchObject({
      slug: 'no-data',
      totalInvocations: 0,
      gradedCount: 0,
      gradedSuccessRate: null,
      avgInputTokens: null,
      avgCostUsd: null,
      recentVerdicts: [],
    });
  });

  it('degrades to typed empty scorecards when the store throws', () => {
    const store = makeStore();
    store.getScorecardAggregates.mockImplementation(() => {
      throw new Error('SQLITE_BUSY');
    });
    const service = makeService(store);

    const cards = service.getScorecards(['a', 'b']);
    expect(cards['a']).toMatchObject({
      totalInvocations: 0,
      recentVerdicts: [],
    });
    expect(cards['b']).toMatchObject({
      totalInvocations: 0,
      recentVerdicts: [],
    });
  });

  it('recovers the taskId from verdict_source when task_id is null', () => {
    const store = makeStore();
    store.getScorecardAggregates.mockReturnValue(
      new Map([
        [
          'agent-w',
          {
            ...zeroAggregate('agent-w'),
            total: 1,
            graded: 1,
            gradedSucceeded: 0,
          },
        ],
      ]),
    );
    store.listGradedInvocations.mockReturnValue([
      gradedRow({
        taskId: null,
        verdictSource: 'spec-window:TASK_2026_050',
        succeeded: false,
        reconciledAt: 7,
      }),
    ]);
    const service = makeService(store);

    const card = service.getScorecards(['agent-w'])['agent-w'];
    expect(card.recentVerdicts[0].taskId).toBe('TASK_2026_050');
  });
});

describe('SkillScorecardService.getScorecardDetail', () => {
  it('maps graded rows and marks exact vs heuristic attribution', async () => {
    const store = makeStore();
    store.listGradedInvocations.mockReturnValue([
      gradedRow({ verdictSource: 'spec:TASK_2026_001' }),
      gradedRow({
        taskId: null,
        verdictSource: 'spec-window:TASK_2026_002',
      }),
    ]);
    const service = makeService(store, makeFindings(null));

    const detail = await service.getScorecardDetail('agent-a');
    expect(detail.slug).toBe('agent-a');
    expect(detail.rows).toHaveLength(2);
    expect(detail.rows[0].exactAttribution).toBe(true);
    expect(detail.rows[1].exactAttribution).toBe(false);
    expect(detail.rows[1].taskId).toBeNull();
    expect(detail.findingsExcerpt).toBeNull();
  });

  it('truncates the findings excerpt to the 4000-char cap', async () => {
    const store = makeStore();
    const service = makeService(store, makeFindings('x'.repeat(9000)));

    const detail = await service.getScorecardDetail('agent-b');
    expect(detail.findingsExcerpt).not.toBeNull();
    expect(detail.findingsExcerpt?.length).toBe(4000);
  });

  it('returns findingsExcerpt=null when no findings port is bound', async () => {
    const store = makeStore();
    const service = makeService(store, null);

    const detail = await service.getScorecardDetail('agent-c');
    expect(detail.findingsExcerpt).toBeNull();
  });

  it('returns findingsExcerpt=null when the port yields an empty string', async () => {
    const store = makeStore();
    const service = makeService(store, makeFindings(''));

    const detail = await service.getScorecardDetail('agent-d');
    expect(detail.findingsExcerpt).toBeNull();
  });

  it('returns a typed empty detail for an empty slug', async () => {
    const store = makeStore();
    const service = makeService(store, makeFindings('findings'));

    const detail = await service.getScorecardDetail('');
    expect(detail).toEqual({ slug: '', rows: [], findingsExcerpt: null });
    expect(store.listGradedInvocations).not.toHaveBeenCalled();
  });

  it('clamps the limit to [1,100] and defaults to 20', async () => {
    const store = makeStore();
    const service = makeService(store);

    await service.getScorecardDetail('agent-e');
    expect(store.listGradedInvocations).toHaveBeenLastCalledWith('agent-e', 20);

    await service.getScorecardDetail('agent-e', 500);
    expect(store.listGradedInvocations).toHaveBeenLastCalledWith(
      'agent-e',
      100,
    );

    await service.getScorecardDetail('agent-e', 5);
    expect(store.listGradedInvocations).toHaveBeenLastCalledWith('agent-e', 5);
  });
});
