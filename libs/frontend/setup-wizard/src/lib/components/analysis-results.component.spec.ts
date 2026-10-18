import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  MultiPhaseAnalysisResponse,
  ResumableGenerationRun,
} from '@ptah-extension/shared';
import { AnalysisResultsComponent } from './analysis-results.component';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardAnalysisRunner } from '../services/wizard-analysis-runner.service';
import { SetupGenerationOpenHandler } from '../services/setup-generation-open.handler';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';

const mockMultiPhase = {
  isMultiPhase: true,
  analysisDir: '/mock/.ptah/analysis/demo',
  manifest: {
    version: 3,
    runId: 'run-1',
    slug: 'demo',
    analyzedAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:01:05.000Z',
    lifecycle: 'completed',
    model: 'test-model',
    totalDurationMs: 65000,
    phases: {
      'project-profile': {
        status: 'completed',
        file: '01-project-profile.md',
        durationMs: 1200,
      },
      'architecture-assessment': {
        status: 'failed',
        file: '02-architecture-assessment.md',
        durationMs: 300,
        error: 'phase timed out',
      },
    },
  },
  phaseContents: { 'project-profile': '# Profile' },
} as unknown as MultiPhaseAnalysisResponse;

const mockGenerationRun: ResumableGenerationRun = {
  runId: 'run-1',
  analysisDirectory: '/mock/.ptah/analysis/demo',
  outputDirectory: '/mock/.claude/agents',
  lifecycle: 'paused',
  selectedAgentIds: ['frontend-developer', 'backend-developer'],
  agents: [
    {
      agentId: 'frontend-developer',
      filePath: '/mock/.claude/agents/frontend-developer.md',
      status: 'written',
      rejectedSections: 0,
      tailoredSections: 0,
    },
    {
      agentId: 'backend-developer',
      filePath: '/mock/.claude/agents/backend-developer.md',
      status: 'pending',
      rejectedSections: 0,
      tailoredSections: 0,
    },
  ],
};

describe('AnalysisResultsComponent', () => {
  const open = jest
    .fn()
    .mockResolvedValue({ outcome: 'landed', tabId: 'agent-tab' });
  let component: AnalysisResultsComponent;
  let fixture: ComponentFixture<AnalysisResultsComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRunner: Partial<WizardAnalysisRunner>;

  let multiPhaseResult: ReturnType<
    typeof signal<MultiPhaseAnalysisResponse | null>
  >;
  let resumableGeneration: ReturnType<
    typeof signal<ResumableGenerationRun | null>
  >;

  beforeEach(async () => {
    open
      .mockReset()
      .mockResolvedValue({ outcome: 'landed', tabId: 'agent-tab' });
    multiPhaseResult = signal<MultiPhaseAnalysisResponse | null>(null);
    resumableGeneration = signal<ResumableGenerationRun | null>(null);

    mockStateService = {
      multiPhaseResult: multiPhaseResult.asReadonly(),
      setCurrentStep: jest.fn(),
    } as unknown as Partial<SetupWizardStateService>;

    mockRunner = {
      resumableGeneration: resumableGeneration.asReadonly(),
      resumeGeneration: jest.fn().mockResolvedValue(undefined),
    } as unknown as Partial<WizardAnalysisRunner>;

    await TestBed.configureTestingModule({
      imports: [AnalysisResultsComponent],
      providers: [
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/workspace' },
        },
        { provide: GenerationWorkflowLauncherService, useValue: { open } },
        {
          provide: SetupGenerationOpenHandler,
          useValue: { launchNotice: signal(null) },
        },
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardAnalysisRunner, useValue: mockRunner },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalysisResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Analysis rendering', () => {
    it('shows the skeleton state without a stored result', () => {
      const skeleton = fixture.nativeElement.querySelector('.skeleton');
      expect(skeleton).toBeTruthy();
    });

    it('renders one phase card per manifest phase with its status', () => {
      multiPhaseResult.set(mockMultiPhase);
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Project Profile');
      expect(text).toContain('Architecture Assessment');
      // Failed phase surfaces its recorded error.
      expect(text).toContain('phase timed out');
    });

    it('continue opens the combined agent workflow', async () => {
      multiPhaseResult.set(mockMultiPhase);
      fixture.detectChanges();

      const continueButton = Array.from(
        fixture.nativeElement.querySelectorAll('button'),
      ).find((b) =>
        ((b as HTMLButtonElement).textContent ?? '').includes('Yes, Continue'),
      ) as HTMLButtonElement;
      continueButton.click();
      await fixture.whenStable();
      expect(open).toHaveBeenCalledWith({
        workspacePath: '/workspace',
        workflow: 'setup-agent-generation',
        origin: 'analysis-result-continue',
      });
      expect(mockStateService.setCurrentStep).not.toHaveBeenCalledWith(
        'selection',
      );
    });

    it('shows safe launch failure and stays silent on cancellation', async () => {
      multiPhaseResult.set(mockMultiPhase);
      fixture.detectChanges();
      const button = Array.from<HTMLButtonElement>(
        fixture.nativeElement.querySelectorAll('button'),
      ).find((item) =>
        (item.textContent ?? '').includes('Yes, Continue'),
      ) as HTMLButtonElement;
      open.mockResolvedValueOnce({ outcome: 'failed' });
      button.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'Agent generation could not be opened',
      );
      open.mockResolvedValueOnce({ outcome: 'cancelled' });
      button.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain(
        'Agent generation could not be opened',
      );
    });
  });

  describe('Resume generation offer', () => {
    it('hides the banner when no checkpoint was discovered', () => {
      const banner = fixture.nativeElement.querySelector(
        '[data-testid="resume-generation-banner"]',
      );
      expect(banner).toBeFalsy();
    });

    it('offers resume for a discovered generation checkpoint', () => {
      resumableGeneration.set(mockGenerationRun);
      fixture.detectChanges();

      const banner = fixture.nativeElement.querySelector(
        '[data-testid="resume-generation-banner"]',
      );
      expect(banner).toBeTruthy();
      expect(banner.textContent).toContain('Unfinished agent generation found');
      expect(banner.textContent).toContain('2 selected agents');
    });

    it('resume action delegates to the root-scoped runner', () => {
      resumableGeneration.set(mockGenerationRun);
      fixture.detectChanges();

      const resumeButton = Array.from(
        fixture.nativeElement.querySelectorAll('button'),
      ).find((b) =>
        ((b as HTMLButtonElement).textContent ?? '').includes(
          'Resume Generation',
        ),
      ) as HTMLButtonElement;
      resumeButton.click();

      expect(mockRunner.resumeGeneration).toHaveBeenCalledTimes(1);
    });

    it('shows the banner even before an analysis result is stored', () => {
      resumableGeneration.set(mockGenerationRun);
      fixture.detectChanges();

      // Skeleton branch is active, banner still renders.
      expect(fixture.nativeElement.querySelector('.skeleton')).toBeTruthy();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="resume-generation-banner"]',
        ),
      ).toBeTruthy();
    });
  });
});
