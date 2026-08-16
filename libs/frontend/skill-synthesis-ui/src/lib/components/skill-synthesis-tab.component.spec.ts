import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  EligibilityHistogramDto,
  SkillSuggestionSummary,
  SkillSynthesisCandidateSummary,
  SkillSynthesisEventWire,
  SkillSynthesisInvocationEntry,
  SkillSynthesisPromoteBulkResult,
  SkillSynthesisPromoteResult,
  SkillSynthesisRejectByPatternResult,
  SkillSynthesisStatsResult,
  SkillSynthesisDrainRun,
  SkillSynthesisQueueItem,
  SkillSynthesisStageSpend,
  SkillDigestItem,
} from '@ptah-extension/shared';

import { SkillSynthesisTabComponent } from './skill-synthesis-tab.component';
import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
import type { RefreshDigestOptions } from '../services/skill-synthesis-state.service';
import { SkillDiagnosticsStateService } from '../services/skill-diagnostics-state.service';

interface DiagnosticsStub {
  readonly lastAnalyzeRunAt: ReturnType<typeof signal<number | null>>;
  readonly lastCuratorPassAt: ReturnType<typeof signal<number | null>>;
  readonly eligibilityHistogram: ReturnType<
    typeof signal<EligibilityHistogramDto>
  >;
  readonly recentEvents: ReturnType<
    typeof signal<readonly SkillSynthesisEventWire[]>
  >;
  readonly triggers: ReturnType<typeof signal<Record<string, unknown>>>;
  readonly byStatus: ReturnType<
    typeof signal<{
      totalCandidates: number;
      totalPromoted: number;
      totalRejected: number;
      activeSkills: number;
      totalInvocations: number;
    }>
  >;
  readonly loading: ReturnType<typeof signal<boolean>>;
  readonly error: ReturnType<typeof signal<string | null>>;
  readonly sessionsAnalyzedToday: ReturnType<typeof signal<number>>;
  readonly hasActiveSession: ReturnType<typeof signal<boolean>>;
  readonly refresh: jest.Mock<Promise<void>, []>;
  readonly startPolling: jest.Mock<void, []>;
  readonly stopPolling: jest.Mock<void, []>;
  readonly analyzeNow: jest.Mock<Promise<void>, []>;
  readonly setTriggers: jest.Mock<Promise<void>, [Record<string, unknown>]>;
}

function makeDiagnosticsStub(
  overrides: Partial<{
    lastAnalyzeRunAt: number | null;
    eligibilityHistogram: EligibilityHistogramDto;
    recentEvents: readonly SkillSynthesisEventWire[];
  }> = {},
): DiagnosticsStub {
  return {
    lastAnalyzeRunAt: signal<number | null>(overrides.lastAnalyzeRunAt ?? null),
    lastCuratorPassAt: signal<number | null>(null),
    eligibilityHistogram: signal<EligibilityHistogramDto>(
      overrides.eligibilityHistogram ?? {
        prefilterTooThin: 0,
        prefilterRejected: 0,
        accepted: 0,
      },
    ),
    recentEvents: signal<readonly SkillSynthesisEventWire[]>(
      overrides.recentEvents ?? [],
    ),
    triggers: signal<Record<string, unknown>>({
      sessionEnd: true,
      idleMs: 600_000,
      bootScan: true,
    }),
    byStatus: signal({
      totalCandidates: 0,
      totalPromoted: 0,
      totalRejected: 0,
      activeSkills: 0,
      totalInvocations: 0,
    }),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    sessionsAnalyzedToday: signal<number>(0),
    hasActiveSession: signal<boolean>(false),
    refresh: jest.fn(async () => undefined),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    analyzeNow: jest.fn(async () => undefined),
    setTriggers: jest.fn(async () => undefined),
  };
}

function openActivity(
  fixture: ReturnType<typeof TestBed.createComponent>,
): void {
  const root = fixture.nativeElement as HTMLElement;
  const subViewNav = root.querySelector('[aria-label="Skills views"]');
  const tabs = subViewNav?.querySelectorAll(
    '[role="tab"]',
  ) as NodeListOf<HTMLButtonElement>;
  const activity = Array.from(tabs).find(
    (t) => t.textContent?.trim() === 'Activity',
  );
  activity?.click();
  fixture.detectChanges();
}

