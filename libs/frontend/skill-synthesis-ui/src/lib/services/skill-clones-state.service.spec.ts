import { TestBed } from '@angular/core/testing';
import type { AgentScorecard, CloneSummary } from '@ptah-extension/shared';

import { SkillClonesStateService } from './skill-clones-state.service';
import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 0,
    successRate: 1,
    lastEnhancedAt: null,
    historyCount: 0,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
    ...overrides,
  };
}

function scorecard(overrides: Partial<AgentScorecard> = {}): AgentScorecard {
  return {
    slug: 'planner',
    totalInvocations: 3,
    gradedCount: 2,
    gradedSuccessRate: 0.5,
    avgInputTokens: 100,
    avgOutputTokens: 40,
    avgCacheReadTokens: null,
    totalInputTokens: 300,
    totalOutputTokens: 120,
    avgCostUsd: 0.012,
    avgDurationMs: 4200,
    avgToolCount: 5,
    recentVerdicts: [
      { taskId: 'TASK_2026_001', succeeded: true, reconciledAt: 1 },
      { taskId: 'TASK_2026_002', succeeded: false, reconciledAt: 2 },
    ],
    ...overrides,
  };
}

type RpcSlice = Pick<
  SkillSynthesisRpcService,
  'listClones' | 'getClone' | 'getScorecards' | 'getScorecardDetail'
>;

function makeRpc(): jest.Mocked<RpcSlice> {
  return {
    listClones: jest.fn(async () => [
      clone(),
      clone({ slug: 'x', diverged: true }),
    ]),
    getClone: jest.fn(async () => ({
      clone: clone(),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    })),
    getScorecards: jest.fn(async () => ({ planner: scorecard() })),
    getScorecardDetail: jest.fn(async () => ({
      slug: 'planner',
      rows: [
        {
          taskId: 'TASK_2026_001',
          succeeded: true,
          exactAttribution: true,
          inputTokens: 100,
          outputTokens: 40,
          costUsd: 0.012,
          durationMs: 4200,
          invokedAt: 1,
          reconciledAt: 2,
        },
      ],
      findingsExcerpt: '## Findings\n- reduce tokens',
    })),
  } as unknown as jest.Mocked<RpcSlice>;
}

describe('SkillClonesStateService', () => {
  function setup(rpc = makeRpc()) {
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillClonesStateService);
    return { svc, rpc };
  }

  it('refreshes clones and computes diverged count', async () => {
    const { svc } = setup();
    await svc.refreshClones();
    expect(svc.clones().length).toBe(2);
    expect(svc.divergedCount()).toBe(1);
    expect(svc.loading()).toBe(false);
  });

  it('records error on refresh failure', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockRejectedValueOnce(new Error('boom'));
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.error()).toBe('boom');
  });

  it('loads detail and clears it', async () => {
    const { svc } = setup();
    await svc.loadDetail('deep-research', 'skill');
    expect(svc.selectedSlug()).toBe('deep-research');
    expect(svc.detail()?.history.length).toBe(1);
    svc.clearDetail();
    expect(svc.selectedSlug()).toBeNull();
    expect(svc.detail()).toBeNull();
  });

  it('populates scorecards from ONE getScorecards call for agent slugs only', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce([
      clone({ slug: 'deep-research', kind: 'skill' }),
      clone({ slug: 'planner', kind: 'agent' }),
      clone({ slug: 'ship', kind: 'command' }),
    ]);
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(rpc.getScorecards).toHaveBeenCalledTimes(1);
    expect(rpc.getScorecards).toHaveBeenCalledWith(['planner']);
    expect(svc.scorecards()['planner']?.slug).toBe('planner');
  });

  it('skips the scorecard RPC entirely when no agent clones exist', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce([clone({ kind: 'skill' })]);
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(rpc.getScorecards).not.toHaveBeenCalled();
    expect(svc.scorecards()).toEqual({});
  });

  it('degrades to empty scorecards (not a blanked list) when getScorecards fails', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce([
      clone({ slug: 'planner', kind: 'agent' }),
    ]);
    rpc.getScorecards.mockRejectedValueOnce(new Error('scorecard boom'));
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.clones().length).toBe(1);
    expect(svc.scorecards()).toEqual({});
    expect(svc.error()).toBeNull();
  });

  it('handles a no-data agent slug missing from the scorecard map', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce([
      clone({ slug: 'planner', kind: 'agent' }),
    ]);
    rpc.getScorecards.mockResolvedValueOnce({});
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.scorecards()['planner']).toBeUndefined();
  });

  it('lazily loads scorecard detail once and caches it per slug', async () => {
    const rpc = makeRpc();
    const { svc } = setup(rpc);
    await svc.loadScorecardDetail('planner');
    expect(rpc.getScorecardDetail).toHaveBeenCalledTimes(1);
    expect(svc.scorecardDetails()['planner']?.rows.length).toBe(1);
    expect(svc.scorecardDetailLoading()).toBeNull();

    // Second call is a cached no-op — no extra RPC.
    await svc.loadScorecardDetail('planner');
    expect(rpc.getScorecardDetail).toHaveBeenCalledTimes(1);
  });
});
