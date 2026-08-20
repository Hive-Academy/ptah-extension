/**
 * SkillScorecardService specs — composition of store aggregates + graded
 * verdicts + (detail-only) findings excerpt into the shared scorecard DTOs.
 *
 * The store and findings port are plain fakes; the SQL itself is covered by
 * skill-candidate.store.spec.ts.
 */
import 'reflect-metadata';
import { SkillScorecardService } from './skill-scorecard.service';
import type { SkillWinRate } from './skill-candidate.store';
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
  getWinRates: jest.Mock;
}

function makeStore(): FakeStore {
  return {
    getScorecardAggregates: jest.fn(
      () => new Map<string, ScorecardAggregate>(),
    ),
    listGradedInvocations: jest.fn((): GradedInvocationRow[] => []),
    getWinRates: jest.fn((): SkillWinRate[] => []),
  };
}

/**
 * A measured win-rate row. `winRate` is passed in explicitly — including `0`,
 * which is a measurement and not a stand-in for "unmeasured".
 */
function winRateRow(
  slug: string,
  winRate: number | null,
  over: Partial<SkillWinRate> = {},
): SkillWinRate {
  return {
    slug,
    invocations: 4,
    wins: 2,
    unknown: 0,
    winRate,
    ...over,
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

// ─── B4.3.1: the scorecard exposes the win rate alongside its aggregates ─────

describe('SkillScorecardService.getWinRates', () => {
  it('returns {} for an empty slug list without touching the store', () => {
    const store = makeStore();
    const service = makeService(store);

    expect(service.getWinRates([])).toEqual({});
    expect(store.getWinRates).not.toHaveBeenCalled();
  });

  it('echoes the measured row for a slug the join covered', () => {
    const store = makeStore();
    store.getWinRates.mockReturnValue([
      winRateRow('backend-developer', 0.75, {
        invocations: 6,
        wins: 3,
        unknown: 2,
      }),
    ]);
    const service = makeService(store);

    expect(service.getWinRates(['backend-developer'])).toEqual({
      'backend-developer': {
        slug: 'backend-developer',
        invocations: 6,
        wins: 3,
        unknown: 2,
        winRate: 0.75,
      },
    });
  });

  it('reports an unmeasured slug as winRate null — NOT 0 — and never omits it', () => {
    const store = makeStore();
    store.getWinRates.mockReturnValue([winRateRow('measured', 0.5)]);
    const service = makeService(store);

    const rates = service.getWinRates(['measured', 'never-invoked']);

    expect(rates['never-invoked']).toEqual({
      slug: 'never-invoked',
      invocations: 0,
      wins: 0,
      unknown: 0,
      winRate: null,
    });
    expect(rates['never-invoked'].winRate).toBeNull();
    expect(rates['never-invoked'].winRate).not.toBe(0);
  });

  it('preserves a measured 0 as 0 — the loser is not folded into "unmeasured"', () => {
    const store = makeStore();
    store.getWinRates.mockReturnValue([
      winRateRow('measured-loser', 0, { invocations: 4, wins: 0, unknown: 0 }),
    ]);
    const service = makeService(store);

    const rate = service.getWinRates(['measured-loser'])['measured-loser'];
    expect(rate.winRate).toBe(0);
    expect(rate.winRate).not.toBeNull();
  });

  it('ignores slugs the caller did not ask about', () => {
    const store = makeStore();
    store.getWinRates.mockReturnValue([
      winRateRow('asked', 0.4),
      winRateRow('not-asked', 0.9),
    ]);
    const service = makeService(store);

    expect(Object.keys(service.getWinRates(['asked']))).toEqual(['asked']);
  });

  it('degrades to unmeasured (never throws, never 0) when the store fails', () => {
    const store = makeStore();
    store.getWinRates.mockImplementation(() => {
      throw new Error('no such table: skill_session_verdicts');
    });
    const service = makeService(store);

    const rates = service.getWinRates(['a', 'b']);
    expect(rates['a'].winRate).toBeNull();
    expect(rates['b'].winRate).toBeNull();
  });
});
