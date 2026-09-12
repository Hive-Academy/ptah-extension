import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  AgentScorecard,
  CloneSummary,
  SkillSynthesisGetScorecardDetailResult,
  SkillSynthesisSaveCloneBodyResult,
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
  readonly saveCloneBody: jest.Mock;
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
    // The default is the protected save: the clone has an origin record, so the
    // next sync marks it diverged rather than overwriting the edit.
    saveCloneBody: jest.fn(async () => saveResult()),
  };
}

/** A `skillSynthesis:saveCloneBody` result, protected unless told otherwise. */
function saveResult(
  overrides: Partial<SkillSynthesisSaveCloneBodyResult> = {},
): SkillSynthesisSaveCloneBodyResult {
  return {
    kind: 'skill',
    slug: 'deep-research',
    historyTs: '20260103T000000',
    metadataIncomplete: false,
    reconcileProtected: true,
    ...overrides,
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
    saveCloneBody: jest.fn(async () => saveResult()),
  };
}

type RpcStub = ReturnType<typeof makeRpcStub>;

function setup(opts: {
  isElectron?: boolean;
  state?: StateStub;
  rpc?: RpcStub;
  divergedFilterRequest?: number;
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
  if (opts.divergedFilterRequest) {
    fixture.componentRef.setInput(
      'divergedFilterRequest',
      opts.divergedFilterRequest,
    );
  }
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

  /**
   * Drain pending promises WITHOUT going through `whenStable()`.
   *
   * `showToast` schedules a 3-second in-zone `setTimeout` to clear itself, and
   * `whenStable()` waits for that macrotask — so any assertion made after it
   * reads an already-cleared toast. This lets the awaited work finish while
   * leaving the toast on screen.
   */
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };

  return {
    fixture,
    state,
    rpc,
    el,
    q,
    all,
    click,
    settle,
    selectTab,
    openFirstCard,
  };
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

// ── Diverged filter, bulk rebase, deep-link arrival ───────────────────────

/** Two eligible skills, one clean skill, one eligible agent (other kind). */
function bulkFixture(): CloneSummary[] {
  return [
    clone({ slug: 'alpha', kind: 'skill', diverged: true }),
    clone({ slug: 'beta', kind: 'skill', diverged: true }),
    clone({ slug: 'gamma', kind: 'skill', diverged: false }),
    clone({ slug: 'planner', kind: 'agent', diverged: true }),
  ];
}

describe('SkillClonesViewComponent — diverged filter', () => {
  it('narrows the rendered set and reports its own pressed state', async () => {
    const { all, click, q } = setup({ state: makeStateStub(bulkFixture()) });
    expect(all('clones-row').length).toBe(3);
    expect(q('clones-diverged-filter')?.getAttribute('aria-pressed')).toBe(
      'false',
    );

    await click('clones-diverged-filter');

    expect(all('clones-row').length).toBe(2);
    expect(q('clones-diverged-filter')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('renders an empty STATE, not a blank region, when the filter empties the list', async () => {
    const state = makeStateStub([clone({ slug: 'gamma', diverged: false })]);
    const { click, q, all } = setup({ state });

    await click('clones-diverged-filter');

    expect(all('clones-row').length).toBe(0);
    expect(q('clones-empty')?.textContent).toContain('No diverged entries');
  });

  it('arrives pre-filtered when the deep link asked for it', () => {
    const { all } = setup({
      state: makeStateStub(bulkFixture()),
      divergedFilterRequest: 1,
    });
    expect(all('clones-row').length).toBe(2);
  });

  /**
   * The view stays mounted between deep links. A boolean request could not
   * express the SECOND one — it was already `true`, so nothing changed and the
   * filter the user had cleared stayed cleared.
   */
  it('re-applies the filter on a SECOND deep link after the user cleared it', async () => {
    const { all, click, fixture } = setup({
      state: makeStateStub(bulkFixture()),
      divergedFilterRequest: 1,
    });
    expect(all('clones-row').length).toBe(2);

    await click('clones-diverged-filter');
    expect(all('clones-row').length).toBe(3);

    fixture.componentRef.setInput('divergedFilterRequest', 2);
    fixture.detectChanges();
    expect(all('clones-row').length).toBe(2);
  });
});

describe('SkillClonesViewComponent — bulk rebase', () => {
  it('counts only the current kind and reports the other-kind residual', () => {
    const { q } = setup({ state: makeStateStub(bulkFixture()) });
    expect(q('clones-bulk-count')?.textContent).toContain(
      '2 diverged entries can be rebased',
    );
    expect(q('clones-bulk-count')?.textContent).toContain('(1 in other kinds)');
  });

  it('names the count on the control and excludes orphaned and authored entries', () => {
    const state = makeStateStub([
      clone({ slug: 'alpha', diverged: true }),
      clone({ slug: 'orphan', diverged: true, orphaned: true }),
      clone({ slug: 'mine', diverged: true, cloneStatus: 'authored' }),
    ]);
    const { q } = setup({ state });
    expect(q('clones-bulk-rebase-btn')?.getAttribute('aria-label')).toBe(
      'Rebase all 1 diverged entries in this kind',
    );
  });

  it('stays rendered but DISABLED with a stated reason when nothing is eligible', () => {
    const { q } = setup({ state: makeStateStub([clone({ diverged: false })]) });
    const btn = q<HTMLButtonElement>('clones-bulk-rebase-btn');
    expect(btn).toBeTruthy();
    expect(btn?.disabled).toBe(true);
    expect(q('clones-bulk-disabled-reason')?.textContent).toContain(
      'Nothing to rebase in this kind',
    );
  });

  /**
   * A refresh replaces every row, so a write started while one is in flight
   * was authorised against rows that may already be gone — including the
   * eligibility the bulk count was taken from.
   */
  it('locks the bulk controls while the clone list is still being read', () => {
    const state = makeStateStub(bulkFixture());
    state.refreshClones.mockImplementation(() => {
      state.loading.set(true);
      return new Promise<void>(() => undefined);
    });
    const { q } = setup({ state });

    expect(q<HTMLButtonElement>('clones-bulk-rebase-btn')?.disabled).toBe(true);
    expect(q<HTMLButtonElement>('clones-refresh')?.disabled).toBe(true);
  });

  it('writes nothing until the confirmation is accepted', async () => {
    const rpc = makeRpcStub();
    const { click, q } = setup({ state: makeStateStub(bulkFixture()), rpc });

    await click('clones-bulk-rebase-btn');

    expect(rpc.rebaseClone).not.toHaveBeenCalled();
    expect(q('clones-bulk-modal')).toBeTruthy();
    expect(q('clones-bulk-modal-count')?.textContent).toContain('2 entries');
    expect(q('clones-bulk-explanation')?.textContent).toContain(
      'replaces your local copy',
    );
    expect(q('clones-bulk-explanation')?.textContent).toContain(
      'keeps going if an individual entry fails',
    );

    await click('clones-bulk-cancel');
    expect(rpc.rebaseClone).not.toHaveBeenCalled();
    expect(q('clones-bulk-modal')).toBeNull();
  });

  it('rebases every eligible entry of the kind and refreshes the list once', async () => {
    const state = makeStateStub(bulkFixture());
    const rpc = makeRpcStub();
    const { click } = setup({ state, rpc });

    await click('clones-bulk-rebase-btn');
    await click('clones-bulk-confirm');

    expect(rpc.rebaseClone).toHaveBeenCalledTimes(2);
    expect(rpc.rebaseClone).toHaveBeenNthCalledWith(1, 'skill', 'alpha');
    expect(rpc.rebaseClone).toHaveBeenNthCalledWith(2, 'skill', 'beta');
    // ngOnInit is the first call; the batch adds exactly one more (R1.5).
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('reaches the last entry after a mid-batch failure and names the failed slugs', async () => {
    const state = makeStateStub([
      clone({ slug: 'alpha', diverged: true }),
      clone({ slug: 'beta', diverged: true }),
      clone({ slug: 'delta', diverged: true }),
    ]);
    const rpc = makeRpcStub();
    rpc.rebaseClone
      .mockImplementationOnce(async () => ({
        kind: 'skill' as const,
        slug: 'alpha',
        sourceHash: 'sha256:a',
        snapshotPath: null,
        failed: false,
        reason: null,
      }))
      .mockRejectedValueOnce(new Error('transport died'))
      .mockImplementationOnce(async () => ({
        kind: 'skill' as const,
        slug: 'delta',
        sourceHash: 'sha256:d',
        snapshotPath: null,
        failed: true,
        reason: 'Cannot resolve upstream source',
      }));
    const { click, q, fixture, settle } = setup({ state, rpc });

    await click('clones-bulk-rebase-btn');
    (q<HTMLButtonElement>('clones-bulk-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle();

    expect(rpc.rebaseClone).toHaveBeenCalledTimes(3);
    const toast = q('clones-toast')?.textContent ?? '';
    expect(toast).toContain('Rebased 1 of 3');
    expect(toast).toContain('beta');
    expect(toast).toContain('delta');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('locks every control that could start a conflicting write while running', async () => {
    const state = makeStateStub(bulkFixture());
    const rpc = makeRpcStub();
    let release: (() => void) | null = null;
    rpc.rebaseClone.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              kind: 'skill' as const,
              slug: 'alpha',
              sourceHash: 'sha256:a',
              snapshotPath: null,
              failed: false,
              reason: null,
            });
        }),
    );
    const { click, fixture, q } = setup({ state, rpc });

    await click('clones-bulk-rebase-btn');
    (q<HTMLButtonElement>('clones-bulk-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(q<HTMLButtonElement>('clones-bulk-rebase-btn')?.disabled).toBe(true);
    expect(q<HTMLButtonElement>('clones-refresh')?.disabled).toBe(true);
    expect(q('clones-bulk-rebase-btn')?.textContent).toContain('Rebasing 1 of');

    release?.();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /*
   * R1.4 end to end. The two cases above prove a failure in the MIDDLE and at
   * the END of a batch are both survived. The two below close the remaining
   * gaps: a failure on the very FIRST member, and the unlock afterwards.
   */

  it('a failure on the FIRST entry does not abort the batch — the later entries still succeed', async () => {
    const state = makeStateStub([
      clone({ slug: 'alpha', diverged: true }),
      clone({ slug: 'beta', diverged: true }),
      clone({ slug: 'delta', diverged: true }),
    ]);
    const rpc = makeRpcStub();
    rpc.rebaseClone.mockImplementation(async (_kind: string, slug: string) => {
      if (slug === 'alpha') throw new Error('transport died');
      return {
        kind: 'skill' as const,
        slug,
        sourceHash: 'sha256:x',
        snapshotPath: null,
        failed: false,
        reason: null,
      };
    });
    const { click, q, fixture, settle } = setup({ state, rpc });

    await click('clones-bulk-rebase-btn');
    (q<HTMLButtonElement>('clones-bulk-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle();

    expect(rpc.rebaseClone).toHaveBeenCalledTimes(3);
    expect(rpc.rebaseClone).toHaveBeenNthCalledWith(2, 'skill', 'beta');
    expect(rpc.rebaseClone).toHaveBeenNthCalledWith(3, 'skill', 'delta');
    const toast = q('clones-toast')?.textContent ?? '';
    expect(toast).toContain('Rebased 2 of 3');
    expect(toast).toContain('alpha');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('releases the lock after a batch in which an entry threw, so the surface is not stranded', async () => {
    const state = makeStateStub(bulkFixture());
    const rpc = makeRpcStub();
    rpc.rebaseClone.mockRejectedValue(new Error('transport died'));
    const { click, q, fixture, settle } = setup({ state, rpc });

    await click('clones-bulk-rebase-btn');
    (q<HTMLButtonElement>('clones-bulk-confirm') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle();

    // `running` clears in a `finally`; had it not, every control below would
    // stay disabled until the tab was rebuilt.
    expect(q<HTMLButtonElement>('clones-bulk-rebase-btn')?.disabled).toBe(
      false,
    );
    expect(q<HTMLButtonElement>('clones-refresh')?.disabled).toBe(false);
    expect(q('clones-toast')?.textContent).toContain('Rebased 0 of 2');
    fixture.detectChanges();
  });
});

describe('SkillClonesViewComponent — body save', () => {
  function openDrawerWithBody(body: string | null) {
    const state = makeStateStub([clone()]);
    state.detail.set({ clone: clone(), body, history: [] });
    const rpc = makeRpcStub();
    const harness = setup({ state, rpc });
    (harness.el().querySelector('[role="button"]') as HTMLElement).click();
    harness.fixture.detectChanges();
    return harness;
  }

  it('offers no Edit affordance while the body is unloaded', () => {
    expect(openDrawerWithBody(null).q('drawer-body-edit-btn')).toBeNull();
  });

  it('offers the Edit affordance once the body has loaded', () => {
    expect(openDrawerWithBody('# body').q('drawer-body-edit-btn')).toBeTruthy();
  });

  it('saves the edited body, then reloads the detail and the list', async () => {
    const { click, state, fixture, el } = openDrawerWithBody('# body');

    await click('drawer-body-edit-btn');
    const textarea = el().querySelector(
      '[data-testid="clone-body-editor-textarea"]',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await click('clone-body-editor-save');

    expect(state.saveCloneBody).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      '# edited',
    );
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  /**
   * Edit the open body and submit, leaving the toast on screen.
   *
   * Deliberately does NOT use `click`, which awaits `whenStable()` and so waits
   * out the toast's own 3-second dismissal timer.
   */
  async function editAndSave(
    harness: ReturnType<typeof setup>,
    text: string,
  ): Promise<void> {
    const { click, fixture, el, q, settle } = harness;
    await click('drawer-body-edit-btn');
    const textarea = el().querySelector(
      '[data-testid="clone-body-editor-textarea"]',
    ) as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      q<HTMLButtonElement>('clone-body-editor-save') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await settle();
  }

  /**
   * CodeRabbit finding C, TASK_2026_426. `SkillSynthesisSaveCloneBodyResult`
   * forbids an unqualified success when `reconcileProtected` is `false`: the
   * body is on disk, but the next sync pass can overwrite it. The protected
   * case must stay exactly as it was.
   */
  it('reports a protected save as a plain success', async () => {
    const harness = openDrawerWithBody('# body');
    await editAndSave(harness, '# edited');

    const toast = harness.q('clones-toast');
    const tone = Array.from(toast?.classList ?? []);
    expect(toast?.textContent?.trim()).toBe('Saved "deep-research".');
    expect(tone).toContain('alert-success');
    expect(tone).not.toContain('alert-warning');
  });

  it('warns that an unprotected save may not survive the next sync', async () => {
    const harness = openDrawerWithBody('# body');
    harness.state.saveCloneBody.mockResolvedValueOnce(
      saveResult({ reconcileProtected: false }),
    );
    await editAndSave(harness, '# edited');

    const toast = harness.q('clones-toast');
    const text = toast?.textContent ?? '';
    const tone = Array.from(toast?.classList ?? []);
    // Saved, at risk, and recoverable — the three facts, in the user's words.
    expect(text).toContain('Saved "deep-research"');
    expect(text).toContain('a later sync may replace it');
    expect(text).toContain('History keeps a snapshot');
    // A warning, not an error: the write DID happen, so the list still reloads.
    expect(tone).toContain('alert-warning');
    expect(tone).not.toContain('alert-error');
    expect(tone).not.toContain('alert-success');
    expect(harness.state.refreshClones).toHaveBeenCalledTimes(2);
  });

  /**
   * CodeRabbit re-review of the fix above. BOTH flags can be true at once: the
   * mirror reads the sidecar — which is what makes the clone protected —
   * before the sidecar write that then fails. Checking `reconcileProtected`
   * first therefore reported a plain success over incomplete bookkeeping.
   */
  it('warns about incomplete metadata even on a protected save', async () => {
    const harness = openDrawerWithBody('# body');
    harness.state.saveCloneBody.mockResolvedValueOnce(
      saveResult({ reconcileProtected: true, metadataIncomplete: true }),
    );
    await editAndSave(harness, '# edited');

    const toast = harness.q('clones-toast');
    const text = toast?.textContent ?? '';
    const tone = Array.from(toast?.classList ?? []);
    expect(text).toContain('Saved "deep-research"');
    expect(text).toContain('metadata could not be');
    expect(text).toContain('History keeps a snapshot');
    // Still a success — the body was committed — so never an error tone, and
    // never the unqualified success the protected branch would have shown.
    expect(tone).toContain('alert-warning');
    expect(tone).not.toContain('alert-error');
    expect(tone).not.toContain('alert-success');
  });

  /**
   * Regression, TASK_2026_426 logic review finding 1.
   *
   * The whole sequence, against the REAL `SkillClonesStateService` — a stubbed
   * state cannot reproduce this, because the defect lives in what `loadDetail`
   * leaves in `detail` while it awaits. Select alpha, wait for its body, select
   * beta, then reach for Edit before beta's detail lands: the editor used to
   * open seeded with ALPHA's body, and saving wrote it into beta's file while
   * the toast said `Saved "beta"`.
   */
  describe('cross-clone edit during the detail load', () => {
    type Detail = SkillCloneDetail;

    function realStateSetup() {
      const resolvers = new Map<string, (d: Detail) => void>();
      const rpc = {
        listClones: jest.fn(async () => [
          clone({ slug: 'alpha', kind: 'skill' }),
          clone({ slug: 'beta', kind: 'skill' }),
        ]),
        getScorecards: jest.fn(async () => ({})),
        getClone: jest.fn(
          (slug: string) =>
            new Promise<Detail>((resolve) => resolvers.set(slug, resolve)),
        ),
        saveCloneBody: jest.fn(async () => saveResult({ slug: 'beta' })),
      };

      TestBed.configureTestingModule({
        imports: [SkillClonesViewComponent],
        providers: [
          { provide: SkillSynthesisRpcService, useValue: rpc },
          { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        ],
      });
      const fixture = TestBed.createComponent(SkillClonesViewComponent);
      fixture.detectChanges();

      const el = () => fixture.nativeElement as HTMLElement;
      const q = <T extends HTMLElement>(testId: string): T | null =>
        el().querySelector<T>(`[data-testid="${testId}"]`);
      const settle = async (): Promise<void> => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();
      };
      const openCard = (index: number): void => {
        const rows = el().querySelectorAll('[data-testid="clones-row"]');
        (rows[index].querySelector('[role="button"]') as HTMLElement).click();
        fixture.detectChanges();
      };
      const resolveDetail = async (slug: string, body: string) => {
        resolvers.get(slug)?.({
          clone: clone({ slug, kind: 'skill' }),
          body,
          history: [],
        });
        await settle();
      };

      return { fixture, el, q, settle, openCard, resolveDetail, rpc };
    }

    it('withholds Edit until the SELECTED entry’s own body has landed', async () => {
      const { q, el, settle, openCard, resolveDetail, fixture } =
        realStateSetup();
      await settle();

      openCard(0);
      await resolveDetail('alpha', '# alpha body');
      expect(q('drawer-body-edit-btn')).toBeTruthy();

      openCard(1);

      // Alpha's body must not be reachable under beta's heading.
      expect(q('drawer-body-loading')).toBeTruthy();
      const staleEdit = q<HTMLButtonElement>('drawer-body-edit-btn');
      expect(staleEdit).toBeNull();

      // Belt and braces: even a click on a stale affordance must not seed.
      staleEdit?.click();
      fixture.detectChanges();
      expect(
        el().querySelector<HTMLTextAreaElement>(
          '[data-testid="clone-body-editor-textarea"]',
        ),
      ).toBeNull();

      // Beta's own body restores the affordance, seeded with BETA's text.
      await resolveDetail('beta', '# beta body');
      expect(q('drawer-body-edit-btn')).toBeTruthy();
      (
        q<HTMLButtonElement>('drawer-body-edit-btn') as HTMLButtonElement
      ).click();
      // `[ngModel]` writes to the DOM on the tick after the editor is created.
      await settle();
      expect(
        el().querySelector<HTMLTextAreaElement>(
          '[data-testid="clone-body-editor-textarea"]',
        )?.value,
      ).toBe('# beta body');
    });
  });

  it('surfaces a save failure as a toast without refreshing the list', async () => {
    const { click, state, fixture, el, q, settle } =
      openDrawerWithBody('# body');
    state.saveCloneBody.mockRejectedValueOnce(new Error('save refused'));

    await click('drawer-body-edit-btn');
    const textarea = el().querySelector(
      '[data-testid="clone-body-editor-textarea"]',
    ) as HTMLTextAreaElement;
    textarea.value = '# edited';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      q<HTMLButtonElement>('clone-body-editor-save') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await settle();

    expect(q('clones-toast')?.textContent).toContain('save refused');
    expect(state.refreshClones).toHaveBeenCalledTimes(1);
    // The draft survives a failure: edit mode is still up (R3.3 failure path).
    expect(q('clone-body-editor')).toBeTruthy();
  });
});