function openSessions(
  fixture: ReturnType<typeof TestBed.createComponent>,
): void {
  const root = fixture.nativeElement as HTMLElement;
  const subViewNav = root.querySelector('[aria-label="Skills views"]');
  const tabs = subViewNav?.querySelectorAll(
    '[role="tab"]',
  ) as NodeListOf<HTMLButtonElement>;
  const sessions = Array.from(tabs).find(
    (t) => t.textContent?.trim() === 'Sessions',
  );
  sessions?.click();
  fixture.detectChanges();
}

const tabManagerStub: Pick<TabManagerService, 'activeTab'> = {
  activeTab: signal(null) as unknown as TabManagerService['activeTab'],
};

function vscodeServiceStub(isElectron: boolean): Partial<VSCodeService> {
  return {
    config: signal({ isElectron }),
  } as unknown as Partial<VSCodeService>;
}

interface StubState {
  readonly candidates: ReturnType<
    typeof signal<SkillSynthesisCandidateSummary[]>
  >;
  readonly invocations: ReturnType<
    typeof signal<SkillSynthesisInvocationEntry[]>
  >;
  readonly stats: ReturnType<typeof signal<SkillSynthesisStatsResult | null>>;
  readonly statusFilter: ReturnType<
    typeof signal<'all' | 'pending' | 'promoted' | 'rejected'>
  >;
  readonly selectedCandidateId: ReturnType<typeof signal<string | null>>;
  readonly selectedCandidate: ReturnType<
    typeof signal<SkillSynthesisCandidateSummary | null>
  >;
  readonly loading: ReturnType<typeof signal<boolean>>;
  readonly error: ReturnType<typeof signal<string | null>>;
  readonly suggestions: ReturnType<typeof signal<SkillSuggestionSummary[]>>;
  readonly suggestionsLoading: ReturnType<typeof signal<boolean>>;
  readonly pendingSuggestionCount: ReturnType<typeof computed<number>>;
  readonly refreshCandidates: jest.Mock<Promise<void>, []>;
  readonly refreshSuggestions: jest.Mock<Promise<void>, []>;
  readonly loadStats: jest.Mock<Promise<void>, []>;
  readonly setStatusFilter: jest.Mock<
    Promise<void>,
    ['all' | 'pending' | 'promoted' | 'rejected']
  >;
  readonly selectCandidate: jest.Mock<Promise<void>, [string | null]>;
  readonly promote: jest.Mock<
    Promise<SkillSynthesisPromoteResult | null>,
    [string, string | undefined]
  >;
  readonly reject: jest.Mock<Promise<void>, [string, string | undefined]>;
  readonly rejectBulk: jest.Mock<
    Promise<number>,
    [string[], string | undefined]
  >;
  readonly promoteBulk: jest.Mock<
    Promise<SkillSynthesisPromoteBulkResult | null>,
    [string[]]
  >;
  readonly rejectByPattern: jest.Mock<
    Promise<SkillSynthesisRejectByPatternResult | null>,
    [string, string | undefined]
  >;
  readonly specs: ReturnType<typeof signal<unknown[]>>;
  readonly specsLoading: ReturnType<typeof signal<boolean>>;
  readonly staleSpecCount: ReturnType<typeof computed<number>>;
  readonly refreshSpecs: jest.Mock<Promise<void>, []>;
  readonly harvestSpecs: jest.Mock<Promise<void>, []>;
  readonly clearStaleSpecs: jest.Mock<Promise<number>, [unknown]>;
  readonly candidateDetail: ReturnType<typeof signal<unknown>>;
  readonly candidateDetailLoading: ReturnType<typeof signal<boolean>>;
  readonly loadCandidateDetail: jest.Mock<Promise<void>, [string | null]>;
  readonly drainRuns: ReturnType<typeof signal<SkillSynthesisDrainRun[]>>;
  readonly queueItems: ReturnType<typeof signal<SkillSynthesisQueueItem[]>>;
  readonly stageSpend: ReturnType<typeof signal<SkillSynthesisStageSpend[]>>;
  readonly queueLoading: ReturnType<typeof signal<boolean>>;
  readonly queuedAttemptTotal: ReturnType<typeof computed<number>>;
  readonly refreshQueue: jest.Mock<Promise<void>, []>;
  readonly digestItems: ReturnType<typeof signal<SkillDigestItem[]>>;
  readonly digestLoading: ReturnType<typeof signal<boolean>>;
  /**
   * Takes the options bag so B4.8's `allowRewrite:false` is assertable at the
   * init seam. A bare `[]` here would make `toHaveBeenCalledWith({…})` a type
   * error and push the money rule out of this spec's reach.
   */
  readonly refreshDigest: jest.Mock<Promise<void>, [RefreshDigestOptions?]>;
}

