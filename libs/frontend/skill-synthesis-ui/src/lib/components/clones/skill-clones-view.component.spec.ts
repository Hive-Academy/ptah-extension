import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  AgentScorecard,
  CloneSummary,
  SkillCloneHistoryEntry,
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
    invocationCount: 4,
    successRate: 0.75,
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
  readonly refreshClones: jest.Mock<Promise<void>, []>;
  readonly loadDetail: jest.Mock<Promise<void>, [string, CloneSummary['kind']]>;
  readonly clearDetail: jest.Mock<void, []>;
  readonly loadScorecardDetail: jest.Mock<Promise<void>, [string, number?]>;
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

function makeRpcStub(): jest.Mocked<
  Pick<
    SkillSynthesisRpcService,
    | 'enhanceNow'
    | 'revertEnhancement'
    | 'rebaseClone'
    | 'keepClone'
    | 'getClone'
    | 'listClones'
  >
> {
  return {
    enhanceNow: jest.fn(async () => ({
      changed: true,
      slug: 'deep-research',
      kind: 'skill',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      historyTs: '20260101T000000',
      skipReason: null,
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
    getClone: jest.fn(async () => ({
      clone: clone(),
      body: '# body',
      history: [] as SkillCloneHistoryEntry[],
    })),
    listClones: jest.fn(async () => []),
  } as unknown as jest.Mocked<
    Pick<
      SkillSynthesisRpcService,
      | 'enhanceNow'
      | 'revertEnhancement'
      | 'rebaseClone'
      | 'keepClone'
      | 'getClone'
      | 'listClones'
    >
  >;
}

function setup(opts: {
  isElectron?: boolean;
  state?: StateStub;
  rpc?: ReturnType<typeof makeRpcStub>;
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
  return { fixture, state, rpc };
}

describe('SkillClonesViewComponent', () => {
  it('shows the desktop-only notice and does not refresh in VS Code', () => {
    const { fixture, state } = setup({ isElectron: false });
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="clones-desktop-notice"]'),
    ).toBeTruthy();
    expect(el.querySelector('[data-testid="clones-view"]')).toBeNull();
    expect(state.refreshClones).not.toHaveBeenCalled();
  });

  it('refreshes clones on init in Electron and renders rows', () => {
    const state = makeStateStub([clone(), clone({ slug: 'caveman' })]);
    const { fixture } = setup({ isElectron: true, state });
    expect(state.refreshClones).toHaveBeenCalledTimes(1);
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="clones-row"]',
    );
    expect(rows.length).toBe(2);
  });

  it('renders the diverged status for diverged rows', () => {
    const state = makeStateStub([
      clone({ cloneStatus: 'diverged', diverged: true }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const status = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="clones-status-badge"]',
    ) as HTMLElement;
    expect(status.textContent?.trim()).toBe('diverged');
    const dot = status.previousElementSibling as HTMLElement | null;
    expect(dot?.className).toContain('bg-warning');
  });

  it('shows Rebase/Keep only for diverged rows, not for normal rows', () => {
    const normal = setup({
      isElectron: true,
      state: makeStateStub([clone()]),
    });
    expect(
      (normal.fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-rebase-btn"]',
      ),
    ).toBeNull();

    TestBed.resetTestingModule();

    const diverged = setup({
      isElectron: true,
      state: makeStateStub([clone({ diverged: true })]),
    });
    const el = diverged.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="clones-rebase-btn"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="clones-keep-btn"]')).toBeTruthy();
  });

  it('formats success rate as a percentage', () => {
    const state = makeStateStub([clone({ successRate: 0.5 })]);
    const { fixture } = setup({ isElectron: true, state });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('50%');
  });

  it('calls enhanceNow with the row kind and refreshes', async () => {
    const state = makeStateStub([clone()]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-enhance-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.enhanceNow).toHaveBeenCalledWith('skill', 'deep-research');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('calls enhanceNow with the agent kind for an agent clone', async () => {
    const state = makeStateStub([clone({ kind: 'agent', slug: 'planner' })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-enhance-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.enhanceNow).toHaveBeenCalledWith('agent', 'planner');
  });

  it('calls enhanceNow with the command kind for a command clone', async () => {
    const state = makeStateStub([clone({ kind: 'command', slug: 'ship' })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-enhance-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.enhanceNow).toHaveBeenCalledWith('command', 'ship');
  });

  it('opens the revert modal and loads detail', () => {
    const state = makeStateStub([clone()]);
    const { fixture } = setup({ isElectron: true, state });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(state.loadDetail).toHaveBeenCalledWith('deep-research', 'skill');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-modal"]',
      ),
    ).toBeTruthy();
  });

  it('reverts to a chosen history snapshot', async () => {
    const state = makeStateStub([clone()]);
    state.detail.set({
      clone: clone(),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    });
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-history-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.revertEnhancement).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      '20260101T000000',
    );
  });

  it('reverts an agent clone forwarding the agent kind', async () => {
    const state = makeStateStub([clone({ kind: 'agent', slug: 'planner' })]);
    state.detail.set({
      clone: clone({ kind: 'agent', slug: 'planner' }),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    });
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-history-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.revertEnhancement).toHaveBeenCalledWith(
      'agent',
      'planner',
      '20260101T000000',
    );
  });

  it('calls rebaseClone for a diverged row', async () => {
    const state = makeStateStub([clone({ diverged: true })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-rebase-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.rebaseClone).toHaveBeenCalledWith('skill', 'deep-research');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('calls keepClone for a diverged row', async () => {
    const state = makeStateStub([clone({ diverged: true })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-keep-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.keepClone).toHaveBeenCalledWith('skill', 'deep-research');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  // enhanceHint display — added for feature coverage
  it('shows N/M runs hint when invocationCount is below enhanceMinInvocations', () => {
    // clone() defaults: invocationCount=4, enhanceMinInvocations=5
    const state = makeStateStub([
      clone({ invocationCount: 4, enhanceMinInvocations: 5 }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const hint = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="clones-enhance-hint"]',
    ) as HTMLElement | null;
    expect(hint).not.toBeNull();
    expect(hint?.textContent?.trim()).toBe('4/5 runs');
  });

  it('shows cooldown hint when invocationCount >= threshold but cooldown is active', () => {
    const futureMs = Date.now() + 2 * 60 * 60 * 1000; // 2h from now
    const state = makeStateStub([
      clone({
        invocationCount: 10,
        enhanceMinInvocations: 5,
        enhanceCooldownUntil: futureMs,
      }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const hint = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="clones-enhance-hint"]',
    ) as HTMLElement | null;
    expect(hint?.textContent?.trim()).toMatch(/^cooldown \d+h$/);
  });

  it('shows "ready" hint when invocationCount >= threshold and cooldown has expired', () => {
    const pastMs = Date.now() - 1000; // already expired
    const state = makeStateStub([
      clone({
        invocationCount: 10,
        enhanceMinInvocations: 5,
        enhanceCooldownUntil: pastMs,
      }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const hint = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="clones-enhance-hint"]',
    ) as HTMLElement | null;
    expect(hint?.textContent?.trim()).toBe('ready');
  });

  it('shows "ready" hint when invocationCount >= threshold and enhanceCooldownUntil is null', () => {
    const state = makeStateStub([
      clone({
        invocationCount: 10,
        enhanceMinInvocations: 5,
        enhanceCooldownUntil: null,
      }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const hint = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="clones-enhance-hint"]',
    ) as HTMLElement | null;
    expect(hint?.textContent?.trim()).toBe('ready');
  });

  it('shows "—" for success rate when invocationCount is 0', () => {
    const state = makeStateStub([
      clone({ invocationCount: 0, successRate: 0 }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('—');
  });

  it('shows percentage success rate when invocationCount > 0', () => {
    const state = makeStateStub([
      clone({ invocationCount: 10, successRate: 0.8 }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('80%');
  });

  // ── Scorecard rendering (Batch 5, R6/R7) ──────────────────────────────

  it('renders a scorecard badge only for agent-kind rows', () => {
    const state = makeStateStub([
      clone({ slug: 'planner', kind: 'agent' }),
      clone({ slug: 'deep-research', kind: 'skill' }),
    ]);
    state.scorecards.set({ planner: scorecard() });
    const { fixture } = setup({ isElectron: true, state });
    const badges = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="scorecard-badge"]',
    );
    expect(badges.length).toBe(1);
  });

  it('shows an explicit "no data yet" state (never zeros) for an agent with no scorecard', () => {
    const state = makeStateStub([clone({ slug: 'planner', kind: 'agent' })]);
    // No entry in the scorecards map → scorecardFor() returns null.
    const { fixture } = setup({ isElectron: true, state });
    const success = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="scorecard-success"]',
    ) as HTMLElement | null;
    expect(success?.textContent?.trim()).toBe('no data yet');
    const tokens = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="scorecard-tokens"]',
    ) as HTMLElement | null;
    expect(tokens?.textContent).toContain('no data yet');
  });

  it('renders usage-only metrics with no graded verdicts (spec-less runtime)', () => {
    const state = makeStateStub([clone({ slug: 'planner', kind: 'agent' })]);
    state.scorecards.set({
      planner: scorecard({
        gradedCount: 0,
        gradedSuccessRate: null,
        recentVerdicts: [],
        avgInputTokens: 120,
        avgOutputTokens: 30,
        avgCostUsd: null,
      }),
    });
    const { fixture } = setup({ isElectron: true, state });
    const el = fixture.nativeElement as HTMLElement;
    // Success degrades to "no data yet"; no verdict dots section.
    expect(
      el
        .querySelector('[data-testid="scorecard-success"]')
        ?.textContent?.trim(),
    ).toBe('no data yet');
    expect(
      el.querySelector('[data-testid="scorecard-verdict-dots"]'),
    ).toBeNull();
    // Tokens still show (usage-only); cost degrades independently.
    expect(
      el.querySelector('[data-testid="scorecard-tokens"]')?.textContent,
    ).toContain('tok');
    expect(
      el.querySelector('[data-testid="scorecard-cost"]')?.textContent,
    ).toContain('no data yet');
  });

  it('expands an agent card and lazily loads its detail once', async () => {
    const state = makeStateStub([clone({ slug: 'planner', kind: 'agent' })]);
    state.scorecards.set({ planner: scorecard() });
    const { fixture } = setup({ isElectron: true, state });
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="scorecard-detail-panel"]'),
    ).toBeNull();
    (
      el.querySelector('[data-testid="scorecard-expand"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(state.loadScorecardDetail).toHaveBeenCalledWith('planner');
    expect(
      el.querySelector('[data-testid="scorecard-detail-panel"]'),
    ).toBeTruthy();
  });

  it('explains how data accrues when the expanded detail is empty (R7.3)', () => {
    const state = makeStateStub([clone({ slug: 'planner', kind: 'agent' })]);
    state.scorecards.set({ planner: scorecard() });
    state.scorecardDetails.set({
      planner: { slug: 'planner', rows: [], findingsExcerpt: null },
    });
    const { fixture } = setup({ isElectron: true, state });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="scorecard-expand"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const empty = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="scorecard-detail-empty"]',
    );
    expect(empty?.textContent).toContain('.ptah/specs');
  });

  it('marks heuristically-attributed detail rows distinctly (R7.2)', () => {
    const state = makeStateStub([clone({ slug: 'planner', kind: 'agent' })]);
    state.scorecards.set({ planner: scorecard() });
    state.scorecardDetails.set({
      planner: {
        slug: 'planner',
        rows: [
          {
            taskId: 'TASK_2026_009',
            succeeded: true,
            exactAttribution: false,
            inputTokens: 80,
            outputTokens: 20,
            costUsd: 0.01,
            durationMs: 3000,
            invokedAt: 1,
            reconciledAt: 2,
          },
        ],
        findingsExcerpt: null,
      },
    });
    const { fixture } = setup({ isElectron: true, state });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="scorecard-expand"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="scorecard-heuristic-marker"]',
      ),
    ).toBeTruthy();
  });

  it('routes the findings excerpt through the markdown chokepoint (never raw innerHTML)', () => {
    const state = makeStateStub([clone({ slug: 'planner', kind: 'agent' })]);
    state.scorecards.set({ planner: scorecard() });
    state.scorecardDetails.set({
      planner: {
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
      },
    });
    const { fixture } = setup({ isElectron: true, state });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="scorecard-expand"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const findings = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="scorecard-findings"]',
    );
    expect(findings).toBeTruthy();
    // Rendered via <ptah-markdown-block>, not a raw innerHTML sink.
    expect(findings?.querySelector('ptah-markdown-block')).toBeTruthy();
  });
});
