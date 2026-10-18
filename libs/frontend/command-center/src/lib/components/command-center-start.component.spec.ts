import { TestBed } from '@angular/core/testing';
import type { ChatSessionSummary } from '@ptah-extension/shared';
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
