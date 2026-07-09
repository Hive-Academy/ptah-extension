/**
 * TurnEndHandlerService — background turn-end clears the spinner (TASK_2026_154
 * Bug 2), asserted against the REAL TabManagerService + partition + registries.
 *
 * Reproduces the reported failure: a tab starts streaming while active (its id
 * enters the global `_streamingTabIds` spinner set), the user switches to
 * another workspace (the tab moves to a background partition, the id stays in
 * the global set), and the session then finishes in the background. Before the
 * fix the background terminal branches called `updateBackgroundTab` WITHOUT
 * `markTabIdle`, so `isTabStreaming` stayed true forever. This asserts the real
 * signal is cleared and the status reaches 'loaded'.
 *
 * The background branch is reached only when `findTabsBySessionId` returns [],
 * which requires the conversation to be registered (StreamRouter's job) but the
 * owning tab to be off the active workspace — seeded here via ConversationRegistry
 * + TabSessionBinding.
 */

import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  TabWorkspacePartitionService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import {
  BackgroundAgentStore,
  MessageFinalizationService,
} from '@ptah-extension/chat-streaming';
import {
  SessionId,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
} from '@ptah-extension/shared';
import type { TabId } from '@ptah-extension/chat-state';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TurnEndHandlerService } from './turn-end-handler.service';

const WS_A = '/ws/a';
const WS_B = '/ws/b';

describe('TurnEndHandlerService — background turn-end clears spinner (Bug 2)', () => {
  let handler: TurnEndHandlerService;
  let tabManager: TabManagerService;
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;

  /** Create a streaming tab in WS_A, then switch to WS_B so it is backgrounded. */
  function streamingTabInBackground(sessionId: string): string {
    tabManager.switchWorkspace(WS_A);
    const tabId = tabManager.createTab('A');
    tabManager.attachSession(tabId, sessionId);
    tabManager.markStreaming(tabId);
    tabManager.markTabStreaming(tabId);
    // Register + bind the conversation so findTabsBySessionId resolves the
    // conversation but returns [] (its tab is not on the active workspace),
    // driving the background terminal branch.
    const convId = registry.create(sessionId as unknown as never);
    binding.bind(tabId as TabId, convId);

    tabManager.switchWorkspace(WS_B);
    return tabId;
  }

  beforeEach(() => {
    localStorage.clear();

    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TurnEndHandlerService,
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
        {
          provide: MessageFinalizationService,
          useValue: { finalizeCurrentMessage: jest.fn() },
        },
        {
          provide: ChatLifecycleService,
          useValue: { handleChatError: jest.fn() },
        },
        {
          provide: BackgroundAgentStore,
          useValue: { onStopped: jest.fn(), findByAgentId: jest.fn() },
        },
      ],
    });

    handler = TestBed.inject(TurnEndHandlerService);
    tabManager = TestBed.inject(TabManagerService);
    registry = TestBed.inject(ConversationRegistry);
    binding = TestBed.inject(TabSessionBinding);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function turnEnded(sessionId: string): SdkTurnEndedPayload {
    return {
      sessionId,
      cwd: WS_A,
      lastAssistantMessage: 'done',
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'completed',
      timestamp: 1,
    };
  }

  function turnFailed(sessionId: string): SdkTurnFailedPayload {
    return {
      sessionId,
      cwd: WS_A,
      lastAssistantMessage: null,
      error: 'rate_limit',
      errorDetails: null,
      terminalReason: 'blocking_limit',
      timestamp: 1,
    };
  }

  it('handleTurnEnded removes the backgrounded tab from _streamingTabIds and marks it loaded', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    // Precondition: spinner is lit even though the tab is now backgrounded.
    expect(tabManager.isTabStreaming(tabId)).toBe(true);

    handler.handleTurnEnded(turnEnded(sessA));

    expect(tabManager.isTabStreaming(tabId)).toBe(false);
    const bgTab = tabManager.getWorkspaceTabs(WS_A).find((t) => t.id === tabId);
    expect(bgTab?.status).toBe('loaded');
  });

  it('handleTurnFailed removes the backgrounded tab from _streamingTabIds and marks it loaded', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    expect(tabManager.isTabStreaming(tabId)).toBe(true);

    handler.handleTurnFailed(turnFailed(sessA));

    expect(tabManager.isTabStreaming(tabId)).toBe(false);
    const bgTab = tabManager.getWorkspaceTabs(WS_A).find((t) => t.id === tabId);
    expect(bgTab?.status).toBe('loaded');
  });
});
