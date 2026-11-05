import { TestBed } from '@angular/core/testing';
import {
  QueuedFollowUpStore,
  type QueuedFollowUpEntry,
} from '@ptah-extension/chat-state';
import { FollowUpQueueService } from '../../../services/chat-store/follow-up-queue.service';
import { QueuedFollowUpsComponent } from './queued-follow-ups.component';

const S1 = '11111111-1111-4111-8111-111111111111';

function entry(
  clientMessageId: string,
  patch: Partial<QueuedFollowUpEntry> = {},
): QueuedFollowUpEntry {
  return {
    clientMessageId,
    tabId: 'tab-1',
    sessionId: S1,
    content: `text ${clientMessageId}`,
    isCommand: false,
    phase: 'queued',
    ...patch,
  };
}

describe('QueuedFollowUpsComponent', () => {
  let store: QueuedFollowUpStore;
  let followUps: {
    reconcile: jest.Mock;
    withdraw: jest.Mock;
    sendNow: jest.Mock;
    canSendNow: jest.Mock;
    isClaudeSession: jest.Mock;
  };

  function render(tabId: string | null = 'tab-1', sessionId: string | null = S1) {
    const fixture = TestBed.createComponent(QueuedFollowUpsComponent);
    fixture.componentRef.setInput('tabId', tabId);
    fixture.componentRef.setInput('sessionId', sessionId);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    followUps = {
      reconcile: jest.fn().mockResolvedValue(undefined),
      withdraw: jest.fn().mockResolvedValue(true),
      sendNow: jest.fn().mockResolvedValue(undefined),
      canSendNow: jest.fn().mockReturnValue(false),
      isClaudeSession: jest.fn().mockReturnValue(false),
    };
    TestBed.configureTestingModule({
      imports: [QueuedFollowUpsComponent],
      providers: [{ provide: FollowUpQueueService, useValue: followUps }],
    });
    store = TestBed.inject(QueuedFollowUpStore);
  });

  it('renders nothing without items, and reconciles the session view on open', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('section')).toBeNull();
    expect(followUps.reconcile).toHaveBeenCalledWith('tab-1', S1);
  });

  it('lists only this tab and session as text, with a status per item', () => {
    store.add(entry('a', { content: '<b>bold</b> text' }));
    store.add(entry('b', { phase: 'held', isCommand: true, content: '/compact' }));
    store.add(entry('c', { tabId: 'tab-2' }));
    store.add(entry('d', { sessionId: 'old-session' }));
    const fixture = render();

    const items = fixture.nativeElement.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('<b>bold</b> text');
    expect(items[0].querySelector('b')).toBeNull();
    expect(items[0].textContent).toContain('Queued for the next turn');
    expect(items[1].textContent).toContain('Runs when this turn finishes');
  });

  it('Withdraw restores the text to the composer', async () => {
    store.add(entry('a'));
    const fixture = render();
    fixture.nativeElement.querySelector('[data-testid="queued-withdraw"]').click();
    await fixture.whenStable();
    expect(followUps.withdraw).toHaveBeenCalledWith(
      expect.objectContaining({ clientMessageId: 'a' }),
      { restore: true },
    );
  });

  it('shows Send now only for a Codex session and only for a queued item', async () => {
    store.add(entry('a'));
    store.add(entry('b', { phase: 'held' }));
    let fixture = render();
    expect(
      fixture.nativeElement.querySelector('[data-testid="queued-follow-up-send-now"]'),
    ).toBeNull();

    followUps.canSendNow.mockReturnValue(true);
    fixture.destroy();
    fixture = render();
    const buttons = fixture.nativeElement.querySelectorAll(
      '[data-testid="queued-follow-up-send-now"]',
    );
    expect(buttons.length).toBe(1);
    buttons[0].click();
    await fixture.whenStable();
    expect(followUps.sendNow).toHaveBeenCalledWith(
      expect.objectContaining({ clientMessageId: 'a' }),
    );
  });

  it('labels Claude Send now as Interrupt & send with an accessible preview', () => {
    store.add(entry('a', { content: 'hello Claude' }));
    followUps.canSendNow.mockReturnValue(true);
    followUps.isClaudeSession.mockReturnValue(true);
    const fixture = render();
    const button = fixture.nativeElement.querySelector('[data-testid="queued-follow-up-send-now"]');
    expect(button.textContent).toContain('Interrupt & send');
    expect(button.getAttribute('aria-label')).toBe('Interrupt and send: hello Claude');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="queued-follow-up-item"]')).toHaveLength(1);
  });

  it('shows the note a refused Send now left', () => {
    store.add(
      entry('a', { note: 'The turn changed. It stays queued for the next turn.' }),
    );
    const fixture = render();
    expect(
      fixture.nativeElement.querySelector('[role="status"]').textContent,
    ).toContain('The turn changed');
  });
});
