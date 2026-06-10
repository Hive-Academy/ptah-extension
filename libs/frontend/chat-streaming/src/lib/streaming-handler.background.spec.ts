/**
 * StreamingHandlerService — background-workspace routing (routeBackgroundEvent).
 *
 * When no active-workspace tab is found for an event, processStreamEvent must
 * fall through to routeBackgroundEvent BEFORE the "No target tab" warn:
 *   (a) cross-workspace hit  → accumulatorCore.process + updateBackgroundTab
 *       with status 'streaming'; warn NOT emitted; no batched signal scheduled.
 *   (b) cross-workspace miss → updateBackgroundTab NOT called; warn fires.
 *   (c) an active-tab hit never triggers the background route.
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import {
  createEmptyStreamingState,
  type StreamingState,
  type TabState,
} from '@ptah-extension/chat-types';
import type { TextDeltaEvent } from '@ptah-extension/shared';
import { SessionId } from '@ptah-extension/shared';
import { StreamingHandlerService } from './streaming-handler.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from './session-manager.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { MessageFinalizationService } from './message-finalization.service';
import { PermissionHandlerService } from './permission-handler.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';
import {
  StreamingAccumulatorCore,
  type AccumulatorResult,
} from './accumulator-core.service';

const BG_TAB_ID = 'bg-tab';
const SESSION_ID = SessionId.create();

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: BG_TAB_ID,
    title: 'Background',
    name: 'Background',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESSION_ID,
    ...overrides,
  } as TabState;
}

function textDelta(overrides: Partial<TextDeltaEvent> = {}): TextDeltaEvent {
  return {
    id: 'evt-text-1',
    eventType: 'text_delta',
    timestamp: 2,
    sessionId: SESSION_ID,
    messageId: 'msg-1',
    blockIndex: 0,
    delta: 'hello',
    source: 'stream',
    ...overrides,
  } as TextDeltaEvent;
}

describe('StreamingHandlerService — background routing', () => {
  let service: StreamingHandlerService;
  let tabsSignal: ReturnType<typeof signal<TabState[]>>;
  let activeTabIdSignal: ReturnType<typeof signal<string | null>>;
  let updateBackgroundTab: jest.Mock<boolean, [string, Partial<TabState>]>;
  let findTabBySessionIdAcrossWorkspaces: jest.Mock;
  let process: jest.Mock<AccumulatorResult, unknown[]>;
  let scheduleUpdate: jest.Mock;
  let flushSync: jest.Mock;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    tabsSignal = signal<TabState[]>([]);
    activeTabIdSignal = signal<string | null>(null);
    updateBackgroundTab = jest.fn().mockReturnValue(true);
    findTabBySessionIdAcrossWorkspaces = jest.fn().mockReturnValue(null);
    process = jest.fn().mockReturnValue({} as AccumulatorResult);
    scheduleUpdate = jest.fn();
    flushSync = jest.fn();

    const tabManager = {
      tabs: computed(() => tabsSignal()),
      activeTab: computed(
        () => tabsSignal().find((t) => t.id === activeTabIdSignal()) ?? null,
      ),
      findTabBySessionId: jest.fn(() => null),
      findTabsBySessionId: jest.fn((sid: string) =>
        tabsSignal().filter((t) => t.claudeSessionId === sid),
      ),
      findTabBySessionIdAcrossWorkspaces,
      updateBackgroundTab,
      attachSession: jest.fn(),
      markStreaming: jest.fn(),
      setStreamingState: jest.fn(),
      setMessages: jest.fn(),
      markTabIdle: jest.fn(),
      markTabStreaming: jest.fn(),
      isTabStreaming: jest.fn().mockReturnValue(false),
    } as unknown as TabManagerService;

    const sessionManager = {
      setSessionId: jest.fn(),
      setStatus: jest.fn(),
      registerAgent: jest.fn(() => []),
      clearNodeMaps: jest.fn(),
    } as unknown as SessionManager;

    const batchedUpdate = {
      scheduleUpdate,
      flushSync,
    } as unknown as BatchedUpdateService;

    const accumulatorCore = { process } as unknown as StreamingAccumulatorCore;

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        StreamingHandlerService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionManager, useValue: sessionManager },
        {
          provide: EventDeduplicationService,
          useValue: { cleanupSession: jest.fn() },
        },
        { provide: BatchedUpdateService, useValue: batchedUpdate },
        {
          provide: MessageFinalizationService,
          useValue: { finalizeCurrentMessage: jest.fn() },
        },
        {
          provide: PermissionHandlerService,
          useValue: { consumeHardDenyToolUseIds: jest.fn(() => new Set()) },
        },
        { provide: BackgroundAgentStore, useValue: {} },
        { provide: AgentMonitorStore, useValue: {} },
        { provide: StreamingAccumulatorCore, useValue: accumulatorCore },
      ],
    });
    service = TestBed.inject(StreamingHandlerService);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('cross-workspace hit (background tab present)', () => {
    it('runs accumulatorCore.process and persists via updateBackgroundTab with status streaming', () => {
      const bgTab = makeTab();
      findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: bgTab,
        workspacePath: '/ws/bg',
      });

      const result = service.processStreamEvent(textDelta());

      expect(result).toBeNull();
      expect(process).toHaveBeenCalledTimes(1);
      expect(updateBackgroundTab).toHaveBeenCalledTimes(1);
      const [tabId, updates] = updateBackgroundTab.mock.calls[0];
      expect(tabId).toBe(BG_TAB_ID);
      expect(updates.status).toBe('streaming');
      expect(updates.streamingState).toBeDefined();
    });

    it('creates an empty streaming state when the background tab has none', () => {
      findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: makeTab({ streamingState: null }),
        workspacePath: '/ws/bg',
      });

      service.processStreamEvent(textDelta());

      const stateArg = process.mock.calls[0][0] as StreamingState;
      expect(stateArg).toBeDefined();
      expect(stateArg.events).toBeInstanceOf(Map);
    });

    it('swaps to replacementState on compaction_complete before persisting', () => {
      const replacement = createEmptyStreamingState();
      replacement.events.set('replaced', {} as never);
      process.mockReturnValue({
        compactionComplete: true,
        replacementState: replacement,
      } as AccumulatorResult);
      findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: makeTab(),
        workspacePath: '/ws/bg',
      });

      service.processStreamEvent(textDelta());

      const updates = updateBackgroundTab.mock.calls[0][1];
      expect(updates.streamingState).toBe(replacement);
    });

    it('does NOT emit the No-target-tab warn on the background path', () => {
      findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: makeTab(),
        workspacePath: '/ws/bg',
      });

      service.processStreamEvent(textDelta());

      expect(consoleWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        expect.anything(),
        expect.anything(),
      );
    });

    it('does NOT schedule a batched signal update on the background path', () => {
      findTabBySessionIdAcrossWorkspaces.mockReturnValue({
        tab: makeTab(),
        workspacePath: '/ws/bg',
      });

      service.processStreamEvent(textDelta());

      expect(scheduleUpdate).not.toHaveBeenCalled();
    });
  });

  describe('cross-workspace miss (no background tab)', () => {
    it('does NOT call updateBackgroundTab and runs the existing warn path', () => {
      findTabBySessionIdAcrossWorkspaces.mockReturnValue(null);

      service.processStreamEvent(textDelta());

      expect(updateBackgroundTab).not.toHaveBeenCalled();
      expect(process).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No target tab'),
        SESSION_ID,
        expect.any(String),
      );
    });
  });

  describe('active-tab path is unaffected', () => {
    it('never triggers the background route when a primaryTab is found by tabId', () => {
      const tab = makeTab({ streamingState: createEmptyStreamingState() });
      tabsSignal.set([tab]);

      service.processStreamEvent(textDelta(), BG_TAB_ID);

      expect(findTabBySessionIdAcrossWorkspaces).not.toHaveBeenCalled();
      expect(updateBackgroundTab).not.toHaveBeenCalled();
    });
  });
});
