import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  SkillSynthesisSettingsDto,
  SkillSynthesisSettingsWriteDto,
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
  SkillDiagnosticsResult,
} from '@ptah-extension/shared';

import {
  SkillSynthesisTabComponent,
  skillSettingsDtoToForm,
  skillSettingsFormToDto,
} from './skill-synthesis-tab.component';
import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
import type { RefreshDigestOptions } from '../services/skill-synthesis-state.service';
import { SkillDiagnosticsStateService } from '../services/skill-diagnostics-state.service';
import { SkillDiagnosticsRpcService } from '../services/skill-diagnostics-rpc.service';
import { SkillClonesStateService } from '../services/skill-clones-state.service';
import {
  SkillSynthesisRpcService,
  SkillsPausedError,
} from '../services/skill-synthesis-rpc.service';
import { SkillsPauseSwitchComponent } from './skills-pause-switch.component';
import { By } from '@angular/platform-browser';

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
  readonly pausedNotice: ReturnType<typeof signal<string | null>>;
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
    pausedNotice: signal<string | null>(null),
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
  readonly scopeFilter: ReturnType<typeof signal<'workspace' | 'all'>>;
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
  /** The Skills master switch; writable so a test can pause it. */
  readonly skillsEnabledCommitted: ReturnType<typeof signal<boolean | null>>;
  readonly skillsEnabled: ReturnType<typeof computed<boolean | null>>;
  readonly skillsPaused: ReturnType<typeof computed<boolean>>;
  readonly skillsSwitchSaving: ReturnType<typeof signal<boolean>>;
  readonly skillsSwitchError: ReturnType<typeof signal<string | null>>;
  readonly refreshSkillsEnabled: jest.Mock<Promise<void>, []>;
  readonly setSkillsEnabled: jest.Mock<Promise<void>, [boolean]>;
  readonly markSkillsPaused: jest.Mock<void, []>;
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
  const skillsEnabledCommitted = signal<boolean | null>(true);
  const skillsEnabled = computed(() => skillsEnabledCommitted());
  return {
    skillsEnabledCommitted,
    skillsEnabled,
    skillsPaused: computed(() => skillsEnabled() === false),
    skillsSwitchSaving: signal<boolean>(false),
    skillsSwitchError: signal<string | null>(null),
    refreshSkillsEnabled: jest.fn(async () => undefined),
    setSkillsEnabled: jest.fn(async (_enabled: boolean) => undefined),
    markSkillsPaused: jest.fn(() => skillsEnabledCommitted.set(false)),
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
    // Matches the real service's default — the NARROW scope, which is the
    // whole point of the control this stands in for.
    scopeFilter: signal<'workspace' | 'all'>('workspace'),
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

/**
 * SKILL_SETTINGS_MAPPERS round-trip.
 *
 * These two functions are the ONLY place the dotted wire keys and the nested
 * form paths meet, and TypeScript cannot police them: `skillSettingsFormToDto`
 * opens its return literal with `...(flat as unknown as
 * SkillSynthesisSettingsDto)`, and a spread typed as the full DTO satisfies
 * every required key. So a forgotten mapper line compiles clean, emits
 * `undefined` on the wire, passes the `.partial()` update schema, and reaches
 * `setConfiguration('ptah', 'skillSynthesis.drain.nightlyMaxItemsPerRun',
 * undefined)` — wiping a value the user set in `~/.ptah/settings.json`,
 * silently, on every Save. This spec is the only thing standing there.
 */
describe('skill settings mappers', () => {
  /**
   * Distinct, deliberately NON-default values for the three item caps (4 / 40 /
   * 400 are the shipped defaults) so a value crossing wires between the tiers
   * shows up as a mismatch instead of passing by accident.
   */
  const dto: SkillSynthesisSettingsDto = {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '.ptah/skills',
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinToolUses: 2,
    judgeEnabled: true,
    minJudgeScore: 6,
    judgeModel: 'inherit',
    judgeProvider: '',
    enhanceTimeoutMs: {
      value: 120000,
      default: 120000,
      min: 15000,
      max: 600000,
    },
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
    'drain.cronExpr': '*/15 * * * *',
    'drain.nightlyCronExpr': '0 3 * * *',
    'drain.weeklyCronExpr': '0 4 * * 0',
    'drain.maxItemsPerRun': 7,
    'drain.nightlyMaxItemsPerRun': 55,
    'drain.weeklyMaxItemsPerRun': 321,
    'drain.perWorkspaceBatch': 1,
    'drain.foregroundBackoffMs': 300_000,
    'drain.pauseOnBattery': true,
    'drain.maxAttempts': 5,
    'drain.staleClaimTtlMs': 900_000,
    'budget.maxTokensPerDay': 2_000_000,
    trayKeepalive: false,
  };

  /**
   * The REAL production path, and the only one that proves anything.
   *
   * `loadSettings` does `patchValue(skillSettingsDtoToForm(s))` and
   * `onSaveSettings` does `skillSettingsFormToDto(settingsForm.getRawValue())`.
   * The FORM in the middle is what makes a dropped mapper line fatal: it holds
   * only declared controls, so `patchValue` discards a key with no control and
   * `getRawValue()` never re-emits one.
   *
   * Chaining the two mappers directly instead would be a FALSE pin — verified,
   * not assumed: `skillSettingsDtoToForm` spreads `...dto`, leaving the dotted
   * keys in `flat`, which `skillSettingsFormToDto`'s own `...flat` re-emits. A
   * deleted mapper line still round-trips clean that way.
   */
  function saveThroughForm(): Partial<SkillSynthesisSettingsWriteDto> {
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: makeStub() },
        {
          provide: SkillDiagnosticsStateService,
          useValue: makeDiagnosticsStub(),
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });
    // No `detectChanges()`: this exercises the form, not the template, and
    // `ngOnInit` would fire a wall of RPC reads we do not need here.
    const form = TestBed.createComponent(SkillSynthesisTabComponent)
      .componentInstance.settingsForm;
    form.patchValue(skillSettingsDtoToForm(dto));
    return skillSettingsFormToDto(form.getRawValue());
  }

  it('round-trips all three per-tier item caps without crossing them', () => {
    const out = saveThroughForm();

    expect(out['drain.maxItemsPerRun']).toBe(7);
    expect(out['drain.nightlyMaxItemsPerRun']).toBe(55);
    expect(out['drain.weeklyMaxItemsPerRun']).toBe(321);
  });

  it('never emits undefined for a per-tier item cap', () => {
    const out = saveThroughForm();

    // `undefined` is the exact shape the laundering cast lets through, and it
    // is what would reach `setConfiguration('ptah', '…', undefined)` and erase
    // the user's `~/.ptah/settings.json` value on every Save. `toBeDefined()`
    // alone would also pass on a MISSING key, so assert presence separately.
    expect('drain.nightlyMaxItemsPerRun' in out).toBe(true);
    expect('drain.weeklyMaxItemsPerRun' in out).toBe(true);
    expect(out['drain.nightlyMaxItemsPerRun']).not.toBeUndefined();
    expect(out['drain.weeklyMaxItemsPerRun']).not.toBeUndefined();
  });

  it('lands both new caps on their own form controls', () => {
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: makeStub() },
        {
          provide: SkillDiagnosticsStateService,
          useValue: makeDiagnosticsStub(),
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });
    const form = TestBed.createComponent(SkillSynthesisTabComponent)
      .componentInstance.settingsForm;
    form.patchValue(skillSettingsDtoToForm(dto));

    // Pins the READ direction and the control's existence independently of the
    // write direction: a missing control makes the panel render a blank input.
    expect(form.get('drain.nightlyMaxItemsPerRun')?.value).toBe(55);
    expect(form.get('drain.weeklyMaxItemsPerRun')?.value).toBe(321);
  });

  it('blocks saving when either prefilter minimum is zero', async () => {
    const rpc = { updateSettings: jest.fn(async () => undefined) };
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: makeStub() },
        {
          provide: SkillDiagnosticsStateService,
          useValue: makeDiagnosticsStub(),
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
        { provide: SkillSynthesisRpcService, useValue: rpc },
      ],
    });
    const component = TestBed.createComponent(
      SkillSynthesisTabComponent,
    ).componentInstance;
    component.settingsForm.patchValue(skillSettingsDtoToForm(dto));
    component.settingsForm.patchValue({ prefilterMinEdits: 0 });

    expect(component.settingsForm.valid).toBe(false);
    await (
      component as unknown as { onSaveSettings(): Promise<void> }
    ).onSaveSettings();
    expect(rpc.updateSettings).not.toHaveBeenCalled();

    component.settingsForm.patchValue({
      prefilterMinEdits: 1,
      prefilterMinToolUses: 0,
    });
    expect(component.settingsForm.valid).toBe(false);
  });

  it('accepts one for both prefilter minimums', () => {
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: makeStub() },
        {
          provide: SkillDiagnosticsStateService,
          useValue: makeDiagnosticsStub(),
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
      ],
    });
    const form = TestBed.createComponent(SkillSynthesisTabComponent)
      .componentInstance.settingsForm;
    form.patchValue(skillSettingsDtoToForm(dto));
    form.patchValue({ prefilterMinEdits: 1, prefilterMinToolUses: 1 });

    expect(form.valid).toBe(true);
  });

  it('drops the nested drain / budget groups from the outgoing DTO', () => {
    const out = saveThroughForm();

    // Sending both shapes would offer the backend two keys for one setting.
    expect('drain' in out).toBe(false);
    expect('budget' in out).toBe(false);
  });

  it('round-trips form-owned settings and leaves Providers-only fields and the master switch untouched', () => {
    const {
      judgeModel,
      judgeProvider,
      enhanceTimeoutMs,
      enabled,
      ...formOwned
    } = dto;
    expect(judgeModel).toBeDefined();
    expect(enabled).toBe(true);
    expect(saveThroughForm()).toEqual(formOwned);
    expect(skillSettingsDtoToForm(dto)).toMatchObject({
      judgeProvider,
      enhanceTimeoutMs,
    });
  });

  it('never sends enabled on Save, so a stale form cannot undo the Skills switch', async () => {
    // The form was loaded while Skills was on; the user then paused Skills
    // with the header switch (or the tray). Save must not write `true` back.
    const rpc = { updateSettings: jest.fn(async () => undefined) };
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: makeStub() },
        {
          provide: SkillDiagnosticsStateService,
          useValue: makeDiagnosticsStub(),
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
        { provide: SkillSynthesisRpcService, useValue: rpc },
      ],
    });
    const component = TestBed.createComponent(
      SkillSynthesisTabComponent,
    ).componentInstance;
    component.settingsForm.patchValue(skillSettingsDtoToForm(dto));

    expect(component.settingsForm.get('enabled')).toBeNull();
    await (
      component as unknown as { onSaveSettings(): Promise<void> }
    ).onSaveSettings();

    expect(rpc.updateSettings).toHaveBeenCalledTimes(1);
    const payload = (rpc.updateSettings.mock.calls[0] as unknown[])[0];
    expect(payload).not.toHaveProperty('enabled');
  });
});

