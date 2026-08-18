import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AgentContinueInputComponent } from './agent-continue-input.component';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: 'Do work',
    status: 'completed',
    startedAt: Date.now(),
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

describe('AgentContinueInputComponent', () => {
  let fixture: ComponentFixture<AgentContinueInputComponent>;
  let component: AgentContinueInputComponent;
  let continueAgent: jest.Mock;
  let resumeAgentWithMessage: jest.Mock;

  function setup(agent: MonitoredAgent): void {
    continueAgent = jest.fn().mockResolvedValue({ ok: true });
    resumeAgentWithMessage = jest.fn().mockResolvedValue({ ok: true });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AgentContinueInputComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: { continueAgent, resumeAgentWithMessage },
        },
      ],
    });
    fixture = TestBed.createComponent(AgentContinueInputComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
  }

  it('renders nothing when supportsContinuation is not true', () => {
    setup(makeAgent({ supportsContinuation: false }));
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('renders nothing when supportsContinuation is undefined', () => {
    setup(makeAgent({ supportsContinuation: undefined }));
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('renders the input when supportsContinuation is true', () => {
    setup(makeAgent({ supportsContinuation: true }));
    expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
  });

  it('leaves the input usable while the agent is running so a follow-up can be queued', () => {
    setup(makeAgent({ status: 'running', supportsContinuation: true }));
    const textarea = fixture.nativeElement.querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    expect(component['subtitle']()).toContain('queues');
  });

  it('clears the draft on successful submit', async () => {
    setup(makeAgent());
    component['draft'].set('follow up');

    await component['submit']();

    expect(continueAgent).toHaveBeenCalledWith('agent-1', 'follow up');
    expect(component['draft']()).toBe('');
  });

  it('re-queues rather than erroring when the backend still answers busy', async () => {
    // The card's status lagged the backend. Erroring here is how the typed
    // message used to be thrown away.
    setup(makeAgent());
    continueAgent.mockResolvedValueOnce({ ok: false, code: 'busy' });
    component['draft'].set('follow up');

    await component['submit']();

    expect(component['queued']()).toBe('follow up');
    expect(component['error']()).toBeNull();
  });

  it('does not call the store when the draft is blank', async () => {
    setup(makeAgent());
    component['draft'].set('   ');

    await component['submit']();

    expect(continueAgent).not.toHaveBeenCalled();
  });

  describe('queue while running, flush at turn end (TASK_2026_294)', () => {
    it('queues instead of calling the store while the agent is running', async () => {
      setup(makeAgent({ status: 'running' }));
      component['draft'].set('give the agent more time');

      await component['submit']();

      expect(continueAgent).not.toHaveBeenCalled();
      expect(component['queued']()).toBe('give the agent more time');
      expect(component['draft']()).toBe('');
    });

    it('coalesces repeat follow-ups into one message', async () => {
      setup(makeAgent({ status: 'running' }));

      component['draft'].set('first');
      await component['submit']();
      component['draft'].set('second');
      await component['submit']();

      expect(component['queued']()).toBe('first\nsecond');
    });

    it('sends the queued message once the agent leaves running', async () => {
      setup(makeAgent({ status: 'running' }));
      component['draft'].set('follow up');
      await component['submit']();
      expect(continueAgent).not.toHaveBeenCalled();

      fixture.componentRef.setInput(
        'agent',
        makeAgent({ status: 'completed' }),
      );
      fixture.detectChanges();
      await Promise.resolve();

      expect(continueAgent).toHaveBeenCalledWith('agent-1', 'follow up');
      expect(component['queued']()).toBeNull();
    });

    it('does not resend on later status changes', async () => {
      setup(makeAgent({ status: 'running' }));
      component['draft'].set('follow up');
      await component['submit']();

      fixture.componentRef.setInput(
        'agent',
        makeAgent({ status: 'completed' }),
      );
      fixture.detectChanges();
      await Promise.resolve();
      fixture.componentRef.setInput('agent', makeAgent({ status: 'failed' }));
      fixture.detectChanges();
      await Promise.resolve();

      expect(continueAgent).toHaveBeenCalledTimes(1);
    });

    it('puts a queued message back in the box on unqueue', async () => {
      setup(makeAgent({ status: 'running' }));
      component['draft'].set('follow up');
      await component['submit']();

      component['unqueue']();

      expect(component['queued']()).toBeNull();
      expect(component['draft']()).toBe('follow up');
    });

    it('restores the message when the flush fails, instead of dropping it', async () => {
      setup(makeAgent({ status: 'running' }));
      component['draft'].set('follow up');
      await component['submit']();
      continueAgent.mockResolvedValueOnce({ ok: false, code: 'unknown' });

      fixture.componentRef.setInput(
        'agent',
        makeAgent({ status: 'completed' }),
      );
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();

      expect(component['draft']()).toBe('follow up');
      expect(component['error']()).toContain('Could not send');
    });
  });

  describe('expired records fall back to a session resume', () => {
    it('resumes the session when continue answers not_found', async () => {
      setup(makeAgent({ cliSessionId: 'session-9' }));
      continueAgent.mockResolvedValueOnce({ ok: false, code: 'not_found' });
      component['draft'].set('follow up');

      await component['submit']();

      // The conversation is still on disk. Telling the user to start a new
      // agent would throw away the context they are following up ON.
      expect(resumeAgentWithMessage).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1' }),
        'follow up',
      );
      expect(component['draft']()).toBe('');
      expect(component['error']()).toBeNull();
    });

    it('skips the doomed continue call once the card is known expired', async () => {
      setup(
        makeAgent({ continuationExpired: true, cliSessionId: 'session-9' }),
      );
      component['draft'].set('follow up');

      await component['submit']();

      expect(continueAgent).not.toHaveBeenCalled();
      expect(resumeAgentWithMessage).toHaveBeenCalled();
    });

    it('says so when there is no session to resume with', async () => {
      setup(makeAgent({ cliSessionId: undefined }));
      continueAgent.mockResolvedValueOnce({ ok: false, code: 'not_found' });
      component['draft'].set('follow up');

      await component['submit']();

      expect(resumeAgentWithMessage).not.toHaveBeenCalled();
      expect(component['draft']()).toBe('follow up');
      expect(component['error']()).toContain('no session to resume');
    });

    it('keeps the draft and quotes the reason when the resume fails', async () => {
      setup(
        makeAgent({ continuationExpired: true, cliSessionId: 'session-9' }),
      );
      resumeAgentWithMessage.mockResolvedValueOnce({
        ok: false,
        error: 'no such session file',
      });
      component['draft'].set('follow up');

      await component['submit']();

      expect(component['draft']()).toBe('follow up');
      expect(component['error']()).toContain('no such session file');
    });

    it('announces the resume in the subtitle, but only with a session id', () => {
      setup(
        makeAgent({ continuationExpired: true, cliSessionId: 'session-9' }),
      );
      expect(component['subtitle']()).toContain('resumes the session');

      setup(makeAgent({ continuationExpired: true, cliSessionId: undefined }));
      expect(component['subtitle']()).toBe('Send a follow-up');
    });
  });
});
