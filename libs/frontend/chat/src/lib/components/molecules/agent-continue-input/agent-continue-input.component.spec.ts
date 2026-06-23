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

  function setup(agent: MonitoredAgent): void {
    continueAgent = jest.fn().mockResolvedValue({ ok: true });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AgentContinueInputComponent],
      providers: [{ provide: AgentMonitorStore, useValue: { continueAgent } }],
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
});
