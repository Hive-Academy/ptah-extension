import { TestBed } from '@angular/core/testing';
import { AgentGenerationStore } from './agent-generation.store';
import { WizardRpcService } from './wizard-rpc.service';

describe('AgentGenerationStore', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('only discovers a saved checkpoint until the user resumes', async () => {
    const resumeGeneration = jest.fn().mockResolvedValue({ success: true });
    TestBed.configureTestingModule({
      providers: [
        AgentGenerationStore,
        {
          provide: WizardRpcService,
          useValue: {
            getResumableRun: jest.fn().mockResolvedValue({
              generation: {
                runId: 'old',
                lifecycle: 'paused',
                selectedAgentIds: ['a'],
                agents: [
                  { agentId: 'a', status: 'written' },
                  { agentId: 'b', status: 'failed' },
                ],
              },
            }),
            resumeGeneration,
          },
        },
      ],
    });
    const store = TestBed.inject(AgentGenerationStore);
    await store.discover();
    expect(store.resumable()?.agents[0].status).toBe('written');
    expect(resumeGeneration).not.toHaveBeenCalled();
    await store.resume();
    expect(resumeGeneration).toHaveBeenCalledTimes(1);
    expect(store.checkpoint()?.agents[0].status).toBe('written');
  });

  it('guards duplicate retries and uses 1, 2, 4 second backoff', async () => {
    const retryGenerationItem = jest
      .fn()
      .mockRejectedValue(new Error('secret'));
    TestBed.configureTestingModule({
      providers: [
        AgentGenerationStore,
        { provide: WizardRpcService, useValue: { retryGenerationItem } },
      ],
    });
    const store = TestBed.inject(AgentGenerationStore);
    for (const delay of [1000, 2000, 4000]) {
      const attempt = store.retry('a');
      void store.retry('a');
      jest.advanceTimersByTime(delay - 1);
      expect(retryGenerationItem).toHaveBeenCalledTimes(
        [1000, 2000, 4000].indexOf(delay),
      );
      jest.advanceTimersByTime(1);
      await attempt;
    }
    expect(store.remaining('a')).toBe(0);
    await store.retry('a');
    expect(retryGenerationItem).toHaveBeenCalledTimes(3);
    expect(store.error()).toBe(true);
  });

  it('shows guidance-first advice only when status confirms no saved guidance', async () => {
    TestBed.configureTestingModule({
      providers: [
        AgentGenerationStore,
        {
          provide: WizardRpcService,
          useValue: {
            getEnhancedPromptsStatus: jest
              .fn()
              .mockResolvedValue({ hasGeneratedPrompt: false }),
          },
        },
      ],
    });
    const store = TestBed.inject(AgentGenerationStore);
    expect(store.guidanceStatus()).toBe('unknown');
    await store.checkGuidance('/ws');
    expect(store.guidanceStatus()).toBe('missing');
  });
});
