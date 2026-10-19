import { TestBed } from '@angular/core/testing';
import { AttentionItem } from './attention.types';
import { NotificationService, attentionConditionKey, attentionRequestKey } from './notification.service';

const request = (id: string, overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  key: attentionRequestKey('permission', id),
  generation: 1,
  kind: 'permission',
  source: 'chat',
  workspacePath: 'workspace',
  workspaceName: 'workspace',
  sessionId: 'session',
  severity: 'warning',
  title: 'Permission needed',
  actions: [{ id: 'open', label: 'Open' }],
  actionable: true,
  soundEligible: true,
  ...overrides,
});

const failure = (id: string, kind: 'failure' | 'warning' = 'failure'): AttentionItem => ({
  ...request(id),
  key: attentionConditionKey('workspace', id),
  kind,
  severity: kind === 'failure' ? 'error' : 'warning',
  title: kind,
  soundEligible: false,
});

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('keys requests by kind and id, independently of workspace', () => {
    expect(attentionRequestKey('permission', '1')).toBe('permission:1');
    expect(attentionRequestKey('permission', '1')).not.toBe(attentionRequestKey('question', '1'));
    expect(attentionRequestKey('permission', '1')).not.toBe(attentionRequestKey('permission', '2'));
  });

  it('dedupes repeated request snapshots and preserves a dismissed live row', () => {
    const item = request('one');
    service.upsert(item);
    service.dismissPresentation(item.key);
    service.upsert({ ...item, tabId: 'attached-tab' });
    expect(service.badgeCount()).toBe(1);
    expect(service.needsYou()).toHaveLength(1);
    expect(service.snackbars()).toHaveLength(0);
    service.upsert({ ...item, presentationKey: 'changed' });
    expect(service.snackbars()).toHaveLength(1);
  });

  it('keeps a dismissed chat presentation when a host source updates', () => {
    const chat = request('shared', { presentationKey: 'chat-version' });
    service.upsert(chat);
    service.dismissPresentation(chat.key);
    service.upsert({ ...chat, source: 'host', presentationKey: 'host-version' });
    expect(service.snackbars()).toHaveLength(0);
    expect(service.needsYou()[0]).toBe(chat);
  });

  it('keeps an equal-by-value action snapshot without replacing or rescheduling a notice', () => {
    const item = failure('unchanged');
    service.upsert(item);
    const original = service.recentNotices()[0];
    const schedule = jest.spyOn(globalThis, 'setTimeout');
    service.upsert({ ...item, actions: item.actions.map(action => ({ ...action })) });
    expect(service.recentNotices()[0]).toBe(original);
    expect(schedule).not.toHaveBeenCalled();
    schedule.mockRestore();
  });

  it('updates a notice when an optional field disappears', () => {
    const item = request('context-removed', { context: 'Waiting for approval' });
    service.upsert(item);
    const withoutContext = request('context-removed');
    service.upsert(withoutContext);
    expect(service.needsYou()[0]).toBe(withoutContext);
    expect(service.needsYou()[0].context).toBeUndefined();
  });

  it.each(['chat', 'host'] as const)('merges chat and host and survives %s resolution first', first => {
    const chat = request('merged');
    const host = { ...chat, source: 'host', title: 'Host projection', soundEligible: false };
    service.upsert(host);
    service.upsert(chat);
    expect(service.badgeCount()).toBe(1);
    expect(service.needsYou()[0].source).toBe('chat');
    jest.advanceTimersByTime(350);
    expect(service.soundCue()?.sequence).toBe(1);
    service.resolve(chat.key, 1, first);
    expect(service.badgeCount()).toBe(1);
    expect(service.needsYou()[0].source).toBe(first === 'chat' ? 'host' : 'chat');
    service.resolve(chat.key, 1, first === 'chat' ? 'host' : 'chat');
    expect(service.badgeCount()).toBe(0);
  });

  it('Clear all clears Recent and transient snackbars but keeps live requests and their snackbars', () => {
    service.upsert(request('one'));
    service.upsert(failure('failed'));
    service.upsert(failure('stale', 'warning'));
    expect(service.snackbars()).toHaveLength(3);
    expect(service.recentNotices()).toHaveLength(2);
    service.clearAll();
    expect(service.recentNotices()).toHaveLength(0);
    expect(service.snackbars().map(item => item.kind)).toEqual(['permission']);
    expect(service.needsYou()).toHaveLength(1);
    expect(service.badgeCount()).toBe(1);
    expect(service.canClearAll()).toBe(false);
  });

  it('keeps Recent after snackbar timeout, and pause resumes the remaining time', () => {
    service.upsert(failure('failed'));
    jest.advanceTimersByTime(3000);
    service.pauseSnackbar(attentionConditionKey('workspace', 'failed'));
    jest.advanceTimersByTime(10000);
    expect(service.snackbars()).toHaveLength(1);
    service.resumeSnackbar(attentionConditionKey('workspace', 'failed'));
    jest.advanceTimersByTime(5000);
    expect(service.snackbars()).toHaveLength(0);
    expect(service.recentNotices()).toHaveLength(1);
  });

  it('keeps a hovered snackbar paused when the bell closes', () => {
    const key = attentionConditionKey('workspace', 'failed');
    service.upsert(failure('failed'));
    service.pauseSnackbar(key);
    service.pauseAll();
    service.resumeAll();
    jest.advanceTimersByTime(9000);
    expect(service.snackbars()).toHaveLength(1);
    service.resumeSnackbar(key);
    jest.advanceTimersByTime(8000);
    expect(service.snackbars()).toHaveLength(0);
  });

  it('retains at most 75 Recent entries without evicting requests', () => {
    service.upsert(request('live'));
    for (let i = 0; i < 80; i++) service.upsert(failure(String(i)));
    expect(service.recentNotices()).toHaveLength(75);
    expect(service.badgeCount()).toBe(1);
  });

  it('evicts hidden Recent entries before visible ones', () => {
    for (let i = 0; i < 75; i++) service.upsert(failure(String(i)));
    const hidden = attentionConditionKey('workspace', '74');
    service.dismissRecent(hidden);
    service.upsert(failure('new'));
    expect(service.recentNotices().some(item => item.key === attentionConditionKey('workspace', '0'))).toBe(true);
    expect(service.recentNotices().some(item => item.key === hidden)).toBe(false);
  });

  it('keeps inline suppression when the panel clears its reason', () => {
    const item = request('inline');
    service.upsert(item);
    service.setSnackbarSuppressed(item.key, true, 'inline');
    service.setSnackbarSuppressed(item.key, true, 'panel');
    service.setSnackbarSuppressed(item.key, false, 'panel');
    expect(service.snackbars()).toHaveLength(0);
    service.setSnackbarSuppressed(item.key, false, 'inline');
    expect(service.snackbars()).toHaveLength(1);
  });

  it('rejects local info and success rows so they cannot accumulate after expiry', () => {
    service.upsert({ ...request('info'), kind: 'info' });
    service.upsert({ ...request('success'), kind: 'success' });
    expect(service.badgeCount()).toBe(0);
    expect(service.snackbars()).toHaveLength(0);
  });

  it('ignores stale resolution and never replays sound on a duplicate', () => {
    const item = request('one');
    service.upsert(item);
    service.upsert({ ...item });
    jest.advanceTimersByTime(350);
    expect(service.soundCue()?.sequence).toBe(1);
    service.resolve(item.key, 0);
    expect(service.badgeCount()).toBe(1);
    service.resolve(item.key, 1);
    expect(service.badgeCount()).toBe(0);
  });

  it('respects soundEligible and coalesces an eligible burst', () => {
    service.upsert(request('muted', { soundEligible: false }));
    jest.advanceTimersByTime(350);
    expect(service.soundCue()).toBeNull();
    service.upsert(request('a'));
    service.upsert(request('b'));
    jest.advanceTimersByTime(350);
    expect(service.soundCue()?.sequence).toBe(1);
  });
});
