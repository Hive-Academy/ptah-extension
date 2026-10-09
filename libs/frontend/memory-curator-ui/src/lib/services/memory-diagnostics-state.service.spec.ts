import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';

import {
  MemoryDiagnosticsRpcService,
  MemoryPausedError,
} from './memory-diagnostics-rpc.service';
import {
  DIAGNOSTICS_POLL_MS,
  MEMORY_PAUSED_NOTICE,
  MemoryDiagnosticsStateService,
} from './memory-diagnostics-state.service';

/** A promise whose settlement the test controls. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('MemoryDiagnosticsStateService', () => {
  let service: MemoryDiagnosticsStateService;
  let diagnosticsMock: jest.Mock;
  let runNowMock: jest.Mock;
  let setTriggersMock: jest.Mock;
  let getTriggersMock: jest.Mock;

  const workspaceSignal = signal<{ path: string } | null>({ path: '/ws' });
  const activeTabSignal = signal<{ claudeSessionId: string | null } | null>({
    claudeSessionId: 'sess-real-uuid',
  });

  const baseTriggers = {
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
  const baseStorage = {
    dbBytes: 2_097_152,
    reclaimableBytes: 4_096,
    autoVacuumIncremental: true,
    observations: {
      pendingRows: 12,
      pendingBytes: 2_048,
      oldestPendingAt: 1_000,
      stuckEligibleRows: 3,
      processedRows: 4_500,
      processedBytesEstimate: 1_500_000,
      measuredAt: 900,
      quarantineLedgerRows: 7,
      bootScanFailuresPending: 0,
      bootScanFailuresGivenUp: 0,
    },
    retention: {
      healthVerdict: 'healthy' as const,
      enabled: true,
      processedDays: 14,
      stuckDays: 30,
      lastRun: null,
      lastCompletedAt: null,
      nextDueAt: null,
      lastSkippedAt: null,
      lastSkipReason: null,
    },
  };

  const snapshot = {
    lastRunAt: 1000,
    lastRunStats: { promoted: 3 },
    recentEvents: [
      { kind: 'curator-run' as const, timestamp: 100 },
      { kind: 'manual-run' as const, timestamp: 200 },
    ],
    dbHealth: baseDbHealth,
    storage: baseStorage,
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
      .mockResolvedValue({ triggers: baseTriggers, enabled: true });
    getTriggersMock = jest
      .fn()
      .mockResolvedValue({ triggers: baseTriggers, enabled: true });

    activeTabSignal.set({ claudeSessionId: 'sess-real-uuid' });
    workspaceSignal.set({ path: '/ws' });

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
        {
          provide: TabManagerService,
          useValue: { activeTab: activeTabSignal },
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
    expect(service.recentEvents().length).toBe(2);
    expect(service.dbHealth()).toEqual(baseDbHealth);
    expect(service.storage()).toEqual(baseStorage);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('refresh() sets error signal and clears loading on RPC failure', async () => {
    diagnosticsMock.mockRejectedValue(new Error('boom'));

    await service.refresh();

    expect(service.error()).toBe('boom');
    expect(service.loading()).toBe(false);
  });

  it('runNow() passes the real claudeSessionId from TabManager and refreshes signals', async () => {
    await service.runNow();

    expect(runNowMock).toHaveBeenCalledWith({
      sessionId: 'sess-real-uuid',
      workspaceRoot: '/ws',
    });
    // The literal 'manual' must NEVER be sent — pollutes memories.session_id.
    expect(runNowMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'manual' }),
    );
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

  it('runNow() no-ops + sets error when there is no active session', async () => {
    activeTabSignal.set(null);

    await service.runNow();

    expect(runNowMock).not.toHaveBeenCalled();
    expect(service.error()).toBe('No active session to curate.');
  });

  it('runNow() no-ops + sets error when active tab has a null claudeSessionId', async () => {
    activeTabSignal.set({ claudeSessionId: null });

    await service.runNow();

    expect(runNowMock).not.toHaveBeenCalled();
    expect(service.error()).toBe('No active session to curate.');
  });

  it('hasActiveSession reflects TabManager.activeTab().claudeSessionId presence', () => {
    expect(service.hasActiveSession()).toBe(true);

    activeTabSignal.set({ claudeSessionId: null });
    expect(service.hasActiveSession()).toBe(false);

    activeTabSignal.set(null);
    expect(service.hasActiveSession()).toBe(false);

    activeTabSignal.set({ claudeSessionId: 'sess-real-uuid' });
    expect(service.hasActiveSession()).toBe(true);
  });

  it('setTriggers() updates the triggers signal from RPC response', async () => {
    await service.setTriggers({ idleMs: 0 });

    expect(setTriggersMock).toHaveBeenCalledWith({
      triggers: { idleMs: 0 },
    });
    expect(service.triggers()).toEqual({
      ...baseTriggers,
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

  describe('Memory pause switch', () => {
    it('loadMemoryEnabled() reads memory.enabled through memory:getTriggers', async () => {
      getTriggersMock.mockResolvedValue({
        triggers: baseTriggers,
        enabled: false,
      });

      expect(service.memoryEnabled()).toBeNull();
      await service.loadMemoryEnabled();

      expect(service.memoryEnabled()).toBe(false);
      expect(service.memoryEnabledCommitted()).toBe(false);
      expect(service.memoryPaused()).toBe(true);
    });

    it('treats a missing or non-boolean enabled as unknown, not on', async () => {
      getTriggersMock.mockResolvedValue({ triggers: baseTriggers });

      await service.loadMemoryEnabled();

      expect(service.memoryEnabled()).toBeNull();
      expect(service.memoryPaused()).toBe(false);
    });

    it('setMemoryEnabled() sends only { triggers: {}, enabled }, never the cached triggers', async () => {
      await service.refresh(); // caches a full trigger DTO
      setTriggersMock.mockResolvedValue({
        triggers: baseTriggers,
        enabled: false,
      });

      await service.setMemoryEnabled(false);

      expect(setTriggersMock).toHaveBeenCalledTimes(1);
      expect(setTriggersMock).toHaveBeenCalledWith({
        triggers: {},
        enabled: false,
      });
      expect(service.memoryEnabledCommitted()).toBe(false);
      expect(service.memoryPaused()).toBe(true);
    });

    it('moves the switch at once and disables it until the write lands', async () => {
      await service.loadMemoryEnabled(); // committed: true
      const write = deferred<{
        triggers: typeof baseTriggers;
        enabled: boolean;
      }>();
      setTriggersMock.mockReturnValue(write.promise);

      const pending = service.setMemoryEnabled(false);

      expect(service.memoryEnabled()).toBe(false);
      expect(service.memoryPaused()).toBe(true);
      expect(service.memorySwitchSaving()).toBe(true);
      // The committed value only changes once the host answers.
      expect(service.memoryEnabledCommitted()).toBe(true);

      write.resolve({ triggers: baseTriggers, enabled: false });
      await pending;

      expect(service.memorySwitchSaving()).toBe(false);
      expect(service.memoryEnabledCommitted()).toBe(false);
    });

    it('rolls back to the committed value and re-reads it when the write fails', async () => {
      await service.loadMemoryEnabled(); // committed: true
      getTriggersMock.mockClear();
      setTriggersMock.mockRejectedValue(new Error('write failed'));

      await service.setMemoryEnabled(false);

      expect(service.memoryEnabled()).toBe(true);
      expect(service.memoryPaused()).toBe(false);
      expect(service.memorySwitchError()).toBe(
        'Could not change the Memory switch. It shows the saved setting.',
      );
      expect(getTriggersMock).toHaveBeenCalledTimes(1);
    });

    it('drops a read that started before a write (stale-GET guard)', async () => {
      const staleRead = deferred<{
        triggers: typeof baseTriggers;
        enabled: boolean;
      }>();
      getTriggersMock.mockReturnValueOnce(staleRead.promise);

      const read = service.loadMemoryEnabled(); // will answer "on"
      setTriggersMock.mockResolvedValue({
        triggers: baseTriggers,
        enabled: false,
      });
      await service.setMemoryEnabled(false);

      staleRead.resolve({ triggers: baseTriggers, enabled: true });
      await read;

      expect(service.memoryEnabledCommitted()).toBe(false);
    });

    it('does not start a read while a write is in flight', async () => {
      const write = deferred<{
        triggers: typeof baseTriggers;
        enabled: boolean;
      }>();
      setTriggersMock.mockReturnValue(write.promise);

      const pending = service.setMemoryEnabled(false);
      await service.loadMemoryEnabled();

      expect(getTriggersMock).not.toHaveBeenCalled();
      write.resolve({ triggers: baseTriggers, enabled: false });
      await pending;
    });

    it('runNow() is not sent while Memory is paused and shows the paused notice', async () => {
      getTriggersMock.mockResolvedValue({
        triggers: baseTriggers,
        enabled: false,
      });
      await service.loadMemoryEnabled();

      await service.runNow();

      expect(runNowMock).not.toHaveBeenCalled();
      expect(service.pausedNotice()).toBe(MEMORY_PAUSED_NOTICE);
      expect(service.error()).toBeNull();
    });

    it('runNow() turns a host PAUSED refusal into the paused state, not an error', async () => {
      await service.loadMemoryEnabled(); // this tab still believes "on"
      runNowMock.mockRejectedValue(new MemoryPausedError());

      await service.runNow();

      expect(service.error()).toBeNull();
      expect(service.loading()).toBe(false);
      expect(service.pausedNotice()).toBe(MEMORY_PAUSED_NOTICE);
      expect(service.memoryPaused()).toBe(true);
    });

    it('clears the paused notice once Memory is back on', async () => {
      runNowMock.mockRejectedValue(new MemoryPausedError());
      await service.runNow();
      expect(service.pausedNotice()).not.toBeNull();

      await service.setMemoryEnabled(true);

      expect(service.pausedNotice()).toBeNull();
      expect(service.memoryPaused()).toBe(false);
    });
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
