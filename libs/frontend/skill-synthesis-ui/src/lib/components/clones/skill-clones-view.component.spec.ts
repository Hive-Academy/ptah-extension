import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  AgentScorecard,
  CloneSummary,
  SkillSynthesisGetScorecardDetailResult,
} from '@ptah-extension/shared';

import { SkillClonesViewComponent } from './skill-clones-view.component';
import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import {
  SkillClonesStateService,
  SkillCloneDetail,
} from '../../services/skill-clones-state.service';

function vscodeServiceStub(isElectron: boolean): Partial<VSCodeService> {
  return {
    config: signal({ isElectron }),
  } as unknown as Partial<VSCodeService>;
}

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 10,
    successRate: 0.8,
    lastEnhancedAt: null,
    historyCount: 2,
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
    ],
    ...overrides,
  };
}

interface StateStub {
  readonly clones: ReturnType<typeof signal<CloneSummary[]>>;
  readonly loading: ReturnType<typeof signal<boolean>>;
  readonly error: ReturnType<typeof signal<string | null>>;
  readonly detailLoading: ReturnType<typeof signal<boolean>>;
  readonly detail: ReturnType<typeof signal<SkillCloneDetail | null>>;
  readonly scorecards: ReturnType<
    typeof signal<Record<string, AgentScorecard>>
  >;
  readonly scorecardDetails: ReturnType<
    typeof signal<Record<string, SkillSynthesisGetScorecardDetailResult>>
  >;
  readonly scorecardDetailLoading: ReturnType<typeof signal<string | null>>;
  readonly refreshClones: jest.Mock;
  readonly loadDetail: jest.Mock;
  readonly clearDetail: jest.Mock;
  readonly loadScorecardDetail: jest.Mock;
}

function makeStateStub(initial: CloneSummary[] = []): StateStub {
  return {
    clones: signal<CloneSummary[]>(initial),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    detailLoading: signal<boolean>(false),
    detail: signal<SkillCloneDetail | null>(null),
    scorecards: signal<Record<string, AgentScorecard>>({}),
    scorecardDetails: signal<
      Record<string, SkillSynthesisGetScorecardDetailResult>
    >({}),
    scorecardDetailLoading: signal<string | null>(null),
    refreshClones: jest.fn(async () => undefined),
    loadDetail: jest.fn(async () => undefined),
    clearDetail: jest.fn(() => undefined),
    loadScorecardDetail: jest.fn(async () => undefined),
  };
}

function makeRpcStub() {
  return {
    previewEnhancement: jest.fn(async () => ({
      proposed: true,
      skipReason: null,
      currentBody: '# before',
      proposedBody: '# after',
      judgeScore: 8,
      judgeReason: 'Tighter trigger phrasing.',
      proposalId: 'prop-1',
    })),
    applyProposal: jest.fn(async () => ({
      applied: true,
      historyTs: '20260101T000000',
    })),
    getHistoryBody: jest.fn(async () => ({
      body: '# older',
      ts: '20260101T000000',
    })),
    revertEnhancement: jest.fn(async () => ({
      reverted: true,
      slug: 'deep-research',
      revertedFrom: '20260101T000000',
      newHistoryTs: '20260102T000000',
    })),
    rebaseClone: jest.fn(async () => ({
      kind: 'skill' as const,
      slug: 'deep-research',
      sourceHash: 'sha256:abc',
      snapshotPath: null,
      failed: false,
      reason: null,
    })),
    keepClone: jest.fn(async () => ({
      kind: 'skill' as const,
      slug: 'deep-research',
      sourceHash: 'sha256:def',
    })),
    listClones: jest.fn(async () => []),
  };
}

type RpcStub = ReturnType<typeof makeRpcStub>;

