import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, LoggingService, RpcResult } from '@ptah-extension/core';
import type { CliDetectionResult } from '@ptah-extension/shared';
import { HostInventoryCache } from './host-inventory.cache';
import { VITALS_ERROR_RETRY_MS, VITALS_RPC_TIMEOUT_MS } from './vitals-load';

function cli(overrides: Partial<CliDetectionResult>): CliDetectionResult {
  return { cli: 'codex', installed: true, messagingMode: 'none', ...overrides };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('HostInventoryCache', () => {
  let call: jest.Mock;
  let logger: { error: jest.Mock };
  let cache: HostInventoryCache;

  beforeEach(() => {
    call = jest.fn(async (method: string) =>
      method === 'skillsSh:listInstalled'
        ? new RpcResult(true, { skills: [{}, {}, {}] })
        : new RpcResult(true, {
            clis: [
              cli({ cli: 'codex' }),
              cli({ cli: 'copilot', installed: false }),
              cli({ cli: 'cursor', disabled: true }),
              cli({ cli: 'opencode' }),
            ],
          }),
    );
    logger = { error: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: logger },
      ],
    });
    cache = TestBed.inject(HostInventoryCache);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('counts installed skills once for repeated reads', async () => {
    const state = cache.skillCount();
    cache.skillCount();
    await flush();

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'skillsSh:listInstalled',
      {},
      { timeout: VITALS_RPC_TIMEOUT_MS },
    );
    expect(state()).toEqual({ status: 'ready', value: 3 });
  });

  it('counts installed, enabled CLIs from its own detection read', async () => {
    const state = cache.cliCount();
    await flush();

    expect(call).toHaveBeenCalledWith('agent:detectClis', undefined, {
      timeout: VITALS_RPC_TIMEOUT_MS,
    });
    expect(state()).toEqual({ status: 'ready', value: 2 });
  });

  it('reports failures as error and retries on a read after the retry floor', async () => {
    jest.useFakeTimers();
    call
      .mockResolvedValueOnce(new RpcResult(false, undefined, 'boom'))
      .mockRejectedValueOnce(new Error('transport'));
    const skills = cache.skillCount();
    const clis = cache.cliCount();
    await flush();

    expect(skills()).toEqual({ status: 'error' });
    expect(clis()).toEqual({ status: 'error' });
    expect(logger.error).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(VITALS_ERROR_RETRY_MS);
    cache.skillCount();
    await flush();
    expect(skills()).toEqual({ status: 'ready', value: 3 });
  });

  it('treats an answer without a list as an error', async () => {
    call.mockResolvedValueOnce(new RpcResult(true, { skills: null }));
    const state = cache.skillCount();
    await flush();

    expect(state()).toEqual({ status: 'error' });
    expect(logger.error).toHaveBeenCalledWith(
      'HostInventoryCache',
      'Installed skills result is invalid',
    );
  });
});
