/**
 * MemoryRpcService — RPC roundtrip tests (TASK_2026_HERMES_FINISH Batch C1).
 *
 * Stubs `ClaudeRpcService.call` to verify each method:
 *   1. Targets the expected `memory:*` RPC name.
 *   2. Forwards the supplied parameters with the documented timeout option.
 *   3. Returns `result.data` on success.
 *   4. Throws with the RPC error string on failure.
 *
 * Pattern matches `wizard-rpc.service.spec.ts` so the same `okResult` /
 * `errResult` factories produce results compatible with `RpcResult.isSuccess`.
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { MemoryRpcService } from './memory-rpc.service';

describe('MemoryRpcService', () => {
  let service: MemoryRpcService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        MemoryRpcService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    service = TestBed.inject(MemoryRpcService);
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

  it('list() calls memory:list with workspaceRoot null by default and returns data', async () => {
    const payload = { items: [], total: 0 };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.list();

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:list',
      { workspaceRoot: null },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(payload);
  });

  it('list() forwards optional tier/limit/offset filters', async () => {
    rpcCall.mockResolvedValue(okResult({ items: [], total: 0 }));

    await service.list({
      workspaceRoot: '/ws',
      tier: 'session',
      limit: 50,
      offset: 10,
    });

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:list',
      {
        workspaceRoot: '/ws',
        tier: 'session',
        limit: 50,
        offset: 10,
      },
      expect.any(Object),
    );
  });

  it('search() targets memory:search with query and topK', async () => {
    rpcCall.mockResolvedValue(okResult({ results: [] }));

    await service.search('needle', 5);

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:search',
      { query: 'needle', topK: 5 },
      expect.any(Object),
    );
  });

  it('pin() targets memory:pin and returns data on success', async () => {
    const payload = { pinned: true };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.pin('m-1');

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:pin',
      { id: 'm-1' },
      expect.any(Object),
    );
    expect(result).toEqual(payload);
  });

  it('throws with the RPC error string when the result is unsuccessful', async () => {
    rpcCall.mockResolvedValue(errResult('boom'));

    await expect(service.forget('m-99')).rejects.toThrow('boom');
  });
});