function makeStub(
  candidatesValue: SkillSynthesisCandidateSummary[] = [],
  queueValue: {
    items?: SkillSynthesisQueueItem[];
    runs?: SkillSynthesisDrainRun[];
    stageSpend?: SkillSynthesisStageSpend[];
    digest?: SkillDigestItem[];
  } = {},
): StubState {
  const candidates = signal<SkillSynthesisCandidateSummary[]>(candidatesValue);
  const suggestions = signal<SkillSuggestionSummary[]>([]);
  const queueItems = signal<SkillSynthesisQueueItem[]>(queueValue.items ?? []);
  return {
    drainRuns: signal<SkillSynthesisDrainRun[]>(queueValue.runs ?? []),
    queueItems,
    stageSpend: signal<SkillSynthesisStageSpend[]>(queueValue.stageSpend ?? []),
    queueLoading: signal<boolean>(false),
    queuedAttemptTotal: computed(() =>
      queueItems().reduce((sum, item) => sum + item.attemptCount, 0),
    ),
    refreshQueue: jest.fn(async () => undefined),
    digestItems: signal<SkillDigestItem[]>(queueValue.digest ?? []),
    digestLoading: signal<boolean>(false),
    refreshDigest: jest.fn(
      async (_options?: RefreshDigestOptions) => undefined,
    ),
    candidates,
    suggestions,
    suggestionsLoading: signal<boolean>(false),
    pendingSuggestionCount: computed(
      () => suggestions().filter((s) => s.status === 'pending').length,
    ),
    refreshSuggestions: jest.fn(async () => undefined),
    invocations: signal<SkillSynthesisInvocationEntry[]>([]),
    stats: signal<SkillSynthesisStatsResult | null>({
      totalCandidates: candidatesValue.length,
      totalPromoted: 0,
      totalRejected: 0,
      totalInvocations: 0,
      activeSkills: 0,
    }),
    statusFilter: signal<'all' | 'pending' | 'promoted' | 'rejected'>('all'),
    selectedCandidateId: signal<string | null>(null),
    selectedCandidate: signal<SkillSynthesisCandidateSummary | null>(null),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    refreshCandidates: jest.fn(async () => undefined),
    loadStats: jest.fn(async () => undefined),
    setStatusFilter: jest.fn(async () => undefined),
    selectCandidate: jest.fn(async () => undefined),
    promote: jest.fn(async () => null),
    reject: jest.fn(async () => undefined),
    rejectBulk: jest.fn(async () => 0),
    promoteBulk: jest.fn(async () => null),
    rejectByPattern: jest.fn(async () => null),
    specs: signal<unknown[]>([]),
    specsLoading: signal<boolean>(false),
    staleSpecCount: computed(() => 0),
    refreshSpecs: jest.fn(async () => undefined),
    harvestSpecs: jest.fn(async () => undefined),
    clearStaleSpecs: jest.fn(async () => 0),
    candidateDetail: signal<unknown>(null),
    candidateDetailLoading: signal<boolean>(false),
    loadCandidateDetail: jest.fn(async () => undefined),
  };
}

