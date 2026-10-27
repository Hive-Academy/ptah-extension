import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  LibraryChangeFeed,
  type LibraryChange,
} from '@ptah-extension/marketplace/services';
import type {
  AgentOutcomeSignals,
  AgentScorecard,
  CloneSummary,
  SkillSynthesisListClonesResult,
} from '@ptah-extension/shared';

import {
  LIBRARY_REFRESH_FAILED_COPY,
  SkillClonesStateService,
  libraryUpdatedCopy,
} from './skill-clones-state.service';
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

/** A `skillSynthesis:listClones` reply scoped to `scopeRoot`. */
function listed(
  clones: CloneSummary[],
  scopeRoot = '/repo',
): SkillSynthesisListClonesResult {
  return { clones, scopeRoot };
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

function agentSignals(
  overrides: Partial<AgentOutcomeSignals> = {},
): AgentOutcomeSignals {
  return {
    slug: 'planner',
    windowDays: 30,
    runCount: 5,
    delivered: { numerator: 4, denominator: 5 },
    reviewPass: { numerator: 3, denominator: 4 },
    avgReviseRounds: 1.5,
    topFailureClass: 'timeout',
    ...overrides,
  };
}

type RpcSlice = Pick<
  SkillSynthesisRpcService,
  | 'listClones'
  | 'getClone'
  | 'getScorecards'
  | 'getScorecardDetail'
  | 'getAgentOutcomeSignals'
>;

function makeRpc(): jest.Mocked<RpcSlice> {
  return {
    listClones: jest.fn(async () =>
      listed([clone(), clone({ slug: 'x', diverged: true })]),
    ),
    getClone: jest.fn(async () => ({
      clone: clone(),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    })),
    getScorecards: jest.fn(async () => ({ planner: scorecard() })),
    getAgentOutcomeSignals: jest.fn(async () => ({
      signals: {},
      windowDays: 30,
      persistent: true,
    })),
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
  function setup(rpc = makeRpc(), held: LibraryChange | null = null) {
    const latest = signal<LibraryChange | null>(held);
    TestBed.configureTestingModule({
      providers: [
        { provide: SkillSynthesisRpcService, useValue: rpc },
        { provide: LibraryChangeFeed, useValue: { latest } },
      ],
    });
    const svc = TestBed.inject(SkillClonesStateService);
    // The feed effect's first run (the value held at construction).
    TestBed.tick();
    return { svc, rpc, latest };
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
    rpc.listClones.mockResolvedValueOnce(
      listed([
        clone({ slug: 'deep-research', kind: 'skill' }),
        clone({ slug: 'planner', kind: 'agent' }),
        clone({ slug: 'ship', kind: 'command' }),
      ]),
    );
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(rpc.getScorecards).toHaveBeenCalledTimes(1);
    expect(rpc.getScorecards).toHaveBeenCalledWith(['planner']);
    expect(svc.scorecards()['planner']?.slug).toBe('planner');
  });

  it('skips the scorecard RPC entirely when no agent clones exist', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce(listed([clone({ kind: 'skill' })]));
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(rpc.getScorecards).not.toHaveBeenCalled();
    expect(svc.scorecards()).toEqual({});
    expect(rpc.getAgentOutcomeSignals).not.toHaveBeenCalled();
    expect(svc.agentOutcomeSignals()).toEqual({});
    expect(svc.outcomeWindowDays()).toBeNull();
  });

  it('degrades to empty scorecards (not a blanked list) when getScorecards fails', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce(
      listed([clone({ slug: 'planner', kind: 'agent' })]),
    );
    rpc.getScorecards.mockRejectedValueOnce(new Error('scorecard boom'));
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.clones().length).toBe(1);
    expect(svc.scorecards()).toEqual({});
    expect(svc.error()).toBeNull();
  });

  it('handles a no-data agent slug missing from the scorecard map', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce(
      listed([clone({ slug: 'planner', kind: 'agent' })]),
    );
    rpc.getScorecards.mockResolvedValueOnce({});
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.scorecards()['planner']).toBeUndefined();
  });

  it('loads outcome signals once for every agent slug and keeps the window', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce(
      listed([
        clone({ slug: 'deep-research', kind: 'skill' }),
        clone({ slug: 'planner', kind: 'agent' }),
        clone({ slug: 'reviewer', kind: 'agent' }),
        clone({ slug: 'ship', kind: 'command' }),
      ]),
    );
    rpc.getAgentOutcomeSignals.mockResolvedValueOnce({
      signals: { planner: agentSignals({ slug: 'planner', runCount: 5 }) },
      windowDays: 30,
      persistent: true,
    });
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(rpc.getAgentOutcomeSignals).toHaveBeenCalledTimes(1);
    expect(rpc.getAgentOutcomeSignals).toHaveBeenCalledWith([
      'planner',
      'reviewer',
    ]);
    expect(svc.agentOutcomeSignals()['planner']?.runCount).toBe(5);
    expect(svc.agentOutcomeSignals()['reviewer']).toBeUndefined();
    expect(svc.outcomeWindowDays()).toBe(30);
    expect(svc.clones()).toHaveLength(4);
    expect(svc.error()).toBeNull();
  });

  it('records unavailable outcome data without exposing the read error', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce(
      listed([clone({ slug: 'planner', kind: 'agent' })]),
    );
    rpc.getAgentOutcomeSignals.mockRejectedValueOnce(new Error('signals boom'));
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.clones()).toHaveLength(1);
    expect(svc.agentOutcomeSignals()).toEqual({});
    expect(svc.outcomeWindowDays()).toBeNull();
    expect(svc.outcomeStatus()).toBe('unavailable');
    expect(svc.outcomeReadFailures()).toBe(1);
    expect(svc.error()).toBeNull();
    expect(svc.scorecards()['planner']?.slug).toBe('planner');
  });

  it('keeps displayed outcome figures after a failed refresh', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValue(
      listed([clone({ slug: 'planner', kind: 'agent' })]),
    );
    rpc.getAgentOutcomeSignals.mockResolvedValueOnce({
      signals: { planner: agentSignals() },
      windowDays: 30,
      persistent: true,
    });
    const { svc } = setup(rpc);
    await svc.refreshClones();
    rpc.getAgentOutcomeSignals.mockRejectedValueOnce(
      new Error('/secret/outcomes.db'),
    );
    await svc.refreshClones();
    expect(svc.agentOutcomeSignals()['planner']?.runCount).toBe(5);
    expect(svc.outcomeWindowDays()).toBe(30);
    expect(svc.outcomeStatus()).toBe('unavailable');
    expect(svc.outcomeReadFailures()).toBe(1);
  });

  it('marks outcome data as not persistent when the host has no durable store', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce(
      listed([clone({ slug: 'planner', kind: 'agent' })]),
    );
    rpc.getAgentOutcomeSignals.mockResolvedValueOnce({
      signals: {},
      windowDays: 30,
      persistent: false,
    });
    const { svc } = setup(rpc);
    await svc.refreshClones();
    expect(svc.outcomeStatus()).toBe('not-persistent');
  });

  it('marks the first outcome read as loading until it finishes', async () => {
    const rpc = makeRpc();
    rpc.listClones.mockResolvedValueOnce(
      listed([clone({ slug: 'planner', kind: 'agent' })]),
    );
    let finish!: (
      value: Awaited<
        ReturnType<SkillSynthesisRpcService['getAgentOutcomeSignals']>
      >,
    ) => void;
    rpc.getAgentOutcomeSignals.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { svc } = setup(rpc);
    const refresh = svc.refreshClones();
    expect(svc.outcomeStatus()).toBe('loading');
    await Promise.resolve();
    await Promise.resolve();
    expect(svc.outcomeStatus()).toBe('loading');
    finish({ signals: {}, windowDays: 30, persistent: true });
    await refresh;
    expect(svc.outcomeStatus()).toBe('ready');
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

  describe('library:changed feed (8.2b, B13)', () => {
    const agent = (
      slug: string,
      provenance?: CloneSummary['provenance'],
    ): CloneSummary =>
      clone({ slug, kind: 'agent', ...(provenance ? { provenance } : {}) });
    let at = 0;
    const change = (overrides: Partial<LibraryChange> = {}): LibraryChange => ({
      workspaceRoot: '/repo',
      status: 'updated',
      reasons: ['setup-wizard'],
      at: ++at,
      ...overrides,
    });
    type Latest = ReturnType<typeof setup>['latest'];

    /** Run the root effect, then drain the refresh it started. */
    async function push(latest: Latest, value: LibraryChange): Promise<void> {
      latest.set(value);
      TestBed.tick();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    /** A `listClones` mock whose replies the test releases by hand. */
    function deferredLists(rpc: ReturnType<typeof makeRpc>) {
      const settle: Array<{
        resolve: (r: SkillSynthesisListClonesResult) => void;
        reject: (e: Error) => void;
      }> = [];
      rpc.listClones.mockImplementation(
        () =>
          new Promise<SkillSynthesisListClonesResult>((resolve, reject) =>
            settle.push({ resolve, reject }),
          ),
      );
      return settle;
    }

    it('ignores a push before the Library was ever opened', async () => {
      const { rpc, latest } = setup();
      await push(latest, change());
      expect(rpc.listClones).not.toHaveBeenCalled();
    });

    it('does not act on a push the feed held before the service existed', async () => {
      const rpc = makeRpc();
      rpc.listClones.mockResolvedValue(listed([agent('planner')]));
      const { svc } = setup(rpc, change());
      await svc.refreshClones();
      TestBed.tick();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(rpc.listClones).toHaveBeenCalledTimes(1);
      expect(svc.libraryNotice()).toBeNull();
    });

    it('claims no added agents across a harness-root change', async () => {
      const rpc = makeRpc();
      rpc.listClones
        .mockResolvedValueOnce(listed([agent('planner')], '/a'))
        .mockResolvedValueOnce(listed([agent('planner'), agent('x')], '/b'));
      const { svc, latest } = setup(rpc);
      await svc.refreshClones();
      await push(latest, change({ workspaceRoot: '/b' }));
      expect(svc.clones()).toHaveLength(2);
      expect(svc.libraryNotice()).toBeNull();
    });

    it('refreshes on every push, including two identical ones', async () => {
      const { svc, rpc, latest } = setup();
      await svc.refreshClones();
      await push(latest, change());
      await push(latest, change());
      expect(rpc.listClones).toHaveBeenCalledTimes(3);
    });

    it('says what the CURRENT list gained, with its recorded origin', async () => {
      const rpc = makeRpc();
      rpc.listClones
        .mockResolvedValueOnce(listed([agent('planner')]))
        .mockResolvedValueOnce(
          listed([
            agent('planner'),
            agent('backend-developer', { kind: 'setup-wizard' }),
            agent('tester', { kind: 'setup-wizard' }),
            clone({ slug: 'new-skill', kind: 'skill' }),
          ]),
        );
      const { svc, latest } = setup(rpc);
      await svc.refreshClones();
      await push(latest, change());
      expect(svc.libraryNotice()).toEqual({
        kind: 'updated',
        message: 'Library updated: 2 agents added by the setup wizard.',
      });

      svc.clearLibraryNotice();
      expect(svc.libraryNotice()).toBeNull();
    });

    it('says nothing when the current list gained no agents (a push for another root)', async () => {
      const rpc = makeRpc();
      rpc.listClones.mockResolvedValue(listed([agent('planner')]));
      const { svc, latest } = setup(rpc);
      await svc.refreshClones();
      await push(latest, change({ workspaceRoot: '/other' }));
      expect(rpc.listClones).toHaveBeenCalledTimes(2);
      expect(svc.libraryNotice()).toBeNull();
    });

    it('shows the C10 failure notice only for the root the list is scoped to', async () => {
      const rpc = makeRpc();
      rpc.listClones.mockResolvedValue(listed([agent('planner')], '/repo'));
      const { svc, latest } = setup(rpc);
      await svc.refreshClones();

      await push(latest, change({ status: 'failed', workspaceRoot: '/other' }));
      expect(svc.libraryNotice()).toBeNull();

      await push(latest, change({ status: 'failed', workspaceRoot: '/repo' }));
      expect(svc.libraryNotice()).toEqual({
        kind: 'failed',
        message: LIBRARY_REFRESH_FAILED_COPY,
      });

      // The next push replaces the line.
      await push(latest, change());
      expect(svc.libraryNotice()).toBeNull();
    });

    it('shows no failure notice when the host sent no scopeRoot', async () => {
      const rpc = makeRpc();
      rpc.listClones.mockResolvedValue({ clones: [agent('planner')] });
      const { svc, latest } = setup(rpc);
      await svc.refreshClones();
      await push(latest, change({ status: 'failed' }));
      expect(svc.libraryNotice()).toBeNull();
    });

    it('drops an out-of-order list reply: the newer request wins', async () => {
      const rpc = makeRpc();
      const lists = deferredLists(rpc);
      const { svc } = setup(rpc);
      const older = svc.refreshClones();
      const newer = svc.refreshClones();

      lists[1].resolve(listed([agent('current')], '/b'));
      await newer;
      expect(svc.clones().map((c) => c.slug)).toEqual(['current']);
      expect(svc.loading()).toBe(false);

      lists[0].resolve(listed([agent('stale')], '/a'));
      await older;
      expect(svc.clones().map((c) => c.slug)).toEqual(['current']);
      expect(svc.loading()).toBe(false);
    });

    it('keeps loading on while a newer request is still in flight', async () => {
      const rpc = makeRpc();
      const lists = deferredLists(rpc);
      const { svc } = setup(rpc);
      const older = svc.refreshClones();
      void svc.refreshClones();
      lists[0].resolve(listed([agent('stale')]));
      await older;
      expect(svc.loading()).toBe(true);
      expect(svc.clones()).toEqual([]);
    });

    it('drops the failure of a superseded request', async () => {
      const rpc = makeRpc();
      const lists = deferredLists(rpc);
      const { svc } = setup(rpc);
      const older = svc.refreshClones();
      const newer = svc.refreshClones();
      lists[1].resolve(listed([agent('planner')]));
      await newer;
      lists[0].reject(new Error('stale boom'));
      await older;
      expect(svc.error()).toBeNull();
    });

    it('drops a scorecard reply from a superseded list request', async () => {
      const rpc = makeRpc();
      rpc.listClones.mockResolvedValue(listed([agent('planner')]));
      let finishOld: (map: Record<string, AgentScorecard>) => void = () =>
        undefined;
      rpc.getScorecards
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve;
            }),
        )
        .mockResolvedValueOnce({
          planner: scorecard({ totalInvocations: 9 }),
        });
      const { svc } = setup(rpc);
      const older = svc.refreshClones();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await svc.refreshClones();
      finishOld({ planner: scorecard({ totalInvocations: 1 }) });
      await older;
      expect(svc.scorecards()['planner']?.totalInvocations).toBe(9);
    });

    it('a different scopeRoot clears the previous root line', async () => {
      const rpc = makeRpc();
      rpc.listClones
        .mockResolvedValueOnce(listed([agent('planner')], '/repo'))
        .mockResolvedValueOnce(listed([agent('planner')], '/repo'))
        .mockResolvedValueOnce(listed([agent('planner')], '/other'));
      const { svc, latest } = setup(rpc);
      await svc.refreshClones();
      await push(latest, change({ status: 'failed' }));
      expect(svc.libraryNotice()?.kind).toBe('failed');
      await svc.refreshClones();
      expect(svc.libraryNotice()).toBeNull();
    });
  });

  describe('libraryUpdatedCopy', () => {
    it('names one plugin, the setup wizard, or no origin', () => {
      const plugin = {
        kind: 'plugin' as const,
        pluginId: 'acme',
        name: 'Acme Toolkit',
        state: 'active' as const,
      };
      expect(
        libraryUpdatedCopy([clone({ kind: 'agent', provenance: plugin })]),
      ).toBe('Library updated: 1 agent added by plugin Acme Toolkit.');
      expect(
        libraryUpdatedCopy([
          clone({ kind: 'agent', provenance: { kind: 'setup-wizard' } }),
          clone({ slug: 'b', kind: 'agent', provenance: plugin }),
        ]),
      ).toBe('Library updated: 2 agents added.');
      expect(libraryUpdatedCopy([clone({ kind: 'agent' })])).toBe(
        'Library updated: 1 agent added.',
      );
    });
  });
});
