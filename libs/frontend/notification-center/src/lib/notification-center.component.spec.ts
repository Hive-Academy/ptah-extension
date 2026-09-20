import { Component, NgModule, signal } from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({ selector: 'ptah-markdown-stub', standalone: true, template: '' })
  class MarkdownStub {}
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStub,
    provideMarkdown: () => [],
  };
});
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NotificationCenterComponent } from './notification-center.component';
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';
import type {
  CompletionNotificationEntry,
  CompletionNotificationGroup,
  PendingNotificationEntry,
} from './notification-center.types';

describe('NotificationCenterComponent', () => {
  const unreadCount = signal(12);
  const pendingEntries = signal<readonly PendingNotificationEntry[]>([]);
  const completionGroups = signal<readonly CompletionNotificationGroup[]>([]);
  const announcement = signal('12 sessions finished; 3 need attention');
  const activateCompletion = jest.fn();
  const activatePrompt = jest.fn();
  const markAllRead = jest.fn();
  const dismissCompletion = jest.fn();
  const muted = signal(false);
  const completion: CompletionNotificationEntry = {
    kind: 'completion',
    id: 'session-1:1',
    revision: 1,
    tabId: 'tab-1',
    sessionId: 'session-1',
    workspacePath: '/workspace/a',
    workspaceLabel: 'a',
    title: 'Build release',
    sessionColor: 'oklch(70% 0.1 100)',
    phase: 'idle',
    terminalReason: 'completed',
    classification: 'success',
    occurredAt: 1,
    readAt: null,
    dismissed: false,
    target: {
      workspacePath: '/workspace/a',
      tabId: 'tab-1',
      sessionId: 'session-1',
    },
  };
  const prompt: PendingNotificationEntry = {
    kind: 'permission',
    id: 'permission:p-1:tab-1',
    sourceId: 'p-1',
    sessionId: 'session-1',
    workspacePath: '/workspace/a',
    workspaceLabel: 'a',
    title: 'Run tests',
    statusText: 'Needs permission',
    occurredAt: 1,
    target: completion.target,
    source: {
      id: 'p-1',
      toolName: 'Bash',
      toolInput: {},
      timestamp: 1,
      description: 'Run tests',
      timeoutAt: 0,
    },
  };

  beforeEach(async () => {
    unreadCount.set(12);
    pendingEntries.set([]);
    completionGroups.set([]);
    announcement.set('12 sessions finished; 3 need attention');
    jest.clearAllMocks();
    activateCompletion.mockResolvedValue({
      success: true,
      outcome: 'focused',
    });
    activatePrompt.mockResolvedValue({ success: true, outcome: 'focused' });
    await TestBed.configureTestingModule({
      imports: [NotificationCenterComponent],
      providers: [
        {
          provide: NotificationCenterStore,
          useValue: {
            unreadCount,
            pendingEntries,
            completionGroups,
            announcement,
            activateCompletion,
            activatePrompt,
            markAllRead,
            dismissCompletion,
          },
        },
        {
          provide: NotificationSoundService,
          useValue: { muted, setMuted: jest.fn() },
        },
      ],
    })
      .overrideComponent(NotificationCenterComponent, {
        set: {
          providers: [
            {
              provide: NotificationCenterStore,
              useValue: {
                unreadCount,
                pendingEntries,
                completionGroups,
                announcement,
                activateCompletion,
                activatePrompt,
                markAllRead,
                dismissCompletion,
              },
            },
          ],
        },
      })
      .compileComponents();
  });

  it('uses a real button with the exact accessible count and visual 9+ cap', () => {
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    const bell = fixture.debugElement.query(
      By.css('[data-testid="notification-center-bell"]'),
    ).nativeElement as HTMLButtonElement;
    const badge = fixture.debugElement.query(
      By.css('[data-testid="notification-count-badge"]'),
    ).nativeElement as HTMLElement;
    expect(bell.tagName).toBe('BUTTON');
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 12 unread');
    expect(bell.getAttribute('aria-haspopup')).toBe('dialog');
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    expect(badge.textContent?.trim()).toBe('9+');
  });

  it('opens with linked ARIA state, focuses the heading, and Escape restores bell focus', fakeAsync(() => {
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    const bell = fixture.debugElement.query(By.css('button'))
      .nativeElement as HTMLButtonElement;
    bell.click();
    fixture.detectChanges();
    tick();
    const panel = fixture.debugElement.query(By.css('[role="dialog"]'));
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    expect(panel.attributes['id']).toBe('ptah-notification-center-panel');
    expect(document.activeElement?.id).toBe('ptah-notification-center-heading');
    panel.nativeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    tick();
    expect(document.activeElement).toBe(bell);
  }));

  it('keeps one polite live region outside the panel', () => {
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    const statuses = fixture.debugElement.queryAll(By.css('[role="status"]'));
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.nativeElement.textContent.trim()).toBe(
      '12 sessions finished; 3 need attention',
    );
  });

  it('closes the panel after successful completion and prompt activation', fakeAsync(() => {
    completionGroups.set([
      {
        id: 'group-1',
        workspacePath: '/workspace/a',
        workspaceLabel: 'a',
        classification: 'success',
        occurredAt: 1,
        entries: [completion],
      },
    ]);
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    fixture.debugElement
      .query(By.css('[data-testid="notification-center-bell"]'))
      .nativeElement.click();
    fixture.detectChanges();
    tick();
    fixture.debugElement
      .query(By.css('.notification-row'))
      .nativeElement.click();
    tick();
    fixture.detectChanges();
    expect(activateCompletion).toHaveBeenCalledWith(completion);
    expect(fixture.debugElement.query(By.css('[role="dialog"]'))).toBeNull();

    completionGroups.set([]);
    pendingEntries.set([prompt]);
    fixture.detectChanges();
    fixture.debugElement
      .query(By.css('[data-testid="notification-center-bell"]'))
      .nativeElement.click();
    fixture.detectChanges();
    tick();
    fixture.debugElement
      .query(By.css('.notification-row'))
      .nativeElement.click();
    tick();
    fixture.detectChanges();
    expect(activatePrompt).toHaveBeenCalledWith(prompt);
    expect(fixture.debugElement.query(By.css('[role="dialog"]'))).toBeNull();
  }));

  it('renders a keyboard-reachable dismiss control for each completion', fakeAsync(() => {
    completionGroups.set([
      {
        id: 'group-1',
        workspacePath: '/workspace/a',
        workspaceLabel: 'a',
        classification: 'success',
        occurredAt: 1,
        entries: [completion],
      },
    ]);
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    fixture.debugElement
      .query(By.css('[data-testid="notification-center-bell"]'))
      .nativeElement.click();
    fixture.detectChanges();
    tick();
    const dismiss = fixture.debugElement.query(
      By.css('[aria-label="Dismiss Build release"]'),
    ).nativeElement as HTMLButtonElement;

    expect(dismiss.tagName).toBe('BUTTON');
    expect(dismiss.tabIndex).toBe(0);
    dismiss.click();
    expect(dismissCompletion).toHaveBeenCalledWith(completion.id);
    expect(activateCompletion).not.toHaveBeenCalled();
  }));
});
