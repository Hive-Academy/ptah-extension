/**
 * ActionBannerService — per-tab banner scoping.
 *
 * Each banner carries a `tabId` (null = global). The show methods thread it
 * so a rewind fired on one tab does not surface its toast on another tab's
 * surface in canvas/tile mode.
 */
import { TestBed } from '@angular/core/testing';
import { ActionBannerService } from './action-banner.service';

describe('ActionBannerService', () => {
  let service: ActionBannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ActionBannerService] });
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

  it('showError / showWarning also thread tabId', () => {
    service.showError('err', 'tab-2');
    expect(service.banner()?.kind).toBe('error');
    expect(service.banner()?.tabId).toBe('tab-2');

    service.showWarning('warn', 'tab-3');
    expect(service.banner()?.kind).toBe('warning');
    expect(service.banner()?.tabId).toBe('tab-3');
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
