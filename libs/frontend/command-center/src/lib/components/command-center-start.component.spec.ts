import { TestBed } from '@angular/core/testing';
import type {
  ChatSessionSummary,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { SessionId } from '@ptah-extension/shared';
import { CommandCenterStartComponent } from './command-center-start.component';

describe('CommandCenterStartComponent', () => {
  const sessions: ChatSessionSummary[] = Array.from(
    { length: 7 },
    (_, index) => ({
      id: SessionId.from(`11111111-1111-4111-8111-11111111111${index}`),
      name: `Session ${index}`,
      messageCount: 1,
      createdAt: Date.now() - index * 60_000,
      lastActivityAt: Date.now() - index * 60_000,
      isActive: false,
    }),
  );

  function render(status: 'loading' | 'ready' | 'error' = 'ready') {
    TestBed.configureTestingModule({ imports: [CommandCenterStartComponent] });
    const fixture = TestBed.createComponent(CommandCenterStartComponent);
    fixture.componentRef.setInput('sessions', sessions);
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('now', Date.now());
    fixture.detectChanges();
    return fixture;
  }

  it('shows five recent cards and opens the full list', () => {
    const fixture = render();
    const all = jest.fn();
    const select = jest.fn();
    fixture.componentInstance.allSessions.subscribe(all);
    fixture.componentInstance.selected.subscribe(select);
    expect(fixture.nativeElement.querySelectorAll('.grid button')).toHaveLength(
      5,
    );
    fixture.nativeElement.querySelectorAll('button')[1].click();
    expect(all).toHaveBeenCalledTimes(1);
    fixture.nativeElement.querySelector('.grid button').click();
    expect(select).toHaveBeenCalledWith(sessions[0].id);
    fixture.componentRef.setInput('expanded', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.grid button')).toHaveLength(
      7,
    );
  });

  it('updates recency from the supplied shared clock', () => {
    const fixture = render();
    fixture.componentRef.setInput('sessions', [
      { ...sessions[0], lastActivityAt: 820_000 },
    ]);
    fixture.componentRef.setInput('now', 1_000_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('3m ago');
    fixture.componentRef.setInput('now', 1_060_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('4m ago');
    fixture.componentRef.setInput('sessions', [
      { ...sessions[0], lastActivityAt: 1_065_000 },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Just now');
  });

  it('uses known provider artwork and a monogram for unknown providers', () => {
    const fixture = render();
    fixture.componentRef.setInput('sessions', [
      { ...sessions[0], providerId: 'codex' },
      { ...sessions[1], providerId: 'custom-provider' },
    ]);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.grid button');
    expect(cards[0].querySelector('ptah-provider-mark')).not.toBeNull();
    expect(cards[0].querySelector('ptah-monogram-tile')).toBeNull();
    expect(cards[1].querySelector('ptah-provider-mark')).toBeNull();
    expect(cards[1].querySelector('ptah-monogram-tile')).not.toBeNull();
  });

  it('shows six static recency bars by age and omits them for an invalid timestamp', () => {
    const fixture = render();
    fixture.componentRef.setInput('now', 2_000_000);
    fixture.componentRef.setInput('sessions', [
      { ...sessions[0], lastActivityAt: 2_000_000 },
      { ...sessions[1], lastActivityAt: 1_820_000 },
      { ...sessions[2], lastActivityAt: Number.NaN },
    ]);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.grid button');
    const firstBars = cards[0].querySelectorAll(
      '[data-testid="activity-bars"] > span',
    );
    const secondBars = cards[1].querySelectorAll(
      '[data-testid="activity-bars"] > span',
    );
    expect(firstBars).toHaveLength(6);
    expect(
      [...firstBars].filter(
        (bar: HTMLElement) => bar.dataset['active'] === 'true',
      ),
    ).toHaveLength(6);
    expect(
      [...secondBars].filter(
        (bar: HTMLElement) => bar.dataset['active'] === 'true',
      ),
    ).toHaveLength(5);
    expect(cards[1].textContent).toContain('Updated 3m ago');
    expect(cards[2].querySelector('[data-testid="activity-bars"]')).toBeNull();
    expect(cards[2].textContent).toContain('No recent activity');
    expect(cards[2].getAttribute('aria-label')).toContain('No recent activity');
    expect(cards[2].textContent).not.toContain('Updated Unknown');
  });

  it('names each card with visible session figures, state and expiry', () => {
    const fixture = render();
    fixture.componentRef.setInput('now', 1_000_000);
    fixture.componentRef.setInput('sessions', [
      {
        ...sessions[0],
        lastActivityAt: 820_000,
        messageCount: 12,
        tokenUsage: { input: 100, output: 40, cacheRead: 10 },
        isActive: true,
        livePhase: 'awaiting-background',
        hasTranscript: false,
      },
      {
        ...sessions[1],
        tokenUsage: { input: 0, output: 0 },
        hasTranscript: undefined,
      },
      { ...sessions[2], tokenUsage: undefined, messageCount: 0 },
    ]);
    fixture.detectChanges();
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.grid button');
    expect(cards[0].getAttribute('aria-label')).toBe(
      'Session 0, Updated 3m ago, 12 messages, 150 tokens, Active, awaiting background, History unavailable',
    );
    expect(cards[0].textContent).toContain('12 messages');
    expect(cards[0].textContent).toContain('150 tokens');
    expect(cards[0].textContent).toContain('Active');
    expect(cards[0].textContent).toContain('awaiting background');
    expect(cards[1].textContent).toContain('0 tokens');
    expect(cards[1].textContent).not.toContain('History unavailable');
    expect(cards[2].getAttribute('aria-label')).not.toContain('tokens');
    // session:list reports 0 until the count is warmed; never show "0 messages".
    expect(cards[2].getAttribute('aria-label')).not.toContain('messages');
    expect(cards[2].textContent).not.toContain('messages');
    expect(cards[0].querySelectorAll('button')).toHaveLength(0);
  });

  it('places Current before recent cards and marks the recorded session', () => {
    const fixture = render();
    fixture.componentRef.setInput('currentTabId', 'tab');
    fixture.componentRef.setInput('currentSessionId', sessions[0].id);
    fixture.componentRef.setInput('recordedSessionId', sessions[1].id);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Current');
    expect(fixture.nativeElement.textContent).toContain('Command Center');
    expect(fixture.nativeElement.querySelectorAll('.grid button')).toHaveLength(
      4,
    );
  });

  it('shows only the current row live figures and keeps unknown values unavailable', () => {
    const fixture = render();
    fixture.componentRef.setInput('currentTabId', 'tab');
    fixture.componentRef.setInput('currentSessionId', sessions[0].id);
    fixture.detectChanges();
    const current = (
      fixture.nativeElement.querySelector('.badge-primary') as HTMLElement
    ).closest('button') as HTMLButtonElement;
    expect(current.querySelector('[data-testid="current-figures"]')).toBeNull();
    fixture.componentRef.setInput('currentStats', {
      sessionId: 'current',
      model: null,
      totalCost: 0.2,
      tokens: { input: 10, output: 2, cacheRead: 0, cacheCreation: 0 },
      tokenCount: 12,
      messageCount: 3,
      status: 'ok',
      provisional: true,
    } satisfies SessionStatsEntry);
    fixture.detectChanges();
    expect(
      current.querySelector('[data-testid="current-figures"]')?.textContent,
    ).toContain('~$0.20');
    expect(
      current.querySelector('[data-testid="current-figures"]')?.textContent,
    ).toContain('~12');
    expect(
      fixture.nativeElement.querySelector('.grid')?.textContent,
    ).not.toContain('$0.20');
    fixture.componentRef.setInput('currentStats', {
      sessionId: 'current',
      model: null,
      totalCost: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      messageCount: 0,
      status: 'ok',
    } satisfies SessionStatsEntry);
    fixture.detectChanges();
    expect(current.querySelector('[data-testid="current-figures"]')).toBeNull();
  });

  it('shows loading, empty, and error states with Retry', () => {
    const fixture = render('loading');
    const newSession = jest.fn();
    const retry = jest.fn();
    fixture.componentInstance.newSession.subscribe(newSession);
    fixture.componentInstance.retry.subscribe(retry);
    fixture.nativeElement.querySelectorAll('button')[0].click();
    expect(newSession).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Loading sessions');
    fixture.componentRef.setInput('status', 'ready');
    fixture.componentRef.setInput('sessions', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No previous sessions');
    fixture.componentRef.setInput('status', 'error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Retry');
    fixture.nativeElement.querySelector('[role="alert"] button').click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('disables selection and action buttons during restore', () => {
    const fixture = render();
    fixture.componentRef.setInput('choosing', true);
    fixture.detectChanges();
    expect(
      [...fixture.nativeElement.querySelectorAll('button')].every(
        (button: HTMLButtonElement) => button.disabled,
      ),
    ).toBe(true);
  });
});
