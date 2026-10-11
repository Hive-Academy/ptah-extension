/**
 * AgentFollowUpQueueService (TASK_2026_524 batch 3b) — a follow-up queued on a
 * running agent is sent when the run ends even with no agent card alive, which
 * is the case on a standalone surface where the shell row is detached.
 *
 * Signal-driven fake AgentMonitorStore: each test publishes agent states into
 * `agents` and flushes effects with `TestBed.tick()`. No component is created
 * anywhere in this file.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { AgentFollowUpQueueService } from './agent-follow-up-queue.service';

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: 'Do work',
    status: 'running',
    startedAt: 0,
    stdout: '',
    stderr: '',
    expanded: true,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    permissionQueue: [],
    supportsContinuation: true,
    ...overrides,
  } as MonitoredAgent;
}

/** Let the effect run, then let the `send` it started settle. */
async function settle(): Promise<void> {
  TestBed.tick();
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('AgentFollowUpQueueService', () => {
  let agents: ReturnType<typeof signal<readonly MonitoredAgent[]>>;
  let continueAgent: jest.Mock;
  let resumeAgentWithMessage: jest.Mock;
  let service: AgentFollowUpQueueService;

  beforeEach(() => {
    agents = signal<readonly MonitoredAgent[]>([makeAgent()]);
    continueAgent = jest.fn().mockResolvedValue({ ok: true });
    resumeAgentWithMessage = jest.fn().mockResolvedValue({ ok: true });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: { agents, continueAgent, resumeAgentWithMessage },
        },
      ],
    });
    service = TestBed.inject(AgentFollowUpQueueService);
    TestBed.tick();
  });

  it('sends the queued follow-up when the run ends, with no component alive', async () => {
    service.enqueue('agent-1', 'follow up');
    await settle();
    expect(continueAgent).not.toHaveBeenCalled();

    agents.set([makeAgent({ status: 'completed' })]);
    await settle();

    expect(continueAgent).toHaveBeenCalledWith('agent-1', 'follow up');
    expect(service.queued('agent-1')).toBeNull();
  });

  it('keeps waiting while the agent is still running and coalesces repeats', async () => {
    service.enqueue('agent-1', 'first');
    agents.set([makeAgent({ streamRevision: 1 })]);
    await settle();
    service.enqueue('agent-1', 'second');

    expect(continueAgent).not.toHaveBeenCalled();
    expect(service.queued('agent-1')).toBe('first\nsecond');
  });

  it('sends once, not again on later status changes', async () => {
    service.enqueue('agent-1', 'follow up');
    agents.set([makeAgent({ status: 'completed' })]);
    await settle();
    agents.set([makeAgent({ status: 'failed' })]);
    await settle();

    expect(continueAgent).toHaveBeenCalledTimes(1);
  });

  it('does not flush a message the user took back with unqueue', async () => {
    service.enqueue('agent-1', 'follow up');

    expect(service.unqueue('agent-1')).toBe('follow up');
    agents.set([makeAgent({ status: 'completed' })]);
    await settle();

    expect(continueAgent).not.toHaveBeenCalled();
  });

  it('re-queues on busy and retries only once the card changes', async () => {
    service.enqueue('agent-1', 'follow up');
    continueAgent.mockResolvedValueOnce({ ok: false, code: 'busy' });
    const stale = makeAgent({ status: 'completed' });
    agents.set([stale]);
    await settle();

    expect(service.queued('agent-1')).toBe('follow up');
    expect(service.error('agent-1')).toBeNull();

    // An unrelated agent updating must not retry against the same stale card.
    agents.set([stale, makeAgent({ agentId: 'agent-2' })]);
    await settle();
    expect(continueAgent).toHaveBeenCalledTimes(1);

    agents.set([makeAgent({ status: 'completed', streamRevision: 2 })]);
    await settle();
    expect(continueAgent).toHaveBeenCalledTimes(2);
    expect(service.queued('agent-1')).toBeNull();
  });

  it('flushes a resume-only agent through resumeAgentWithMessage', async () => {
    const running = makeAgent({
      supportsContinuation: undefined,
      cliSessionId: 'sess-a',
    });
    agents.set([running]);
    await settle();
    service.enqueue('agent-1', 'follow up');

    agents.set([{ ...running, status: 'completed' }]);
    await settle();

    expect(continueAgent).not.toHaveBeenCalled();
    expect(resumeAgentWithMessage).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
      'follow up',
    );
  });

  it('falls back to resume when continue answers not_found', async () => {
    agents.set([makeAgent({ cliSessionId: 'sess-a' })]);
    await settle();
    service.enqueue('agent-1', 'follow up');
    continueAgent.mockResolvedValueOnce({ ok: false, code: 'not_found' });

    agents.set([makeAgent({ cliSessionId: 'sess-a', status: 'completed' })]);
    await settle();

    expect(resumeAgentWithMessage).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
      'follow up',
    );
    expect(service.undelivered('agent-1')).toBeNull();
  });

  describe('a cliSessionId merged while agent:continue is in flight', () => {
    function deferContinue(): (answer: { ok: boolean; code?: string }) => void {
      let answer!: (value: { ok: boolean; code?: string }) => void;
      continueAgent.mockReturnValueOnce(
        new Promise((resolve) => (answer = resolve)),
      );
      return (value) => answer(value);
    }

    it('resumes with the latest card, not the snapshot taken before the await', async () => {
      service.enqueue('agent-1', 'follow up');
      const answer = deferContinue();
      agents.set([makeAgent({ status: 'completed' })]);
      await settle();
      expect(continueAgent).toHaveBeenCalledTimes(1);

      // The store learns the session id while the RPC is still pending.
      agents.set([makeAgent({ status: 'completed', cliSessionId: 'sess-late' })]);
      answer({ ok: false, code: 'not_found' });
      await settle();

      expect(resumeAgentWithMessage).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', cliSessionId: 'sess-late' }),
        'follow up',
      );
      expect(service.error('agent-1')).toBeNull();
      expect(service.undelivered('agent-1')).toBeNull();
    });

    it('falls back to the snapshot when the card is gone by the time the RPC answers', async () => {
      const answer = deferContinue();
      const pending = service.send(
        makeAgent({ status: 'completed', cliSessionId: 'sess-a' }),
        'follow up',
      );

      agents.set([]);
      answer({ ok: false, code: 'released' });
      await pending;

      expect(resumeAgentWithMessage).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', cliSessionId: 'sess-a' }),
        'follow up',
      );
    });
  });

  it('keeps a background flush that failed, for the box to take back once', async () => {
    service.enqueue('agent-1', 'follow up');
    continueAgent.mockResolvedValueOnce({ ok: false, code: 'unknown' });

    agents.set([makeAgent({ status: 'completed' })]);
    await settle();

    expect(service.error('agent-1')).toContain('Could not send');
    expect(service.sending('agent-1')).toBe(false);
    expect(service.takeUndelivered('agent-1')).toBe('follow up');
    expect(service.takeUndelivered('agent-1')).toBeNull();
  });

  it('keeps the message and quotes the reason when the store throws', async () => {
    continueAgent.mockRejectedValueOnce(new Error('rpc down'));

    await service.send(makeAgent({ status: 'completed' }), 'follow up');

    expect(service.error('agent-1')).toBe('rpc down');
    expect(service.undelivered('agent-1')).toBe('follow up');
  });

  it('drops the state of an agent whose card was dismissed', async () => {
    service.enqueue('agent-1', 'follow up');

    agents.set([]);
    await settle();

    expect(service.queued('agent-1')).toBeNull();
    expect(continueAgent).not.toHaveBeenCalled();
  });
});
