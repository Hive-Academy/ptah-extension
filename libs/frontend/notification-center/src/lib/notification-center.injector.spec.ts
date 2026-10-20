import { Component, NgModule } from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({ selector: 'ptah-markdown-stub', standalone: true, template: '' })
  class MarkdownStub {}
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return { MarkdownModule, MarkdownComponent: MarkdownStub, provideMarkdown: () => [] };
});
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NOTIFICATION_FOCUS_ROUTER, type AttentionItem } from '@ptah-extension/core';
import { NotificationCenterComponent } from './notification-center.component';
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';

const item: AttentionItem = {
  key: 'permission-1', generation: 1, kind: 'permission', source: 'chat',
  workspacePath: '/workspace/a', workspaceName: 'a', sessionId: 'session-1', tabId: 'tab-1',
  severity: 'warning', title: 'Needs permission', actions: [{ id: 'open', label: 'Open' }],
  actionable: true, soundEligible: false,
};

describe('NotificationCenterComponent injector topology', () => {
  const focus = jest.fn();
  @Component({
    selector: 'ptah-notification-center-host', standalone: true,
    imports: [NotificationCenterComponent],
    providers: [{ provide: NOTIFICATION_FOCUS_ROUTER, useValue: { focus } }],
    template: '<ptah-notification-center />',
  })
  class NotificationCenterHostComponent {}

  beforeEach(() => {
    focus.mockReset().mockResolvedValue({ success: true, outcome: 'focused' });
    TestBed.configureTestingModule({
      imports: [NotificationCenterHostComponent],
      providers: [{ provide: NotificationSoundService, useValue: { muted: () => false, setMuted: jest.fn() } }],
    });
  });

  it('resolves the shell focus router from the notification component store', async () => {
    const fixture = TestBed.createComponent(NotificationCenterHostComponent);
    fixture.detectChanges();
    const center = fixture.debugElement.query(By.directive(NotificationCenterComponent));
    const store = center.injector.get(NotificationCenterStore);
    await expect(store.focus(item)).resolves.toEqual({ success: true, outcome: 'focused' });
    expect(focus).toHaveBeenCalledWith({
      workspacePath: '/workspace/a', tabId: 'tab-1', sessionId: 'session-1',
    });
  });
});