describe('SkillSynthesisTabComponent — diverged-clones deep link', () => {
  /** Stand-in for the Library's data layer; the tab only has to route to it. */
  function clonesStateStub() {
    return {
      clones: signal<unknown[]>([]),
      loading: signal<boolean>(false),
      error: signal<string | null>(null),
      detailLoading: signal<boolean>(false),
      detail: signal<unknown>(null),
      scorecards: signal<Record<string, unknown>>({}),
      scorecardDetails: signal<Record<string, unknown>>({}),
      scorecardDetailLoading: signal<string | null>(null),
      refreshClones: jest.fn(async () => undefined),
      loadDetail: jest.fn(async () => undefined),
      clearDetail: jest.fn(() => undefined),
      loadScorecardDetail: jest.fn(async () => undefined),
      saveCloneBody: jest.fn(async () => undefined),
    };
  }

  function mount(): { appState: AppStateManager } {
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: makeStub() },
        {
          provide: SkillDiagnosticsStateService,
          useValue: makeDiagnosticsStub(),
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
        { provide: SkillClonesStateService, useValue: clonesStateStub() },
        { provide: SkillSynthesisRpcService, useValue: {} },
      ],
    });
    return { appState: TestBed.inject(AppStateManager) };
  }

  function activeSubView(root: HTMLElement): string | undefined {
    const nav = root.querySelector('[aria-label="Skills views"]');
    const selected = nav?.querySelector('[role="tab"][aria-selected="true"]');
    return selected?.textContent?.trim();
  }

  it('lands on Library with the diverged filter applied when the flag is raised', () => {
    const { appState } = mount();
    appState.openSkillsDivergedClones();

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(activeSubView(root)).toBe('Library');
    expect(root.querySelector('ptah-skill-clones-view')).toBeTruthy();
    expect(
      root
        .querySelector('[data-testid="clones-diverged-filter"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('consumes the flag exactly once, so a second mount does not re-filter', () => {
    const { appState } = mount();
    appState.openSkillsDivergedClones();

    const first = TestBed.createComponent(SkillSynthesisTabComponent);
    first.detectChanges();
    expect(activeSubView(first.nativeElement as HTMLElement)).toBe('Library');

    const second = TestBed.createComponent(SkillSynthesisTabComponent);
    second.detectChanges();
    expect(activeSubView(second.nativeElement as HTMLElement)).toBe(
      'Recommended',
    );
  });

  /**
   * The tab stays mounted across deep links. A boolean flag already `true`
   * cannot express a SECOND request, so the Library kept whatever filter state
   * the user had left it in and the deep link silently did nothing.
   */
  it('re-applies the diverged filter on a SECOND deep link while still mounted', () => {
    const { appState } = mount();
    appState.openSkillsDivergedClones();

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const filter = (): HTMLButtonElement | null =>
      root.querySelector<HTMLButtonElement>(
        '[data-testid="clones-diverged-filter"]',
      );
    expect(filter()?.getAttribute('aria-pressed')).toBe('true');

    // The user widens the list back out by hand, WITHOUT leaving the Library.
    filter()?.click();
    fixture.detectChanges();
    expect(filter()?.getAttribute('aria-pressed')).toBe('false');

    appState.openSkillsDivergedClones();
    fixture.detectChanges();

    expect(activeSubView(root)).toBe('Library');
    expect(filter()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('stays on Recommended when no deep link asked for the Library', () => {
    mount();
    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    expect(activeSubView(fixture.nativeElement as HTMLElement)).toBe(
      'Recommended',
    );
  });
});

/**
 * Tab-level acceptance on the PRODUCTION feed path: tab -> real
 * `SkillDiagnosticsStateService` -> real activity feed -> real event feed.
 * Only the transport (`SkillDiagnosticsRpcService`) and the shell services
 * are stubbed, so ordering, de-duplication, grouping and row identity are the
 * shipped code's, not a stub's.
 */
describe('SkillSynthesisTabComponent — diagnostics on the production path', () => {
  const NOW = Date.now();

  function wireEvent(
    id: string,
    kind: SkillSynthesisEventWire['kind'],
    timestamp: number,
    sessionId: string,
  ): SkillSynthesisEventWire {
    return { id, kind, timestamp, sessionId };
  }

  function snapshot(
    recentEvents: readonly SkillSynthesisEventWire[],
    overrides: Partial<SkillDiagnosticsResult> = {},
  ): SkillDiagnosticsResult {
    return {
      lastAnalyzeRunAt: null,
      lastCuratorPassAt: null,
      totalCandidates: 0,
      totalPromoted: 0,
      totalRejected: 0,
      totalInvocations: 0,
      activeSkills: 0,
      totalMerged: 0,
      totalRetired: 0,
      totalDormant: 0,
      eligibilityHistogram: {
        prefilterTooThin: 0,
        prefilterRejected: 0,
        accepted: 0,
      },
      recentEvents,
      triggers: { idleMs: 600_000, bootScan: true },
      ...overrides,
    };
  }

  interface Mounted {
    readonly fixture: ComponentFixture<SkillSynthesisTabComponent>;
    readonly root: HTMLElement;
    readonly dss: SkillDiagnosticsStateService;
    /** Lets pending RPC promises settle, then re-renders. */
    readonly settle: () => Promise<void>;
  }

  function mount(result: SkillDiagnosticsResult): Mounted {
    const rpc = {
      diagnostics: jest.fn(async () => result),
      analyzeNow: jest.fn(async () => undefined),
      setTriggers: jest.fn(async () => ({ triggers: result.triggers })),
      getTriggers: jest.fn(async () => ({ triggers: result.triggers })),
    };
    const appState = {
      workspaceInfo: signal({ path: '/w', name: 'w', type: 'workspace' }),
      consumeSkillsDivergedRequest: () => false,
      requestSettingsTab: jest.fn(),
      setCurrentView: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: makeStub() },
        { provide: SkillDiagnosticsRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: appState },
        { provide: TabManagerService, useValue: tabManagerStub },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
      ],
    });
    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    const settle = async (): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
    };
    return {
      fixture,
      root: fixture.nativeElement as HTMLElement,
      dss: TestBed.inject(SkillDiagnosticsStateService),
      settle,
    };
  }

  function openSubView(
    fixture: ComponentFixture<SkillSynthesisTabComponent>,
    label: string,
  ): void {
    const nav = (fixture.nativeElement as HTMLElement).querySelector(
      '[aria-label="Skills views"]',
    );
    const tab = Array.from(
      nav?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    ).find((t) => t.textContent?.trim() === label);
    tab?.click();
    fixture.detectChanges();
  }

  function feedRowIds(root: HTMLElement): string[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        '[data-test="panel-events"] li[data-event-id]',
      ),
    ).map((li) => li.dataset['eventId'] ?? '');
  }

  it('renders the newest event first: oldest-first snapshot plus a live push', async () => {
    // Twelve distinct sessions, OLDEST first, as the base backend sent them.
    // More rows than the feed's limit (10), so showing the oldest window or
    // appending the live push at the tail both fail.
    const seeded = Array.from({ length: 12 }, (_, i) =>
      wireEvent(
        `evt-${String(i + 1).padStart(2, '0')}`,
        'analyze-run',
        NOW - (12 - i) * 60_000,
        `s-${i + 1}`,
      ),
    );
    const { fixture, root, dss, settle } = mount(snapshot(seeded));
    openSubView(fixture, 'Activity');
    await settle();

    expect(feedRowIds(root).slice(0, 2)).toEqual(['evt-12', 'evt-11']);

    dss.pushLiveEvent(wireEvent('evt-live', 'ineligible', NOW, 's-live'));
    fixture.detectChanges();

    const ids = feedRowIds(root);
    expect(ids[0]).toBe('evt-live');
    expect(ids[1]).toBe('evt-12');
    expect(ids).not.toContain('evt-01');
  });

  it('groups five repeated analyze-run events for one session into one row', async () => {
    const repeats = Array.from({ length: 5 }, (_, i) =>
      wireEvent(`run-${i + 1}`, 'analyze-run', NOW - (5 - i) * 1_000, 's-1'),
    );
    const { fixture, root, settle } = mount(snapshot(repeats));
    openSubView(fixture, 'Activity');
    await settle();

    const rows = root.querySelectorAll('[data-test="panel-events"] li');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-event-id')).toBe('run-5');
    expect(
      rows[0].querySelector('[data-test="event-count"]')?.textContent,
    ).toContain('5 events');
  });

  it('renders two same-millisecond events as two rows keyed by their real ids', async () => {
    const at = NOW - 5_000;
    const { fixture, root, settle } = mount(
      snapshot([
        wireEvent('01JSAMEMS0000000000000000A', 'ineligible', at, 's-a'),
        wireEvent('01JSAMEMS0000000000000000B', 'ineligible', at, 's-b'),
      ]),
    );
    openSubView(fixture, 'Activity');
    await settle();

    // Same ms: the greater ULID (recorded later) is newer and comes first.
    expect(feedRowIds(root)).toEqual([
      '01JSAMEMS0000000000000000B',
      '01JSAMEMS0000000000000000A',
    ]);
  });

  it('removes the accordion and keeps the triggers card on Settings only', async () => {
    const { fixture, root, settle } = mount(snapshot([]));
    openSubView(fixture, 'Activity');
    await settle();

    expect(root.querySelector('ptah-skill-diagnostics-accordion')).toBeNull();
    expect(root.querySelector('[data-test="panel-events"]')).toBeTruthy();
    expect(root.querySelector('[data-test="panel-triggers"]')).toBeNull();

    openSubView(fixture, 'Settings');
    await settle();

    expect(root.querySelector('[data-test="panel-triggers"]')).toBeTruthy();
    expect(root.querySelector('[data-test="panel-events"]')).toBeNull();
  });

  it('shows candidates by status on the status card and refreshes from its Refresh button', async () => {
    const { fixture, root, dss, settle } = mount(
      snapshot([], { totalCandidates: 7, totalPromoted: 3, totalRejected: 2 }),
    );
    openSubView(fixture, 'Activity');
    await settle();

    const byStatus = root.querySelector(
      '[data-testid="skills-pipeline-by-status"]',
    );
    const text = byStatus?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Candidates by status');
    expect(text).toContain('7 Candidates');
    expect(text).toContain('3 Promoted');
    expect(text).toContain('2 Rejected');

    const refreshSpy = jest.spyOn(dss, 'refresh');
    const button = root.querySelector<HTMLButtonElement>(
      '[data-testid="skills-pipeline-refresh"]',
    );
    expect(button?.textContent?.trim()).toBe('Refresh');
    button?.click();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('polls while Activity is shown and stops when the sub-view changes', async () => {
    const { fixture, dss, settle } = mount(snapshot([]));
    const start = jest.spyOn(dss, 'startPolling');
    const stop = jest.spyOn(dss, 'stopPolling');

    openSubView(fixture, 'Activity');
    await settle();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    openSubView(fixture, 'Settings');
    await settle();
    expect(stop).toHaveBeenCalledTimes(1);
    // The Settings triggers card must not start a poll of its own.
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('drives the Sessions ineligible hint from the newest event', async () => {
    // Oldest-first: the ineligible event is the OLDER one, so a reader taking
    // the oldest event as "latest" would wrongly show the hint.
    const { fixture, root, dss, settle } = mount(
      snapshot([
        wireEvent('e-1', 'ineligible', NOW - 60_000, 's-1'),
        wireEvent('e-2', 'analyze-run', NOW - 30_000, 's-2'),
      ]),
    );
    openSubView(fixture, 'Sessions');
    await settle();

    const hint = 'Recent sessions were marked ineligible';
    expect(root.textContent).not.toContain(hint);

    dss.pushLiveEvent(wireEvent('e-3', 'ineligible', NOW, 's-3'));
    fixture.detectChanges();
    expect(root.textContent).toContain(hint);
  });

  it('drives the status card reason chip from the newest event', async () => {
    const { fixture, root, dss, settle } = mount(
      snapshot([
        wireEvent('e-1', 'ineligible', NOW - 60_000, 's-1'),
        wireEvent('e-2', 'error', NOW - 30_000, 's-2'),
      ]),
    );
    openSubView(fixture, 'Activity');
    await settle();

    const chip = (): Element | null =>
      root.querySelector('[data-testid="skills-pipeline-reason"]');
    expect(chip()).toBeNull();

    dss.pushLiveEvent(wireEvent('e-3', 'rate-limited', NOW, 's-3'));
    fixture.detectChanges();
    expect(chip()?.textContent).toContain('rate-limited');
  });
});

describe('SkillSynthesisTabComponent — Skills pause switch', () => {
  function mount(rpc: Record<string, unknown> = {}): {
    fixture: ComponentFixture<SkillSynthesisTabComponent>;
    root: HTMLElement;
    stub: StubState;
  } {
    // `loadSettings` resolves quietly so the only toast a test can see is one
    // the action under test raised.
    const stub = {
      ...makeStub(),
      settings: signal(null),
      loadSettings: jest.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        {
          provide: SkillDiagnosticsStateService,
          useValue: makeDiagnosticsStub(),
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        { provide: TabManagerService, useValue: tabManagerStub },
        { provide: SkillSynthesisRpcService, useValue: rpc },
      ],
    });
    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement, stub };
  }

  function runCuratorButton(root: HTMLElement): HTMLButtonElement {
    return root.querySelector(
      '[data-testid="run-curator"]',
    ) as HTMLButtonElement;
  }

  it('puts the Skills switch at the top of the tab, right under the header', () => {
    const { root } = mount();

    const switchEl = root.querySelector('ptah-skills-pause-switch');
    expect(switchEl).not.toBeNull();
    expect(switchEl?.previousElementSibling?.tagName).toBe('HEADER');
    expect(
      root.querySelector('[data-testid="skills-enabled-toggle"]'),
    ).not.toBeNull();
  });

  it('greys out Run Curator with the paused reason while Skills is paused', () => {
    const { fixture, root, stub } = mount();
    expect(runCuratorButton(root).disabled).toBe(false);
    expect(
      root.querySelector('[data-testid="run-curator-paused-hint"]'),
    ).toBeNull();

    stub.skillsEnabledCommitted.set(false);
    fixture.detectChanges();

    const button = runCuratorButton(root);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Paused — resume Skills to run');
    expect(
      root.querySelector('[data-testid="run-curator-paused-hint"]')
        ?.textContent,
    ).toContain('Paused — resume Skills to run');
  });

  it('turns a PAUSED refusal from runCurator into the paused state, not an error toast', async () => {
    const runCurator = jest.fn(async () => {
      throw new SkillsPausedError();
    });
    const { fixture, root, stub } = mount({ runCurator });

    runCuratorButton(root).click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(runCurator).toHaveBeenCalledTimes(1);
    expect(stub.markSkillsPaused).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.toast()).toBeNull();
    expect(runCuratorButton(root).disabled).toBe(true);
  });

  it('passes the paused state down to Analyze now on the Activity view', () => {
    const { fixture, root, stub } = mount();
    stub.skillsEnabledCommitted.set(false);
    fixture.detectChanges();

    openActivity(fixture);
    const analyze = root.querySelector(
      '[data-test="analyze-now"]',
    ) as HTMLButtonElement;
    expect(analyze.disabled).toBe(true);
    expect(analyze.getAttribute('title')).toBe('Paused — resume Skills to run');
  });

  it('re-emits the switch pausedChange for the Thoth shell', () => {
    const { fixture } = mount();
    const emitted: boolean[] = [];
    fixture.componentInstance.pausedChange.subscribe((p) => emitted.push(p));

    const child = fixture.debugElement.query(
      By.directive(SkillsPauseSwitchComponent),
    ).componentInstance as SkillsPauseSwitchComponent;
    child.pausedChange.emit(true);

    expect(emitted).toEqual([true]);
  });
});
