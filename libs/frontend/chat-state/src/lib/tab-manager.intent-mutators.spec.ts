/**
 * TabManagerService — intent-named mutator coverage (TASK_2026_105 Wave G2).
 *
 * Covers the most-frequently invoked mutators introduced in Phase 1 so that
 * the chat-state lib hits its coverage threshold post-extraction. These are
 * exercised end-to-end against `_tabs` / readonly signals to catch any
 * regression in the partial-write path through `updateTabInternal`.
 */

import { TestBed } from '@angular/core/testing';
import {
  StreamingState,
  createEmptyStreamingState,
} from '@ptah-extension/chat-types';
import { ExecutionChatMessage } from '@ptah-extension/shared';

import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { STREAMING_CONTROL, type StreamingControl } from './streaming-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

describe('TabManagerService — intent-named mutators', () => {
  let service: TabManagerService;
  let partitionMock: Partial<jest.Mocked<TabWorkspacePartitionService>>;

  const makeMessage = (id: string, text: string): ExecutionChatMessage => ({
    id,
    role: 'assistant',
    content: text,
    timestamp: Date.now(),
    nodes: [],
  });

  beforeEach(() => {
    const confirmMock = { confirm: jest.fn().mockResolvedValue(true) };
    const streamingControl: jest.Mocked<StreamingControl> = {
      cleanupSessionDeduplication: jest.fn(),
      clearSessionAgents: jest.fn(),
    } as jest.Mocked<StreamingControl>;
    partitionMock = {
      initialize: jest.fn(),
      activeWorkspacePath: null,
      registerSessionForWorkspace: jest.fn(),
      unregisterSession: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn().mockReturnValue(null),
      getStorageKeyForWorkspace: jest.fn().mockReturnValue('ptah.tabs'),
      syncActiveWorkspaceState: jest.fn(),
      switchWorkspace: jest.fn().mockReturnValue(null),
      removeWorkspaceState: jest.fn().mockReturnValue(false),
      getWorkspaceTabs: jest.fn().mockReturnValue([]),
      setBackendEncodedPath: jest.fn(),
      updateBackgroundTab: jest.fn(),
    };
    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        { provide: ConfirmationDialogService, useValue: confirmMock },
        { provide: STREAMING_CONTROL, useValue: streamingControl },
        { provide: TabWorkspacePartitionService, useValue: partitionMock },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
      ],
    });
    service = TestBed.inject(TabManagerService);
  });

  describe('status transitions', () => {
    it('markStreaming/markLoaded/markResuming flip status', () => {
      const id = service.createTab('status flip');
      service.markStreaming(id);
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('streaming');
      service.markLoaded(id);
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('loaded');
      service.markResuming(id);
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('resuming');
    });

    it('setStatus accepts dynamic SessionStatus values', () => {
      const id = service.createTab('dynamic');
      service.setStatus(id, 'switching');
      expect(service.tabs().find((t) => t.id === id)?.status).toBe('switching');
    });
  });

  describe('session id attach/adopt', () => {
    it('attachSession sets claudeSessionId', () => {
      const id = service.createTab('attach');
      service.attachSession(id, 'sess-123');
      expect(service.tabs().find((t) => t.id === id)?.claudeSessionId).toBe(
        'sess-123',
      );
    });

    it('adoptStreamingSession sets session and forces streaming', () => {
      const id = service.createTab('adopt');
      service.adoptStreamingSession(id, 'sess-XYZ');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.claudeSessionId).toBe('sess-XYZ');
      expect(tab?.status).toBe('streaming');
    });
  });

  describe('streaming state lifecycle', () => {
    let state: StreamingState;
    beforeEach(() => {
      state = createEmptyStreamingState();
    });

    it('setStreamingState replaces or nulls streamingState', () => {
      const id = service.createTab('stream');
      service.setStreamingState(id, state);
      expect(service.tabs().find((t) => t.id === id)?.streamingState).toBe(
        state,
      );
      service.setStreamingState(id, null);
      expect(
        service.tabs().find((t) => t.id === id)?.streamingState,
      ).toBeNull();
    });

    it('setStreamingStateAndCurrentMessage writes both atomically', () => {
      const id = service.createTab('atomic');
      service.setStreamingStateAndCurrentMessage(id, state, 'msg-1');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBe(state);
      expect(tab?.currentMessageId).toBe('msg-1');
    });
  });

  describe('messages', () => {
    it('setMessages replaces the messages array', () => {
      const id = service.createTab('msgs');
      const msgs = [makeMessage('a', 'hello')];
      service.setMessages(id, msgs);
      expect(service.tabs().find((t) => t.id === id)?.messages).toBe(msgs);
    });

    it('appendUserMessageForNewTurn resets currentMessageId', () => {
      const id = service.createTab('turn');
      service.setStreamingStateAndCurrentMessage(id, null, 'old');
      service.appendUserMessageForNewTurn(id, [makeMessage('u', 'hi')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages.length).toBe(1);
      expect(tab?.currentMessageId).toBeNull();
    });

    it('appendUserMessageAndResetStreaming clears stale streamingState', () => {
      const id = service.createTab('reset');
      const state = createEmptyStreamingState();
      service.setStreamingState(id, state);
      service.appendUserMessageAndResetStreaming(id, [makeMessage('u', 'hi')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.currentMessageId).toBeNull();
    });

    it('setMessagesAndMarkLoaded forces loaded state', () => {
      const id = service.createTab('failpath');
      service.markStreaming(id);
      service.setMessagesAndMarkLoaded(id, [makeMessage('e', 'err')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.status).toBe('loaded');
      expect(tab?.messages.length).toBe(1);
    });
  });

  describe('finalization', () => {
    it('applyFinalizedTurn drops streamingState and switches to loaded', () => {
      const id = service.createTab('final');
      const state = createEmptyStreamingState();
      service.setStreamingStateAndCurrentMessage(id, state, 'msg');
      service.applyFinalizedTurn(id, [makeMessage('a', 'done')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
      expect(tab?.currentMessageId).toBeNull();
    });

    it('applyFinalizedHistory keeps currentMessageId untouched logic', () => {
      const id = service.createTab('hist');
      service.applyFinalizedHistory(id, [makeMessage('a', 'h')]);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.status).toBe('loaded');
      expect(tab?.streamingState).toBeNull();
    });

    it('clearStreamingForLoaded preserves messages', () => {
      const id = service.createTab('dedupe');
      service.setMessages(id, [makeMessage('a', 'kept')]);
      service.setStreamingState(id, createEmptyStreamingState());
      service.clearStreamingForLoaded(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages.length).toBe(1);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
    });
  });

  describe('error/abort reset', () => {
    it('applyErrorReset drops queue + clears currentMessageId', () => {
      const id = service.createTab('err');
      service.setQueuedContentAndOptions(id, 'pending', { files: [] });
      service.applyErrorReset(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBeNull();
      expect(tab?.queuedOptions).toBeNull();
      expect(tab?.status).toBe('loaded');
    });

    it('applyStatusErrorReset only clears status + currentMessageId', () => {
      const id = service.createTab('lite');
      service.setQueuedContent(id, 'still here');
      service.applyStatusErrorReset(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBe('still here');
      expect(tab?.status).toBe('loaded');
    });

    it('detachSessionAndMarkLoaded clears claudeSessionId', () => {
      const id = service.createTab('detach');
      service.attachSession(id, 'sess-x');
      service.detachSessionAndMarkLoaded(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.claudeSessionId).toBeNull();
      expect(tab?.status).toBe('loaded');
    });
  });

  describe('compaction', () => {
    it('markCompactionStart/clearCompactingFlag toggle isCompacting', () => {
      const id = service.createTab('compact');
      service.markCompactionStart(id);
      expect(service.tabs().find((t) => t.id === id)?.isCompacting).toBe(true);
      service.clearCompactingFlag(id);
      expect(service.tabs().find((t) => t.id === id)?.isCompacting).toBe(false);
    });

    it('applyCompactionTimeoutReset clears state machine', () => {
      const id = service.createTab('timeout');
      service.markCompactionStart(id);
      service.setStreamingState(id, createEmptyStreamingState());
      service.applyCompactionTimeoutReset(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.isCompacting).toBe(false);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
    });

    it('applyCompactionComplete resets messages + bumps count', () => {
      const id = service.createTab('done');
      service.setMessages(id, [makeMessage('a', 'old')]);
      service.applyCompactionComplete(id, {
        preloadedStats: {
          totalCost: 1,
          tokens: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 },
          messageCount: 1,
        },
        compactionCount: 2,
      });
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages).toEqual([]);
      expect(tab?.compactionCount).toBe(2);
      expect(tab?.preloadedStats?.totalCost).toBe(1);
    });
  });

  describe('stats and model bookkeeping', () => {
    it('setLiveModelStats updates the live stats payload', () => {
      const id = service.createTab('lms');
      service.setLiveModelStats(id, {
        model: 'claude',
        contextUsed: 10,
        contextWindow: 100,
        contextPercent: 10,
      });
      expect(
        service.tabs().find((t) => t.id === id)?.liveModelStats?.model,
      ).toBe('claude');
    });

    it('setLiveModelStatsAndUsageList writes both', () => {
      const id = service.createTab('combo');
      service.setLiveModelStatsAndUsageList(
        id,
        {
          model: 'claude',
          contextUsed: 1,
          contextWindow: 2,
          contextPercent: 50,
        },
        [
          {
            model: 'claude',
            inputTokens: 1,
            outputTokens: 1,
            costUSD: 0,
            contextWindow: 2,
          },
        ],
      );
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.modelUsageList?.length).toBe(1);
      expect(tab?.liveModelStats?.contextWindow).toBe(2);
    });

    it('setPreloadedStats and applyLoadedSessionStats install the snapshot', () => {
      const id = service.createTab('preload');
      const stats = {
        totalCost: 0.5,
        tokens: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0 },
        messageCount: 3,
      };
      service.setPreloadedStats(id, stats);
      expect(service.tabs().find((t) => t.id === id)?.preloadedStats).toBe(
        stats,
      );
      service.applyLoadedSessionStats(id, stats, 'claude-3-5-sonnet');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.sessionModel).toBe('claude-3-5-sonnet');
    });
  });

  describe('queue helpers', () => {
    it('setQueuedContent / clear / reset variants update the queue', () => {
      const id = service.createTab('q');
      service.setQueuedContentAndOptions(id, 'first', { files: ['a.ts'] });
      let tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBe('first');
      expect(tab?.queuedOptions?.files).toEqual(['a.ts']);

      service.resetQueuedContentAndOptions(id);
      tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBe('');
      expect(tab?.queuedOptions).toBeNull();

      service.clearQueuedContentAndOptions(id);
      tab = service.tabs().find((t) => t.id === id);
      expect(tab?.queuedContent).toBeNull();
      expect(tab?.queuedOptions).toBeNull();
    });
  });

  describe('per-session overrides + naming', () => {
    it('setOverrideModel and setOverrideEffort set tab overrides', () => {
      const id = service.createTab('over');
      service.setOverrideModel(id, 'opus');
      service.setOverrideEffort(id, 'high');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.overrideModel).toBe('opus');
      expect(tab?.overrideEffort).toBe('high');
    });

    it('setNameAndTitle updates both fields atomically', () => {
      const id = service.createTab('rename');
      service.setNameAndTitle(id, 'New Name', 'New Title');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.name).toBe('New Name');
      expect(tab?.title).toBe('New Title');
    });
  });

  describe('resume helpers', () => {
    it('applyResumingSession loads sessionId + resuming status', () => {
      const id = service.createTab('resume');
      const state = createEmptyStreamingState();
      service.applyResumingSession(id, {
        sessionId: 'sess-r',
        name: 'name',
        title: 'title',
        streamingState: state,
      });
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.claudeSessionId).toBe('sess-r');
      expect(tab?.status).toBe('resuming');
      expect(tab?.streamingState).toBe(state);
    });

    it('applyResumedHistory installs replay messages and marks loaded', () => {
      const id = service.createTab('replay');
      const msgs = [makeMessage('h', 'hist')];
      service.applyResumedHistory(id, msgs);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.messages).toBe(msgs);
      expect(tab?.status).toBe('loaded');
    });

    it('applyResumeFailure clears streamingState', () => {
      const id = service.createTab('failure');
      service.setStreamingState(id, createEmptyStreamingState());
      service.applyResumeFailure(id);
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.streamingState).toBeNull();
      expect(tab?.status).toBe('loaded');
    });
  });

  describe('view mode + draft helpers', () => {
    it('toggleTabViewMode flips between full and compact', () => {
      const id = service.createTab('view');
      expect(service.getTabViewMode(id)).toBe('full');
      service.toggleTabViewMode(id);
      expect(service.getTabViewMode(id)).toBe('compact');
      service.toggleTabViewMode(id);
      expect(service.getTabViewMode(id)).toBe('full');
    });

    it('applyNewConversationDraft sets draft + clears claudeSessionId', () => {
      const id = service.createTab('draft');
      service.attachSession(id, 'pre-existing');
      service.applyNewConversationDraft(id, 'Drafted');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.status).toBe('draft');
      expect(tab?.name).toBe('Drafted');
      expect(tab?.claudeSessionId).toBeNull();
    });

    it('applyNewConversationStreaming applies name+title and forces streaming', () => {
      const id = service.createTab('go');
      service.applyNewConversationStreaming(id, 'Auto Name');
      const tab = service.tabs().find((t) => t.id === id);
      expect(tab?.name).toBe('Auto Name');
      expect(tab?.status).toBe('streaming');
    });
  });
});
