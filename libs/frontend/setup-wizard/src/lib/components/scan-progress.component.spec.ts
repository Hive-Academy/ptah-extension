import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  AgentRecommendation,
  AnalysisStreamPayload,
  MultiPhaseAnalysisResponse,
} from '@ptah-extension/shared';
import {
  ScanProgress,
  SetupWizardStateService,
} from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { ScanProgressComponent } from './scan-progress.component';
import { AnalysisTranscriptComponent } from './analysis-transcript.component';
import { AnalysisActivityIndicatorComponent } from './analysis-activity-indicator.component';

/**
 * AnalysisTranscriptComponent transitively imports ExecutionNodeComponent from
 * the `@ptah-extension/chat` barrel, whose deep component tree is undefined at
 * Angular TestBed compile time in the Jest ESM/CJS interop window. We swap it
 * for a selector-compatible stub via TestBed.overrideComponent so the rest of
 * the standalone import graph (stats dashboard, activity indicator,
 * confirmation modal) compiles normally.
 */
@Component({
  selector: 'ptah-analysis-transcript',
  standalone: true,
  template: '',
})
class StubAnalysisTranscriptComponent {}

/**
 * AnalysisActivityIndicatorComponent runs a setInterval-based typewriter
 * effect that keeps the Angular zone perpetually unstable, hanging every
 * `fixture.whenStable()` await. It carries no behaviour under test, so we
 * swap it for an inert selector-compatible stub.
 */
@Component({
  selector: 'ptah-analysis-activity-indicator',
  standalone: true,
  template: '',
})
class StubAnalysisActivityIndicatorComponent {}

const mockMultiPhase = {
  isMultiPhase: true,
  analysisDir: '/mock/.ptah/analysis/demo',
} as unknown as MultiPhaseAnalysisResponse;

const mockRecommendations: AgentRecommendation[] = [
  {
    agentId: 'frontend-developer',
    agentName: 'Frontend Developer',
    relevanceScore: 95,
    matchedCriteria: ['Angular detected'],
    category: 'development',
    recommended: true,
  },
];

