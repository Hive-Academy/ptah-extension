import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { LaneComposerComponent } from './lane-composer.component';

describe('LaneComposerComponent', () => {
  const agentId = '00000000-0000-4000-8000-000000000001';
  const receipt = { id: 'message-1', agentId, sender: 'user', state: 'accepted',
    delivery: 'queue', mode: 'queue-next-turn', preview: 'Earlier text', createdAt: 1, updatedAt: 1 };
  const receipts = signal<ReadonlyMap<string, readonly typeof receipt[]>>(new Map());
  const sendMessage = jest.fn();
  const cancelMessage = jest.fn();
  const previewMessage = jest.fn().mockResolvedValue(undefined);
  const store = {
    receipts, agentsById: signal(new Map()), sendMessage, cancelMessage, previewMessage,
    composerState: jest.fn(() => ({ queue: { supported: true, mode: 'queue-next-turn' }, now: { supported: true, mode: 'steer' } })),
    receiptLabel: () => 'Queued',
    receipt: () => undefined,
  };

  beforeEach(() => {
    receipts.set(new Map());
    store.agentsById.set(new Map());
    sendMessage.mockReset();
    cancelMessage.mockReset();
    previewMessage.mockClear();
    store.composerState.mockReset().mockReturnValue({ queue: { supported: true, mode: 'queue-next-turn' }, now: { supported: true, mode: 'steer' } });
    TestBed.configureTestingModule({ imports: [LaneComposerComponent], providers: [
      { provide: AgentMonitorStore, useValue: store },
    ] });
  });

  it('restores cancelled queued text alongside an existing draft', async () => {
    sendMessage.mockResolvedValue({ mode: 'queue-next-turn', receipt });
    cancelMessage.mockResolvedValue({ ...receipt, state: 'failed', reason: 'cancelled-by-user' });
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Earlier text';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable();
    expect(sendMessage).toHaveBeenCalled();
    receipts.set(new Map([[agentId, [receipt]]]));
    fixture.detectChanges();
    field.value = 'New thought';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Edit queued message: Earlier text"]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(field.value).toContain('New thought\nEarlier text');
  });

  it('restores text and shows the reason after an accepted message fails', async () => {
    sendMessage.mockResolvedValue({ mode: 'queue-next-turn', receipt });
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Earlier text';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable();
    receipts.set(new Map([[agentId, [{ ...receipt, state: 'failed', reason: 'agent_stopped', updatedAt: 2 }]]]));
    fixture.detectChanges();
    expect(field.value).toBe('Earlier text');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('stopped');
  });

  it('recovers accepted text after the composer is remounted', async () => {
    sendMessage.mockResolvedValue({ mode: 'queue-next-turn', receipt: { ...receipt, id: 'remount-receipt' } });
    const first = TestBed.createComponent(LaneComposerComponent);
    first.componentRef.setInput('agentId', agentId);
    first.detectChanges();
    const field = first.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Recover after tab switch';
    field.dispatchEvent(new Event('input'));
    first.detectChanges();
    first.nativeElement.querySelector('button.btn-primary').click();
    await first.whenStable();
    first.destroy();
    receipts.set(new Map([[agentId, [{ ...receipt, id: 'remount-receipt', state: 'expired', updatedAt: 2 }]]]));
    const second = TestBed.createComponent(LaneComposerComponent);
    second.componentRef.setInput('agentId', agentId);
    second.detectChanges();
    expect((second.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Recover after tab switch');
  });

  it('keeps the draft and shows an error when an outcome has no receipt', async () => {
    sendMessage.mockResolvedValue({ mode: 'queue-next-turn' });
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Keep this';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(field.value).toBe('Keep this');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('No message receipt');
  });

  it('does not offer an edit action for parent-sent receipts', () => {
    receipts.set(new Map([[agentId, [{ ...receipt, sender: 'parent' }]]]));
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label^="Edit queued message"]')).toBeNull();
  });

  it('coalesces a new draft with an accepted queued message', async () => {
    sendMessage.mockResolvedValueOnce({ mode: 'queue-next-turn', receipt })
      .mockResolvedValueOnce({ mode: 'queue-next-turn', receipt: { ...receipt, id: 'message-2', updatedAt: 3 } });
    cancelMessage.mockResolvedValue({ ...receipt, state: 'failed', reason: 'cancelled-by-user', updatedAt: 2 });
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Earlier text';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable();
    receipts.set(new Map([[agentId, [receipt]]]));
    fixture.detectChanges();
    field.value = 'New thought';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable();
    expect(sendMessage).toHaveBeenLastCalledWith(agentId, 'Earlier text\nNew thought', 'queue', false);
    expect(cancelMessage.mock.invocationCallOrder[0]).toBeGreaterThan(sendMessage.mock.invocationCallOrder[1]);
  });

  it('does not restore coalesced text when the cancel push arrives before the cancel RPC resolves', async () => {
    sendMessage.mockResolvedValueOnce({ mode: 'queue-next-turn', receipt })
      .mockResolvedValueOnce({ mode: 'queue-next-turn', receipt: { ...receipt, id: 'message-2', updatedAt: 3 } });
    const fixture = TestBed.createComponent(LaneComposerComponent);
    const cancelledPush = { ...receipt, state: 'failed', reason: 'cancelled-by-user', updatedAt: 4 };
    cancelMessage.mockImplementation(async () => {
      receipts.set(new Map([[agentId, [cancelledPush]]]));
      fixture.detectChanges();
      return cancelledPush;
    });
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Earlier text'; field.dispatchEvent(new Event('input')); fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable();
    receipts.set(new Map([[agentId, [receipt]]])); fixture.detectChanges();
    field.value = 'New thought'; field.dispatchEvent(new Event('input')); fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(cancelMessage).toHaveBeenCalledWith(agentId, 'message-1');
    expect(field.value).toBe('');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the earlier queue and new draft when a combined send is refused', async () => {
    sendMessage.mockResolvedValueOnce({ mode: 'queue-next-turn', receipt })
      .mockResolvedValueOnce({ mode: 'unsupported', detail: 'Lane is unavailable' });
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Earlier text'; field.dispatchEvent(new Event('input')); fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable();
    receipts.set(new Map([[agentId, [receipt]]])); fixture.detectChanges();
    field.value = 'New thought'; field.dispatchEvent(new Event('input')); fixture.detectChanges();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(sendMessage).toHaveBeenLastCalledWith(agentId, 'Earlier text\nNew thought', 'queue', false);
    expect(cancelMessage).not.toHaveBeenCalled();
    expect(field.value).toBe('New thought');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Lane is unavailable');
  });

  it('uses one distinct Edit action for a queued user message', () => {
    receipts.set(new Map([[agentId, [receipt]]]));
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId); fixture.detectChanges();
    const action = fixture.nativeElement.querySelector('[aria-label="Edit queued message: Earlier text"]') as HTMLButtonElement;
    expect(action.textContent).toContain('Edit');
    expect(action.querySelector('lucide-angular')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label^="Cancel queued message"]')).toBeNull();
  });

  it('refreshes previews on focus, delivery menu, and lane status change', async () => {
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    await fixture.whenStable();
    previewMessage.mockClear();
    fixture.nativeElement.querySelector('textarea').dispatchEvent(new Event('focus'));
    expect(previewMessage).toHaveBeenCalledTimes(2);
    fixture.nativeElement.querySelector('[aria-label="Send options"]').click();
    expect(previewMessage).toHaveBeenCalledTimes(4);
    store.agentsById.set(new Map([[agentId, { status: 'stopped' }]]));
    fixture.detectChanges();
    expect(previewMessage).toHaveBeenCalledTimes(6);
  });

  it('ignores ten unrelated agent updates and refreshes once per mode on status change', async () => {
    store.agentsById.set(new Map([[agentId, { status: 'running' }]]));
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId); fixture.detectChanges(); await fixture.whenStable();
    previewMessage.mockClear();
    for (let index = 0; index < 10; index++) {
      store.agentsById.set(new Map([[agentId, { status: 'running' }], [`other-${index}`, { status: 'running' }]]));
      fixture.detectChanges();
    }
    expect(previewMessage).not.toHaveBeenCalled();
    store.agentsById.set(new Map([[agentId, { status: 'stopped' }]])); fixture.detectChanges();
    expect(previewMessage.mock.calls.map(call => call[1])).toEqual(['queue', 'now']);
  });

  it('moves focus into the interrupt confirmation and returns it on Escape', async () => {
    store.composerState.mockImplementation(() => ({
      queue: { supported: true, mode: 'queue-next-turn' },
      now: { supported: true, mode: 'interrupt-resume', lossDisclosure: {
        confirmationRequired: true, text: 'Partial work will be lost.',
      } },
    }));
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Now';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Send options"]').click();
    fixture.detectChanges();
    const sendNow = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Send now');
    expect(sendNow).toBeDefined();
    expect(sendNow?.disabled).toBe(false);
    sendNow?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Partial work will be lost.');
    expect(document.activeElement?.textContent?.trim()).toBe('Send now');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[aria-label="Send options"]')?.nextElementSibling?.querySelector('button') ?? sendNow);
    expect(sendMessage).not.toHaveBeenCalled();
    fixture.nativeElement.remove();
  });

  it('passes turn-loss consent only after confirming Send now', async () => {
    store.composerState.mockImplementation(() => ({
      queue: { supported: true, mode: 'queue-next-turn' },
      now: { supported: true, mode: 'interrupt-resume', lossDisclosure: {
        confirmationRequired: true, text: 'Partial work will be lost.',
      } },
    }));
    sendMessage.mockResolvedValue({ mode: 'interrupt-resume', receipt: { ...receipt, state: 'started', delivery: 'now' } });
    const fixture = TestBed.createComponent(LaneComposerComponent);
    fixture.componentRef.setInput('agentId', agentId);
    fixture.detectChanges();
    const field = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Now';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Send options"]').click();
    fixture.detectChanges();
    const sendNow = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find(button => button.textContent?.trim() === 'Send now');
    sendNow?.click();
    fixture.detectChanges();
    expect(sendMessage).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('[role="alertdialog"] button.btn-warning').click();
    await fixture.whenStable();
    expect(sendMessage).toHaveBeenCalledWith(agentId, 'Now', 'now', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Send options"]')?.getAttribute('aria-expanded')).toBe('false');
  });
});
