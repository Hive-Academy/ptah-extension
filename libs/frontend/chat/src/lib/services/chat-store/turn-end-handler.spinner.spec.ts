/**
 * Background tab spinner + status — who owns them (TASK_2026_360), asserted
 * against the REAL TabManagerService + partition + registries.
 *
 * Scenario: a tab starts streaming while active (its id enters the global
 * `_streamingTabIds` spinner set), the user switches to another workspace (the
 * tab moves to a background partition, the id stays in the global set), and
 * the session then finishes in the background.
 *
 * Before TASK_2026_360 the hook pushes (`session:turnEnded` /
 * `session:turnFailed`) cleared the spinner and flipped `status`. They arrive
 * on a channel with no ordering guarantee against the chunks, so they now
 * stamp their snapshot ONLY. The in-stream `turn_state` event, applied by
 * `TurnStateApplier`, is what clears the spinner and writes the status — and it
 * is workspace-aware, so the backgrounded tab is handled the same way.
 */

import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  TabWorkspacePartitionService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
  SessionLivenessRegistry,
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import {
  BackgroundAgentStore,
  MessageFinalizationService,
  PermissionHandlerService,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import {
  SessionId,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
  type TurnStateEvent,
} from '@ptah-extension/shared';
import type { TabId } from '@ptah-extension/chat-state';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TurnEndHandlerService } from './turn-end-handler.service';

const WS_A = '/ws/a';
const WS_B = '/ws/b';

describe('background tab spinner + status ownership (TASK_2026_360)', () => {
  let handler: TurnEndHandlerService;
  let applier: TurnStateApplier;
  let tabManager: TabManagerService;
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;
  let liveness: SessionLivenessRegistry;
  let finalizeCurrentMessage: jest.Mock;

  /** Create a streaming tab in WS_A, then switch to WS_B so it is backgrounded. */
  function streamingTabInBackground(sessionId: string): string {
    tabManager.switchWorkspace(WS_A);
    const tabId = tabManager.createTab('A');
    tabManager.attachSession(tabId, sessionId);
    tabManager.markStreaming(tabId);
    tabManager.markTabStreaming(tabId);
    // Register + bind the conversation so findTabsBySessionId resolves the
    // conversation but returns [] (its tab is not on the active workspace),
    // driving the background branch.
    const convId = registry.create(sessionId as unknown as never);
    binding.bind(tabId as TabId, convId);

    tabManager.switchWorkspace(WS_B);
    return tabId;
  }

  beforeEach(() => {
    localStorage.clear();
    finalizeCurrentMessage = jest.fn();

    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TurnEndHandlerService,
        TurnStateApplier,
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        SessionLivenessRegistry,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
        {
          provide: MessageFinalizationService,
          useValue: { finalizeCurrentMessage },
        },
        {
          provide: PermissionHandlerService,
          useValue: { consumeHardDenyToolUseIds: () => new Set<string>() },
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
    applier = TestBed.inject(TurnStateApplier);
    tabManager = TestBed.inject(TabManagerService);
    registry = TestBed.inject(ConversationRegistry);
    binding = TestBed.inject(TabSessionBinding);
    liveness = TestBed.inject(SessionLivenessRegistry);
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

  function turnState(
    sessionId: string,
    overrides: Partial<TurnStateEvent> = {},
  ): TurnStateEvent {
    return {
      id: `ts-${overrides.revision ?? 1}`,
      eventType: 'turn_state',
      timestamp: 1,
      sessionId,
      messageId: `turn-state-${sessionId}`,
      phase: 'idle',
      revision: 1,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'completed',
      source: 'stream',
      ...overrides,
    };
  }

  function bgTab(tabId: string) {
    return tabManager.getWorkspaceTabs(WS_A).find((t) => t.id === tabId);
  }

  it('handleTurnEnded leaves the spinner and status alone and stamps the snapshot', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);
    expect(tabManager.isTabStreaming(tabId)).toBe(true);

    handler.handleTurnEnded(turnEnded(sessA));

    expect(tabManager.isTabStreaming(tabId)).toBe(true);
    expect(bgTab(tabId)?.status).toBe('streaming');
    expect(bgTab(tabId)?.lastTerminalReason).toBe('completed');
  });

  it('handleTurnFailed leaves the spinner and status alone and stamps the reason', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    handler.handleTurnFailed(turnFailed(sessA));

    expect(tabManager.isTabStreaming(tabId)).toBe(true);
    expect(bgTab(tabId)?.status).toBe('streaming');
    expect(bgTab(tabId)?.lastTerminalReason).toBe('blocking_limit');
  });

  it('an idle turn_state clears the spinner, marks loaded and finalizes the backgrounded tab', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    applier.apply(turnState(sessA));

    expect(finalizeCurrentMessage).toHaveBeenCalledWith(tabId, false);
    expect(tabManager.isTabStreaming(tabId)).toBe(false);
    expect(bgTab(tabId)?.status).toBe('loaded');
    expect(liveness.status(sessA)()).toBe('idle');
    expect(liveness.liveWorkspaces().has(WS_A)).toBe(false);
  });

  it('a failed turn_state finalizes as aborted and marks liveness failed with the owning workspace', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    applier.apply(
      turnState(sessA, {
        phase: 'failed',
        terminalReason: 'blocking_limit',
        error: 'rate_limit',
      }),
    );

    expect(finalizeCurrentMessage).toHaveBeenCalledWith(tabId, true);
    expect(tabManager.isTabStreaming(tabId)).toBe(false);
    expect(bgTab(tabId)?.status).toBe('loaded');
    expect(liveness.status(sessA)()).toBe('failed');
  });

  it('a sleeping turn_state marks the backgrounded tab sleeping and its workspace live', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);

    applier.apply(
      turnState(sessA, {
        phase: 'sleeping',
        sessionCrons: [
          { id: 'c1', schedule: '*/10 * * * *', recurring: true, prompt: 'x' },
        ],
      }),
    );

    expect(tabManager.isTabStreaming(tabId)).toBe(false);
    expect(bgTab(tabId)?.status).toBe('sleeping');
    expect(bgTab(tabId)?.pendingSessionCrons).toHaveLength(1);
    expect(liveness.liveWorkspaces().has(WS_A)).toBe(true);
  });

  it('a generating turn_state re-lights a backgrounded tab (cron-woken turn)', () => {
    const sessA = SessionId.create();
    const tabId = streamingTabInBackground(sessA);
    applier.apply(turnState(sessA, { phase: 'sleeping', revision: 1 }));
    expect(bgTab(tabId)?.status).toBe('sleeping');

    applier.apply(
      turnState(sessA, {
        phase: 'generating',
        revision: 2,
        terminalReason: null,
      }),
    );

    expect(tabManager.isTabStreaming(tabId)).toBe(true);
    expect(bgTab(tabId)?.status).toBe('streaming');
    expect(liveness.status(sessA)()).toBe('streaming');
    expect(liveness.liveWorkspaces().has(WS_A)).toBe(true);
  });
});