describe('ScanProgressComponent', () => {
  let component: ScanProgressComponent;
  let fixture: ComponentFixture<ScanProgressComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;

  let scanProgress: ReturnType<typeof signal<ScanProgress | null>>;
  let fallbackWarning: ReturnType<typeof signal<string | null>>;
  let analysisStream: ReturnType<typeof signal<AnalysisStreamPayload[]>>;
  let multiPhaseResult: ReturnType<
    typeof signal<MultiPhaseAnalysisResponse | null>
  >;
  let recommendations: ReturnType<typeof signal<AgentRecommendation[]>>;

  beforeEach(async () => {
    scanProgress = signal<ScanProgress | null>(null);
    fallbackWarning = signal<string | null>(null);
    analysisStream = signal<AnalysisStreamPayload[]>([]);
    multiPhaseResult = signal<MultiPhaseAnalysisResponse | null>(null);
    recommendations = signal<AgentRecommendation[]>([]);

    mockStateService = {
      scanProgress: scanProgress.asReadonly(),
      fallbackWarning: fallbackWarning.asReadonly(),
      analysisStream: analysisStream.asReadonly(),
      multiPhaseResult: multiPhaseResult.asReadonly(),
      recommendations: recommendations.asReadonly(),
      reset: jest.fn(),
      setMultiPhaseResult: jest.fn((r: MultiPhaseAnalysisResponse) =>
        multiPhaseResult.set(r),
      ),
      setRecommendations: jest.fn((r: AgentRecommendation[]) =>
        recommendations.set(r),
      ),
      setCurrentStep: jest.fn(),
    } as unknown as Partial<SetupWizardStateService>;

    mockRpcService = {
      deepAnalyze: jest.fn().mockResolvedValue(mockMultiPhase),
      recommendAgents: jest.fn().mockResolvedValue(mockRecommendations),
      cancelAnalysis: jest.fn().mockResolvedValue(undefined),
    } as unknown as Partial<WizardRpcService>;

    await TestBed.configureTestingModule({
      imports: [ScanProgressComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardRpcService, useValue: mockRpcService },
      ],
    })
      .overrideComponent(ScanProgressComponent, {
        remove: {
          imports: [
            AnalysisTranscriptComponent,
            AnalysisActivityIndicatorComponent,
          ],
        },
        add: {
          imports: [
            StubAnalysisTranscriptComponent,
            StubAnalysisActivityIndicatorComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ScanProgressComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Initial state', () => {
    it('should start with isAnalyzing false before ngOnInit', () => {
      expect(component['isAnalyzing']()).toBe(false);
    });

    it('should start with no error message', () => {
      expect(component['errorMessage']()).toBeNull();
    });

    it('should render the analyzing-workspace heading', () => {
      fixture.detectChanges();
      const heading = fixture.nativeElement.querySelector('h2');
      expect(heading.textContent).toContain('Analyzing Workspace');
    });
  });

  describe('Analysis flow (ngOnInit)', () => {
    it('should run deep analysis on init', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockRpcService.deepAnalyze).toHaveBeenCalled();
    });

    it('should store the multi-phase result', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockStateService.setMultiPhaseResult).toHaveBeenCalledWith(
        mockMultiPhase,
      );
    });

    it('should request recommendations after analysis', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockRpcService.recommendAgents).toHaveBeenCalledWith(
        mockMultiPhase,
      );
      expect(mockStateService.setRecommendations).toHaveBeenCalledWith(
        mockRecommendations,
      );
    });

    it('should advance to the analysis step on success', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('analysis');
    });

    it('should set the analyzing status text while running', () => {
      let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();

      expect(component['statusText']()).toBe('Analyzing project structure...');

      resolveDeepAnalyze(mockMultiPhase);
    });
  });

  describe('Smart retry', () => {
    it('should skip deep analysis when a multi-phase result is cached', async () => {
      multiPhaseResult.set(mockMultiPhase);

      component['onRetry']();
      await fixture.whenStable();

      expect(mockRpcService.deepAnalyze).not.toHaveBeenCalled();
      expect(mockRpcService.recommendAgents).toHaveBeenCalledWith(
        mockMultiPhase,
      );
    });
  });

  describe('Re-entry guard', () => {
    it('should prevent concurrent analysis calls', async () => {
      let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();
      component['onRetry']();

      expect(mockRpcService.deepAnalyze).toHaveBeenCalledTimes(1);

      resolveDeepAnalyze(mockMultiPhase);
      await fixture.whenStable();
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('should surface a deep-analysis failure', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        new Error('Deep analysis failed: timeout'),
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component['errorMessage']()).toBe('Deep analysis failed: timeout');
      expect(component['statusText']()).toBe('Analysis failed');
    });

    it('should surface a recommendation failure', async () => {
      (mockRpcService.recommendAgents as jest.Mock).mockRejectedValue(
        new Error('Recommendation failed'),
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component['errorMessage']()).toBe('Recommendation failed');
    });

    it('should use a default message for non-Error failures', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        'String error',
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component['errorMessage']()).toBe(
        'Analysis failed. Please try again.',
      );
    });

    it('should not advance the step on failure', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        new Error('fail'),
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockStateService.setCurrentStep).not.toHaveBeenCalled();
    });

    it('should reset isAnalyzing on failure', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        new Error('fail'),
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component['isAnalyzing']()).toBe(false);
    });

    it('should render the error alert with Back and Retry buttons', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        new Error('Test error'),
      );

      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Test error');

      const buttonTexts = Array.from(
        fixture.nativeElement.querySelectorAll('button'),
      ).map((b) => ((b as HTMLButtonElement).textContent ?? '').trim());
      expect(buttonTexts).toContain('Back');
      expect(buttonTexts.some((t) => t.includes('Retry'))).toBe(true);
    });
  });

  describe('Cancel / back', () => {
    it('should reset wizard state on confirmed cancellation', async () => {
      component['onConfirmCancellation']();
      await fixture.whenStable();

      expect(mockRpcService.cancelAnalysis).toHaveBeenCalled();
      expect(mockStateService.reset).toHaveBeenCalled();
    });

    it('should reset wizard state on go back', () => {
      component['onGoBack']();
      expect(mockStateService.reset).toHaveBeenCalled();
    });

    it('should do nothing on declined cancellation', () => {
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      component['onDeclineCancellation']();
      expect(mockStateService.reset).not.toHaveBeenCalled();
    });

    it('should show the confirmation modal only while analyzing', () => {
      let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();
      const showSpy = jest
        .spyOn(component.confirmModal(), 'show')
        .mockImplementation(() => undefined);

      component['onCancel']();
      expect(showSpy).toHaveBeenCalled();

      resolveDeepAnalyze(mockMultiPhase);
    });
  });

  describe('Progress display', () => {
    it('should compute progress percentage', () => {
      scanProgress.set({
        filesScanned: 25,
        totalFiles: 100,
        detections: [],
      });
      expect(component['progressPercentage']()).toBe(25);
    });

    it('should handle zero total files', () => {
      scanProgress.set({
        filesScanned: 0,
        totalFiles: 0,
        detections: [],
      });
      expect(component['progressPercentage']()).toBe(0);
    });

    it('should render the file-progress bar and label', () => {
      let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();
      scanProgress.set({
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular', 'TypeScript'],
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Analyzing 50 of 100 files...');
      expect(text).toContain('50%');

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.getAttribute('role')).toBe('progressbar');

      resolveDeepAnalyze(mockMultiPhase);
    });

    it('should render detected stack entries', () => {
      let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();
      scanProgress.set({
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular', 'TypeScript', 'Nx'],
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Detected Stack');
      expect(text).toContain('Angular');
      expect(text).toContain('TypeScript');
      expect(text).toContain('Nx');

      resolveDeepAnalyze(mockMultiPhase);
    });
  });

  describe('Phase stepper', () => {
    it('should mark completed phases', () => {
      scanProgress.set({
        filesScanned: 0,
        totalFiles: 0,
        detections: [],
        currentPhase: 'architecture-assessment',
        completedPhases: ['project-profile'],
      });

      expect(component['isPhaseComplete']('project-profile')).toBe(true);
      expect(component['isCurrentPhase']('architecture-assessment')).toBe(true);
      expect(component['isPhaseCompleteOrCurrent']('quality-audit')).toBe(
        false,
      );
    });
  });

  describe('Edge cases', () => {
    it('should not crash with null progress data', () => {
      let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();
      scanProgress.set(null);
      fixture.detectChanges();

      expect(fixture.nativeElement).toBeTruthy();

      resolveDeepAnalyze(mockMultiPhase);
    });
  });
});
