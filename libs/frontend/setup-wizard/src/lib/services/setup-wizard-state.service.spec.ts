import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  SetupWizardStateService,
  WizardStep,
  ProjectContext,
  AgentSelection,
  GenerationProgress,
  ScanProgress,
  AnalysisResults,
  CompletionData,
  ErrorState,
} from './setup-wizard-state.service';
import { VSCodeService } from '@ptah-extension/core';

describe('SetupWizardStateService', () => {
  let service: SetupWizardStateService;
  let mockVSCodeService: Partial<VSCodeService>;

  beforeEach(() => {
    mockVSCodeService = {
      postMessage: jest.fn(),
      config: signal({
        isVSCode: true,
        theme: 'dark',
        workspaceRoot: '/test/workspace',
        workspaceName: 'test-workspace',
        extensionUri: 'file:///test/extension',
        extensionVersion: '1.0.0',
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        SetupWizardStateService,
        { provide: VSCodeService, useValue: mockVSCodeService },
      ],
    });

    service = TestBed.inject(SetupWizardStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should initialize with welcome step', () => {
      expect(service.currentStep()).toBe('welcome');
    });

    it('should initialize with null project context', () => {
      expect(service.projectContext()).toBeNull();
    });

    it('should initialize with empty agents array', () => {
      expect(service.availableAgents()).toEqual([]);
    });

    it('should initialize with null generation progress', () => {
      expect(service.generationProgress()).toBeNull();
    });

    it('should initialize with null scan progress', () => {
      expect(service.scanProgress()).toBeNull();
    });

    it('should initialize with null analysis results', () => {
      expect(service.analysisResults()).toBeNull();
    });

    it('should initialize with null completion data', () => {
      expect(service.completionData()).toBeNull();
    });

    it('should initialize with null error state', () => {
      expect(service.errorState()).toBeNull();
    });
  });

  describe('State Mutations', () => {
    it('should update current step', () => {
      service.setCurrentStep('scan');
      expect(service.currentStep()).toBe('scan');
    });

    it('should update project context', () => {
      const context: ProjectContext = {
        type: 'Angular',
        techStack: ['TypeScript', 'Angular'],
        isMonorepo: false,
      };
      service.setProjectContext(context);
      expect(service.projectContext()).toEqual(context);
    });

    it('should update available agents', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'High relevance',
          autoInclude: true,
        },
      ];
      service.setAvailableAgents(agents);
      expect(service.availableAgents()).toEqual(agents);
    });

    it('should toggle agent selection', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: true,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      service.setAvailableAgents(agents);

      service.toggleAgentSelection('1');
      expect(service.availableAgents()[0].selected).toBe(true);

      service.toggleAgentSelection('2');
      expect(service.availableAgents()[1].selected).toBe(false);
    });

    it('should update generation progress', () => {
      const progress: GenerationProgress = {
        phase: 'analysis',
        percentComplete: 50,
      };
      service.updateGenerationProgress(progress);
      expect(service.generationProgress()).toEqual(progress);
    });

    it('should reset all state', () => {
      // Set some state
      service.setCurrentStep('generation');
      service.setProjectContext({
        type: 'Test',
        techStack: [],
        isMonorepo: false,
      });
      service.setAvailableAgents([
        {
          id: '1',
          name: 'Test',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ]);

      // Reset
      service.reset();

      // Verify all state is reset
      expect(service.currentStep()).toBe('welcome');
      expect(service.projectContext()).toBeNull();
      expect(service.availableAgents()).toEqual([]);
      expect(service.generationProgress()).toBeNull();
      expect(service.scanProgress()).toBeNull();
      expect(service.analysisResults()).toBeNull();
      expect(service.completionData()).toBeNull();
      expect(service.errorState()).toBeNull();
    });
  });

  describe('Computed Signals', () => {
    it('should compute selected count correctly', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '2',
          name: 'Agent 2',
          selected: false,
          score: 80,
          reason: 'Test',
          autoInclude: false,
        },
        {
          id: '3',
          name: 'Agent 3',
          selected: true,
          score: 70,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      service.setAvailableAgents(agents);
      expect(service.selectedCount()).toBe(2);
    });

    it('should compute canProceed for welcome step', () => {
      service.setCurrentStep('welcome');
      expect(service.canProceed()).toBe(true);
    });

    it('should compute canProceed for scan step', () => {
      service.setCurrentStep('scan');
      expect(service.canProceed()).toBe(false);
    });

    it('should compute canProceed for analysis step with project context', () => {
      service.setCurrentStep('analysis');
      service.setProjectContext({
        type: 'Test',
        techStack: [],
        isMonorepo: false,
      });
      expect(service.canProceed()).toBe(true);
    });

    it('should compute canProceed for analysis step without project context', () => {
      service.setCurrentStep('analysis');
      expect(service.canProceed()).toBe(false);
    });

    it('should compute canProceed for selection step with agents', () => {
      service.setCurrentStep('selection');
      service.setAvailableAgents([
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ]);
      expect(service.canProceed()).toBe(true);
    });

    it('should compute canProceed for selection step without agents', () => {
      service.setCurrentStep('selection');
      expect(service.canProceed()).toBe(false);
    });

    it('should compute canProceed for generation step', () => {
      service.setCurrentStep('generation');
      expect(service.canProceed()).toBe(false);
    });

    it('should compute canProceed for completion step', () => {
      service.setCurrentStep('completion');
      expect(service.canProceed()).toBe(true);
    });

    it('should compute percentComplete for each step', () => {
      const steps: WizardStep[] = [
        'welcome',
        'scan',
        'analysis',
        'selection',
        'generation',
        'completion',
      ];
      const expected = [0, 20, 30, 40, 50, 100];

      steps.forEach((step, index) => {
        service.setCurrentStep(step);
        expect(service.percentComplete()).toBe(expected[index]);
      });
    });

    it('should compute percentComplete for generation step with progress', () => {
      service.setCurrentStep('generation');
      service.updateGenerationProgress({
        phase: 'customization',
        percentComplete: 75,
      });
      expect(service.percentComplete()).toBe(75);
    });
  });

  describe('Message Listener', () => {
    it('should handle scan progress message', () => {
      const payload: ScanProgress = {
        filesScanned: 50,
        totalFiles: 100,
        detections: ['Angular', 'TypeScript'],
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:scan-progress', payload },
        })
      );

      expect(service.scanProgress()).toEqual(payload);
      expect(service.generationProgress()?.percentComplete).toBe(50);
    });

    it('should handle analysis complete message', () => {
      const payload: AnalysisResults = {
        projectContext: {
          type: 'Angular',
          techStack: ['TypeScript', 'Angular'],
          isMonorepo: false,
        },
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:analysis-complete', payload },
        })
      );

      expect(service.analysisResults()).toEqual(payload);
      expect(service.projectContext()).toEqual(payload.projectContext);
      expect(service.currentStep()).toBe('analysis');
    });

    it('should handle available agents message', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: true,
          score: 90,
          reason: 'Test',
          autoInclude: true,
        },
      ];

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:available-agents', payload: { agents } },
        })
      );

      expect(service.availableAgents()).toEqual(agents);
    });

    it('should handle generation progress message', () => {
      const progress: GenerationProgress = {
        phase: 'rendering',
        percentComplete: 80,
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:generation-progress',
            payload: { progress },
          },
        })
      );

      expect(service.generationProgress()).toEqual(progress);
    });

    it('should handle generation complete message', () => {
      const payload: CompletionData = {
        success: true,
        generatedCount: 5,
        duration: 120000,
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:generation-complete', payload },
        })
      );

      expect(service.completionData()).toEqual(payload);
      expect(service.currentStep()).toBe('completion');
    });

    it('should handle error message', () => {
      const payload: ErrorState = {
        message: 'Test error',
        details: 'Error details',
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:error', payload },
        })
      );

      expect(service.errorState()).toEqual(payload);
    });

    it('should ignore invalid messages', () => {
      jest.spyOn(console, 'warn');

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:scan-progress',
            payload: { invalid: true },
          },
        })
      );

      expect(console.warn).toHaveBeenCalled();
    });

    it('should handle message processing errors', () => {
      jest.spyOn(console, 'error');

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:scan-progress', payload: null },
        })
      );

      expect(service.errorState()).toBeTruthy();
    });

    it('should ignore unknown message types', () => {
      const initialStep = service.currentStep();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'unknown:message', payload: {} },
        })
      );

      expect(service.currentStep()).toBe(initialStep);
    });

    it('should ignore messages without type', () => {
      const initialStep = service.currentStep();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { payload: {} },
        })
      );

      expect(service.currentStep()).toBe(initialStep);
    });
  });

  describe('Edge Cases', () => {
    it('should handle division by zero in scan progress', () => {
      const payload: ScanProgress = {
        filesScanned: 0,
        totalFiles: 0,
        detections: [],
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:scan-progress', payload },
        })
      );

      expect(service.generationProgress()?.percentComplete).toBe(NaN);
    });

    it('should handle toggling non-existent agent', () => {
      const agents: AgentSelection[] = [
        {
          id: '1',
          name: 'Agent 1',
          selected: false,
          score: 90,
          reason: 'Test',
          autoInclude: false,
        },
      ];
      service.setAvailableAgents(agents);

      service.toggleAgentSelection('non-existent');

      expect(service.availableAgents()).toEqual(agents);
    });

    it('should handle empty agents array for selected count', () => {
      service.setAvailableAgents([]);
      expect(service.selectedCount()).toBe(0);
    });
  });
});