describe('SkillSynthesisTabComponent', () => {
  it('renders the four status filter chips and refreshes candidates on init', () => {
    const stub = makeStub();
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    const subViewNav = root.querySelector('[aria-label="Skills views"]');
    const subViewTabs = subViewNav?.querySelectorAll(
      '[role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(Array.from(subViewTabs).map((t) => t.textContent?.trim())).toEqual([
      'Recommended',
      'Sessions',
      'Library',
      'Activity',
      'Settings',
    ]);

    openSessions(fixture);
    const filterNav = root.querySelector('nav[aria-label="Status filter"]');
    const filterTabs = filterNav?.querySelectorAll(
      '[role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    const labels = Array.from(filterTabs).map((t) => t.textContent?.trim());
    expect(labels).toEqual(['Pending', 'Promoted', 'Rejected', 'All']);

    expect(stub.refreshCandidates).toHaveBeenCalledTimes(1);
    expect(stub.loadStats).toHaveBeenCalledTimes(1);
    expect(diag.refresh).toHaveBeenCalledTimes(1);
    expect(stub.refreshQueue).toHaveBeenCalledTimes(1);
  });

  it('feeds drain runs and queue rows from state into the pipeline strip', () => {
    const stub = makeStub([], {
      runs: [
        {
          id: 'run-a',
          jobId: '@ptah/skills-drain-nightly',
          tier: 'nightly',
          scheduledFor: 1_700_000_000_000,
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_004_000,
          status: 'succeeded',
          durationMs: 4_000,
          summary: 'drained 3 items',
        },
      ],
      items: [
        {
          id: 'q-1',
          sessionId: 's-1',
          workspaceRoot: '/w',
          stage: 'archaeology',
          status: 'queued',
          attemptCount: 2,
          enqueuedAt: 1_700_000_000_000,
          notBefore: 0,
          finishedAt: null,
          lane: null,
          reason: null,
          candidateId: null,
        },
      ],
    });
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    openActivity(fixture);

    const root = fixture.nativeElement as HTMLElement;
    const runs = root.querySelectorAll('[data-testid="skills-drain-run"]');
    expect(runs.length).toBe(1);
    expect(runs[0].textContent).toContain('succeeded');
    expect(runs[0].textContent).toContain('4.0s');

    const stages = root.querySelectorAll('[data-testid="skills-stage-cost"]');
    expect(stages.length).toBe(1);
    expect(stages[0].textContent).toContain('archaeology');
    expect(stages[0].textContent).toContain('2 dispatches');
  });

  /**
   * B4.5.1 — the digest is a sibling of the pipeline strip on Activity, and it
   * is fetched at init like the queue is. The `null` win rate is carried
   * through the whole tab wiring here, not just unit-tested on the panel, so a
   * host that coalesced the field on the way down would still be caught.
   */
  it('feeds the weekly digest from state into the Activity panel', () => {
    const stub = makeStub([], {
      digest: [
        {
          kind: 'missed-trigger',
          title: 'compose skill never fired',
          rationale: '3 sessions matched and none invoked it.',
          score: 0.82,
          evidence: {
            sessionIds: ['sess-1', 'sess-2'],
            counts: { missedSessions: 3 },
            winRate: null,
          },
        },
        {
          kind: 'win-rate',
          title: 'lint-fixer loses every run',
          rationale: 'Measured over 6 invocations.',
          score: 0.44,
          evidence: {
            sessionIds: ['sess-3'],
            counts: { invocations: 6 },
            winRate: 0,
          },
        },
      ],
    });
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    expect(stub.refreshDigest).toHaveBeenCalledTimes(1);
    // B4.8 — OPENING A TAB IS NOT A REQUEST TO SPEND. The sweep behind this
    // call can author its description rewrite on an LLM lane, and nothing
    // budgets that: the `digest` queue stage has no handler and no producer, so
    // the drain's daily token gate never sees a digest item. `ngOnInit` is an
    // automatic path, so it reads.
    expect(stub.refreshDigest).toHaveBeenCalledWith({ allowRewrite: false });

    openActivity(fixture);

    const root = fixture.nativeElement as HTMLElement;
    const items = root.querySelectorAll('[data-testid="skills-digest-item"]');
    expect(items.length).toBe(2);

    const winRates = Array.from(items).map((n) =>
      n
        .querySelector('[data-testid="skills-digest-win-rate"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    );
    // `null` and a measured `0` must stay distinguishable end to end.
    expect(winRates).toEqual(['win rate not measured', 'win rate 0%']);
  });

  it('switches to the Activity sub-view when its tab is clicked', () => {
    const stub = makeStub();
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="skills-pipeline-status"]'),
    ).toBeNull();

    openActivity(fixture);

    expect(
      root.querySelector('[data-testid="skills-pipeline-status"]'),
    ).toBeTruthy();
  });

  it('renders the pipeline status strip from diagnostics state', () => {
    const stub = makeStub();
    const diag = makeDiagnosticsStub({
      lastAnalyzeRunAt: Date.now() - 2 * 60_000,
      eligibilityHistogram: {
        prefilterTooThin: 2,
        prefilterRejected: 2,
        accepted: 3,
      },
      recentEvents: [
        { kind: 'ineligible', timestamp: Date.now(), sessionId: 'a' },
      ],
    });

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    openActivity(fixture);

    const root = fixture.nativeElement as HTMLElement;
    const strip = root.querySelector('[data-testid="skills-pipeline-status"]');
    expect(strip).toBeTruthy();
    const text = strip?.textContent ?? '';
    expect(text).toContain('Last analysis:');
    expect(text).toContain('2m ago');
    expect(text).toContain('3');
    expect(text).toContain('accepted');
    expect(text).toContain('4');
    expect(text).toContain('ineligible');

    expect(
      root.querySelector('[data-testid="skills-pipeline-reason"]'),
    ).toBeTruthy();
  });

  it('shows "never" in the pipeline strip when no analysis has run', () => {
    const stub = makeStub();
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    openActivity(fixture);

    const strip = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="skills-pipeline-status"]',
    );
    expect(strip?.textContent ?? '').toContain('never');
  });

  it('renders the explanatory empty state when no candidates match', () => {
    const stub = makeStub();
    stub.stats.set(null);
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    openSessions(fixture);

    const empty = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="skills-empty-state"]',
    );
    expect(empty).toBeTruthy();
    const text = empty?.textContent ?? '';
    expect(text).toContain('No candidates for this filter.');
    expect(text).toContain('5 turns');
    expect(text).toContain('promoted');
  });

  it('renders candidate rows with promote/reject buttons', () => {
    const stub = makeStub([
      {
        id: 'cand-1',
        name: 'refactor-tests',
        description: 'Refactor jest configs into a shared preset',
        status: 'candidate',
        successCount: 3,
        failureCount: 1,
        createdAt: 1_700_000_000_000,
        promotedAt: null,
        rejectedAt: null,
        rejectedReason: null,
        pinned: false,
        displayName: 'Share one Jest preset across libs',
        judgeScore: null,
        judgeStatus: null,
        judgeReason: null,
        judgeCriteria: null,
        replayConfidence: null,
        triggerScore: null,
        judgePanelRationales: null,
      },
    ]);
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    openSessions(fixture);

    const text = fixture.nativeElement.textContent ?? '';
    // The TITLE, not the `name` slug — the slug is a prompt fragment and is
    // never rendered (P1-10).
    expect(text).toContain('Share one Jest preset across libs');
    expect(text).not.toContain('refactor-tests');
    expect(text).toContain('Promote');
    expect(text).toContain('Reject');
  });

  it('shows desktop-only placeholder when not on Electron and skips RPC init', () => {
    const stub = makeStub();
    const diag = makeDiagnosticsStub();

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: SkillDiagnosticsStateService, useValue: diag },
        { provide: VSCodeService, useValue: vscodeServiceStub(false) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ptah desktop app');

    expect(stub.refreshCandidates).not.toHaveBeenCalled();
    expect(stub.loadStats).not.toHaveBeenCalled();
    expect(stub.refreshQueue).not.toHaveBeenCalled();

    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="tab"]',
    );
    expect(tabs.length).toBe(0);
  });
});
