// Mock ngx-markdown to avoid ESM import failure from `marked` in Jest
jest.mock('ngx-markdown', () => ({}));
jest.mock('marked', () => ({ marked: jest.fn() }));

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GenerationProgress,
  ScanProgress,
  SetupWizardStateService,
} from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { ScanProgressComponent } from './scan-progress.component';

describe.skip('ScanProgressComponent', () => {
  let component: ScanProgressComponent;
  let fixture: ComponentFixture<ScanProgressComponent>;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;

  const mockMultiPhaseResult = {
    isMultiPhase: true,
    manifest: {
      slug: 'angular-nx-monorepo',
      analyzedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-5-20250929',
      totalDurationMs: 45000,
      phases: {},
    },
    phaseContents: {},
    analysisDir: '/mock/.ptah/analysis/angular-nx-monorepo',
  };
  const mockRecommendations = [
    {
      agentId: 'frontend-developer',
      agentName: 'Frontend Developer',
      relevanceScore: 95,
      recommended: true,
      matchedCriteria: ['Angular detected'],
      category: 'development' as const,
    },
  ];

  beforeEach(async () => {
    mockStateService = {
      generationProgress: signal<GenerationProgress | null>(null),
      scanProgress: signal<ScanProgress | null>(null),
      analysisStream: signal([]).asReadonly(),
      multiPhaseResult: signal(null).asReadonly(),
      recommendations: signal([]).asReadonly(),
      fallbackWarning: signal(null).asReadonly(),
      reset: jest.fn(),
      setMultiPhaseResult: jest.fn(),
      setRecommendations: jest.fn(),
      setCurrentStep: jest.fn(),
    };
    mockRpcService = {
      deepAnalyze: jest.fn().mockResolvedValue(mockMultiPhaseResult),
      recommendAgents: jest.fn().mockResolvedValue(mockRecommendations),
      cancelAnalysis: jest.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ScanProgressComponent],
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardRpcService, useValue: mockRpcService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanProgressComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should initialize with isAnalyzing as false before ngOnInit', () => {
      expect(component['isAnalyzing']()).toBe(false);
    });

    it('should initialize with null error message', () => {
      expect(component['errorMessage']()).toBeNull();
    });

    it('should display analyzing workspace heading', () => {
      fixture.detectChanges();
      const heading = fixture.nativeElement.querySelector('h2');
      expect(heading.textContent).toContain('Analyzing Workspace');
    });
  });

  describe('Analysis Flow (ngOnInit)', () => {
    it('should call deepAnalyze on init', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockRpcService.deepAnalyze).toHaveBeenCalled();
    });

    it('should store multi-phase result in state', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockStateService.setMultiPhaseResult).toHaveBeenCalledWith(
        mockMultiPhaseResult,
      );
    });

    it('should call recommendAgents after deep analysis', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockRpcService.recommendAgents).toHaveBeenCalledWith(
        mockMultiPhaseResult,
      );
    });

    it('should store recommendations in state', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockStateService.setRecommendations).toHaveBeenCalledWith(
        mockRecommendations,
      );
    });

    it('should transition to analysis step on success', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('analysis');
    });

    it('should update status text during analysis phases', async () => {
      // Use a deferred promise to check intermediate state
      let resolveDeepAnalyze!: (value: unknown) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();

      expect(component['statusText']()).toBe('Analyzing project structure...');

      resolveDeepAnalyze(mockMultiPhaseResult);
      await fixture.whenStable();
    });
  });

  describe('Analysis Error Handling', () => {
    it('should show error message on deep analysis failure', async () => {
      const errorMsg = 'Deep analysis failed: timeout';
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        new Error(errorMsg),
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component['errorMessage']()).toBe(errorMsg);
      expect(component['statusText']()).toBe('Analysis failed');
    });

    it('should show error message on recommendation failure', async () => {
      const errorMsg = 'Recommendation failed';
      (mockRpcService.recommendAgents as jest.Mock).mockRejectedValue(
        new Error(errorMsg),
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component['errorMessage']()).toBe(errorMsg);
    });

    it('should show default error for non-Error failures', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        'String error',
      );

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component['errorMessage']()).toBe(
        'Analysis failed. Please try again.',
      );
    });

    it('should NOT transition step on failure', async () => {
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
  });

  describe('Smart Retry', () => {
    it('should skip deep analysis on retry if multi-phase result already cached', async () => {
      // First call fails at recommendation stage
      (mockRpcService.recommendAgents as jest.Mock).mockRejectedValueOnce(
        new Error('timeout'),
      );

      fixture.detectChanges();
      await fixture.whenStable();

      // Multi-phase result was stored
      expect(mockStateService.setMultiPhaseResult).toHaveBeenCalledWith(
        mockMultiPhaseResult,
      );

      // Simulate cached multi-phase result in state
      (
        mockStateService as unknown as Record<string, unknown>
      ).multiPhaseResult = signal(mockMultiPhaseResult).asReadonly();

      // Reset mock and retry — second call should succeed
      (mockRpcService.deepAnalyze as jest.Mock).mockClear();
      (mockRpcService.recommendAgents as jest.Mock).mockResolvedValueOnce(
        mockRecommendations,
      );

      component['onRetry']();
      await fixture.whenStable();

      // Should NOT have called deepAnalyze again (cached)
      expect(mockRpcService.deepAnalyze).not.toHaveBeenCalled();
      expect(mockRpcService.recommendAgents).toHaveBeenCalled();
    });
  });

  describe('Re-entry Guard', () => {
    it('should prevent concurrent analysis calls', async () => {
      let resolveDeepAnalyze!: (value: unknown) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges(); // Triggers first call via ngOnInit

      // Try to call again while first is in flight
      component['onRetry']();

      // Should only have been called once
      expect(mockRpcService.deepAnalyze).toHaveBeenCalledTimes(1);

      resolveDeepAnalyze(mockMultiPhaseResult);
      await fixture.whenStable();
    });
  });

  describe('Cancel / Back Functionality', () => {
    it('should reset wizard state on confirmed cancellation', () => {
      component['onConfirmCancellation']();

      expect(mockStateService.reset).toHaveBeenCalled();
    });

    it('should reset wizard state on go back', () => {
      component['onGoBack']();

      expect(mockStateService.reset).toHaveBeenCalled();
    });

    it('should do nothing on declined cancellation', () => {
      component['onDeclineCancellation']();

      expect(mockStateService.reset).not.toHaveBeenCalled();
    });
  });

  describe('Progress Display', () => {
    it('should display progress information', () => {
      fixture.detectChanges();

      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set({
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular', 'TypeScript'],
      });
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Analyzing 50 of 100 files...');
      expect(text).toContain('50%');
    });

    it('should calculate progress percentage correctly', () => {
      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set({
        filesScanned: 25,
        totalFiles: 100,
        detections: [],
      });

      expect(component['progressPercentage']()).toBe(25);
    });

    it('should handle zero total files', () => {
      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set({
        filesScanned: 0,
        totalFiles: 0,
        detections: [],
      });

      expect(component['progressPercentage']()).toBe(0);
    });

    it('should display detections list', () => {
      fixture.detectChanges();

      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set({
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular', 'TypeScript', 'Nx'],
      });
      fixture.detectChanges();

      const alerts = fixture.nativeElement.querySelectorAll('.alert-info');
      expect(alerts.length).toBe(3);
      expect(alerts[0].textContent).toContain('Angular');
      expect(alerts[1].textContent).toContain('TypeScript');
      expect(alerts[2].textContent).toContain('Nx');
    });
  });

  describe('UI States', () => {
    it('should show error alert when analysis fails', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        new Error('Test error'),
      );

      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Test error');
    });

    it('should hide error alert when no error', () => {
      fixture.detectChanges();
      const alert = fixture.nativeElement.querySelector('.alert-error');
      expect(alert).toBeFalsy();
    });

    it('should show Back and Retry buttons on error', async () => {
      (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
        new Error('fail'),
      );

      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const buttons = fixture.nativeElement.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map((b) =>
        ((b as HTMLButtonElement).textContent ?? '').trim(),
      );
      expect(buttonTexts).toContain('Back');
      expect(buttonTexts.some((t: string) => t.includes('Retry'))).toBe(true);
    });

    it('should show Cancel Scan button when not in error state', async () => {
      // Prevent auto-analysis from completing during this test
      let resolveDeepAnalyze!: (value: unknown) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.textContent).toContain('Cancel Scan');

      resolveDeepAnalyze(mockMultiPhaseResult);
    });

    it('should enable Cancel Scan button during analysis', async () => {
      // Prevent auto-analysis from completing during this test
      let resolveDeepAnalyze!: (value: unknown) => void;
      (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveDeepAnalyze = resolve;
        }),
      );

      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.textContent).toContain('Cancel Scan');
      expect(button.disabled).toBe(false);

      resolveDeepAnalyze(mockMultiPhaseResult);
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      fixture.detectChanges();

      const h2 = fixture.nativeElement.querySelector('h2');
      expect(h2).toBeTruthy();

      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set({
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular'],
      });
      fixture.detectChanges();

      const h3 = fixture.nativeElement.querySelector('h3');
      expect(h3).toBeTruthy();
    });

    it('should have accessible progress bar', () => {
      fixture.detectChanges();

      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set({
        filesScanned: 50,
        totalFiles: 100,
        detections: [],
      });
      fixture.detectChanges();

      const progressBar = fixture.nativeElement.querySelector('progress');
      expect(progressBar.getAttribute('role')).toBe('progressbar');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null progress data', () => {
      fixture.detectChanges();

      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set(null);
      fixture.detectChanges();

      // Should show the spinner with status text, not crash
      expect(fixture.nativeElement).toBeTruthy();
    });

    it('should handle missing detections array', () => {
      fixture.detectChanges();

      const progressSignal = mockStateService.scanProgress as unknown as {
        set: (v: ScanProgress | null) => void;
      };
      progressSignal.set({
        filesScanned: 50,
        totalFiles: 100,
      });
      fixture.detectChanges();

      // Should not crash
      expect(fixture.nativeElement).toBeTruthy();
    });
  });
});
