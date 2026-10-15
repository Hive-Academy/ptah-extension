import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { TabId, TabManagerService } from '@ptah-extension/chat-state';
import {
  ExecutionTreeBuilderService,
  PermissionHandlerService,
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { StreamRouter } from '@ptah-extension/chat-routing';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { SessionHistoryReplayer } from './chat-store/session-history-replayer.service';
import { ConversationService } from './chat-store/conversation.service';
import { CompactionLifecycleService } from './chat-store/compaction-lifecycle.service';
import { MessageDispatchService } from './chat-store/message-dispatch.service';
import { SessionStatsAggregatorService } from './chat-store/session-stats-aggregator.service';
import { ChatLifecycleService } from './chat-store/chat-lifecycle.service';
import { TaskPromptBridgeService } from './chat-store/task-prompt-bridge.service';
import { SessionOpenBridgeService } from './chat-store/session-open-bridge.service';
import { TurnEndHandlerService } from './chat-store/turn-end-handler.service';
import { ChatStore } from './chat.store';

describe('ChatStore question deciding tab', () => {
  const answer = jest.fn();
  const cancel = jest.fn();
  const empty = signal([]);
  const none = signal(null);
  let store: ChatStore;

  beforeEach(() => {
    jest.clearAllMocks();
    const loader = {
      sessions: empty,
      hasMoreSessions: none,
      totalSessions: none,
      isLoadingMoreSessions: none,
      listQuery: none,
      organizationAvailable: none,
      resumableSubagents: empty,
    };
    const tabs = {
      activeTabId: () => '00000000-0000-4000-8000-000000000002',
      activeTab: none,
      activeTabSessionId: none,
      activeTabMessages: empty,
      activeTabStreamingState: none,
      activeTabStatus: none,
      activeTabHasLiveSession: none,
      activeTabSessionStats: none,
      activeTabLiveModelStats: none,
      activeTabCompactionCount: none,
      activeTabQueuedContent: none,
    };
    TestBed.configureTestingModule({
      providers: [
        ChatStore,
        { provide: VSCodeService, useValue: {} },
        { provide: SessionManager, useValue: {} },
        { provide: TabManagerService, useValue: tabs },
        { provide: StreamingHandlerService, useValue: {} },
        { provide: SessionLoaderService, useValue: loader },
        { provide: SessionHistoryReplayer, useValue: {} },
        {
          provide: ConversationService,
          useValue: { isStopping: none, queueRestoreSignal: none },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: empty,
            unmatchedPermissions: empty,
            questionRequests: empty,
            handleQuestionResponse: answer,
          },
        },
        { provide: ExecutionTreeBuilderService, useValue: {} },
        { provide: CompactionLifecycleService, useValue: {} },
        { provide: MessageDispatchService, useValue: {} },
        { provide: SessionStatsAggregatorService, useValue: {} },
        {
          provide: ChatLifecycleService,
          useValue: { licenseStatus: none, bootstrap: jest.fn() },
        },
        { provide: TurnEndHandlerService, useValue: {} },
        {
          provide: StreamRouter,
          useValue: { cancelPendingQuestionOnOtherTabs: cancel },
        },
        { provide: TaskPromptBridgeService, useValue: {} },
        { provide: SessionOpenBridgeService, useValue: {} },
      ],
    });
    store = TestBed.inject(ChatStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('uses the explicit tab when the active tab differs', () => {
    const response = { id: 'q', answers: {} };
    store.handleQuestionResponse(
      response,
      '00000000-0000-4000-8000-000000000001',
    );
    expect(answer).toHaveBeenCalledWith(response);
    expect(cancel).toHaveBeenCalledWith(
      'q',
      TabId.from('00000000-0000-4000-8000-000000000001'),
    );
    store.handleQuestionResponse(response);
    expect(cancel).toHaveBeenLastCalledWith(
      'q',
      TabId.from('00000000-0000-4000-8000-000000000002'),
    );
  });
});
