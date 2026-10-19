import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SubagentRecord } from '@ptah-extension/chat-streaming';
import type { AgentFeedbackSendResult } from '@ptah-extension/core';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import { ChatAgentFeedbackSender } from '../../../services/agent-feedback/chat-agent-feedback-sender.service';
import { SubagentLaneComposerComponent } from './subagent-lane-composer.component';

describe('SubagentLaneComposerComponent', () => {
  const steer = jest.fn<Promise<boolean>, [TrayAgentContext, string]>();
  const send = jest.fn<
    Promise<AgentFeedbackSendResult>,
    [{ sessionId: string } | 'active', string]
  >();

  const record: SubagentRecord = {
    parentToolUseId: 'tool-1',
    parentSessionId: 'session-1',
    agentType: 'Explore',
    agentId: 'a01',
    taskDescription: 'Map the repo',
    status: 'completed',
  };

  const context = (steerable: boolean): TrayAgentContext => ({
    entry: {
      id: 'tool-1',
      name: 'Explore',
      origin: 'foreground',
      status: 'running',
      canBackground: false,
      stoppable: false,
      steerable,
    },
    taskId: 'task-1',
    sessionId: 'session-1',
    model: null,
  });

  function setup(
    rec: SubagentRecord,
    ctx: TrayAgentContext | null = null,
    sessionId: string | null = null,
  ): ComponentFixture<SubagentLaneComposerComponent> {
    const fixture = TestBed.createComponent(SubagentLaneComposerComponent);
    fixture.componentRef.setInput('record', rec);
    fixture.componentRef.setInput('context', ctx);
    fixture.componentRef.setInput('sessionId', sessionId);
    fixture.detectChanges();
    return fixture;
  }

  const root = (fixture: ComponentFixture<unknown>): HTMLElement =>
    fixture.nativeElement as HTMLElement;
  const field = (fixture: ComponentFixture<unknown>): HTMLInputElement =>
    root(fixture).querySelector('input') as HTMLInputElement;
  const byId = (fixture: ComponentFixture<unknown>, id: string) =>
    root(fixture).querySelector(`[data-testid="${id}"]`);

  async function type(
    fixture: ComponentFixture<unknown>,
    text: string,
  ): Promise<void> {
    const input = field(fixture);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    steer.mockReset();
    send.mockReset();
    TestBed.configureTestingModule({
      imports: [SubagentLaneComposerComponent],
      providers: [
        { provide: SessionAgentTrayService, useValue: { steer } },
        { provide: ChatAgentFeedbackSender, useValue: { send } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('picks the mode from the tray context and the owning session', () => {
    expect(
      setup(
        { ...record, status: 'running' },
        context(true),
      ).componentInstance.mode(),
    ).toBe('steer');
    expect(setup(record, context(false)).componentInstance.mode()).toBe(
      'follow-up',
    );
  });

  it('falls back to the lane session for the follow-up', () => {
    const fixture = setup(
      { ...record, parentSessionId: undefined },
      null,
      'lane-session',
    );
    expect(fixture.componentInstance.mode()).toBe('follow-up');
  });

  it('shows the unavailable notice without any known session', () => {
    const fixture = setup({ ...record, parentSessionId: undefined });
    expect(fixture.componentInstance.mode()).toBe('unavailable');
    expect(
      byId(fixture, 'subagent-composer-unavailable')?.textContent,
    ).toContain("This agent's session is not open");
    expect(root(fixture).querySelector('input')).toBeNull();
  });

  it('steers a running agent, keeps the draft on failure and clears it on success', async () => {
    steer.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const fixture = setup({ ...record, status: 'running' }, context(true));
    expect(field(fixture).placeholder).toBe('Message Explore…');
    expect(byId(fixture, 'subagent-composer-hint')).toBeNull();
    expect(
      root(fixture).querySelector('[aria-label="Send steer message"]'),
    ).not.toBeNull();
    await type(fixture, 'Check tests');
    expect(steer).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Check tests',
    );
    expect(byId(fixture, 'subagent-composer-error')?.getAttribute('role')).toBe(
      'alert',
    );
    expect(field(fixture).value).toBe('Check tests');
    await type(fixture, 'Check tests');
    expect(byId(fixture, 'subagent-composer-error')).toBeNull();
    expect(field(fixture).value).toBe('');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a finished agent the follow-up prompt through the main chat', async () => {
    send.mockResolvedValue({ sent: true });
    const fixture = setup(record);
    expect(field(fixture).placeholder).toBe(
      'Ask the main agent to continue Explore…',
    );
    expect(byId(fixture, 'subagent-composer-hint')?.textContent).toContain(
      'Sends to the main chat as a follow-up',
    );
    expect(
      root(fixture).querySelector('[aria-label="Send follow-up"]'),
    ).not.toBeNull();
    await type(fixture, 'Add tests');
    expect(send).toHaveBeenCalledWith(
      { sessionId: 'session-1' },
      'Continue the Explore sub-agent (agent id a01) that worked on "Map the repo" with this message from me:\n\nAdd tests',
    );
    expect(field(fixture).value).toBe('');
    const status = byId(fixture, 'subagent-composer-status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toContain('Sent to the main chat');
    expect(steer).not.toHaveBeenCalled();
  });

  it('shows the sender error and keeps the draft when the follow-up fails', async () => {
    send.mockResolvedValue({
      sent: false,
      error: 'No chat tab for this session',
    });
    const fixture = setup(record);
    await type(fixture, 'Add tests');
    expect(byId(fixture, 'subagent-composer-error')?.textContent).toContain(
      'No chat tab for this session',
    );
    expect(field(fixture).value).toBe('Add tests');
  });

  it('resets the draft and messages when the lane shows another agent', async () => {
    send.mockResolvedValue({ sent: false, error: 'Failed' });
    const fixture = setup(record);
    await type(fixture, 'For agent A');
    expect(byId(fixture, 'subagent-composer-error')).not.toBeNull();
    fixture.componentRef.setInput('record', {
      ...record,
      parentToolUseId: 'tool-2',
    });
    fixture.detectChanges();
    expect(field(fixture).value).toBe('');
    expect(byId(fixture, 'subagent-composer-error')).toBeNull();
  });

  it('drops a late reply that arrives after the agent changed', async () => {
    let resolve: (result: AgentFeedbackSendResult) => void = () => undefined;
    send.mockReturnValue(
      new Promise<AgentFeedbackSendResult>((done) => (resolve = done)),
    );
    const fixture = setup(record);
    const input = field(fixture);
    input.value = 'For agent A';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.componentRef.setInput('record', {
      ...record,
      parentToolUseId: 'tool-2',
    });
    fixture.detectChanges();
    resolve({ sent: false, error: 'Late failure' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(byId(fixture, 'subagent-composer-error')).toBeNull();
    expect(field(fixture).disabled).toBe(false);
  });
});
