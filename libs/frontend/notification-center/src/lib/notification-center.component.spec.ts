import { Component, NgModule } from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({ selector: 'ptah-markdown-stub', standalone: true, template: '' })
  class MarkdownStub {}
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return { MarkdownModule, MarkdownComponent: MarkdownStub, provideMarkdown: () => [] };
});
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ATTENTION_ACTION_DISPATCHER, NotificationService, type AttentionItem } from '@ptah-extension/core';
import { NotificationCenterComponent } from './notification-center.component';
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';

const lane: AttentionItem = {
  key: 'lane-1', generation: 1, kind: 'lane-permission', source: 'lane',
  workspacePath: '/workspace/a', workspaceName: 'a', sessionId: 'session-1',
  severity: 'warning', title: 'Approve tool', context: 'Claude · Fix notifications · Tool: Bash',
  sessionTitle: 'Fix notifications', provider: 'Claude', detail: 'Tool: Bash',
  actions: [
    { id: 'allow', label: 'Allow', disabledReason: 'Unknown tool' },
    { id: 'deny', label: 'Deny' }, { id: 'open', label: 'Open' },
  ], actionable: true, soundEligible: false,
};
const warning: AttentionItem = {
  ...lane, key: 'warning-1', kind: 'warning', title: 'Git status unavailable',
  sessionTitle: undefined, provider: undefined, detail: undefined,
  actions: [{ id: 'retry', label: 'Retry' }],
};

describe('NotificationCenterComponent', () => {
  let notifications: NotificationService;
  const dispatch = jest.fn();
  const muted = jest.fn(() => false);
  const setMuted = jest.fn();

  beforeEach(() => {
    dispatch.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [NotificationCenterComponent],
      providers: [
        { provide: ATTENTION_ACTION_DISPATCHER, useValue: { dispatch } },
        { provide: NotificationSoundService, useValue: { muted, setMuted } },
      ],
    });
    notifications = TestBed.inject(NotificationService);
  });

  it('opens through the public API and has no dismiss control on Needs you', fakeAsync(() => {
    notifications.upsert(lane);
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    fixture.componentInstance.openPanel();
    fixture.detectChanges();
    tick();
    expect(fixture.componentInstance.panelOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('#ptah-needs-you-heading')?.parentElement?.querySelector('[aria-label^="Dismiss"]')).toBeNull();
  }));

  it('updates action disabled state under OnPush when dispatch settles', fakeAsync(() => {
    notifications.upsert(lane);
    let finish: (value: boolean) => void = () => undefined;
    dispatch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    fixture.componentInstance.openPanel();
    fixture.detectChanges();
    const deny = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === 'Deny');
    deny()?.click();
    fixture.detectChanges();
    expect(deny()?.disabled).toBe(true);
    finish(true);
    tick();
    fixture.detectChanges();
    expect(deny()?.disabled).toBe(false);
  }));

  it('shows needs-you badge and two sections without completion rows', fakeAsync(() => {
    notifications.upsert(lane);
    notifications.upsert(warning);
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    const badge = fixture.debugElement.query(By.css('[data-testid="notification-count-badge"]'));
    expect(badge.nativeElement.textContent.trim()).toBe('1');
    fixture.debugElement.query(By.css('[data-testid="notification-center-bell"]')).nativeElement.click();
    fixture.detectChanges();
    tick();
    expect(fixture.nativeElement.textContent).toContain('Needs you');
    expect(fixture.nativeElement.textContent).toContain('Recent notices');
    expect(fixture.nativeElement.textContent).toContain('Approve tool');
    expect(fixture.nativeElement.textContent).toContain('Git status unavailable');
    expect(fixture.nativeElement.querySelector('#ptah-needs-you-heading')?.parentElement?.textContent).toContain('1');
    expect(fixture.nativeElement.textContent).not.toContain('Finished');
    const rows = fixture.debugElement.queryAll(By.css('.notification-row'));
    expect(rows[0].nativeElement.textContent).toContain('Fix notifications');
    expect(rows[0].nativeElement.textContent).toContain('Claude');
    expect(rows[0].nativeElement.textContent).toContain('Tool: Bash');
    expect(rows[0].nativeElement.textContent).toContain('a');
    expect(document.activeElement).toBe(rows[0].nativeElement.querySelector('button:not(:disabled)'));
    expect(rows[0].queryAll(By.css('button')).find(button => button.nativeElement.textContent.trim() === 'Allow')?.nativeElement.disabled).toBe(true);
  }));

  it('shows Session unavailable for a request without a session title', fakeAsync(() => {
    notifications.upsert({ ...lane, sessionTitle: undefined, title: 'Permission required' });
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    fixture.componentInstance.openPanel();
    fixture.detectChanges();
    tick();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.notification-row');
    expect(row?.querySelector('p[title="Session unavailable"]')?.textContent).toBe('Session unavailable');
    expect(row?.textContent).toContain('Lane permission required');
  }));

  it('shows one All clear state without section headings or section empty messages', fakeAsync(() => {
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    fixture.componentInstance.openPanel();
    fixture.detectChanges();
    tick();
    const panel = fixture.nativeElement.querySelector('[data-testid="notification-center-panel"]') as HTMLElement;
    expect(panel.textContent).toContain('All clear');
    expect(panel.textContent).toContain('Nothing needs your attention.');
    expect(panel.querySelector('#ptah-needs-you-heading')).toBeNull();
    expect(panel.querySelector('#ptah-recent-heading')).toBeNull();
    expect(panel.textContent).not.toContain('Nothing needs your response');
    expect(panel.textContent).not.toContain('No recent notices');
    expect(panel.querySelector<HTMLButtonElement>('header button[aria-label="Clear all notices"]')?.disabled).toBe(true);
  }));

  it('dispatches lane Deny and clears recent notices while retaining Needs you', fakeAsync(() => {
    notifications.upsert(lane);
    notifications.upsert(warning);
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    fixture.debugElement.query(By.css('[data-testid="notification-center-bell"]')).nativeElement.click();
    fixture.detectChanges();
    tick();
    const deny = fixture.debugElement.queryAll(By.css('button')).find(button => button.nativeElement.textContent.trim() === 'Deny');
    deny?.nativeElement.click();
    tick();
    expect(dispatch).toHaveBeenCalledWith('lane-1', 1, 'deny');
    const store = fixture.debugElement.injector.get(NotificationCenterStore);
    const clearAll = jest.spyOn(store, 'clearAll');
    const clear = fixture.nativeElement.querySelector('header button[aria-label="Clear all notices"]') as HTMLButtonElement;
    expect(clear).not.toBeNull();
    expect(clear.disabled).toBe(false);
    clear.click();
    fixture.detectChanges();
    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(notifications.needsYou()).toEqual([lane]);
    expect(notifications.recentNotices()).toEqual([]);
    expect(clear.disabled).toBe(true);
  }));

  it('restores bell focus after Escape', fakeAsync(() => {
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    fixture.detectChanges();
    const bell = fixture.debugElement.query(By.css('[data-testid="notification-center-bell"]')).nativeElement as HTMLButtonElement;
    bell.click();
    fixture.detectChanges();
    tick();
    expect(document.activeElement?.id).toBe('ptah-notification-center-heading');
    fixture.debugElement.query(By.css('[data-testid="notification-center-panel"]')).triggerEventHandler('keydown.escape', new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    tick();
    expect(document.activeElement).toBe(bell);
  }));
});
