import { Component, NgModule } from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({ selector: 'ptah-markdown-stub', standalone: true, template: '' })
  class MarkdownStub {}
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return { MarkdownModule, MarkdownComponent: MarkdownStub, provideMarkdown: () => [] };
});
import { TestBed } from '@angular/core/testing';
import {
  ATTENTION_ACTION_DISPATCHER,
  NOTIFICATION_FOCUS_ROUTER,
  NotificationService,
  type AttentionItem,
} from '@ptah-extension/core';
import { NotificationCenterStore } from './notification-center.store';

const lane: AttentionItem = {
  key: 'lane-1', generation: 1, kind: 'lane-permission', source: 'lane',
  workspacePath: '/workspace/a', workspaceName: 'a', sessionId: 'session-1',
  severity: 'warning', title: 'Lane requests permission',
  actions: [
    { id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' },
    { id: 'open', label: 'Open' },
  ], actionable: true, soundEligible: false,
};
const failure: AttentionItem = {
  ...lane, key: 'failure-1', kind: 'failure', severity: 'error',
  title: 'Run failed', actions: [{ id: 'open', label: 'Open' }],
};

describe('NotificationCenterStore', () => {
  let notifications: NotificationService;
  let store: NotificationCenterStore;
  const dispatch = jest.fn<Promise<boolean>, [string, number, string]>();
  const focus = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    dispatch.mockReset().mockResolvedValue(true);
    focus.mockReset().mockResolvedValue({ success: true, outcome: 'focused' });
    TestBed.configureTestingModule({ providers: [
      NotificationCenterStore,
      { provide: ATTENTION_ACTION_DISPATCHER, useValue: { dispatch } },
      { provide: NOTIFICATION_FOCUS_ROUTER, useValue: { focus } },
    ] });
    notifications = TestBed.inject(NotificationService);
    store = TestBed.inject(NotificationCenterStore);
  });
  afterEach(() => jest.useRealTimers());

  it('counts only live needs-you items and clears recent failures only', () => {
    notifications.upsert(lane);
    notifications.upsert(failure);
    expect(store.badgeCount()).toBe(1);
    expect(store.needsYou()).toEqual([lane]);
    expect(store.recentNotices()).toEqual([failure]);
    expect(store.canClearAll()).toBe(true);
    store.clearAll();
    expect(store.recentNotices()).toEqual([]);
    expect(store.canClearAll()).toBe(false);
    expect(store.needsYou()).toEqual([lane]);
    expect(notifications.snackbars().map(item => item.key)).toEqual(['lane-1']);
  });

  it('pauses transient timeout and hides redundant snackbars while open', () => {
    notifications.upsert(failure);
    jest.advanceTimersByTime(3000);
    store.setPanelOpen(true);
    TestBed.flushEffects();
    expect(notifications.snackbars()).toEqual([]);
    jest.advanceTimersByTime(10000);
    expect(store.recentNotices()).toEqual([failure]);
    store.setPanelOpen(false);
    TestBed.flushEffects();
    expect(notifications.snackbars()).toEqual([failure]);
    jest.advanceTimersByTime(5000);
    expect(notifications.snackbars()).toEqual([]);
  });

  it('dispatches lane actions once per in-flight request and rejects stale actions', async () => {
    notifications.upsert(lane);
    let finish: (value: boolean) => void = () => undefined;
    dispatch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = store.activate(lane, 'allow');
    expect(store.isSubmitting(lane)).toBe(true);
    await expect(store.activate(lane, 'deny')).resolves.toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    finish(true);
    await expect(first).resolves.toBe(true);
    notifications.resolve(lane.key, lane.generation);
    await expect(store.activate(lane, 'allow')).resolves.toBe(false);
  });

  it('retains the shell focus router', async () => {
    await expect(store.focus(lane)).resolves.toEqual({ success: true, outcome: 'focused' });
    expect(focus).toHaveBeenCalledWith({
      workspacePath: '/workspace/a', sessionId: 'session-1', tabId: undefined,
    });
  });

  it('reactively tracks pending actions and reports stale and unavailable outcomes', async () => {
    notifications.upsert(lane);
    const outcome = jest.fn().mockResolvedValueOnce({ kind: 'stale' }).mockResolvedValueOnce({ kind: 'unavailable', reason: 'No owner' });
    TestBed.inject(ATTENTION_ACTION_DISPATCHER).dispatchOutcome = outcome;
    await expect(store.activate(lane, 'allow')).resolves.toBe(false);
    expect(store.status(lane)).toBe('Already answered');
    await expect(store.activate(lane, 'deny')).resolves.toBe(false);
    expect(store.disabledReason(lane, 'deny')).toBe('No owner');
    expect(store.status(lane)).toBe('No owner');
  });
});
