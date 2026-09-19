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

describe('NotificationCenterComponent', () => {
  const unreadCount = signal(12);
  const pendingEntries = signal<readonly never[]>([]);
  const completionGroups = signal<readonly never[]>([]);
  const announcement = signal('12 sessions finished; 3 need attention');
  const activateCompletion = jest.fn();
  const activatePrompt = jest.fn();
  const markAllRead = jest.fn();
  const muted = signal(false);

  beforeEach(async () => {
    unreadCount.set(12);
    pendingEntries.set([]);
    completionGroups.set([]);
    announcement.set('12 sessions finished; 3 need attention');
    jest.clearAllMocks();
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
          },
        },
        {
          provide: NotificationSoundService,
          useValue: { muted, setMuted: jest.fn() },
        },
      ],
    }).compileComponents();
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
});
