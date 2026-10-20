import { TestBed } from '@angular/core/testing';
import { NotificationService, type AttentionItem } from '@ptah-extension/core';
import { NotificationAnnouncerComponent } from './notification-announcer.component';

describe('NotificationAnnouncerComponent', () => {
  it('queues rapid notices and announces identical text after resolution', () => {
    jest.useFakeTimers();
    try {
      TestBed.configureTestingModule({ imports: [NotificationAnnouncerComponent] });
      const notices = TestBed.inject(NotificationService);
      const fixture = TestBed.createComponent(NotificationAnnouncerComponent);
      fixture.detectChanges();
      const item: AttentionItem = {
        key: 'c:failure', generation: 1, source: 'test', kind: 'failure', severity: 'error',
        workspacePath: '/workspace', workspaceName: 'Workspace', title: 'Session failed',
        actions: [], actionable: true, soundEligible: false,
      };
      notices.upsert(item);
      fixture.detectChanges();
      jest.runOnlyPendingTimers();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Session failed');
      notices.resolve(item.key, item.generation);
      fixture.detectChanges();
      notices.upsert({ ...item, generation: 2 });
      fixture.detectChanges();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toBe('');
      jest.runOnlyPendingTimers();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Session failed');
    } finally {
      jest.useRealTimers();
    }
  });
});
