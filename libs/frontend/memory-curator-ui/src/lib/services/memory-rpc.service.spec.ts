/**
 * MemoryRpcService — RPC roundtrip tests.
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

  it('purgeBySubjectPattern() calls memory:purgeBySubjectPattern with pattern, mode, workspaceRoot and returns data', async () => {
    const payload = { deleted: 3 };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.purgeBySubjectPattern(
      'node_modules',
      'substring',
      '/ws',
    );

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:purgeBySubjectPattern',
      { pattern: 'node_modules', mode: 'substring', workspaceRoot: '/ws' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(payload);
  });

  it('purgeBySubjectPattern() throws with RPC error string on failure', async () => {
    rpcCall.mockResolvedValue(errResult('store unavailable'));

    await expect(
      service.purgeBySubjectPattern('foo', 'like', '/ws'),
    ).rejects.toThrow('store unavailable');
  });

  it('purgeBySubjectPattern() omits workspaceRoot when undefined', async () => {
    rpcCall.mockResolvedValue(okResult({ deleted: 0 }));

    await service.purgeBySubjectPattern('foo', 'substring');

    const callArgs = rpcCall.mock.calls[0];
    const params = callArgs[1] as Record<string, unknown>;
    expect(params).toEqual({ pattern: 'foo', mode: 'substring' });
    expect('workspaceRoot' in params).toBe(false);
  });

  describe('mem: progressive disclosure', () => {
    it('searchIndex() calls mem:searchIndex with the supplied params and returns data', async () => {
      const payload = { rows: [], bm25Only: true };
      rpcCall.mockResolvedValue(okResult(payload));

      const params = {
        query: 'auth',
        topK: 25,
        workspaceRoot: '/ws',
        type: ['bugfix'] as const,
      };
      const result = await service.searchIndex(params);

      expect(rpcCall).toHaveBeenCalledWith(
        'mem:searchIndex',
        params,
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(result).toEqual(payload);
    });

    it('searchIndex() throws with the RPC error string on failure', async () => {
      rpcCall.mockResolvedValue(errResult('search exploded'));

      await expect(service.searchIndex({ query: 'x' })).rejects.toThrow(
        'search exploded',
      );
    });

    it('timeline() calls mem:timeline with anchor + neighbour counts', async () => {
      const payload = { rows: [], anchorIndex: 3 };
      rpcCall.mockResolvedValue(okResult(payload));

      const result = await service.timeline({
        anchorId: 'mem-abc',
        before: 5,
        after: 5,
      });

      expect(rpcCall).toHaveBeenCalledWith(
        'mem:timeline',
        { anchorId: 'mem-abc', before: 5, after: 5 },
        expect.any(Object),
      );
      expect(result).toEqual(payload);
    });

    it('getObservations() forwards the id list to mem:getObservations', async () => {
      const payload = { memories: [], observationsBySession: {} };
      rpcCall.mockResolvedValue(okResult(payload));

      await service.getObservations({
        ids: ['mem-1', 'mem-2'],
        includeQueueRows: true,
      });

      expect(rpcCall).toHaveBeenCalledWith(
        'mem:getObservations',
        { ids: ['mem-1', 'mem-2'], includeQueueRows: true },
        expect.any(Object),
      );
    });
  });

  describe('corpus: knowledge corpus lifecycle', () => {
    it('listCorpora() calls corpus:list with empty params when workspaceRoot omitted', async () => {
      const payload = { corpora: [] };
      rpcCall.mockResolvedValue(okResult(payload));

      const result = await service.listCorpora();

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:list',
        {},
        expect.any(Object),
      );
      expect(result).toEqual(payload);
    });

    it('listCorpora() forwards workspaceRoot when provided', async () => {
      rpcCall.mockResolvedValue(okResult({ corpora: [] }));

      await service.listCorpora('/ws');

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:list',
        { workspaceRoot: '/ws' },
        expect.any(Object),
      );
    });

    it('buildCorpus() calls corpus:build and returns data', async () => {
      const payload = {
        corpus: {
          id: 'c-1',
          name: 'auth',
          count: 12,
          builtAt: 1,
          rebuiltAt: null,
          workspaceRoot: '/ws',
        },
      };
      rpcCall.mockResolvedValue(okResult(payload));

      const result = await service.buildCorpus({
        name: 'auth',
        type: ['bugfix'],
      });

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:build',
        { name: 'auth', type: ['bugfix'] },
        expect.any(Object),
      );
      expect(result).toEqual(payload);
    });

    it('primeCorpus() calls corpus:prime with name and returns sessionId', async () => {
      rpcCall.mockResolvedValue(okResult({ sessionId: 's-1' }));

      const result = await service.primeCorpus('auth');

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:prime',
        { name: 'auth' },
        expect.any(Object),
      );
      expect(result).toEqual({ sessionId: 's-1' });
    });

    it('queryCorpus() calls corpus:query with name + question', async () => {
      rpcCall.mockResolvedValue(
        okResult({ sessionId: 's-1', answer: 'because of x' }),
      );

      const result = await service.queryCorpus('auth', 'why?');

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:query',
        { name: 'auth', question: 'why?' },
        expect.any(Object),
      );
      expect(result.answer).toBe('because of x');
    });

    it('reprimeCorpus() calls corpus:reprime', async () => {
      rpcCall.mockResolvedValue(okResult({ sessionId: 's-2' }));

      await service.reprimeCorpus('auth');

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:reprime',
        { name: 'auth' },
        expect.any(Object),
      );
    });

    it('rebuildCorpus() calls corpus:rebuild and returns counts', async () => {
      rpcCall.mockResolvedValue(okResult({ added: 2, removed: 1 }));

      const result = await service.rebuildCorpus('auth');

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:rebuild',
        { name: 'auth' },
        expect.any(Object),
      );
      expect(result).toEqual({ added: 2, removed: 1 });
    });

    it('deleteCorpus() calls corpus:delete and returns deleted flag', async () => {
      rpcCall.mockResolvedValue(okResult({ deleted: true }));

      const result = await service.deleteCorpus('auth');

      expect(rpcCall).toHaveBeenCalledWith(
        'corpus:delete',
        { name: 'auth' },
        expect.any(Object),
      );
      expect(result.deleted).toBe(true);
    });

    it('deleteCorpus() throws on RPC error', async () => {
      rpcCall.mockResolvedValue(errResult('store gone'));

      await expect(service.deleteCorpus('auth')).rejects.toThrow('store gone');
    });
  });
});
