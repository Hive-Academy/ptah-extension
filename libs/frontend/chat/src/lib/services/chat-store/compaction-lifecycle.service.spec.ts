/**
 * CompactionLifecycleService specs â€” SDK session-compaction state machine.
 *
 * Coverage:
 *   - handleCompactionStart sets isCompacting, schedules safety timeout
 *   - handleCompactionStart early-returns + warns when no tab matches sessionId
 *   - handleCompactionStart clears prior timeout before scheduling new one
 *   - Safety timeout fires: resets tab, marks idle, sets sessionManager loaded
 *   - handleCompactionComplete clears tree-builder cache, snapshots preloadedStats
 *   - handleCompactionComplete early-returns when tab no longer exists
 *   - clearCompactionStateForTab single-tab clearCompactingFlag call
 *   - clearCompactionState(tabId) clears specified tab + timeout
 *   - clearCompactionState(undefined) sweeps all isCompacting tabs
 */

import { TestBed } from '@angular/core/testing';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SessionManager,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
import type { TabState } from '@ptah-extension/chat-types';

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Tab 1',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: 'sess-1',
    isCompacting: false,
    compactionCount: 0,
    queuedContent: null,
    queuedOptions: null,
    preloadedStats: null,
    liveModelStats: null,
    modelUsageList: null,
    ...overrides,
  } as unknown as TabState;
}

