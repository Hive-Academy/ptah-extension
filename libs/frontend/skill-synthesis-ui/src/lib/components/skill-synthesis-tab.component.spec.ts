import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
  SkillSynthesisStatsResult,
} from '@ptah-extension/shared';

import { SkillSynthesisTabComponent } from './skill-synthesis-tab.component';
import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';

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

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
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

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
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

    TestBed.configureTestingModule({
      imports: [SkillSynthesisTabComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: stub },
        { provide: VSCodeService, useValue: vscodeServiceStub(false) },
      ],
    });

    const fixture = TestBed.createComponent(SkillSynthesisTabComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ptah desktop app');

    // No RPC init in placeholder mode.
    expect(stub.refreshCandidates).not.toHaveBeenCalled();
    expect(stub.loadStats).not.toHaveBeenCalled();

    // Filter chips are not rendered in placeholder mode.
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="tab"]',
    );
    expect(tabs.length).toBe(0);
  });
});
