import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  EligibilityHistogramDto,
  SkillSynthesisCandidateSummary,
  SkillSynthesisEventWire,
  SkillSynthesisInvocationEntry,
  SkillSynthesisStatsResult,
} from '@ptah-extension/shared';

import { SkillSynthesisTabComponent } from './skill-synthesis-tab.component';
import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
import { SkillDiagnosticsStateService } from '../services/skill-diagnostics-state.service';

interface DiagnosticsStub {
  readonly lastAnalyzeRunAt: ReturnType<typeof signal<number | null>>;
  readonly eligibilityHistogram: ReturnType<
    typeof signal<EligibilityHistogramDto>
  >;
  readonly recentEvents: ReturnType<
    typeof signal<readonly SkillSynthesisEventWire[]>
  >;
  readonly refresh: jest.Mock<Promise<void>, []>;
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
    eligibilityHistogram: signal<EligibilityHistogramDto>(
      overrides.eligibilityHistogram ?? {
        tooFewTurns: 0,
        lowFidelity: 0,
        insufficientAbstraction: 0,
        accepted: 0,
      },
    ),
    recentEvents: signal<readonly SkillSynthesisEventWire[]>(
      overrides.recentEvents ?? [],
    ),
    refresh: jest.fn(async () => undefined),
  };
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
  readonly refreshCandidates: jest.Mock<Promise<void>, []>;
  readonly loadStats: jest.Mock<Promise<void>, []>;
  readonly setStatusFilter: jest.Mock<
    Promise<void>,
    ['all' | 'pending' | 'promoted' | 'rejected']
  >;
  readonly selectCandidate: jest.Mock<Promise<void>, [string | null]>;
  readonly promote: jest.Mock<Promise<void>, [string, string | undefined]>;
  readonly reject: jest.Mock<Promise<void>, [string, string | undefined]>;
}

function makeStub(
  candidatesValue: SkillSynthesisCandidateSummary[] = [],
): StubState {
  const candidates = signal<SkillSynthesisCandidateSummary[]>(candidatesValue);
  return {
    candidates,
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
    promote: jest.fn(async () => undefined),
    reject: jest.fn(async () => undefined),
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

    const tabs = fixture.nativeElement.querySelectorAll(
      '[role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    const labels = Array.from(tabs).map((t) => t.textContent?.trim());
    expect(labels).toEqual(['Pending', 'Promoted', 'Rejected', 'All']);

    expect(stub.refreshCandidates).toHaveBeenCalledTimes(1);
    expect(stub.loadStats).toHaveBeenCalledTimes(1);
    expect(diag.refresh).toHaveBeenCalledTimes(1);
  });

  it('renders the pipeline status strip from diagnostics state', () => {
    const stub = makeStub();
    const diag = makeDiagnosticsStub({
      lastAnalyzeRunAt: Date.now() - 2 * 60_000,
      eligibilityHistogram: {
        tooFewTurns: 2,
        lowFidelity: 1,
        insufficientAbstraction: 1,
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