describe('CompactionLifecycleService', () => {
  let service: CompactionLifecycleService;
  let tabs: TabState[];
  let markCompactionStartMock: jest.Mock;
  let clearCompactingFlagMock: jest.Mock;
  let applyCompactionTimeoutResetMock: jest.Mock;
  let applyCompactionCompleteMock: jest.Mock;
  let findTabBySessionIdMock: jest.Mock;
  let markTabIdleMock: jest.Mock;
  let setStatusMock: jest.Mock;
  let clearCacheMock: jest.Mock;
  let switchSessionMock: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    tabs = [makeTab()];
    markCompactionStartMock = jest.fn((id: string) => {
      tabs = tabs.map((t) => (t.id === id ? { ...t, isCompacting: true } : t));
    });
    clearCompactingFlagMock = jest.fn((id: string) => {
      tabs = tabs.map((t) => (t.id === id ? { ...t, isCompacting: false } : t));
    });
    applyCompactionTimeoutResetMock = jest.fn();
    applyCompactionCompleteMock = jest.fn();
    findTabBySessionIdMock = jest.fn(
      (sessionId: string) =>
        tabs.find((t) => t.claudeSessionId === sessionId) ?? null,
    );
    markTabIdleMock = jest.fn();
    setStatusMock = jest.fn();
    clearCacheMock = jest.fn();
    switchSessionMock = jest.fn().mockResolvedValue(undefined);

    const tabManagerMock = {
      markCompactionStart: markCompactionStartMock,
      clearCompactingFlag: clearCompactingFlagMock,
      applyCompactionTimeoutReset: applyCompactionTimeoutResetMock,
      applyCompactionComplete: applyCompactionCompleteMock,
      findTabBySessionId: findTabBySessionIdMock,
      markTabIdle: markTabIdleMock,
      tabs: () => tabs,
    } as unknown as TabManagerService;

    const sessionManagerMock = {
      setStatus: setStatusMock,
    } as unknown as SessionManager;

    const treeBuilderMock = {
      clearCache: clearCacheMock,
    } as unknown as ExecutionTreeBuilderService;

    const sessionLoaderMock = {
      switchSession: switchSessionMock,
    } as unknown as SessionLoaderService;

    warn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        CompactionLifecycleService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: SessionManager, useValue: sessionManagerMock },
        { provide: ExecutionTreeBuilderService, useValue: treeBuilderMock },
        { provide: SessionLoaderService, useValue: sessionLoaderMock },
      ],
    });
    service = TestBed.inject(CompactionLifecycleService);
  });

  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('handleCompactionStart', () => {
    it('sets isCompacting=true and schedules safety timeout', () => {
      service.handleCompactionStart('sess-1');
      expect(markCompactionStartMock).toHaveBeenCalledWith('tab-1');
    });

    it('warns and does nothing when no tab matches sessionId', () => {
      service.handleCompactionStart('unknown-session');
      expect(markCompactionStartMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleCompactionStart: no tab found for sessionId',
        { sessionId: 'unknown-session' },
      );
    });

    it('clears prior timeout before scheduling new one', () => {
      service.handleCompactionStart('sess-1');
      service.handleCompactionStart('sess-1');
      // Advance time to verify only ONE timeout fires (the second one)
      jest.advanceTimersByTime(120000);
      expect(applyCompactionTimeoutResetMock).toHaveBeenCalledTimes(1);
    });

    it('safety timeout resets tab fields, marks idle, sets sessionManager loaded', () => {
      service.handleCompactionStart('sess-1');
      jest.advanceTimersByTime(120000);
      expect(applyCompactionTimeoutResetMock).toHaveBeenCalledWith('tab-1');
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(setStatusMock).toHaveBeenCalledWith('loaded');
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] Compaction safety timeout reached â€” compaction_complete event may have been lost',
      );
    });
  });

  describe('handleCompactionComplete', () => {
    it('clears tree-builder cache, resets tab, increments compactionCount, switches session', () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
          compactionCount: 2,
        }),
      ];
      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: 'reload-sess',
      });
      expect(clearCacheMock).toHaveBeenCalled();
      expect(applyCompactionCompleteMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ compactionCount: 3 }),
      );
      expect(switchSessionMock).toHaveBeenCalledWith('sess-1');
    });

    it('snapshots preloadedStats when none exist and messages are present', () => {
      tabs = [
        makeTab({
          messages: [{ id: 'm1' } as unknown as TabState['messages'][number]],
          preloadedStats: null,
        }),
      ];
      service.handleCompactionComplete({
        tabId: 'tab-1',
        compactionSessionId: 'reload-sess',
      });
      const call = applyCompactionCompleteMock.mock.calls.find(
        (c) => (c[1] as { compactionCount: number }).compactionCount === 1,
      );
      expect(call).toBeDefined();
      const payload = (
        call as unknown as [string, { preloadedStats: unknown }]
      )[1];
      expect(payload.preloadedStats).toBeDefined();
    });

    it('does nothing when tab no longer exists', () => {
      service.handleCompactionComplete({
        tabId: 'nonexistent',
        compactionSessionId: 'sess-x',
      });
      // tree builder cache still cleared from clearCompactionState path
      expect(switchSessionMock).not.toHaveBeenCalled();
    });
  });

  describe('clearCompactionStateForTab', () => {
    it('clears isCompacting on the specified tab', () => {
      service.clearCompactionStateForTab('tab-1');
      expect(clearCompactingFlagMock).toHaveBeenCalledWith('tab-1');
    });
  });

  describe('clearCompactionState', () => {
    it('clears specified tab and the timeout', () => {
      service.handleCompactionStart('sess-1');
      service.clearCompactionState('tab-1');
      jest.advanceTimersByTime(120000);
      // No safety-timeout reset call should appear
      expect(applyCompactionTimeoutResetMock).not.toHaveBeenCalled();
    });

    it('without tabId, sweeps all isCompacting tabs', () => {
      tabs = [
        makeTab({ id: 'tab-1', isCompacting: true }),
        makeTab({ id: 'tab-2', isCompacting: true, claudeSessionId: 'sess-2' }),
        makeTab({
          id: 'tab-3',
          isCompacting: false,
          claudeSessionId: 'sess-3',
        }),
      ];
      service.clearCompactionState();
      expect(clearCompactingFlagMock).toHaveBeenCalledWith('tab-1');
      expect(clearCompactingFlagMock).toHaveBeenCalledWith('tab-2');
      expect(clearCompactingFlagMock).not.toHaveBeenCalledWith('tab-3');
    });
  });
});
