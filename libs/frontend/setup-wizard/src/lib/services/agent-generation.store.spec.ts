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

  it('refreshes a bound checkpoint after success and preserves the attempt count on failure', async () => {
    const binding = {
      tabId: 'tab',
      workspacePath: '/ws',
      workflow: 'setup-agent-generation' as const,
      runId: 'run',
    };
    const getResumableRun = jest
      .fn()
      .mockResolvedValueOnce({
        generation: {
          runId: 'run',
          lifecycle: 'failed',
          agents: [{ agentId: 'a', status: 'failed' }],
        },
      })
      .mockResolvedValue({
        generation: {
          runId: 'run',
          lifecycle: 'completed',
          agents: [{ agentId: 'a', status: 'written' }],
        },
      });
    const retryGenerationItem = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('failed'));
    TestBed.configureTestingModule({
      providers: [
        AgentGenerationStore,
        {
          provide: WizardRpcService,
          useValue: { getResumableRun, retryGenerationItem },
        },
      ],
    });
    const store = TestBed.inject(AgentGenerationStore);
    await store.discover();
    const first = store.retry('a', binding);
    jest.advanceTimersByTime(1000);
    await first;
    expect(retryGenerationItem).toHaveBeenCalledWith('a', binding);
    expect(store.checkpoint()?.agents[0].status).toBe('written');
    expect(store.remaining('a')).toBe(2);
    const second = store.retry('a', binding);
    jest.advanceTimersByTime(2000);
    await second;
    expect(store.remaining('a')).toBe(1);
    expect(store.error()).toBe(true);
    expect(getResumableRun).toHaveBeenCalledTimes(2);
    expect(store.checkpoint()?.agents[0].status).toBe('written');
    const nextRun = store.retry('a', { ...binding, runId: 'next-run' });
    jest.advanceTimersByTime(1000);
    await nextRun;
    expect(store.remaining('a')).toBe(2);
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
