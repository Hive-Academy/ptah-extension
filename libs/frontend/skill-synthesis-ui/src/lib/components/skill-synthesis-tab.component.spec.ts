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
} from '@ptah-extension/shared';

import { SkillSynthesisTabComponent } from './skill-synthesis-tab.component';
import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
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
}

function makeStub(
  candidatesValue: SkillSynthesisCandidateSummary[] = [],
): StubState {
  const candidates = signal<SkillSynthesisCandidateSummary[]>(candidatesValue);
  const suggestions = signal<SkillSuggestionSummary[]>([]);
  return {
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
    expect(text).toContain('refactor-tests');
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

    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="tab"]',
    );
    expect(tabs.length).toBe(0);
  });
});
