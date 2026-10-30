/**
 * GitRootWatchLeaseService (TASK_2026_855): debounce, renewal only while the
 * set is non-empty, release on destroy, de-duplication and cap, Electron only,
 * failure tolerated.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { GitRootWatchLeaseService } from './git-root-watch-lease.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

describe('GitRootWatchLeaseService', () => {
  const isElectron = signal(true);
  let service: GitRootWatchLeaseService;

  const sentRoots = (): string[][] =>
    mockRpcCall.mock.calls.map(
      ([, , params]) => (params as { roots: string[] }).roots,
    );

  beforeEach(() => {
    jest.useFakeTimers();
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { watched: [], rejected: [], evicted: [] },
    });
    isElectron.set(true);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VSCodeService,
          useValue: { config: () => ({ isElectron: isElectron() }) },
        },
      ],
    });
    service = TestBed.inject(GitRootWatchLeaseService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('collapses a burst of updates into one call after the debounce', async () => {
    service.update(['/wt/a']);
    service.update(['/wt/b']);
    service.update(['/wt/c', '/wt/a']);
    expect(mockRpcCall).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:watchRoots',
      { leaseId: expect.any(String), roots: ['/wt/c', '/wt/a'] },
    );
  });

  it('de-duplicates spellings, skips empty entries and caps at four roots', async () => {
    service.update([null, '', '/wt/A', '/WT/a/', '/b', '/c', '/d', '/e']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);

    expect(sentRoots()).toEqual([['/wt/A', '/b', '/c', '/d']]);
  });

  it('renews only while the set is non-empty', async () => {
    service.update(['/wt/a']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    await jest.advanceTimersByTimeAsync(
      GitRootWatchLeaseService.RENEW_INTERVAL_MS,
    );
    expect(sentRoots()).toEqual([['/wt/a'], ['/wt/a']]);

    service.update([]);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    expect(sentRoots().at(-1)).toEqual([]);
    mockRpcCall.mockClear();

    await jest.advanceTimersByTimeAsync(
      GitRootWatchLeaseService.RENEW_INTERVAL_MS * 3,
    );
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('stops renewing roots the backend rejected until the set changes (M3)', async () => {
    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { watched: ['/wt/a'], rejected: ['/wt/gone'], evicted: [] },
    });
    service.update(['/wt/a', '/wt/gone']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    await jest.advanceTimersByTimeAsync(
      GitRootWatchLeaseService.RENEW_INTERVAL_MS,
    );

    expect(sentRoots()).toEqual([['/wt/a', '/wt/gone'], ['/wt/a']]);

    // A new set from the dock asks for every root again.
    service.update(['/wt/gone', '/wt/b']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    expect(sentRoots().at(-1)).toEqual(['/wt/gone', '/wt/b']);
  });

  it('releases the lease on renewal when every root was rejected (M3)', async () => {
    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { watched: [], rejected: ['/wt/gone'], evicted: [] },
    });
    service.update(['/wt/gone']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    await jest.advanceTimersByTimeAsync(
      GitRootWatchLeaseService.RENEW_INTERVAL_MS * 3,
    );

    expect(sentRoots()).toEqual([['/wt/gone'], []]);
  });

  it('does not resend a set the backend already holds', async () => {
    service.update(['/wt/a']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    service.update(['/wt/a']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an empty set that was never leased', async () => {
    service.update([]);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);

    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('clears the timers on destroy', async () => {
    service.update(['/wt/a']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    service.update(['/wt/b']);
    mockRpcCall.mockClear();

    TestBed.resetTestingModule();
    await jest.advanceTimersByTimeAsync(
      GitRootWatchLeaseService.RENEW_INTERVAL_MS * 2,
    );

    expect(mockRpcCall).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('makes no call outside Electron', async () => {
    isElectron.set(false);
    service.update(['/wt/a']);
    await jest.advanceTimersByTimeAsync(
      GitRootWatchLeaseService.RENEW_INTERVAL_MS,
    );

    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('tolerates a failed call and retries the same set on the next update', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* expected */
    });
    mockRpcCall.mockResolvedValueOnce({ success: false, error: 'Unknown' });
    service.update(['/wt/a']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);
    expect(warn).toHaveBeenCalled();

    service.update(['/wt/a']);
    await jest.advanceTimersByTimeAsync(GitRootWatchLeaseService.DEBOUNCE_MS);

    expect(sentRoots()).toEqual([['/wt/a'], ['/wt/a']]);
    warn.mockRestore();
  });
});
