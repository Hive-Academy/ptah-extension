/**
 * TASK_2026_865 Batch 7: provider carry-over relink, across the real chain
 * that binds a refused tab to the new chat.
 *
 *   ProviderCarryOverService (real) -> SESSION_ID_RESOLVED ->
 *   ChatMessageHandler (real) -> [claimed-surface branch | ChatStore facade ->
 *   ChatLifecycleService (real)] -> TabManagerService.attachSession (real)
 *
 * Real services: TabManagerService, StreamingHandlerService, StreamRouter,
 * ConversationRegistry, TabSessionBinding, WorkflowSessionClaimService,
 * StreamingSurfaceRegistry, AuthStateService (banner), MessageSenderService
 * (case 3). The host RPCs are mocked. ChatStore is a facade that forwards
 * `handleSessionIdResolved` to the real lifecycle, as `chat.store.ts` does.
 * The accumulator appends text deterministically, so the assertions target
 * which tab and which session receive the new chat, not accumulator details.
 *
 * Every assertion names the refused tab by id, never the active tab.
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AuthStateService,
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  PlanLimitsStore,
  PtahCliStateService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  provideSurfaceActiveTesting,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  MODEL_REFRESH_CONTROL,
  SurfaceId,
  TabId,
  TabManagerService,
  TabSessionBinding,
  TabWorkspacePartitionService,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  BatchedUpdateService,
  EventDeduplicationService,
  MessageFinalizationService,
  PermissionHandlerService,
  SessionManager,
  StreamingAccumulatorCore,
  StreamingHandlerService,
  type AccumulatorContext,
} from '@ptah-extension/chat-streaming';
import {
  StreamingSurfaceRegistry,
  StreamRouter,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import {
  MESSAGE_TYPES,
  SessionId,
  createExecutionChatMessage,
  type SessionTurnState,
  type TextDeltaEvent,
} from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { AgentSessionAdoptionService } from './agent-session-adoption.service';
import { ChatMessageHandler } from './chat-message-handler.service';
import { ChatStore } from './chat.store';
import { ChatLifecycleService } from './chat-store/chat-lifecycle.service';
import { CompactionLifecycleService } from './chat-store/compaction-lifecycle.service';
import { ConversationService } from './chat-store/conversation.service';
import { SessionLivenessReconcilerService } from './chat-store/session-liveness-reconciler.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { MessageSenderService } from './message-sender.service';
import {
  CARRY_OVER_NOTICE_MS,
  ProviderCarryOverService,
  carryOverNotice,
} from './provider-carry-over.service';
import { SessionOrganizerService } from './session-list/session-organizer.service';
import { SessionOrganizationCache } from './session-organization/session-organization-cache.store';
import { StreamFlushScheduler } from './stream-flush-scheduler.service';
import { StreamViewportController } from './stream-viewport-controller.service';

const WS = '/work/project';
const OLD = SessionId.create();
const NEW = SessionId.create();
const OTHER = SessionId.create();

function textDelta(sessionId: string, delta: string): TextDeltaEvent {
  return {
    id: `evt-${sessionId}-${delta}`,
    eventType: 'text_delta',
    timestamp: 1,
    sessionId,
    messageId: 'msg-new',
    blockIndex: 0,
    delta,
    source: 'stream',
  } as TextDeltaEvent;
}

function generating(revision: number): SessionTurnState {
  return {
    phase: 'generating',
    revision,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: null,
    timestamp: 1,
  } as SessionTurnState;
}

function textOf(state: StreamingState | null | undefined): string {
  if (!state) return '';
  return [...state.textAccumulators.values()].join('');
}

describe('provider carry-over relink (real tab manager, router, handler, lifecycle)', () => {
  let rpc: MockRpcService;
  let showInfo: jest.Mock;
  let chatStoreLoadSessions: jest.Mock;
  let chatStoreResolve: jest.Mock;
  let tabManager: TabManagerService;
  let router: StreamRouter;
  let registry: ConversationRegistry;
  let handler: ChatMessageHandler;
  let streaming: StreamingHandlerService;
  let carryOver: ProviderCarryOverService;
  let auth: AuthStateService;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  const callsOf = (method: string): unknown[][] =>
    (rpc.call.mock.calls as unknown as unknown[][]).filter(
      (c) => c[0] === method,
    );

  const tabOf = (tabId: string) =>
    tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;

  /** The refused chat: a tab bound to OLD with two old messages. */
  function openRefusedTab(): string {
    const tabId = tabManager.createTab('Old chat');
    tabManager.attachSession(tabId, OLD);
    tabManager.setMessages(tabId, [
      createExecutionChatMessage({
        id: 'old-user',
        role: 'user',
        rawContent: 'old question',
        sessionId: OLD,
      }),
      createExecutionChatMessage({
        id: 'old-assistant',
        role: 'assistant',
        rawContent: 'old answer',
        sessionId: OLD,
      }),
    ]);
    tabManager.markLoaded(tabId);
    router.onTabCreated(TabId.from(tabId), OLD);
    return tabId;
  }

  /** Banner refusal -> offer -> button click; the host accepts the start. */
  async function startFromButton(tabId: string): Promise<void> {
    const generation = auth.flagAuthRequired('anthropic', 'Sign in to Claude', {
      sessionId: OLD,
      tabId,
      workspacePath: WS,
    });
    await carryOver.offerFor(generation);
    const offer = carryOver.offer();
    if (!offer) throw new Error('expected an offer');
    await carryOver.start(offer);
    expect(carryOver.isPending(tabId)).toBe(true);
  }

  /**
   * The host's resolution of the tab, stamped with the latest launch's
   * request ID as the host stamps a carry-over (R1); untagged with no launch.
   */
  function resolveSession(tabId: string, realSessionId: string): void {
    const launches = callsOf('chat:carry-over');
    const requestId = (
      launches[launches.length - 1]?.[1] as { requestId?: string } | undefined
    )?.requestId;
    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
      payload: {
        tabId,
        realSessionId,
        ...(requestId ? { carryOverRequestId: requestId } : {}),
      },
    });
  }

  /** A surface that renders the tab's stream (workflow claim). */
  function claimSurface(tabId: string): SurfaceId {
    const surfaceId = SurfaceId.create();
    TestBed.inject(WorkflowSessionClaimService).claim(tabId, surfaceId);
    let state = createEmptyStreamingState();
    TestBed.inject(StreamingSurfaceRegistry).register(
      surfaceId,
      () => state,
      (next: StreamingState) => {
        state = next;
      },
    );
    return surfaceId;
  }

  beforeEach(() => {
    localStorage.clear();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    showInfo = jest.fn();
    chatStoreLoadSessions = jest.fn().mockResolvedValue(undefined);
    chatStoreResolve = jest.fn(
      (data: { tabId: string; realSessionId: string }) =>
        TestBed.inject(ChatLifecycleService).handleSessionIdResolved(data),
    );

    rpc = createMockRpcService();
    rpc.call.mockImplementation((async (method: string) => {
      switch (method) {
        case 'chat:carry-over-check':
          return rpcSuccess({
            eligible: true,
            providerId: 'openai-codex',
            providerName: 'Codex',
          });
        case 'chat:carry-over':
          return rpcSuccess({
            success: true,
            providerId: 'openai-codex',
            providerName: 'Codex',
          });
        case 'session:validate':
          return rpcSuccess({ exists: true });
        default:
          return rpcSuccess(undefined);
      }
    }) as unknown as MockRpcService['call']);

    // Deterministic accumulator: append each delta to the state it is given.
    const accumulator = {
      process: jest.fn(
        (
          state: StreamingState,
          event: TextDeltaEvent,
          _ctx: AccumulatorContext,
        ) => {
          const key = `${event.messageId}-block-${event.blockIndex}`;
          const prev = state.textAccumulators.get(key) ?? '';
          state.textAccumulators.set(key, prev + (event.delta ?? ''));
          return { stateMutated: true, eventType: event.eventType };
        },
      ),
    } as unknown as StreamingAccumulatorCore;

    const modelRefresh = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        provideSurfaceActiveTesting(),
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        StreamingHandlerService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
        { provide: StreamingAccumulatorCore, useValue: accumulator },
        {
          provide: BatchedUpdateService,
          useValue: {
            scheduleUpdate: jest.fn(),
            flushSync: jest.fn(),
            queuedState: jest.fn(() => undefined),
            clearPendingUpdates: jest.fn(),
          },
        },
        {
          provide: SessionManager,
          useValue: {
            setSessionId: jest.fn(),
            setStatus: jest.fn(),
            clearNodeMaps: jest.fn(),
            failSession: jest.fn(),
          },
        },
        {
          provide: EventDeduplicationService,
          useValue: { cleanupSession: jest.fn() },
        },
        {
          provide: MessageFinalizationService,
          useValue: { finalizeCurrentMessage: jest.fn() },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            decisionPulse: signal(null),
            permissionRequests: signal([]),
            questionRequests: signal([]),
            routingTargetRevision: signal(0),
            consumeHardDenyToolUseIds: jest.fn(() => new Set()),
            questionTargetTabsFor: jest.fn(() => []),
            clearQuestionTargets: jest.fn(),
            attachQuestionTargets: jest.fn(),
          },
        },
        { provide: BackgroundAgentStore, useValue: {} },
        {
          provide: AgentMonitorStore,
          useValue: { resolveParentSessionId: jest.fn() },
        },
        // Core: the real banner state; the host is mocked.
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: VSCodeService,
          useValue: {
            config: jest.fn(() => ({ workspaceRoot: WS, panelId: '' })),
            isElectron: true,
            postMessage: jest.fn(),
          },
        },
        {
          provide: ModelStateService,
          useValue: {
            refreshModels: jest.fn(),
            currentModel: jest.fn(() => 'claude-opus-4'),
            availableModels: jest.fn(() => []),
          },
        },
        {
          provide: EffortStateService,
          useValue: {
            refreshEffort: jest.fn(),
            currentEffort: jest.fn(() => undefined),
            setEffort: jest.fn(async () => true),
          },
        },
        { provide: PlanLimitsStore, useValue: { load: jest.fn() } },
        {
          provide: PtahCliStateService,
          useValue: { selectedAgentId: jest.fn(() => null) },
        },
        { provide: ActionBannerService, useValue: { showInfo } },
        // Chat: the handler's and the lifecycle's other collaborators.
        {
          provide: ChatStore,
          useValue: {
            handleSessionIdResolved: chatStoreResolve,
            loadSessions: chatStoreLoadSessions,
          },
        },
        {
          provide: StreamFlushScheduler,
          useValue: {
            enqueue: (_tabId: string | undefined, work: () => void) => work(),
            enqueueSnapshot: (_snapshot: unknown, work: () => void) => work(),
          },
        },
        { provide: StreamViewportController, useValue: {} },
        {
          provide: AgentSessionAdoptionService,
          useValue: { adopt: jest.fn(), adoptHandoff: jest.fn() },
        },
        {
          provide: SessionOrganizerService,
          useValue: { onOrganizationChanged: jest.fn() },
        },
        {
          provide: SessionOrganizationCache,
          useValue: { onOrganizationChanged: jest.fn() },
        },
        {
          provide: SessionLoaderService,
          useValue: { loadSessions: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CompactionLifecycleService,
          useValue: { clearCompactionState: jest.fn() },
        },
        {
          provide: ConversationService,
          useValue: { dropHeldCommands: jest.fn() },
        },
        { provide: SessionLivenessReconcilerService, useValue: {} },
      ],
    });

    tabManager = TestBed.inject(TabManagerService);
    registry = TestBed.inject(ConversationRegistry);
    streaming = TestBed.inject(StreamingHandlerService);
    handler = TestBed.inject(ChatMessageHandler);
    router = TestBed.inject(StreamRouter);
    carryOver = TestBed.inject(ProviderCarryOverService);
    auth = TestBed.inject(AuthStateService);
    TestBed.tick();
    tabManager.switchWorkspace(WS);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('case 1, lifecycle branch: the refused tab continues in the new session (AC 2.2, 4.1, 4.2, 4.6; A2)', async () => {
    const tabId = openRefusedTab();
    await startFromButton(tabId);

    resolveSession(tabId, NEW);

    const tab = tabOf(tabId);
    expect(tab?.claudeSessionId).toBe(NEW);
    expect(carryOver.isPending(tabId)).toBe(false);
    expect(auth.authRequiredBanner()).toBeNull();
    expect(showInfo).toHaveBeenCalledTimes(1);
    expect(showInfo).toHaveBeenCalledWith(
      carryOverNotice('Codex'),
      tabId,
      CARRY_OVER_NOTICE_MS,
    );

    // A2: the new session's first `generating` is accepted after the attach.
    tabManager.applyTurnState(tabId, generating(1), NEW);
    expect(tabOf(tabId)?.status).toBe('streaming');

    // The new session's first assistant text lands in the same tab.
    const delta = textDelta(NEW, 'Hello from Codex');
    router.routeStreamEvent(delta, TabId.from(tabId));
    streaming.processStreamEvent(delta, tabId);

    const after = tabOf(tabId);
    expect(after?.messages.map((m) => m.id)).toEqual([
      'old-user',
      'old-assistant',
    ]);
    expect(textOf(after?.streamingState)).toBe('Hello from Codex');
    const convId = router.conversationForTab(TabId.from(tabId));
    if (!convId) throw new Error('expected the tab to stay bound');
    expect(registry.getRecord(convId)?.sessions).toEqual([OLD, NEW]);

    // The refused prompt is never sent again (AC 4.6).
    expect(callsOf('chat:continue')).toHaveLength(0);
    expect(callsOf('chat:start')).toHaveLength(0);
    expect(callsOf('chat:carry-over')).toHaveLength(1);
  });

  describe('case 2, claimed-surface branch (F3)', () => {
    it("'bind': attaches the owning tab, binds the surface once, then shows the notice once (AC 4.3)", async () => {
      const tabId = openRefusedTab();
      const surfaceId = claimSurface(tabId);
      await startFromButton(tabId);
      const attach = jest.spyOn(tabManager, 'attachSession');
      const onSurfaceCreated = jest.spyOn(router, 'onSurfaceCreated');
      expect(showInfo).not.toHaveBeenCalled();

      resolveSession(tabId, NEW);

      expect(tabOf(tabId)?.claudeSessionId).toBe(NEW);
      expect(carryOver.isPending(tabId)).toBe(false);
      expect(onSurfaceCreated).toHaveBeenCalledTimes(1);
      expect(onSurfaceCreated).toHaveBeenCalledWith(surfaceId, NEW);
      expect(attach).toHaveBeenCalledWith(tabId, NEW);
      expect(showInfo).toHaveBeenCalledTimes(1);
      expect(attach.mock.invocationCallOrder[0]).toBeLessThan(
        showInfo.mock.invocationCallOrder[0],
      );
    });

    it("'skip' (tab rebound): binds nothing, aborts the new session and refreshes the list (AC 7.7, A9)", async () => {
      const tabId = openRefusedTab();
      claimSurface(tabId);
      await startFromButton(tabId);
      // The user opens another chat in the tab before the resolution.
      tabManager.attachSession(tabId, OTHER);
      const attach = jest.spyOn(tabManager, 'attachSession');
      const onSurfaceCreated = jest.spyOn(router, 'onSurfaceCreated');

      resolveSession(tabId, NEW);

      expect(attach).not.toHaveBeenCalled();
      expect(onSurfaceCreated).not.toHaveBeenCalled();
      expect(chatStoreResolve).not.toHaveBeenCalled();
      expect(showInfo).not.toHaveBeenCalled();
      expect(tabOf(tabId)?.claudeSessionId).toBe(OTHER);
      expect(callsOf('chat:abort')).toEqual([
        ['chat:abort', { sessionId: NEW }],
      ]);
      expect(carryOver.isPending(tabId)).toBe(false);
      expect(chatStoreLoadSessions).toHaveBeenCalledTimes(1);
    });

    it("'none' (no carry-over): today's surface calls in today's order, no attach", () => {
      const tabId = openRefusedTab();
      const surfaceId = claimSurface(tabId);
      const attach = jest.spyOn(tabManager, 'attachSession');
      const onSurfaceCreated = jest.spyOn(router, 'onSurfaceCreated');
      const refresh = jest.spyOn(router, 'refreshQuestionTargetsForSession');

      resolveSession(tabId, NEW);

      expect(onSurfaceCreated).toHaveBeenCalledWith(surfaceId, NEW);
      expect(refresh).toHaveBeenCalledWith(NEW);
      expect(onSurfaceCreated.mock.invocationCallOrder[0]).toBeLessThan(
        refresh.mock.invocationCallOrder[0],
      );
      expect(chatStoreResolve).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(tabOf(tabId)?.claudeSessionId).toBe(OLD);
      expect(showInfo).not.toHaveBeenCalled();
    });
  });

  it('case 3: /compact -> eligible -> SESSION_ID_RESOLVED binds the tab and shows the notice once (proposed AC 9.4)', async () => {
    const tabId = openRefusedTab();
    const sender = TestBed.inject(MessageSenderService);

    await expect(sender.send('/compact', { tabId })).resolves.toEqual({
      success: true,
    });
    expect(carryOver.isPending(tabId)).toBe(true);
    expect(showInfo).not.toHaveBeenCalled();
    expect(callsOf('chat:carry-over')).toHaveLength(1);
    expect(callsOf('chat:carry-over')[0][1]).toEqual({
      sessionId: OLD,
      tabId,
      workspacePath: WS,
      name: 'Old chat',
      ptahUiFence: true,
      requestId: expect.any(String),
    });

    resolveSession(tabId, NEW);

    expect(tabOf(tabId)?.claudeSessionId).toBe(NEW);
    expect(carryOver.isPending(tabId)).toBe(false);
    expect(showInfo).toHaveBeenCalledTimes(1);
    expect(showInfo).toHaveBeenCalledWith(
      carryOverNotice('Codex'),
      tabId,
      CARRY_OVER_NOTICE_MS,
    );
    expect(tabOf(tabId)?.messages.map((m) => m.id)).toEqual([
      'old-user',
      'old-assistant',
    ]);
    expect(callsOf('chat:continue')).toHaveLength(0);
  });

  it('case 4 (R1): a resolution tagged with another launch is aborted; the tagged launch binds', async () => {
    const tabId = openRefusedTab();
    const sender = TestBed.inject(MessageSenderService);
    await sender.send('/compact', { tabId });
    const { requestId } = callsOf('chat:carry-over')[0][1] as {
      requestId: string;
    };
    const STRAY = '55555555-5555-4555-8555-555555555555';

    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
      payload: {
        tabId,
        realSessionId: STRAY,
        carryOverRequestId: '66666666-6666-4666-8666-666666666666',
      },
    });
    expect(tabOf(tabId)?.claudeSessionId).toBe(OLD);
    expect(carryOver.isPending(tabId)).toBe(true);
    expect(callsOf('chat:abort').map((c) => c[1])).toEqual([
      { sessionId: STRAY },
    ]);

    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
      payload: { tabId, realSessionId: NEW, carryOverRequestId: requestId },
    });
    expect(tabOf(tabId)?.claudeSessionId).toBe(NEW);
    expect(carryOver.isPending(tabId)).toBe(false);
    expect(showInfo).toHaveBeenCalledTimes(1);
  });
});
