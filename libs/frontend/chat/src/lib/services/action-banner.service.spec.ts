/**
 * ActionBannerService — per-tab banner scoping.
 *
 * Each banner carries a `tabId` (null = global). The show methods thread it
 * so a rewind fired on one tab does not surface its toast on another tab's
 * surface in canvas/tile mode.
 */
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { LoggingService, NotificationService } from '@ptah-extension/core';
import { ActionBannerService } from './action-banner.service';

describe('ActionBannerService', () => {
  let service: ActionBannerService;
  const upsert = jest.fn();
  const warn = jest.fn();

  beforeEach(() => {
    upsert.mockClear();
    warn.mockClear();
    TestBed.configureTestingModule({ providers: [ActionBannerService,
      { provide: NotificationService, useValue: { upsert } },
      { provide: LoggingService, useValue: { warn } },
      { provide: TabManagerService, useValue: {
        activeWorkspacePath: '/work',
        findTabByIdAcrossWorkspaces: (id: string) => ({ workspacePath: '/work', tab: { id } }),
      } },
    ] });
    service = TestBed.inject(ActionBannerService);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('stores tabId null by default (global banner)', () => {
    service.showInfo('hello');
    expect(service.banner()?.tabId).toBeNull();
    expect(service.banner()?.kind).toBe('info');
  });

  it('stores the supplied tabId on the banner', () => {
    service.showInfo('scoped', 'tab-1');
    expect(service.banner()?.tabId).toBe('tab-1');
  });

  it('projects errors and warnings to Recent without a local banner or badge kind', () => {
    service.showError('err', 'tab-2');
    expect(service.banner()).toBeNull();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'failure', severity: 'error', title: 'err', tabId: 'tab-2', workspacePath: '/work',
    }));

    service.showWarning('warn', 'tab-3');
    expect(service.banner()).toBeNull();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'warning', severity: 'warning', title: 'warn', tabId: 'tab-3', workspacePath: '/work',
    }));
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('keeps info local and out of attention', () => {
    service.showInfo('saved', 'tab-1');
    expect(service.banner()?.message).toBe('saved');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('logs when attention dependencies are unavailable', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ActionBannerService,
      { provide: NotificationService, useValue: null },
      { provide: TabManagerService, useValue: null },
      { provide: LoggingService, useValue: { warn } },
    ] });
    service = TestBed.inject(ActionBannerService);
    service.showError('lost error');
    expect(warn).toHaveBeenCalledWith('ActionBannerService', expect.stringContaining('notification or tab service missing'));
    expect(upsert).not.toHaveBeenCalled();
  });

  it('clear() dismisses the banner and cancels the auto-clear timer', () => {
    service.showInfo('hello', 'tab-1');
    service.clear();
    expect(service.banner()).toBeNull();
    jest.advanceTimersByTime(10_000);
    expect(service.banner()).toBeNull();
  });

  it('auto-clears after the default duration', () => {
    service.showInfo('hello', 'tab-1');
    jest.advanceTimersByTime(4_000);
    expect(service.banner()).toBeNull();
  });

  it('a new banner cancels the prior auto-clear timer', () => {
    service.showInfo('first', 'tab-1');
    jest.advanceTimersByTime(2_000);
    service.showInfo('second', 'tab-1');
    // 4s after the first show — the first timer would have cleared it, but it
    // was cancelled when the second banner was shown, so 'second' survives.
    jest.advanceTimersByTime(2_000);
    expect(service.banner()?.message).toBe('second');
    // The second banner's own 4s timer (anchored at the second show, t=2s)
    // fires at t=6s.
    jest.advanceTimersByTime(2_000);
    expect(service.banner()).toBeNull();
  });
});
