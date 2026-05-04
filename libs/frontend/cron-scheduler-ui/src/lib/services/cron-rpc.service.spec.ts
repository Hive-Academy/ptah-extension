/**
 * CronRpcService — RPC roundtrip tests (Batch C1).
 *
 * The cron handlers are Electron-only; in VS Code the dispatcher returns
 * "not-available" errors. The service translates RPC failure into a thrown
 * Error — the renderer catches that and shows the "Cron is desktop-only"
 * placeholder. These tests lock both happy paths and the Electron-only
 * error propagation.
 *
 * Note: CronRpcService uses `result.isSuccess()` only (no `&& result.data`
 * guard). The mock factory mirrors that contract — no `data` is required
 * for void-result methods like delete().
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { CronRpcService } from './cron-rpc.service';

describe('CronRpcService', () => {
  let service: CronRpcService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        CronRpcService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    service = TestBed.inject(CronRpcService);
  });

  const okResult = <T>(data: T) => ({
    success: true,
    isSuccess: () => true,
    data,
  });
  const errResult = (error: string) => ({
    success: false,
    isSuccess: () => false,
    error,
  });

  it('list() calls cron:list with empty params by default', async () => {
    rpcCall.mockResolvedValue(okResult({ jobs: [] }));

    const result = await service.list();

    expect(rpcCall).toHaveBeenCalledWith(
      'cron:list',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual({ jobs: [] });
  });

  it('create() forwards the full job payload to cron:create', async () => {
    rpcCall.mockResolvedValue(okResult({ id: 'j-1' }));

    const params = {
      name: 'nightly',
      schedule: '0 2 * * *',
      command: 'sync',
    } as never;
    await service.create(params);

    expect(rpcCall).toHaveBeenCalledWith(
      'cron:create',
      params,
      expect.any(Object),
    );
  });

  it('runNow() targets cron:runNow with the supplied id', async () => {
    rpcCall.mockResolvedValue(okResult({ runId: 'r-1' }));

    await service.runNow({ id: 'j-1' } as never);

    expect(rpcCall).toHaveBeenCalledWith(
      'cron:runNow',
      { id: 'j-1' },
      expect.any(Object),
    );
  });

  it('throws with the RPC error string when cron is not available (VS Code)', async () => {
    rpcCall.mockResolvedValue(errResult('cron:not-available'));

    await expect(service.list()).rejects.toThrow('cron:not-available');
  });
});
