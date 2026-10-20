import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  attentionConditionKey,
  ElectronLayoutService,
  NOTICE_ACTION_HANDLER,
  NotificationService,
} from '@ptah-extension/core';
import type { GitStatusUnavailableReason } from '@ptah-extension/shared';
import { GitStatusService } from './git-status.service';
import { GitStatusAttentionService, provideGitStatusAttention } from './git-status-attention.service';

const key = (path: string) => attentionConditionKey(path, 'git-status-unavailable');

describe('GitStatusAttentionService', () => {
  let path: ReturnType<typeof signal<string | null>>;
  let reason: ReturnType<typeof signal<GitStatusUnavailableReason | null>>;
  let visible: ReturnType<typeof signal<boolean>>;
  let refresh: jest.Mock<Promise<void>, []>;
  let startListening: jest.Mock;
  let stopListening: jest.Mock;
  let notices: NotificationService;
  let attention: GitStatusAttentionService;

  beforeEach(() => {
    jest.useFakeTimers();
    path = signal<string | null>('/ws/a');
    reason = signal<GitStatusUnavailableReason | null>(null);
    visible = signal(true);
    refresh = jest.fn(async () => undefined);
    startListening = jest.fn();
    stopListening = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideGitStatusAttention(),
        {
          provide: GitStatusService,
          useValue: {
            activeWorkspacePath: path,
            statusUnavailable: reason,
            refresh,
            startListening,
            stopListening,
          },
        },
        { provide: ElectronLayoutService, useValue: { editorPanelVisible: visible } },
      ],
    });
    notices = TestBed.inject(NotificationService);
    attention = TestBed.inject(GitStatusAttentionService);
    TestBed.tick();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('observes status without arming the git push gate and publishes one Recent row with no visible snackbar', () => {
    expect(startListening).not.toHaveBeenCalled();
    reason.set('timeout');
    TestBed.tick();
    expect(notices.recentNotices().filter(item => item.key === key('/ws/a'))).toHaveLength(1);
    expect(notices.snackbars().filter(item => item.key === key('/ws/a'))).toHaveLength(0);
    expect(notices.badgeCount()).toBe(0);
  });

  it('publishes a ten-second snackbar while the dock is hidden, including after the shell unmounts', () => {
    visible.set(false);
    reason.set('locked');
    TestBed.tick();
    expect(notices.snackbars().filter(item => item.key === key('/ws/a'))).toHaveLength(1);
    expect(notices.recentNotices().filter(item => item.key === key('/ws/a'))).toHaveLength(1);
    jest.advanceTimersByTime(10_001);
    expect(notices.snackbars().filter(item => item.key === key('/ws/a'))).toHaveLength(0);
    expect(notices.recentNotices().filter(item => item.key === key('/ws/a'))).toHaveLength(1);
    expect(stopListening).not.toHaveBeenCalled();
  });

  it('follows visibility changes without duplicating the Recent row', () => {
    reason.set('timeout');
    TestBed.tick();
    visible.set(false);
    TestBed.tick();
    expect(notices.snackbars().filter(item => item.key === key('/ws/a'))).toHaveLength(1);
    visible.set(true);
    TestBed.tick();
    expect(notices.snackbars().filter(item => item.key === key('/ws/a'))).toHaveLength(0);
    expect(notices.recentNotices().filter(item => item.key === key('/ws/a'))).toHaveLength(1);
  });

  it('resolves on recovery and on workspace change', () => {
    reason.set('timeout');
    TestBed.tick();
    reason.set(null);
    TestBed.tick();
    expect(notices.recentNotices()).toHaveLength(0);

    reason.set('locked');
    TestBed.tick();
    path.set('/ws/b');
    reason.set('error');
    TestBed.tick();
    expect(notices.recentNotices().map(item => item.key)).toEqual([key('/ws/b')]);
  });

  it('registers Retry and reports completed only after status recovers', async () => {
    reason.set('timeout');
    TestBed.tick();
    const handlers = TestBed.inject(NOTICE_ACTION_HANDLER);
    expect(handlers).toContain(attention);
    expect(attention.canHandle(key('/ws/a'), 'retry')).toBe(true);
    expect(attention.canHandle(key('/ws/a'), 'open')).toBe(false);
    refresh.mockImplementation(async () => { reason.set(null); });
    await expect(attention.run(key('/ws/a'), 1, 'retry')).resolves.toEqual({ kind: 'completed' });
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(attention.run(key('/ws/a'), 1, 'retry')).resolves.toMatchObject({ kind: 'unavailable' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when refresh cannot recover or the key is stale', async () => {
    reason.set('timeout');
    TestBed.tick();
    await expect(attention.run(key('/ws/a'), 1, 'retry')).resolves.toMatchObject({ kind: 'unavailable' });
    path.set('/ws/b');
    await expect(attention.run(key('/ws/a'), 1, 'retry')).resolves.toMatchObject({ kind: 'unavailable' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