function setup(opts: {
  isElectron?: boolean;
  state?: StateStub;
  rpc?: RpcStub;
}) {
  const state = opts.state ?? makeStateStub();
  const rpc = opts.rpc ?? makeRpcStub();
  TestBed.configureTestingModule({
    imports: [SkillClonesViewComponent],
    providers: [
      { provide: SkillClonesStateService, useValue: state },
      { provide: SkillSynthesisRpcService, useValue: rpc },
      {
        provide: VSCodeService,
        useValue: vscodeServiceStub(opts.isElectron ?? true),
      },
    ],
  });
  const fixture = TestBed.createComponent(SkillClonesViewComponent);
  fixture.detectChanges();

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(testId: string): T | null =>
    el().querySelector<T>(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] =>
    Array.from(el().querySelectorAll(`[data-testid="${testId}"]`));
  const click = async (testId: string): Promise<void> => {
    (q<HTMLButtonElement>(testId) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Cards only render for the active kind tab, so pick the tab first. */
  const selectTab = (index: number): void => {
    (all('native-tab')[index] as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const openFirstCard = (): void => {
    (el().querySelector('[role="button"]') as HTMLElement).click();
    fixture.detectChanges();
  };

  return { fixture, state, rpc, el, q, all, click, selectTab, openFirstCard };
}

afterEach(() => TestBed.resetTestingModule());

describe('SkillClonesViewComponent — shell', () => {
  it('shows the desktop-only notice and does not refresh in VS Code', () => {
    const { q, state } = setup({ isElectron: false });
    expect(q('clones-desktop-notice')).toBeTruthy();
    expect(q('clones-view')).toBeNull();
    expect(state.refreshClones).not.toHaveBeenCalled();
  });

  it('refreshes on init in Electron', () => {
    const { state } = setup({ isElectron: true });
    expect(state.refreshClones).toHaveBeenCalledTimes(1);
  });
});

describe('SkillClonesViewComponent — kind tabs', () => {
  const mixed = () => [
    clone({ slug: 'deep-research', kind: 'skill' }),
    clone({ slug: 'caveman', kind: 'skill' }),
    clone({ slug: 'planner', kind: 'agent' }),
    clone({ slug: 'ship', kind: 'command' }),
  ];

  it('renders Skills / Agents / Commands with live counts', () => {
    const { all } = setup({ state: makeStateStub(mixed()) });
    const tabs = all('native-tab');
    expect(tabs.map((t) => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual(
      ['Skills2', 'Agents1', 'Commands1'],
    );
  });

  it('shows only the active kind and switches on tab click', () => {
    const { all, fixture, el } = setup({ state: makeStateStub(mixed()) });
    expect(all('clones-row').length).toBe(2);
    expect(el().textContent).toContain('deep-research');
    expect(el().textContent).not.toContain('planner');

    (all('native-tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(all('clones-row').length).toBe(1);
    expect(el().textContent).toContain('planner');
  });

  it('renders a kind-specific empty state rather than a blank grid', () => {
    const { q, all, fixture } = setup({
      state: makeStateStub([clone({ kind: 'skill' })]),
    });
    (all('native-tab')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('clones-empty')?.textContent).toContain('No commands');
  });

  it('shows a loading message instead of the empty copy while refreshing', () => {
    const state = makeStateStub([]);
    state.loading.set(true);
    const { q } = setup({ state });
    expect(q('clones-empty')?.textContent).toContain('Loading library…');
  });
});

describe('SkillClonesViewComponent — detail drawer', () => {
  it('opens the drawer and lazily loads detail when a card is activated', () => {
    const state = makeStateStub([clone()]);
    const { fixture, el } = setup({ state });

    (el().querySelector('[role="button"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(state.loadDetail).toHaveBeenCalledWith('deep-research', 'skill');
    expect(
      el().querySelector('[data-testid="native-drawer-panel"]'),
    ).toBeTruthy();
  });

  it('loads the scorecard detail only for agent entries', () => {
    const state = makeStateStub([clone({ kind: 'agent', slug: 'planner' })]);
    state.scorecards.set({ planner: scorecard() });
    const { el, selectTab, openFirstCard } = setup({ state });

    selectTab(1);
    openFirstCard();

    expect(state.loadScorecardDetail).toHaveBeenCalledWith('planner');
    expect(el().querySelector('[data-testid="drawer-scorecard"]')).toBeTruthy();
  });

  it('renders the body through the markdown chokepoint, never raw innerHTML', () => {
    const state = makeStateStub([clone()]);
    state.detail.set({ clone: clone(), body: '# body', history: [] });
    const { fixture, el, q } = setup({ state });

    (el().querySelector('[role="button"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(q('drawer-body')?.querySelector('ptah-markdown-block')).toBeTruthy();
  });

  it('spells out both divergence options, including that Keep mine writes nothing', () => {
    const state = makeStateStub([
      clone({ diverged: true, cloneStatus: 'diverged' }),
    ]);
    const { fixture, el, q } = setup({ state });

    (el().querySelector('[role="button"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(q('drawer-rebase-btn')).toBeTruthy();
    expect(q('drawer-keep-explanation')?.textContent).toContain(
      'changes no file content',
    );
  });

  it('omits Rebase from the drawer for an authored entry and explains why', () => {
    const state = makeStateStub([
      clone({ diverged: true, cloneStatus: 'authored' }),
    ]);
    const { fixture, el, q } = setup({ state });

    (el().querySelector('[role="button"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(q('drawer-rebase-btn')).toBeNull();
    expect(q('drawer-upstream-note')?.textContent).toContain(
      'no upstream source',
    );
  });

  it('reverts to a chosen history snapshot, forwarding the entry kind', async () => {
    const state = makeStateStub([clone({ kind: 'agent', slug: 'planner' })]);
    state.detail.set({
      clone: clone({ kind: 'agent', slug: 'planner' }),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    });
    const rpc = makeRpcStub();
    const { click, selectTab, openFirstCard } = setup({ state, rpc });

    selectTab(1);
    openFirstCard();
    await click('clones-history-revert-btn');

    expect(rpc.revertEnhancement).toHaveBeenCalledWith(
      'agent',
      'planner',
      '20260101T000000',
    );
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('explains the empty history timeline instead of showing a bare list', () => {
    const state = makeStateStub([clone({ historyCount: 0 })]);
    state.detail.set({ clone: clone(), body: '# body', history: [] });
    const { fixture, el, q } = setup({ state });

    (el().querySelector('[role="button"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(q('drawer-history-empty')?.textContent).toContain('No snapshots');
  });

  it('loads a snapshot body on demand for the diff surface', async () => {
    const state = makeStateStub([clone()]);
    state.detail.set({
      clone: clone(),
      body: '# current',
      history: [{ ts: '20260101T000000', hasBody: true }],
    });
    const rpc = makeRpcStub();
    const { fixture, el, click, q } = setup({ state, rpc });

    (el().querySelector('[role="button"]') as HTMLElement).click();
    fixture.detectChanges();
    await click('drawer-history-diff-btn');

    expect(rpc.getHistoryBody).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      '20260101T000000',
    );
    expect(q('drawer-history-diff')).toBeTruthy();
  });
});

describe('SkillClonesViewComponent — enhancement preview', () => {
  it('previews instead of writing, and shows the judge score and reasoning', async () => {
    const state = makeStateStub([clone()]);
    const rpc = makeRpcStub();
    const { click, q } = setup({ state, rpc });

    await click('clones-enhance-btn');

    expect(rpc.previewEnhancement).toHaveBeenCalledWith(
      'skill',
      'deep-research',
    );
    expect(rpc.applyProposal).not.toHaveBeenCalled();
    expect(q('preview-judge-score')?.textContent).toContain('8');
    expect(q('preview-judge-reason')?.textContent).toContain(
      'Tighter trigger phrasing.',
    );
    expect(q('preview-diff')).toBeTruthy();
  });

  it('applies only on Apply, then refreshes the list', async () => {
    const state = makeStateStub([clone()]);
    const rpc = makeRpcStub();
    const { click, q } = setup({ state, rpc });

    await click('clones-enhance-btn');
    await click('preview-apply-btn');

    expect(rpc.applyProposal).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      'prop-1',
    );
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
    expect(q('preview-apply-btn')).toBeNull();
  });

  it('discards without writing anything', async () => {
    const state = makeStateStub([clone()]);
    const rpc = makeRpcStub();
    const { click, q } = setup({ state, rpc });

    await click('clones-enhance-btn');
    await click('preview-discard-btn');

    expect(rpc.applyProposal).not.toHaveBeenCalled();
    expect(q('preview-apply-btn')).toBeNull();
  });

  it('disables Apply and surfaces the reason when nothing was proposed', async () => {
    const state = makeStateStub([clone()]);
    const rpc = makeRpcStub();
    rpc.previewEnhancement.mockResolvedValueOnce({
      proposed: false,
      skipReason: 'Judge scored below the acceptance threshold.',
      currentBody: '# before',
      proposedBody: '',
      judgeScore: 3,
      judgeReason: 'Rewrite lost the trigger list.',
      proposalId: null,
    });
    const { click, q } = setup({ state, rpc });

    await click('clones-enhance-btn');

    expect(q<HTMLButtonElement>('preview-apply-btn')?.disabled).toBe(true);
    expect(q('preview-skip-reason')?.textContent).toContain(
      'below the acceptance threshold',
    );
    expect(q('preview-no-diff')).toBeTruthy();
  });

  it('surfaces a preview failure in the drawer rather than a toast', async () => {
    const state = makeStateStub([clone()]);
    const rpc = makeRpcStub();
    rpc.previewEnhancement.mockRejectedValueOnce(new Error('backend exploded'));
    const { click, q } = setup({ state, rpc });

    await click('clones-enhance-btn');

    expect(q('preview-error')?.textContent).toContain('backend exploded');
  });

  it('cannot be started at all when the entry is below its invocation threshold', () => {
    const state = makeStateStub([
      clone({ invocationCount: 0, enhanceMinInvocations: 5 }),
    ]);
    const rpc = makeRpcStub();
    const { q } = setup({ state, rpc });

    const btn = q<HTMLButtonElement>('clones-enhance-btn');
    expect(btn?.disabled).toBe(true);
    btn?.click();
    expect(rpc.previewEnhancement).not.toHaveBeenCalled();
  });
});

describe('SkillClonesViewComponent — divergence resolution', () => {
  it('confirms Keep mine with the "no file content changes" explanation', async () => {
    const state = makeStateStub([
      clone({ diverged: true, cloneStatus: 'diverged' }),
    ]);
    const rpc = makeRpcStub();
    const { click, q } = setup({ state, rpc });

    await click('clones-keep-btn');

    expect(rpc.keepClone).not.toHaveBeenCalled();
    expect(q('clones-reconcile-modal')).toBeTruthy();
    expect(q('clones-reconcile-explanation')?.textContent).toContain(
      'changes no file content',
    );

    await click('clones-reconcile-confirm');

    expect(rpc.keepClone).toHaveBeenCalledWith('skill', 'deep-research');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('cancels Keep mine without calling the backend', async () => {
    const state = makeStateStub([clone({ diverged: true })]);
    const rpc = makeRpcStub();
    const { click, q } = setup({ state, rpc });

    await click('clones-keep-btn');
    await click('clones-reconcile-cancel');

    expect(rpc.keepClone).not.toHaveBeenCalled();
    expect(q('clones-reconcile-modal')).toBeNull();
  });

  it('confirms Rebase with an explanation of what it overwrites', async () => {
    const state = makeStateStub([
      clone({ diverged: true, cloneStatus: 'diverged' }),
    ]);
    const rpc = makeRpcStub();
    const { click, q } = setup({ state, rpc });

    await click('clones-rebase-btn');
    expect(q('clones-reconcile-explanation')?.textContent).toContain(
      'replaces your local copy',
    );

    await click('clones-reconcile-confirm');
    expect(rpc.rebaseClone).toHaveBeenCalledWith('skill', 'deep-research');
  });

  it('never renders Rebase for an authored entry, so it cannot be attempted', () => {
    const state = makeStateStub([
      clone({ diverged: true, cloneStatus: 'authored' }),
    ]);
    const { q } = setup({ state });
    expect(q('clones-rebase-btn')).toBeNull();
    expect(q('clone-card-upstream-note')?.textContent).toContain(
      'no upstream source',
    );
  });
});
