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

  it('disables the input while the agent is running', () => {
    setup(makeAgent({ status: 'running', supportsContinuation: true }));
    const textarea = fixture.nativeElement.querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('clears the draft on successful submit', async () => {
    setup(makeAgent());
    component['draft'].set('follow up');

    await component['submit']();

    expect(continueAgent).toHaveBeenCalledWith('agent-1', 'follow up');
    expect(component['draft']()).toBe('');
  });

  it('retains the draft and shows a busy message on code=busy', async () => {
    setup(makeAgent());
    continueAgent.mockResolvedValueOnce({ ok: false, code: 'busy' });
    component['draft'].set('follow up');

    await component['submit']();

    expect(component['draft']()).toBe('follow up');
    expect(component['error']()).toContain('busy');
  });

  it('does not call the store when the draft is blank', async () => {
    setup(makeAgent());
    component['draft'].set('   ');

    await component['submit']();

    expect(continueAgent).not.toHaveBeenCalled();
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
