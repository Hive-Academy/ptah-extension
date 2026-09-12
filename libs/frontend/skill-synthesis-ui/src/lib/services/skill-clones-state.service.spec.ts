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

  it('drops the held detail the moment a DIFFERENT entry is selected', async () => {
    const rpc = makeRpc();
    const resolvers = new Map<string, (v: unknown) => void>();
    rpc.getClone.mockImplementation(
      (slug: string) =>
        new Promise((resolve) =>
          resolvers.set(slug, resolve as (v: unknown) => void),
        ) as ReturnType<SkillSynthesisRpcService['getClone']>,
    );
    const { svc } = setup(rpc);

    const alpha = svc.loadDetail('alpha', 'skill');
    resolvers.get('alpha')?.({
      clone: clone({ slug: 'alpha' }),
      body: '# a',
      history: [],
    });
    await alpha;
    expect(svc.detail()?.body).toBe('# a');

    const beta = svc.loadDetail('beta', 'skill');
    // Before beta's reply: no body at all, rather than alpha's.
    expect(svc.detail()).toBeNull();
    expect(svc.detailLoading()).toBe(true);

    resolvers.get('beta')?.({
      clone: clone({ slug: 'beta' }),
      body: '# b',
      history: [],
    });
    await beta;
    expect(svc.detail()?.body).toBe('# b');
    expect(svc.detailLoading()).toBe(false);
  });

  it('ignores a reply that lands after the selection moved on', async () => {
    const rpc = makeRpc();
    const resolvers = new Map<string, (v: unknown) => void>();
    rpc.getClone.mockImplementation(
      (slug: string) =>
        new Promise((resolve) =>
          resolvers.set(slug, resolve as (v: unknown) => void),
        ) as ReturnType<SkillSynthesisRpcService['getClone']>,
    );
    const { svc } = setup(rpc);

    const alpha = svc.loadDetail('alpha', 'skill');
    const beta = svc.loadDetail('beta', 'skill');

    // Beta wins the race; alpha's late reply must not overwrite it.
    resolvers.get('beta')?.({
      clone: clone({ slug: 'beta' }),
      body: '# b',
      history: [],
    });
    await beta;
    resolvers.get('alpha')?.({
      clone: clone({ slug: 'alpha' }),
      body: '# a',
      history: [],
    });
    await alpha;

    expect(svc.detail()?.body).toBe('# b');
    expect(svc.detailLoading()).toBe(false);
  });

  /**
   * Same entry, two requests, replies in reverse order. The entry key matches
   * for BOTH, so a key-only guard lets the superseded reply win — this is the
   * cross-clone race one step narrower, on the exact path a save takes
   * (`saveCloneBody` reloads the entry it just wrote).
   */
  it('ignores the FIRST reply when two loads of the SAME entry land in reverse order', async () => {
    const rpc = makeRpc();
    const queue: Array<(v: unknown) => void> = [];
    rpc.getClone.mockImplementation(
      () =>
        new Promise((resolve) =>
          queue.push(resolve as (v: unknown) => void),
        ) as ReturnType<SkillSynthesisRpcService['getClone']>,
    );
    const { svc } = setup(rpc);

    const first = svc.loadDetail('alpha', 'skill');
    const second = svc.loadDetail('alpha', 'skill');

    // Second (current) reply lands first and wins.
    queue[1]?.({ clone: clone({ slug: 'alpha' }), body: '# new', history: [] });
    await second;
    expect(svc.detail()?.body).toBe('# new');
    expect(svc.detailLoading()).toBe(false);

    // First (superseded) reply lands late and must change nothing.
    queue[0]?.({
      clone: clone({ slug: 'alpha' }),
      body: '# stale',
      history: [],
    });
    await first;
    expect(svc.detail()?.body).toBe('# new');
  });

  it('does not let a superseded same-entry FAILURE clear the current detail', async () => {
    const rpc = makeRpc();
    const settlers: Array<{
      resolve: (v: unknown) => void;
      reject: (e: unknown) => void;
    }> = [];
    rpc.getClone.mockImplementation(
      () =>
        new Promise((resolve, reject) =>
          settlers.push({
            resolve: resolve as (v: unknown) => void,
            reject,
          }),
        ) as ReturnType<SkillSynthesisRpcService['getClone']>,
    );
    const { svc } = setup(rpc);

    const first = svc.loadDetail('alpha', 'skill');
    const second = svc.loadDetail('alpha', 'skill');

    settlers[1]?.resolve({
      clone: clone({ slug: 'alpha' }),
      body: '# new',
      history: [],
    });
    await second;

    settlers[0]?.reject(new Error('stale boom'));
    await first;

    expect(svc.detail()?.body).toBe('# new');
    expect(svc.error()).toBeNull();
    expect(svc.detailLoading()).toBe(false);
  });

  /**
   * Close, then REOPEN the same entry. `clearDetail` resets the key, so the
   * reopen restores exactly the key the abandoned request was filed under —
   * without a token bump the cleared request lands on the reopened one, writes
   * its body and clears the spinner while the live request is still out.
   */
  it('ignores a request abandoned by clearDetail even when the same entry is reopened', async () => {
    const rpc = makeRpc();
    const queue: Array<(v: unknown) => void> = [];
    rpc.getClone.mockImplementation(
      () =>
        new Promise((resolve) =>
          queue.push(resolve as (v: unknown) => void),
        ) as ReturnType<SkillSynthesisRpcService['getClone']>,
    );
    const { svc } = setup(rpc);

    const abandoned = svc.loadDetail('alpha', 'skill');
    svc.clearDetail();
    const reopened = svc.loadDetail('alpha', 'skill');

    queue[0]?.({
      clone: clone({ slug: 'alpha' }),
      body: '# stale',
      history: [],
    });
    await abandoned;

    expect(svc.detail()).toBeNull();
    expect(svc.detailLoading()).toBe(true);

    queue[1]?.({
      clone: clone({ slug: 'alpha' }),
      body: '# live',
      history: [],
    });
    await reopened;
    expect(svc.detail()?.body).toBe('# live');
    expect(svc.detailLoading()).toBe(false);
  });

  it('keeps the visible detail through a reload of the SAME entry', async () => {
    const rpc = makeRpc();
    const { svc } = setup(rpc);
    await svc.loadDetail('deep-research', 'skill');

    const reload = svc.loadDetail('deep-research', 'skill');
    expect(svc.detail()?.body).toBe('# body');
    await reload;
    expect(svc.detail()?.body).toBe('# body');
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
