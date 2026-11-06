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

function capabilities(steer: 'supported' | 'unsupported'): NonNullable<MonitoredAgent['effectiveCapabilities']> {
  return {
    agentId: agentId as NonNullable<MonitoredAgent['effectiveCapabilities']>['agentId'],
    resolvedAt: 1, source: 'live-handle',
    messaging: {
      steer: { state: steer }, interrupt: { state: 'unsupported' },
      continuation: { state: 'unsupported' }, resume: { state: 'unsupported' },
    },
    mcp: { state: 'unsupported' },
  };
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
    sendMessage = jest.fn().mockResolvedValue({ mode: 'queue-next-turn', receipt: { id: 'm-1', state: 'accepted' } });
    cancelMessage = jest.fn().mockResolvedValue({ id: 'm-1', reason: 'cancelled-by-user' });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AgentContinueInputComponent],
      providers: [{ provide: AgentMonitorStore, useValue: {
        receipts, agentsById: signal(new Map([[agentId, agent]])), composerState: () => state, previewMessage: jest.fn().mockResolvedValue(undefined),
        sendMessage, cancelMessage, receiptLabel: () => 'Received', receipt: () => undefined,
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

  it('shows Stop without a text input while running and Resume when stopped', () => {
    const running = makeAgent({ status: 'running', supportsContinuation: false });
    setup(running);
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Stop generating"]')).not.toBeNull();
    fixture.componentRef.setInput('agent', { ...running, status: 'stopped', cliSessionId: 'cli-1' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Resume codex session"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Stopped');
  });

  it('shows the composer and emits Stop for a running steer-capable lane without continuation', () => {
    setup(makeAgent({ supportsContinuation: false, effectiveCapabilities: capabilities('supported') }));
    expect(fixture.nativeElement.querySelector('textarea')).not.toBeNull();
    const stop = fixture.nativeElement.querySelector('[aria-label="Stop generating"]') as HTMLButtonElement;
    const requested = jest.fn();
    fixture.componentInstance.stopRequested.subscribe(requested);
    stop.click();
    expect(requested).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('stopPending', true);
    fixture.detectChanges();
    expect(stop.disabled).toBe(true);
  });

  it('shows Stop alone for a running lane without steering or continuation', () => {
    setup(makeAgent({ supportsContinuation: false, effectiveCapabilities: capabilities('unsupported') }));
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Stop generating"]')).not.toBeNull();
  });

  it('renders no message field when continuation is unavailable', () => {
    setup(makeAgent({ supportsContinuation: false, status: 'completed' }));
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    setup(makeAgent({ supportsContinuation: undefined, status: 'completed' }));
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('keeps a failed draft and clears only an accepted message', async () => {
    setup();
    const field = draft('follow up');
    sendMessage.mockResolvedValueOnce({ mode: 'unsupported', detail: 'Unavailable' });
    (Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Send') as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(field.value).toBe('follow up');
    expect(fixture.nativeElement.textContent).toContain('Unavailable');
    (Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Send') as HTMLButtonElement).click();
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
    (Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Send now') as HTMLButtonElement).click();
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
    expect(fixture.nativeElement.querySelector('[aria-label="Send options"]')?.getAttribute('aria-expanded')).toBe('true');
    fixture.nativeElement.querySelector('input, textarea').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Send options"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('offers Resume with message and no Send now when stopped', () => {
    setup(makeAgent({ status: 'stopped', supportsContinuation: false, cliSessionId: 'cli-session-123' }));
    expect(fixture.nativeElement.textContent).toContain('Resume CLI session cli-sess');
    expect(fixture.nativeElement.textContent).toContain('Resume with message');
    expect(fixture.nativeElement.textContent).not.toContain('Send now:');
  });

  it('cancels an accepted queued message', async () => {
    setup();
    receipts.set(new Map([[agentId, [{ id: 'm-1', state: 'accepted', delivery: 'queue', sender: 'user', preview: 'Queued text' }]]]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 queued');
    (fixture.nativeElement.querySelector('[aria-label="Edit queued message: Queued text"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(cancelMessage).toHaveBeenCalledWith(agentId, 'm-1');
  });
});
