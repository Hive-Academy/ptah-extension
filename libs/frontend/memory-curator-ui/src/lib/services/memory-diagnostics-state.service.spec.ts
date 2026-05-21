import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';

import { MemoryDiagnosticsRpcService } from './memory-diagnostics-rpc.service';
import {
  DIAGNOSTICS_POLL_MS,
  MemoryDiagnosticsStateService,
} from './memory-diagnostics-state.service';

describe('MemoryDiagnosticsStateService', () => {
  let service: MemoryDiagnosticsStateService;
  let diagnosticsMock: jest.Mock;
  let runNowMock: jest.Mock;
  let setTriggersMock: jest.Mock;
  let getTriggersMock: jest.Mock;

  const workspaceSignal = signal<{ path: string } | null>({ path: '/ws' });

  const baseTriggers = {
    preCompact: true,
    idleMs: 600000,
    turnThreshold: 20,
    bootScan: true,
  };
  const baseDbHealth = {
    memories: 1,
    memory_chunks: 1,
    memory_chunks_vec: 1,
    memory_chunks_fts: 1,
    code_symbols: 0,
    code_symbols_vec: 0,
    coherent: true,
    mismatches: [],
  };

  const snapshot = {
    lastRunAt: 1000,
    lastRunStats: { promoted: 3 },
    lastDecayAt: 500,
    lastDecayStats: { decayed: 1 },
    recentEvents: [
      { kind: 'curator-run' as const, timestamp: 100 },
      { kind: 'decay-run' as const, timestamp: 200 },
    ],
    dbHealth: baseDbHealth,
    triggers: baseTriggers,
  };

  beforeEach(() => {
    diagnosticsMock = jest.fn().mockResolvedValue(snapshot);
    runNowMock = jest.fn().mockResolvedValue({
      success: true,
      startedAt: 0,
      completedAt: 1,
      stats: null,
    });
    setTriggersMock = jest
      .fn()
      .mockResolvedValue({ triggers: { ...baseTriggers, preCompact: false } });
    getTriggersMock = jest.fn().mockResolvedValue({ triggers: baseTriggers });

    TestBed.configureTestingModule({
      providers: [
        MemoryDiagnosticsStateService,
        {
          provide: MemoryDiagnosticsRpcService,
          useValue: {
            diagnostics: diagnosticsMock,
            runNow: runNowMock,
            setTriggers: setTriggersMock,
            getTriggers: getTriggersMock,
          },
        },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceSignal },
        },
      ],
    });
    service = TestBed.inject(MemoryDiagnosticsStateService);
  });

  afterEach(() => {
    service.stopPolling();
    jest.useRealTimers();
  });

  it('refresh() calls diagnostics RPC and populates signals', async () => {
    await service.refresh();

    expect(diagnosticsMock).toHaveBeenCalledWith('/ws');
    expect(service.triggers()).toEqual(baseTriggers);
    expect(service.lastRun()).toEqual({ at: 1000, stats: { promoted: 3 } });
    expect(service.lastDecay()).toEqual({ at: 500, stats: { decayed: 1 } });
    expect(service.recentEvents().length).toBe(2);
    expect(service.dbHealth()).toEqual(baseDbHealth);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('refresh() sets error signal and clears loading on RPC failure', async () => {
    diagnosticsMock.mockRejectedValue(new Error('boom'));

    await service.refresh();

    expect(service.error()).toBe('boom');
    expect(service.loading()).toBe(false);
  });

  it('runNow() calls RPC then refreshes signals', async () => {
    await service.runNow();

    expect(runNowMock).toHaveBeenCalledWith({
      sessionId: 'manual',
      workspaceRoot: '/ws',
    });
    expect(diagnosticsMock).toHaveBeenCalled();
    expect(service.error()).toBeNull();
  });

  it('runNow() blocks when no workspace is open', async () => {
    workspaceSignal.set(null);

    await service.runNow();

    expect(runNowMock).not.toHaveBeenCalled();
    expect(service.error()).toBe('No workspace is open.');

    workspaceSignal.set({ path: '/ws' });
  });

  it('setTriggers() updates the triggers signal from RPC response', async () => {
    await service.setTriggers({ preCompact: false });

    expect(setTriggersMock).toHaveBeenCalledWith({
      triggers: { preCompact: false },
    });
    expect(service.triggers()).toEqual({
      ...baseTriggers,
      preCompact: false,
    });
  });

  it('setTriggers() surfaces RPC error through the error signal', async () => {
    setTriggersMock.mockRejectedValue(new Error('write failed'));

    await service.setTriggers({ idleMs: 100 });

    expect(service.error()).toBe('write failed');
  });

  it('startPolling() triggers immediate refresh on first subscriber', async () => {
    jest.useFakeTimers();
    service.startPolling();
    await Promise.resolve();
    await Promise.resolve();

    expect(diagnosticsMock).toHaveBeenCalledTimes(1);
  });

  it('stopPolling() tears down timer on last unsubscribe', async () => {
    jest.useFakeTimers();
    service.startPolling();
    service.startPolling();
    await Promise.resolve();
    await Promise.resolve();

    service.stopPolling();
    jest.advanceTimersByTime(DIAGNOSTICS_POLL_MS * 2);
    const beforeFinal = diagnosticsMock.mock.calls.length;

    service.stopPolling();
    jest.advanceTimersByTime(DIAGNOSTICS_POLL_MS * 2);

    expect(diagnosticsMock.mock.calls.length).toBe(beforeFinal);
  });

  it('refcount: second subscriber does NOT trigger a second initial refresh', async () => {
    jest.useFakeTimers();
    service.startPolling();
    await Promise.resolve();
    await Promise.resolve();
    const first = diagnosticsMock.mock.calls.length;

    service.startPolling();
    await Promise.resolve();

    expect(diagnosticsMock.mock.calls.length).toBe(first);
  });
});
