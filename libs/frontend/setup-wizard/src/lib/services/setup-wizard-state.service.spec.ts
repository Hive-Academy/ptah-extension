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
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';

describe('SetupWizardStateService', () => {
  let service: SetupWizardStateService;
  let mockVSCodeService: Partial<VSCodeService>;
  let mockStreamRouter: jest.Mocked<
    Pick<
      StreamRouter,
      'onSurfaceCreated' | 'onSurfaceClosed' | 'routeStreamEventForSurface'
    >
  >;
  let mockSurfaceRegistry: jest.Mocked<
    Pick<StreamingSurfaceRegistry, 'register' | 'unregister' | 'getAdapter'>
  >;

  beforeEach(() => {
    mockVSCodeService = {
      postMessage: jest.fn(),
      config: signal({
        isVSCode: true,
        theme: 'dark' as const,
        workspaceRoot: '/test/workspace',
        workspaceName: 'test-workspace',
        extensionUri: 'file:///test/extension',
        baseUri: 'file:///test/base',
        iconUri: 'file:///test/icons',
        userIconUri: 'file:///test/user-icons',
      }),
    };

    // SetupWizardStateService injects StreamRouter and StreamingSurfaceRegistry
    // to route per-phase stream events through the canonical pipeline. Stub
    // both to keep these tests focused on wizard-state behaviour without
    // standing up the full chat-routing graph (TabManager +
    // ConversationRegistry + permission/agent stores).
    mockStreamRouter = {
      onSurfaceCreated: jest.fn(),
      onSurfaceClosed: jest.fn(),
      routeStreamEventForSurface: jest.fn().mockReturnValue(null),
    };
    mockSurfaceRegistry = {
      register: jest.fn(),
      unregister: jest.fn(),
      getAdapter: jest.fn().mockReturnValue(null),
    };

    TestBed.configureTestingModule({
      providers: [
        SetupWizardStateService,
        { provide: VSCodeService, useValue: mockVSCodeService },
        { provide: StreamRouter, useValue: mockStreamRouter },
        { provide: StreamingSurfaceRegistry, useValue: mockSurfaceRegistry },
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
      // stepProgress map from SetupWizardStateService: welcome=5, scan=20,
      // analysis=35, selection=50, generation=55, completion=100.
      const expected = [5, 20, 35, 50, 55, 100];

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
        }),
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
        }),
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
        }),
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
        }),
      );

      expect(service.generationProgress()).toEqual(progress);
    });

    it('should handle generation complete message and store completion data', () => {
      const payload: CompletionData = {
        success: true,
        generatedCount: 5,
        duration: 120000,
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:generation-complete', payload },
        }),
      );

      // Completion data should always be stored
      expect(service.completionData()).toEqual(payload);
      // Auto-transition to completion only occurs when on the 'generation' step.
      // From 'welcome' step it should NOT auto-transition (prevents skipping enhance step).
      expect(service.currentStep()).toBe('welcome');
    });

    it('should auto-transition from generation to enhance step on complete', () => {
      // The post-generation auto-transition hands off to the `enhance` step
      // (Enhanced Prompts) rather than jumping straight to `completion`. The
      // service's `setCurrentStepIfGeneration` helper fires on the
      // generation-complete message only when the current step is 'generation'.
      service.setCurrentStep('generation');

      const payload: CompletionData = {
        success: true,
        generatedCount: 5,
        duration: 120000,
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:generation-complete', payload },
        }),
      );

      expect(service.completionData()).toEqual(payload);
      expect(service.currentStep()).toBe('enhance');
    });

    it('should handle error message', () => {
      const payload: ErrorState = {
        message: 'Test error',
        details: 'Error details',
      };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:error', payload },
        }),
      );

      expect(service.errorState()).toEqual(payload);
    });

    it('should ignore messages that are not wizard-shaped', () => {
      // WizardMessageDispatcher validates the `type` discriminator but not
      // payload shape (payloads are passed straight to the per-phase
      // handlers). Messages without a `type` matching a wizard prefix are
      // silently ignored — currentStep should remain unchanged.
      const initialStep = service.currentStep();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { payload: { invalid: true } },
        }),
      );

      expect(service.currentStep()).toBe(initialStep);
    });

    it('should handle message processing errors', () => {
      jest.spyOn(console, 'error');

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'setup-wizard:scan-progress', payload: null },
        }),
      );

      expect(service.errorState()).toBeTruthy();
    });

    it('should ignore unknown message types', () => {
      const initialStep = service.currentStep();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'unknown:message', payload: {} },
        }),
      );

      expect(service.currentStep()).toBe(initialStep);
    });

    it('should ignore messages without type', () => {
      const initialStep = service.currentStep();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { payload: {} },
        }),
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
        }),
      );

      // The service guards `totalFiles > 0` before computing the ratio, so
      // a 0/0 scan-progress payload yields a clean `0` rather than NaN.
      expect(service.generationProgress()?.percentComplete).toBe(0);
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

  describe('Fallback Warning Routing (TASK_2025_149)', () => {
    it('should set fallbackWarning when error type is fallback-warning', () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:error',
            payload: {
              type: 'fallback-warning',
              message:
                'AI-powered analysis unavailable. Using quick analysis mode.',
            },
          },
        }),
      );

      expect(service.fallbackWarning()).toBe(
        'AI-powered analysis unavailable. Using quick analysis mode.',
      );
      expect(service.errorState()).toBeNull();
    });

    it('should set errorState when error type is error', () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:error',
            payload: {
              type: 'error',
              message: 'Fatal error occurred',
              details: 'Stack trace details',
            },
          },
        }),
      );

      expect(service.errorState()).toEqual({
        message: 'Fatal error occurred',
        details: 'Stack trace details',
      });
      expect(service.fallbackWarning()).toBeNull();
    });

    it('should set errorState when error type is undefined', () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:error',
            payload: {
              message: 'Some error without type',
            },
          },
        }),
      );

      expect(service.errorState()).toEqual({
        message: 'Some error without type',
        details: undefined,
      });
      expect(service.fallbackWarning()).toBeNull();
    });

    it('should clear fallbackWarning on reset', () => {
      service.setFallbackWarning('Test warning');
      expect(service.fallbackWarning()).toBe('Test warning');

      service.reset();

      expect(service.fallbackWarning()).toBeNull();
    });
  });

  describe('Enhance Step Integration (TASK_2025_149)', () => {
    it('should include enhance in step order and return correct stepIndex', () => {
      service.setCurrentStep('enhance');
      // 'enhance' is at index 5 in: premium-check(0), welcome(1), scan(2), analysis(3), selection(4), enhance(5), generation(6), completion(7)
      expect(service.stepIndex()).toBe(5);
    });

    it('should return correct percentComplete for enhance step', () => {
      service.setCurrentStep('enhance');
      // stepProgress: enhance=85 (post-generation but pre-completion)
      expect(service.percentComplete()).toBe(85);
    });

    it('should return canProceed=false for enhance step', () => {
      service.setCurrentStep('enhance');
      expect(service.canProceed()).toBe(false);
    });
  });

  describe('CompletionData Warnings Mapping (TASK_2025_149)', () => {
    it('should map warnings from GenerationCompletePayload to CompletionData', () => {
      const warnings = [
        "Section 'examples' for agent 'backend-developer' customization failed (validation): using generic content",
        "Section 'patterns' for agent 'frontend-developer' customization failed (infrastructure): using generic content",
      ];

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:generation-complete',
            payload: {
              success: true,
              generatedCount: 3,
              duration: 45000,
              warnings,
              enhancedPromptsUsed: true,
            },
          },
        }),
      );

      const completionData = service.completionData();
      expect(completionData).not.toBeNull();
      expect(completionData?.warnings).toEqual(warnings);
      expect(completionData?.enhancedPromptsUsed).toBe(true);
    });

    it('should handle GenerationCompletePayload without warnings', () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:generation-complete',
            payload: {
              success: true,
              generatedCount: 5,
              duration: 30000,
            },
          },
        }),
      );

      const completionData = service.completionData();
      expect(completionData).not.toBeNull();
      expect(completionData?.warnings).toBeUndefined();
      expect(completionData?.enhancedPromptsUsed).toBeUndefined();
    });

    it('should map enhancedPromptsUsed=false from payload', () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'setup-wizard:generation-complete',
            payload: {
              success: true,
              generatedCount: 2,
              enhancedPromptsUsed: false,
            },
          },
        }),
      );

      const completionData = service.completionData();
      expect(completionData).not.toBeNull();
      expect(completionData?.enhancedPromptsUsed).toBe(false);
    });
  });

  // Verifies the per-phase SurfaceId lifecycle: lazy registration, idempotent
  // re-mint, sibling lookup, teardown semantics for both
  // `unregisterAllPhaseSurfaces` (analysis-complete — keeps states visible)
  // and `resetPhaseSurfaces` (full nuke — wipes states).
  describe('Phase Surface Routing (TASK_2026_107 Phase 3)', () => {
    it('registerPhaseSurface mints a SurfaceId, binds via StreamRouter, and registers the adapter', () => {
      const surfaceId = service.registerPhaseSurface('wizard-phase-discovery');

      expect(typeof surfaceId).toBe('string');
      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledWith(surfaceId);
      expect(mockSurfaceRegistry.register).toHaveBeenCalledTimes(1);
      // The registry receives the surfaceId + getState/setState callbacks.
      const [registeredId, getState, setState] =
        mockSurfaceRegistry.register.mock.calls[0];
      expect(registeredId).toBe(surfaceId);
      expect(typeof getState).toBe('function');
      expect(typeof setState).toBe('function');
    });

    it('registerPhaseSurface is idempotent — repeat call returns same SurfaceId', () => {
      const first = service.registerPhaseSurface('wizard-phase-discovery');
      const second = service.registerPhaseSurface('wizard-phase-discovery');

      expect(second).toBe(first);
      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockSurfaceRegistry.register).toHaveBeenCalledTimes(1);
    });

    it('surfaceForPhase returns the SurfaceId after register and null otherwise', () => {
      expect(service.surfaceForPhase('wizard-phase-arch')).toBeNull();
      const surfaceId = service.registerPhaseSurface('wizard-phase-arch');
      expect(service.surfaceForPhase('wizard-phase-arch')).toBe(surfaceId);
      expect(service.surfaceForPhase('wizard-phase-other')).toBeNull();
    });

    it('registerPhaseSurface seeds an empty StreamingState and surfaces it via phaseStreamingStates signal', () => {
      service.registerPhaseSurface('wizard-phase-discovery');

      const entries = service.phaseStreamingStates();
      expect(entries).toHaveLength(1);
      expect(entries[0].phaseKey).toBe('wizard-phase-discovery');
      expect(entries[0].state.events.size).toBe(0);
    });

    it('unregisterPhaseSurface calls StreamRouter.onSurfaceClosed and removes the surface mapping', () => {
      const surfaceId = service.registerPhaseSurface('wizard-phase-discovery');

      service.unregisterPhaseSurface('wizard-phase-discovery');

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
      expect(service.surfaceForPhase('wizard-phase-discovery')).toBeNull();
      // The router's onSurfaceClosed handles surfaceRegistry.unregister
      // internally — the wizard MUST NOT call surfaceRegistry.unregister
      // itself (would race residual events).
      expect(mockSurfaceRegistry.unregister).not.toHaveBeenCalled();
    });

    it('unregisterPhaseSurface is a no-op for unknown phaseKey', () => {
      service.unregisterPhaseSurface('wizard-phase-never-seen');

      expect(mockStreamRouter.onSurfaceClosed).not.toHaveBeenCalled();
    });

    it('unregisterAllPhaseSurfaces tears down routing for every phase but PRESERVES accumulated states', () => {
      service.registerPhaseSurface('wizard-phase-discovery');
      service.registerPhaseSurface('wizard-phase-arch');

      // Pre-condition: both phases visible in the signal.
      expect(service.phaseStreamingStates()).toHaveLength(2);

      service.unregisterAllPhaseSurfaces();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(2);
      expect(service.surfaceForPhase('wizard-phase-discovery')).toBeNull();
      expect(service.surfaceForPhase('wizard-phase-arch')).toBeNull();
      // Accumulated states stay visible — the analysis-transcript continues
      // to render completed phases after analysis-complete.
      expect(service.phaseStreamingStates()).toHaveLength(2);
    });

    it('resetPhaseSurfaces tears down routing AND wipes accumulated states', () => {
      service.registerPhaseSurface('wizard-phase-discovery');
      service.registerPhaseSurface('wizard-phase-arch');
      expect(service.phaseStreamingStates()).toHaveLength(2);

      service.resetPhaseSurfaces();

      expect(mockStreamRouter.onSurfaceClosed).toHaveBeenCalledTimes(2);
      expect(service.phaseStreamingStates()).toHaveLength(0);
      expect(service.surfaceForPhase('wizard-phase-discovery')).toBeNull();
    });

    it('routePhaseEvent lazy-mints a surface on first event for an unknown phaseKey', () => {
      const fakeEvent = {
        eventType: 'message_start',
        messageId: 'wizard-phase-discovery',
        sessionId: 'sess-1',
      } as unknown as Parameters<SetupWizardStateService['routePhaseEvent']>[1];

      service.routePhaseEvent('wizard-phase-discovery', fakeEvent);

      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledWith(
        fakeEvent,
        service.surfaceForPhase('wizard-phase-discovery'),
      );
    });

    it('routePhaseEvent reuses the existing surface for repeat events on the same phaseKey', () => {
      const evt1 = {
        eventType: 'message_start',
        messageId: 'wizard-phase-discovery',
        sessionId: 'sess-1',
      } as unknown as Parameters<SetupWizardStateService['routePhaseEvent']>[1];
      const evt2 = {
        eventType: 'text_delta',
        messageId: 'wizard-phase-discovery',
        sessionId: 'sess-1',
        blockIndex: 0,
        delta: 'hi',
      } as unknown as Parameters<SetupWizardStateService['routePhaseEvent']>[1];

      service.routePhaseEvent('wizard-phase-discovery', evt1);
      service.routePhaseEvent('wizard-phase-discovery', evt2);

      expect(mockStreamRouter.onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(mockStreamRouter.routeStreamEventForSurface).toHaveBeenCalledTimes(
        2,
      );
    });

    it('reset() invokes resetPhaseSurfaces (full nuke on wizard restart)', () => {
      service.registerPhaseSurface('wizard-phase-discovery');
      expect(service.phaseStreamingStates()).toHaveLength(1);

      service.reset();

      expect(service.phaseStreamingStates()).toHaveLength(0);
      expect(service.surfaceForPhase('wizard-phase-discovery')).toBeNull();
    });
  });
});
