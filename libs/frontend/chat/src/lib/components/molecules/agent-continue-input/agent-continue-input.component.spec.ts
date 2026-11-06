import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AgentMonitorStore, type MonitoredAgent } from '@ptah-extension/chat-streaming';
import { AgentContinueInputComponent } from './agent-continue-input.component';

const agentId = '11111111-1111-4111-8111-111111111111';

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId, cli: 'codex', task: 'Do work', status: 'running', startedAt: 1,
    stdout: '', stderr: '', expanded: true, segments: [], streamEvents: [],
    streamRevision: 0, permissionQueue: [], supportsContinuation: true,
    ...overrides,
  } as MonitoredAgent;
}

describe('AgentContinueInputComponent', () => {
  let fixture: ComponentFixture<AgentContinueInputComponent>;
  let sendMessage: jest.Mock;
  let cancelMessage: jest.Mock;
  let state: { queue: { mode: string; usesResume: boolean }; now: { mode: string; lossDisclosure?: { confirmationRequired: boolean } } };
  const receipts = signal(new Map<string, Array<{ id: string; state: string; delivery: string }>>());

  function setup(agent = makeAgent(), variant: 'panel' | 'composer' = 'composer'): void {
    state = { queue: { mode: 'queue-next-turn', usesResume: agent.status !== 'running' && !!agent.cliSessionId }, now: { mode: 'steer' } };
    receipts.set(new Map());
    sendMessage = jest.fn().mockResolvedValue({ mode: 'queue-next-turn', receipt: { state: 'accepted' } });
    cancelMessage = jest.fn().mockResolvedValue(undefined);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AgentContinueInputComponent],
      providers: [{ provide: AgentMonitorStore, useValue: {
        receipts, composerState: () => state, previewMessage: jest.fn().mockResolvedValue(undefined),
        sendMessage, cancelMessage, receiptLabel: () => 'Received',
      } }],
    });
    fixture = TestBed.createComponent(AgentContinueInputComponent);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
  }

  function draft(text: string): HTMLInputElement | HTMLTextAreaElement {
    const field = fixture.nativeElement.querySelector('textarea, input') as HTMLInputElement | HTMLTextAreaElement;
    field.value = text;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    return field;
  }

  it('shows full and compact variants', () => {
    setup();
    expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
    setup(makeAgent(), 'panel');
    expect(fixture.nativeElement.querySelector('input')).not.toBeNull();
  });

  it('keeps a failed draft and clears only an accepted message', async () => {
    setup();
    const field = draft('follow up');
    sendMessage.mockResolvedValueOnce({ mode: 'unsupported', detail: 'Unavailable' });
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(field.value).toBe('follow up');
    expect(fixture.nativeElement.textContent).toContain('Unavailable');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(sendMessage).toHaveBeenLastCalledWith(agentId, 'follow up', 'queue', false);
    expect(field.value).toBe('');
  });

  it('confirms turn loss before Send now', async () => {
    setup();
    state.now = { mode: 'interrupt-resume', lossDisclosure: { confirmationRequired: true } };
    fixture.detectChanges();
    draft('urgent');
    (fixture.nativeElement.querySelector('[aria-label="Send options"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Partial work in this turn will be discarded.');
    expect(sendMessage).not.toHaveBeenCalled();
    (fixture.nativeElement.querySelector('[role="alertdialog"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(sendMessage).toHaveBeenCalledWith(agentId, 'urgent', 'now', true);
  });

  it('uses Enter for queue', async () => {
    setup();
    const field = draft('first');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable(); fixture.detectChanges();
    expect(sendMessage).toHaveBeenCalledWith(agentId, 'first', 'queue', false);
  });

  it('uses Ctrl+Enter for Send now', async () => {
    setup();
    const secondField = draft('second');
    secondField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await fixture.whenStable();
    expect(sendMessage).toHaveBeenCalledWith(agentId, 'second', 'now', false);
  });

  it('closes the Send now menu with Escape', () => {
    setup();
    draft('urgent');
    (fixture.nativeElement.querySelector('[aria-label="Send options"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).not.toBeNull();
    fixture.nativeElement.querySelector('input, textarea').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();
  });

  it('offers Resume with message and no Send now when stopped', () => {
    setup(makeAgent({ status: 'stopped', supportsContinuation: false, cliSessionId: 'cli-session-123' }));
    expect(fixture.nativeElement.textContent).toContain('resume cli session cli-sess');
    expect(fixture.nativeElement.textContent).toContain('Resume with message');
    expect(fixture.nativeElement.textContent).not.toContain('Send now:');
  });

  it('cancels an accepted queued message', async () => {
    setup();
    receipts.set(new Map([[agentId, [{ id: 'm-1', state: 'accepted', delivery: 'queue' }]]]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 queued');
    (fixture.nativeElement.querySelector('[aria-label="Cancel queued message m-1"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(cancelMessage).toHaveBeenCalledWith(agentId, 'm-1');
  });
});
