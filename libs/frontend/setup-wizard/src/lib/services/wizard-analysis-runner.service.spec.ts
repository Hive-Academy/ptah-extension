import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AgentRecommendation,
  MultiPhaseAnalysisResponse,
} from '@ptah-extension/shared';

import { SetupWizardStateService } from './setup-wizard-state.service';
import { WizardAnalysisRunner } from './wizard-analysis-runner.service';
import { WizardRpcService } from './wizard-rpc.service';

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

  beforeEach(() => {
    multiPhaseResult = signal<MultiPhaseAnalysisResponse | null>(null);
    recommendations = signal<AgentRecommendation[]>([]);

    mockStateService = {
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

    expect(mockRpcService.deepAnalyze).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

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
});
