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
import {
  TabManagerService,
  type TerminalTurnPulse,
} from '@ptah-extension/chat-state';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { NOTIFICATION_FOCUS_ROUTER } from '@ptah-extension/core';
import { NotificationCenterComponent } from './notification-center.component';
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';
import type { PendingNotificationEntry } from './notification-center.types';

describe('NotificationCenterComponent injector topology', () => {
  const focus = jest.fn();
  const pulses = signal<readonly TerminalTurnPulse[]>([]);

  @Component({
    selector: 'ptah-notification-center-host',
    standalone: true,
    imports: [NotificationCenterComponent],
    providers: [{ provide: NOTIFICATION_FOCUS_ROUTER, useValue: { focus } }],
    template: '<ptah-notification-center />',
  })
  class NotificationCenterHostComponent {}

  beforeEach(() => {
    jest.useFakeTimers();
    pulses.set([]);
    focus.mockReset().mockResolvedValue({ success: true, outcome: 'focused' });
    TestBed.configureTestingModule({
      imports: [NotificationCenterHostComponent],
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            terminalTurnPulses: pulses,
            takeTerminalTurnPulses: () => {
              const queued = pulses();
              pulses.set([]);
              return queued;
            },
            findTabByIdAcrossWorkspaces: () => null,
            findTabBySessionIdAcrossWorkspaces: () => null,
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: signal([]),
            questionRequests: signal([]),
            routingTargetRevision: signal(0),
            targetTabsFor: () => [],
            questionTargetTabsFor: () => [],
          },
        },
        {
          provide: NotificationSoundService,
          useValue: { playBurst: jest.fn() },
        },
      ],
    });
  });

  afterEach(() => jest.useRealTimers());

  it('resolves the shell focus router from the notification component store', async () => {
    const fixture = TestBed.createComponent(NotificationCenterHostComponent);
    fixture.detectChanges();
    const center = fixture.debugElement.query(
      By.directive(NotificationCenterComponent),
    );
    const store = center.injector.get(NotificationCenterStore);
    const entry = {
      target: {
        workspacePath: '/workspace/a',
        tabId: 'tab-1',
        sessionId: 'session-1',
      },
    } as PendingNotificationEntry;

    await expect(store.activatePrompt(entry)).resolves.toEqual({
      success: true,
      outcome: 'focused',
    });
    expect(focus).toHaveBeenCalledWith(entry.target);
  });

  it('updates the live region for two isolated bursts with the same phrase', fakeAsync(() => {
    const fixture = TestBed.createComponent(NotificationCenterHostComponent);
    fixture.detectChanges();
    const liveRegion = fixture.debugElement.query(By.css('[role="status"]'))
      .nativeElement as HTMLElement;
    const pulse = (seq: number): TerminalTurnPulse => ({
      seq,
      tabId: `tab-${seq}`,
      sessionId: `session-${seq}`,
      workspacePath: '/workspace/a',
      revision: 1,
      phase: 'idle',
      terminalReason: 'completed',
      lastAssistantMessage: null,
      classification: 'success',
      title: `Run ${seq}`,
      occurredAt: seq * 1000,
    });

    pulses.set([pulse(1)]);
    fixture.detectChanges();
    tick(350);
    fixture.detectChanges();
    expect(liveRegion.textContent?.trim()).toBe('1 session finished');

    pulses.set([pulse(2)]);
    fixture.detectChanges();
    expect(liveRegion.textContent?.trim()).toBe('');
    tick(350);
    fixture.detectChanges();
    expect(liveRegion.textContent?.trim()).toBe('1 session finished');
  }));
});
