import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, LoggingService, RpcResult } from '@ptah-extension/core';
import type { UsageSummary } from '@ptah-extension/shared';
import {
  USAGE_VITALS_MAX_ENTRIES,
  USAGE_VITALS_TIMEOUT_MS,
  UsageVitalsCache,
} from './usage-vitals.cache';
import { VITALS_ERROR_RETRY_MS, VITALS_READY_TTL_MS } from './vitals-load';

const SUMMARY: UsageSummary = {
  version: 1,
  generatedAt: '2026-10-26T12:00:00.000Z',
  timeZone: 'UTC',
  fromDay: '2026-10-20',
  untilDayExclusive: '2026-10-27',
  facts: [],
  sources: [],
  pricing: { source: 'bundled', asOf: null },
};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('UsageVitalsCache', () => {
  let call: jest.Mock;
  let logger: { error: jest.Mock };
  let cache: UsageVitalsCache;

  beforeEach(() => {
    jest.useFakeTimers();
    call = jest.fn(async () => new RpcResult(true, SUMMARY));
    logger = { error: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: logger },
      ],
    });
    cache = TestBed.inject(UsageVitalsCache);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('shares one call per scope and range, with the 40 s timeout', async () => {
    const first = cache.summary('/ws', 7);
    const second = cache.summary('/ws', 7);
    await flush();

    expect(first).toBe(second);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'analytics:spendSummary',
      { range: 7, workspace: '/ws' },
      { timeout: USAGE_VITALS_TIMEOUT_MS },
    );
    expect(first()).toEqual({ status: 'ready', value: SUMMARY });
  });

  it('shares an entry between spellings of one workspace path', async () => {
    const first = cache.summary('D:\\Projects\\Ptah\\', 90);
    const second = cache.summary('d:/projects/ptah', 90);
    await flush();

    expect(first).toBe(second);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'analytics:spendSummary',
      { range: 90, workspace: 'D:\\Projects\\Ptah\\' },
      { timeout: USAGE_VITALS_TIMEOUT_MS },
    );
  });

  it('keeps separate entries per key and omits the workspace for all scopes', async () => {
    cache.summary(null, 90);
    cache.summary('', 90);
    cache.summary('/ws', 90);
    cache.summary('/ws', 7);
    await flush();

    expect(call).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenCalledWith(
      'analytics:spendSummary',
      { range: 90 },
      { timeout: USAGE_VITALS_TIMEOUT_MS },
    );
  });

  it('evicts the least recently read entry past the cap', async () => {
    const kept = cache.summary('/ws-0', 90);
    for (let i = 1; i <= USAGE_VITALS_MAX_ENTRIES; i++) {
      if (i === USAGE_VITALS_MAX_ENTRIES) cache.summary('/ws-0', 90);
      cache.summary(`/ws-${i}`, 90);
    }
    await flush();
    expect(call).toHaveBeenCalledTimes(USAGE_VITALS_MAX_ENTRIES + 1);

    expect(cache.summary('/ws-0', 90)).toBe(kept);
    cache.summary('/ws-1', 90);
    expect(call).toHaveBeenCalledTimes(USAGE_VITALS_MAX_ENTRIES + 2);
  });

  it('refetches once the ready answer is older than the TTL', async () => {
    cache.summary(null, 7);
    await flush();
    jest.advanceTimersByTime(VITALS_READY_TTL_MS);
    cache.summary(null, 7);

    expect(call).toHaveBeenCalledTimes(2);
  });

  it('treats a summary that fails the schema as an error', async () => {
    call.mockResolvedValueOnce(
      new RpcResult(true, {
        ...SUMMARY,
        facts: [{ day: '2026-10-26', providerId: 'anthropic' }],
      }),
    );
    const state = cache.summary('/ws', 90);
    await flush();

    expect(state()).toEqual({ status: 'error' });
    expect(logger.error).toHaveBeenCalledWith(
      'UsageVitalsCache',
      'Usage summary result is invalid',
    );
  });

  it('reports a failed call as error and retries after the retry floor', async () => {
    call.mockResolvedValueOnce(new RpcResult(false, undefined, 'boom'));
    const state = cache.summary('/ws', 90);
    await flush();

    expect(state()).toEqual({ status: 'error' });
    expect(logger.error).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(VITALS_ERROR_RETRY_MS);
    cache.summary('/ws', 90);
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    expect(state()).toEqual({ status: 'ready', value: SUMMARY });
  });

  it('reports a rejected call as error', async () => {
    call.mockRejectedValueOnce(new Error('transport'));
    const state = cache.summary(null, 90);
    await flush();

    expect(state()).toEqual({ status: 'error' });
  });
});
