import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { MemoryDiagnosticsRpcService } from './memory-diagnostics-rpc.service';

describe('MemoryDiagnosticsRpcService', () => {
  let service: MemoryDiagnosticsRpcService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        MemoryDiagnosticsRpcService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    service = TestBed.inject(MemoryDiagnosticsRpcService);
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

  it('diagnostics() targets memory:diagnostics with default workspaceRoot null', async () => {
    const payload = {
      lastRunAt: null,
      lastRunStats: null,
      lastDecayAt: null,
      lastDecayStats: null,
      recentEvents: [],
      dbHealth: {
        memories: 0,
        memory_chunks: 0,
        memory_chunks_vec: 0,
        memory_chunks_fts: 0,
        code_symbols: 0,
        code_symbols_vec: 0,
        coherent: true,
        mismatches: [],
      },
      triggers: {
        preCompact: true,
        idleMs: 600000,
        turnThreshold: 20,
        bootScan: true,
      },
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.diagnostics();

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:diagnostics',
      { workspaceRoot: null },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(payload);
  });

  it('diagnostics() forwards workspaceRoot + eventLimit', async () => {
    rpcCall.mockResolvedValue(
      okResult({
        lastRunAt: null,
        lastRunStats: null,
        lastDecayAt: null,
        lastDecayStats: null,
        recentEvents: [],
        dbHealth: {
          memories: 0,
          memory_chunks: 0,
          memory_chunks_vec: 0,
          memory_chunks_fts: 0,
          code_symbols: 0,
          code_symbols_vec: 0,
          coherent: true,
          mismatches: [],
        },
        triggers: {
          preCompact: true,
          idleMs: 0,
          turnThreshold: 0,
          bootScan: true,
        },
      }),
    );

    await service.diagnostics('/ws', 25);

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:diagnostics',
      { workspaceRoot: '/ws', eventLimit: 25 },
      expect.any(Object),
    );
  });

  it('runNow() forwards params and returns data', async () => {
    const payload = {
      success: true,
      startedAt: 1,
      completedAt: 2,
      stats: null,
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.runNow({
      sessionId: 'sess-1',
      workspaceRoot: '/ws',
    });

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:runNow',
      { sessionId: 'sess-1', workspaceRoot: '/ws' },
      expect.any(Object),
    );
    expect(result).toEqual(payload);
  });

  it('setTriggers() forwards partial triggers DTO', async () => {
    const payload = {
      triggers: {
        preCompact: false,
        idleMs: 600000,
        turnThreshold: 20,
        bootScan: true,
      },
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.setTriggers({
      triggers: { preCompact: false },
    });

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:setTriggers',
      { triggers: { preCompact: false } },
      expect.any(Object),
    );
    expect(result).toEqual(payload);
  });

  it('getTriggers() calls memory:getTriggers with empty params', async () => {
    const payload = {
      triggers: {
        preCompact: true,
        idleMs: 600000,
        turnThreshold: 20,
        bootScan: true,
      },
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.getTriggers();

    expect(rpcCall).toHaveBeenCalledWith(
      'memory:getTriggers',
      {},
      expect.any(Object),
    );
    expect(result).toEqual(payload);
  });

  it('throws with RPC error string on failure', async () => {
    rpcCall.mockResolvedValue(errResult('boom'));

    await expect(service.diagnostics()).rejects.toThrow('boom');
  });

  it('runNow() throws with default message when error is missing', async () => {
    rpcCall.mockResolvedValue({
      success: false,
      isSuccess: () => false,
    });

    await expect(
      service.runNow({ sessionId: 's', workspaceRoot: '/w' }),
    ).rejects.toThrow('memory:runNow failed');
  });
});
