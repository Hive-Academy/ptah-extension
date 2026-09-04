import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AgentRecommendation,
  MultiPhaseAnalysisResponse,
  ResumableGenerationRun,
} from '@ptah-extension/shared';

import { SetupWizardStateService } from './setup-wizard-state.service';
import type { SkillGenerationProgressItem } from './setup-wizard-state.types';
import { WizardAnalysisRunner } from './wizard-analysis-runner.service';
import { WizardRpcService } from './wizard-rpc.service';

const mockMultiPhase = {
  isMultiPhase: true,
  analysisDir: '/mock/.ptah/analysis/demo',
} as unknown as MultiPhaseAnalysisResponse;

const pausedAnalysis = {
  isMultiPhase: true,
  analysisDir: '/mock/.ptah/analysis/demo',
  manifest: { lifecycle: 'paused' },
} as unknown as MultiPhaseAnalysisResponse;

const completedAnalysis = {
  isMultiPhase: true,
  analysisDir: '/mock/.ptah/analysis/demo',
  manifest: { lifecycle: 'completed' },
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

/**
 * The regression these cover: the analysis used to be owned by
 * `ScanProgressComponent`, so a view switch destroyed it mid-run and the
 * resolved result was discarded — returning to Setup re-ran the whole
 * analysis. The runner is root-scoped, so nothing here involves a component.
 */
describe('WizardAnalysisRunner', () => {
  let runner: WizardAnalysisRunner;
  let mockStateService: Partial<SetupWizardStateService>;
  let mockRpcService: Partial<WizardRpcService>;

  let multiPhaseResult: ReturnType<
    typeof signal<MultiPhaseAnalysisResponse | null>
  >;
  let recommendations: ReturnType<typeof signal<AgentRecommendation[]>>;
  let skillItems: ReturnType<typeof signal<SkillGenerationProgressItem[]>>;

  beforeEach(() => {
    multiPhaseResult = signal<MultiPhaseAnalysisResponse | null>(null);
    recommendations = signal<AgentRecommendation[]>([]);
    skillItems = signal<SkillGenerationProgressItem[]>([]);

    mockStateService = {
      multiPhaseResult: multiPhaseResult.asReadonly(),
      recommendations: recommendations.asReadonly(),
      skillGenerationProgress: skillItems.asReadonly(),
      reset: jest.fn(),
      setMultiPhaseResult: jest.fn((r: MultiPhaseAnalysisResponse) =>
        multiPhaseResult.set(r),
      ),
      setRecommendations: jest.fn((r: AgentRecommendation[]) =>
        recommendations.set(r),
      ),
      setSkillGenerationProgress: jest.fn(
        (items: SkillGenerationProgressItem[]) => skillItems.set(items),
      ),
      setCurrentStep: jest.fn(),
    } as unknown as Partial<SetupWizardStateService>;

    mockRpcService = {
      deepAnalyze: jest.fn().mockResolvedValue(mockMultiPhase),
      recommendAgents: jest.fn().mockResolvedValue(mockRecommendations),
      cancelAnalysis: jest.fn().mockResolvedValue(undefined),
      getResumableRun: jest
        .fn()
        .mockResolvedValue({ analysis: null, generation: null }),
      resumeGeneration: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as Partial<WizardRpcService>;

    TestBed.configureTestingModule({
      providers: [
        { provide: SetupWizardStateService, useValue: mockStateService },
        { provide: WizardRpcService, useValue: mockRpcService },
      ],
    });

    runner = TestBed.inject(WizardAnalysisRunner);
  });

  it('stores the result and advances the step', async () => {
    await runner.ensureStarted();

    expect(mockStateService.setMultiPhaseResult).toHaveBeenCalledWith(
      mockMultiPhase,
    );
    expect(mockStateService.setRecommendations).toHaveBeenCalledWith(
      mockRecommendations,
    );
    expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('analysis');
  });

  it('stores a result that resolves after the view is gone', async () => {
    let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
    (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveDeepAnalyze = resolve;
      }),
    );

    const run = runner.ensureStarted();
    // The view switch happens here — nothing tells the runner, by design.
    resolveDeepAnalyze(mockMultiPhase);
    await run;

    expect(mockStateService.setMultiPhaseResult).toHaveBeenCalledWith(
      mockMultiPhase,
    );
  });

  it('re-attaches to the in-flight run instead of starting a second one', async () => {
    let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
    (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveDeepAnalyze = resolve;
      }),
    );

    const first = runner.ensureStarted();
    const second = runner.ensureStarted();

    expect(second).toBe(first);

    // Let the discovery step settle so the run reaches deepAnalyze.
    await new Promise<void>((resolve) => setTimeout(resolve));
    expect(mockRpcService.deepAnalyze).toHaveBeenCalledTimes(1);

    resolveDeepAnalyze(mockMultiPhase);
    await first;
  });

  it('re-uses a stored result instead of re-analyzing', async () => {
    await runner.ensureStarted();
    (mockRpcService.deepAnalyze as jest.Mock).mockClear();

    await runner.ensureStarted();

    expect(mockRpcService.deepAnalyze).not.toHaveBeenCalled();
  });

  it('fetches only recommendations when a result is already stored', async () => {
    multiPhaseResult.set(mockMultiPhase);

    await runner.ensureStarted();

    expect(mockRpcService.deepAnalyze).not.toHaveBeenCalled();
    expect(mockRpcService.recommendAgents).toHaveBeenCalledWith(mockMultiPhase);
  });

  it('surfaces a failure and leaves the step alone', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (mockRpcService.deepAnalyze as jest.Mock).mockRejectedValue(
      new Error('Deep analysis failed: timeout'),
    );

    await runner.ensureStarted();

    expect(runner.errorMessage()).toBe('Deep analysis failed: timeout');
    expect(runner.statusText()).toBe('Analysis failed');
    expect(runner.isRunning()).toBe(false);
    expect(mockStateService.setCurrentStep).not.toHaveBeenCalled();
  });

  it('drops the result of a run the user cancelled', async () => {
    let resolveDeepAnalyze!: (value: MultiPhaseAnalysisResponse) => void;
    (mockRpcService.deepAnalyze as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveDeepAnalyze = resolve;
      }),
    );

    const run = runner.ensureStarted();
    await runner.cancel();
    resolveDeepAnalyze(mockMultiPhase);
    await run;

    expect(mockRpcService.cancelAnalysis).toHaveBeenCalled();
    expect(mockStateService.reset).toHaveBeenCalled();
    expect(mockStateService.setMultiPhaseResult).not.toHaveBeenCalled();
    expect(mockStateService.setCurrentStep).not.toHaveBeenCalled();
  });

  it('lets a reset start a fresh run', async () => {
    await runner.ensureStarted();
    runner.reset();
    multiPhaseResult.set(null);
    (mockRpcService.deepAnalyze as jest.Mock).mockClear();

    await runner.ensureStarted();

    expect(mockRpcService.deepAnalyze).toHaveBeenCalledTimes(1);
  });

  describe('resume discovery (restart recovery)', () => {
    it('holds on an unfinished analysis instead of restarting it', async () => {
      (mockRpcService.getResumableRun as jest.Mock).mockResolvedValue({
        analysis: pausedAnalysis,
        generation: null,
      });

      await runner.ensureStarted();

      expect(mockRpcService.deepAnalyze).not.toHaveBeenCalled();
      expect(runner.resumableAnalysis()).toBe(pausedAnalysis);
      expect(runner.statusText()).toBe('An unfinished analysis was found.');
    });

    it('queries wizard:get-resumable-run only once per session', async () => {
      await runner.ensureStarted();
      runner.reset();
      multiPhaseResult.set(null);
      await runner.ensureStarted();

      expect(mockRpcService.getResumableRun).toHaveBeenCalledTimes(1);
    });

    it('resumeAnalysis continues the run with the resume flag', async () => {
      (mockRpcService.getResumableRun as jest.Mock).mockResolvedValue({
        analysis: pausedAnalysis,
        generation: null,
      });
      await runner.ensureStarted();

      await runner.resumeAnalysis();

      expect(runner.resumableAnalysis()).toBeNull();
      expect(mockRpcService.deepAnalyze).toHaveBeenCalledWith({
        resume: true,
      });
      expect(mockStateService.setMultiPhaseResult).toHaveBeenCalledWith(
        mockMultiPhase,
      );
      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith('analysis');
    });

    it('startFreshAnalysis discards the offer and analyzes without resume', async () => {
      (mockRpcService.getResumableRun as jest.Mock).mockResolvedValue({
        analysis: pausedAnalysis,
        generation: null,
      });
      await runner.ensureStarted();

      await runner.startFreshAnalysis();

      expect(runner.resumableAnalysis()).toBeNull();
      expect(mockRpcService.deepAnalyze).toHaveBeenCalledWith({
        resume: false,
      });
    });

    it('adopts a completed analysis and surfaces its generation checkpoint', async () => {
      (mockRpcService.getResumableRun as jest.Mock).mockResolvedValue({
        analysis: completedAnalysis,
        generation: mockGenerationRun,
      });

      await runner.ensureStarted();

      // Completed analysis is stored, never re-run.
      expect(mockStateService.setMultiPhaseResult).toHaveBeenCalledWith(
        completedAnalysis,
      );
      expect(mockRpcService.deepAnalyze).not.toHaveBeenCalled();
      expect(runner.resumableAnalysis()).toBeNull();
      expect(runner.resumableGeneration()).toBe(mockGenerationRun);
    });
  });

  describe('resumeGeneration', () => {
    beforeEach(async () => {
      (mockRpcService.getResumableRun as jest.Mock).mockResolvedValue({
        analysis: completedAnalysis,
        generation: mockGenerationRun,
      });
      await runner.ensureStarted();
    });

    it('seeds items from the persisted checkpoint and moves to generation', async () => {
      await runner.resumeGeneration();

      expect(mockStateService.setSkillGenerationProgress).toHaveBeenCalledWith([
        {
          id: 'frontend-developer',
          name: 'frontend-developer.md',
          type: 'agent',
          status: 'complete',
          progress: 100,
        },
        {
          id: 'backend-developer',
          name: 'backend-developer.md',
          type: 'agent',
          status: 'pending',
        },
      ]);
      expect(mockStateService.setCurrentStep).toHaveBeenCalledWith(
        'generation',
      );
      expect(mockRpcService.resumeGeneration).toHaveBeenCalledTimes(1);
      expect(runner.resumableGeneration()).toBeNull();
    });

    it('is a no-op without a discovered checkpoint', async () => {
      await runner.resumeGeneration();
      (mockRpcService.resumeGeneration as jest.Mock).mockClear();

      await runner.resumeGeneration();

      expect(mockRpcService.resumeGeneration).not.toHaveBeenCalled();
    });

    it('marks still-pending items as failed when the resume RPC fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      (mockRpcService.resumeGeneration as jest.Mock).mockRejectedValue(
        new Error('no checkpoint'),
      );

      await runner.resumeGeneration();

      const items = skillItems();
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get('backend-developer')?.status).toBe('error');
      expect(byId.get('backend-developer')?.errorMessage).toBe('no checkpoint');
      // Already-terminal items keep their state.
      expect(byId.get('frontend-developer')?.status).toBe('complete');
    });
  });
});
