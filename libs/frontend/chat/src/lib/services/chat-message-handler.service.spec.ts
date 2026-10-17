/**
 * ChatMessageHandler specs.
 *
 * Validates the Zod safeParse guards added at the frontend receive point.
 * A malformed PermissionRequest or AskUserQuestionRequest payload MUST be
 * logged and dropped (early-return) without crashing the message-handler
 * loop and without invoking downstream services (ChatStore, StreamRouter).
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES, SessionId } from '@ptah-extension/shared';
import {
  StreamingSurfaceRegistry,
  StreamRouter,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import {
  AgentMonitorStore,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import {
  SessionLivenessRegistry,
  SurfaceId,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { ChatMessageHandler } from './chat-message-handler.service';
import { StreamFlushScheduler } from './stream-flush-scheduler.service';
import { StreamViewportController } from './stream-viewport-controller.service';
import { AgentSessionAdoptionService } from './agent-session-adoption.service';
import { ChatStore } from './chat.store';
import { BoardTaskLinkCaptureService } from './chat-store/board-task-link-capture.service';
import { SessionOrganizerService } from './session-list/session-organizer.service';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const SESS_VALID = SessionId.create();

function makeValidPermissionRequest() {
  return {
    id: VALID_UUID,
    toolName: 'Bash',
    toolInput: {},
    toolUseId: 'tool-1',
    timestamp: Date.now(),
    description: 'Run a command',
    timeoutAt: 0,
    sessionId: VALID_UUID,
  };
}

function makeValidAskUserQuestionRequest() {
  return {
    id: VALID_UUID,
    toolName: 'AskUserQuestion' as const,
    questions: [],
    toolUseId: 'tool-1',
    timestamp: Date.now(),
    timeoutAt: 0,
    sessionId: VALID_UUID,
  };
}

describe('ChatMessageHandler — payload validation (TASK_2026_120 Phase B)', () => {
  let handler: ChatMessageHandler;
  let chatStore: {
    handlePermissionRequest: jest.Mock;
    handleQuestionRequest: jest.Mock;
    handleTurnEndedNotification: jest.Mock;
    handleTurnFailedNotification: jest.Mock;
    handleSubagentEndedNotification: jest.Mock;
    processStreamEvent: jest.Mock;
    deferLiveStreamEvent: jest.Mock;
    handleSessionIdResolved: jest.Mock;
    loadSessions: jest.Mock;
    resyncStream: jest.Mock;
    handleSessionStats: jest.Mock;
    handleSessionStatsLive: jest.Mock;
  };
  let linkCapture: { onSessionIdResolved: jest.Mock };
  let streamRouter: {
    routePermissionPrompt: jest.Mock;
    routeQuestionPrompt: jest.Mock;
    refreshQuestionTargetsForSession: jest.Mock;
    routeStreamEvent: jest.Mock;
    routeStreamEventForSurface: jest.Mock;
    onSurfaceCreated: jest.Mock;
  };
  let tabManager: {
    tabs: jest.Mock;
    resetTabToFresh: jest.Mock;
    findTabBySessionIdAcrossWorkspaces: jest.Mock;
    findTabIdsBySessionId: jest.Mock;
    markTabAttached: jest.Mock;
    markTabDetached: jest.Mock;
  };
  let turnStateApplier: { apply: jest.Mock };
  let agentSessionAdoption: { adopt: jest.Mock; adoptHandoff: jest.Mock };
  let organizer: { onOrganizationChanged: jest.Mock };
  let claims: WorkflowSessionClaimService;
  let surfaceRegistry: StreamingSurfaceRegistry;
  let consoleWarnSpy: jest.SpyInstance;

  function registerSurfaceAdapter(surfaceId: SurfaceId): void {
    surfaceRegistry.register(
      surfaceId,
      () => ({}) as never,
      () => undefined,
    );
  }

  beforeEach(() => {
    chatStore = {
      handlePermissionRequest: jest.fn(),
      handleQuestionRequest: jest.fn(),
      handleTurnEndedNotification: jest.fn(),
      handleTurnFailedNotification: jest.fn(),
      handleSubagentEndedNotification: jest.fn(),
      processStreamEvent: jest.fn(),
      deferLiveStreamEvent: jest.fn().mockReturnValue(false),
      handleSessionIdResolved: jest.fn(),
      loadSessions: jest.fn().mockResolvedValue(undefined),
      resyncStream: jest.fn().mockResolvedValue(undefined),
      handleSessionStats: jest.fn(),
      handleSessionStatsLive: jest.fn(),
    };
    linkCapture = {
      onSessionIdResolved: jest.fn().mockResolvedValue(undefined),
    };
    streamRouter = {
      routePermissionPrompt: jest.fn(),
      routeQuestionPrompt: jest.fn(),
      refreshQuestionTargetsForSession: jest.fn(),
      routeStreamEvent: jest.fn(),
      routeStreamEventForSurface: jest.fn(),
      onSurfaceCreated: jest.fn(),
    };
    tabManager = {
      tabs: jest.fn(() => [{ id: 'tab-1' }]),
      resetTabToFresh: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
      findTabIdsBySessionId: jest.fn(() => []),
      markTabAttached: jest.fn(),
      markTabDetached: jest.fn(),
    };
    turnStateApplier = { apply: jest.fn() };
    agentSessionAdoption = { adopt: jest.fn(), adoptHandoff: jest.fn() };
    organizer = { onOrganizationChanged: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        ChatMessageHandler,
        { provide: ChatStore, useValue: chatStore },
        {
          provide: StreamFlushScheduler,
          useValue: {
            enqueue: (_tabId: string | undefined, work: () => void) => work(),
            enqueueSnapshot: (_snapshot: unknown, work: () => void) => work(),
          },
        },
        { provide: StreamViewportController, useValue: {} },
        { provide: StreamRouter, useValue: streamRouter },
        {
          provide: AgentMonitorStore,
          useValue: { resolveParentSessionId: jest.fn() },
        },
        { provide: TabManagerService, useValue: tabManager },
        { provide: TurnStateApplier, useValue: turnStateApplier },
        { provide: BoardTaskLinkCaptureService, useValue: linkCapture },
        {
          provide: AgentSessionAdoptionService,
          useValue: agentSessionAdoption,
        },
        { provide: SessionOrganizerService, useValue: organizer },
      ],
    });

    handler = TestBed.inject(ChatMessageHandler);
    claims = TestBed.inject(WorkflowSessionClaimService);
    surfaceRegistry = TestBed.inject(StreamingSurfaceRegistry);
    TestBed.inject(SessionLivenessRegistry);
    consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    TestBed.resetTestingModule();
  });

  // ----- PERMISSION_REQUEST -------------------------------------------------

  it('handlePermissionRequest drops malformed payload and does not throw', () => {
    // Missing required fields (toolName, timestamp, etc.).
    const malformed = { id: 'not-a-uuid', sessionId: 'also-not-uuid' };

    expect(() =>
      handler.handleMessage({
        type: MESSAGE_TYPES.PERMISSION_REQUEST,
        payload: malformed,
      }),
    ).not.toThrow();

    expect(chatStore.handlePermissionRequest).not.toHaveBeenCalled();
    expect(streamRouter.routePermissionPrompt).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid PermissionRequest payload'),
      expect.anything(),
    );
  });

  it('handlePermissionRequest accepts a well-formed payload and forwards it', () => {
    const valid = makeValidPermissionRequest();

    handler.handleMessage({
      type: MESSAGE_TYPES.PERMISSION_REQUEST,
      payload: valid,
    });

    expect(chatStore.handlePermissionRequest).toHaveBeenCalledTimes(1);
    expect(streamRouter.routePermissionPrompt).toHaveBeenCalledTimes(1);
  });

  // ----- ASK_USER_QUESTION_REQUEST ------------------------------------------

  it('handleAskUserQuestion drops malformed payload and does not throw', () => {
    const malformed = { id: 'not-a-uuid', toolName: 'WrongTool' };

    expect(() =>
      handler.handleMessage({
        type: MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
        payload: malformed,
      }),
    ).not.toThrow();

    expect(chatStore.handleQuestionRequest).not.toHaveBeenCalled();
    expect(streamRouter.routeQuestionPrompt).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid AskUserQuestionRequest payload'),
      expect.anything(),
    );
  });

  it('handleAskUserQuestion accepts a well-formed payload and forwards it', () => {
    const valid = makeValidAskUserQuestionRequest();

    handler.handleMessage({
      type: MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
      payload: valid,
    });

    expect(chatStore.handleQuestionRequest).toHaveBeenCalledTimes(1);
    expect(streamRouter.routeQuestionPrompt).toHaveBeenCalledTimes(1);
  });

  // ----- SESSION_STATS / SESSION_STATS_LIVE (TASK_2026_626) -----------------

  describe('session:stats-live', () => {
    function liveSnapshot(overrides: Record<string, unknown> = {}) {
      return {
        sessionId: SESS_VALID,
        model: 'claude-sonnet-4-5',
        totalCost: 0.5,
        tokens: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
        messageCount: 2,
        status: 'ok',
        revision: 5,
        provisional: true,
        ...overrides,
      };
    }

    it('is a handled message type', () => {
      expect(handler.handledMessageTypes).toContain(
        MESSAGE_TYPES.SESSION_STATS_LIVE,
      );
    });

    it('routes a provisional payload, with its context, to the store live path only', () => {
      const sessionStats = liveSnapshot();
      const context = { model: 'claude-sonnet-4-5', contextTokens: 90000 };

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_STATS_LIVE,
        payload: { sessionId: SESS_VALID, sessionStats, context },
      });

      expect(chatStore.handleSessionStatsLive).toHaveBeenCalledTimes(1);
      expect(chatStore.handleSessionStatsLive).toHaveBeenCalledWith({
        sessionId: SESS_VALID,
        sessionStats,
        context,
      });
      expect(chatStore.handleSessionStats).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('strips a stray context from an authoritative payload before the store is called', () => {
      // No `provisional` field: the settle snapshot is authoritative.
      const authoritative = liveSnapshot({ revision: 6 });
      delete (authoritative as { provisional?: boolean }).provisional;

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_STATS_LIVE,
        payload: {
          sessionId: SESS_VALID,
          sessionStats: authoritative,
          context: { model: 'claude-sonnet-4-5', contextTokens: 90000 },
        },
      });

      expect(chatStore.handleSessionStatsLive).toHaveBeenCalledTimes(1);
      const [forwarded] = chatStore.handleSessionStatsLive.mock.calls[0];
      expect(forwarded).toEqual({
        sessionId: SESS_VALID,
        sessionStats: authoritative,
      });
      expect('context' in forwarded).toBe(false);
    });

    it.each([
      ['a non-object payload', 'oops'],
      ['a missing snapshot', { sessionId: SESS_VALID }],
      [
        'a non-true provisional flag',
        {
          sessionId: SESS_VALID,
          sessionStats: liveSnapshot({ provisional: false }),
        },
      ],
      [
        'a missing revision',
        {
          sessionId: SESS_VALID,
          sessionStats: liveSnapshot({ revision: undefined }),
        },
      ],
    ])(
      'drops %s with one warning naming only the session',
      (_label, payload) => {
        expect(() =>
          handler.handleMessage({
            type: MESSAGE_TYPES.SESSION_STATS_LIVE,
            payload,
          }),
        ).not.toThrow();

        expect(chatStore.handleSessionStatsLive).not.toHaveBeenCalled();
        expect(chatStore.handleSessionStats).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        const expectedSessionId =
          typeof payload === 'object' ? SESS_VALID : undefined;
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          '[ChatMessageHandler] session:stats-live payload rejected — dropped',
          { sessionId: expectedSessionId },
        );
      },
    );

    it('leaves session:stats routing unchanged', () => {
      const payload = { sessionId: SESS_VALID, turnCost: 0.1 };

      handler.handleMessage({ type: MESSAGE_TYPES.SESSION_STATS, payload });

      expect(handler.handledMessageTypes).toContain(
        MESSAGE_TYPES.SESSION_STATS,
      );
      expect(chatStore.handleSessionStats).toHaveBeenCalledTimes(1);
      expect(chatStore.handleSessionStats).toHaveBeenCalledWith(payload);
      expect(chatStore.handleSessionStatsLive).not.toHaveBeenCalled();
    });
  });

  // ----- GATEWAY_SESSION_ATTACHED / DETACHED --------------------------------

  it('gateway:sessionAttached marks every resolved tab attached', () => {
    tabManager.findTabIdsBySessionId.mockReturnValueOnce(['tab-1', 'tab-2']);

    handler.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_SESSION_ATTACHED,
      payload: {
        bindingId: 'binding-9',
        sessionUuid: VALID_UUID,
        platform: 'telegram',
      },
    });

    expect(tabManager.findTabIdsBySessionId).toHaveBeenCalledTimes(1);
    expect(tabManager.markTabAttached).toHaveBeenCalledTimes(2);
    expect(tabManager.markTabAttached).toHaveBeenCalledWith('tab-1', {
      bindingId: 'binding-9',
      platform: 'telegram',
    });
    expect(tabManager.markTabAttached).toHaveBeenCalledWith('tab-2', {
      bindingId: 'binding-9',
      platform: 'telegram',
    });
  });

  it('gateway:sessionAttached drops a payload missing fields without throwing', () => {
    expect(() =>
      handler.handleMessage({
        type: MESSAGE_TYPES.GATEWAY_SESSION_ATTACHED,
        payload: { bindingId: 'binding-9' },
      }),
    ).not.toThrow();

    expect(tabManager.markTabAttached).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('gateway:sessionAttached payload missing fields'),
      expect.anything(),
    );
  });

  it('gateway:sessionDetached marks every resolved tab detached', () => {
    tabManager.findTabIdsBySessionId.mockReturnValueOnce(['tab-1']);

    handler.handleMessage({
      type: MESSAGE_TYPES.GATEWAY_SESSION_DETACHED,
      payload: { bindingId: 'binding-9', sessionUuid: VALID_UUID },
    });

    expect(tabManager.markTabDetached).toHaveBeenCalledTimes(1);
    expect(tabManager.markTabDetached).toHaveBeenCalledWith('tab-1');
  });

  // ----- AGENT_SESSION_OPENED (TASK_2026_584) --------------------------------

  const agentSessionPayload = {
    tabId: VALID_UUID,
    sessionId: null,
    parentTabId: '22222222-2222-4222-8222-222222222222',
    parentSessionId: null,
    workspaceRoot: '/ws',
    worktreePath: '/ws/.worktrees/child',
    branch: 'feat/child',
    label: 'Child',
    displayPrompt: 'Do the thing',
    startedAt: 1,
  };

  it('agentSession:opened is a handled type and adopts the tab live', () => {
    expect(handler.handledMessageTypes).toContain(
      MESSAGE_TYPES.AGENT_SESSION_OPENED,
    );

    handler.handleMessage({
      type: MESSAGE_TYPES.AGENT_SESSION_OPENED,
      payload: agentSessionPayload,
    });

    expect(agentSessionAdoption.adopt).toHaveBeenCalledTimes(1);
    expect(agentSessionAdoption.adopt).toHaveBeenCalledWith(
      agentSessionPayload,
      'live',
    );
  });

  it.each([
    ['undefined', undefined],
    ['a string', 'nope'],
    ['missing parentTabId', { ...agentSessionPayload, parentTabId: '' }],
    ['non-numeric startedAt', { ...agentSessionPayload, startedAt: 'x' }],
    ['numeric sessionId', { ...agentSessionPayload, sessionId: 5 }],
  ])(
    'agentSession:opened drops %s without throwing or adopting',
    (_label, payload) => {
      expect(() =>
        handler.handleMessage({
          type: MESSAGE_TYPES.AGENT_SESSION_OPENED,
          payload,
        }),
      ).not.toThrow();
      expect(agentSessionAdoption.adopt).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('agentSession:opened payload rejected'),
        expect.anything(),
      );
    },
  );

  // ----- SESSION_HANDOFF_OPENED (TASK_2026_655) ------------------------------

  const handoffPayload = {
    tabId: VALID_UUID,
    fromTabId: '22222222-2222-4222-8222-222222222222',
    fromSessionId: null,
    workspaceRoot: '/ws',
    cwd: '/ws/pkg',
    label: 'Continue',
    displayPrompt: 'Read HANDOFF.md first',
    startedAt: 1,
  };

  it('sessionHandoff:opened is a handled type and adopts the handoff tab', () => {
    expect(handler.handledMessageTypes).toContain(
      MESSAGE_TYPES.SESSION_HANDOFF_OPENED,
    );

    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_HANDOFF_OPENED,
      payload: handoffPayload,
    });

    expect(agentSessionAdoption.adoptHandoff).toHaveBeenCalledTimes(1);
    expect(agentSessionAdoption.adoptHandoff).toHaveBeenCalledWith(
      handoffPayload,
    );
    expect(agentSessionAdoption.adopt).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['a string', 'nope'],
    ['missing fromTabId', { ...handoffPayload, fromTabId: '' }],
    ['missing cwd', { ...handoffPayload, cwd: undefined }],
    ['non-numeric startedAt', { ...handoffPayload, startedAt: 'x' }],
  ])(
    'sessionHandoff:opened drops %s without throwing or adopting',
    (_label, payload) => {
      expect(() =>
        handler.handleMessage({
          type: MESSAGE_TYPES.SESSION_HANDOFF_OPENED,
          payload,
        }),
      ).not.toThrow();
      expect(agentSessionAdoption.adoptHandoff).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('sessionHandoff:opened payload rejected'),
        expect.anything(),
      );
    },
  );

  // ----- SESSION_TURN_ENDED (Phase 2 Batch 3) -------------------------------

  it('handleSessionTurnEnded forwards a well-formed payload to ChatStore', () => {
    const payload = {
      sessionId: SESS_VALID,
      cwd: '/workspace',
      lastAssistantMessage: 'done',
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'completed',
      timestamp: 1_700_000_000_000,
    };

    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_TURN_ENDED,
      payload,
    });

    expect(chatStore.handleTurnEndedNotification).toHaveBeenCalledTimes(1);
    expect(chatStore.handleTurnEndedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESS_VALID,
        terminalReason: 'completed',
      }),
    );
  });

  it('handleSessionTurnEnded drops malformed payload with a single warn', () => {
    const malformed = { sessionId: '', terminalReason: 'bogus' };

    expect(() =>
      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_TURN_ENDED,
        payload: malformed,
      }),
    ).not.toThrow();

    expect(chatStore.handleTurnEndedNotification).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid SdkTurnEndedPayload'),
      expect.anything(),
    );
  });

  // ----- SESSION_TURN_FAILED (Phase 2 Batch 3) ------------------------------

  it('handleSessionTurnFailed forwards a well-formed payload to ChatStore', () => {
    const payload = {
      sessionId: SESS_VALID,
      cwd: '/workspace',
      lastAssistantMessage: null,
      error: 'rate_limit',
      errorDetails: 'try again later',
      terminalReason: 'blocking_limit',
      timestamp: 1_700_000_000_000,
    };

    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_TURN_FAILED,
      payload,
    });

    expect(chatStore.handleTurnFailedNotification).toHaveBeenCalledTimes(1);
    expect(chatStore.handleTurnFailedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESS_VALID,
        error: 'rate_limit',
      }),
    );
  });

  it('handleSessionTurnFailed drops malformed payload with a single warn', () => {
    const malformed = { sessionId: '', error: 'mystery' };

    expect(() =>
      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_TURN_FAILED,
        payload: malformed,
      }),
    ).not.toThrow();

    expect(chatStore.handleTurnFailedNotification).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid SdkTurnFailedPayload'),
      expect.anything(),
    );
  });

  // ----- SESSION_SUBAGENT_ENDED (Phase 3 Batch 4) ---------------------------

  it('handleSessionSubagentEnded forwards a well-formed payload to ChatStore', () => {
    const payload = {
      sessionId: SESS_VALID,
      cwd: '/workspace',
      agentId: 'agent-a',
      agentType: 'subagent',
      lastAssistantMessage: 'sub done',
      backgroundTasks: [],
      timestamp: 1_700_000_000_000,
    };

    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_SUBAGENT_ENDED,
      payload,
    });

    expect(chatStore.handleSubagentEndedNotification).toHaveBeenCalledTimes(1);
    expect(chatStore.handleSubagentEndedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESS_VALID,
        agentId: 'agent-a',
      }),
    );
  });

  it('handleSessionSubagentEnded drops malformed payload with a single warn', () => {
    const malformed = { sessionId: '', agentId: '' };

    expect(() =>
      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_SUBAGENT_ENDED,
        payload: malformed,
      }),
    ).not.toThrow();

    expect(chatStore.handleSubagentEndedNotification).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid SdkSubagentEndedPayload'),
      expect.anything(),
    );
  });

  // ----- CHAT_COMPLETE (/clear native command) ------------------------------

  it('handleChatComplete resets the target tab on the clear command', () => {
    handler.handleMessage({
      type: MESSAGE_TYPES.CHAT_COMPLETE,
      payload: { tabId: 'tab-1', sessionId: VALID_UUID, command: 'clear' },
    });

    expect(tabManager.resetTabToFresh).toHaveBeenCalledTimes(1);
    expect(tabManager.resetTabToFresh).toHaveBeenCalledWith('tab-1');
  });

  it('handleChatComplete ignores ordinary (per-turn) completions', () => {
    handler.handleMessage({
      type: MESSAGE_TYPES.CHAT_COMPLETE,
      payload: { tabId: 'tab-1', sessionId: VALID_UUID },
    });

    expect(tabManager.resetTabToFresh).not.toHaveBeenCalled();
  });

  it('handleChatComplete no-ops when the clear targets an unknown tab', () => {
    handler.handleMessage({
      type: MESSAGE_TYPES.CHAT_COMPLETE,
      payload: { tabId: 'tab-gone', command: 'clear' },
    });

    expect(tabManager.resetTabToFresh).not.toHaveBeenCalled();
  });

  it('handleSessionSubagentEnded warns and no-ops on undefined payload', () => {
    handler.handleMessage({
      type: MESSAGE_TYPES.SESSION_SUBAGENT_ENDED,
      payload: undefined,
    });

    expect(chatStore.handleSubagentEndedNotification).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'session:subagentEnded received but payload is undefined',
      ),
    );
  });

  // ----- claimed workflow session routing -----------------------------------

  describe('claimed workflow session routing (CHAT_CHUNK)', () => {
    const CHUNK_SESSION = '99999999-9999-4999-8999-999999999999';

    function makeChunkPayload(
      tabId: string,
      surfaceMode?: boolean,
    ): Record<string, unknown> {
      return {
        tabId,
        sessionId: CHUNK_SESSION,
        ...(surfaceMode !== undefined ? { surfaceMode } : {}),
        event: {
          id: 'evt-1',
          eventType: 'text_delta',
          timestamp: 1,
          sessionId: CHUNK_SESSION,
          messageId: 'msg-1',
          blockIndex: 0,
          delta: 'hi',
          source: 'stream',
        },
      };
    }

    it('routes a claimed chunk to the surface and bypasses the chat tab path', () => {
      const correlationId = VALID_UUID;
      const surfaceId = SurfaceId.create();
      claims.claim(correlationId, surfaceId);
      registerSurfaceAdapter(surfaceId);

      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: makeChunkPayload(correlationId, true),
      });

      expect(streamRouter.routeStreamEventForSurface).toHaveBeenCalledTimes(1);
      expect(streamRouter.routeStreamEventForSurface).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'text_delta' }),
        surfaceId,
      );
      expect(chatStore.processStreamEvent).not.toHaveBeenCalled();
      expect(streamRouter.routeStreamEvent).not.toHaveBeenCalled();
    });

    it('routes a hide-only claimed chunk (no registered surface adapter) through the tab path', () => {
      const correlationId = VALID_UUID;
      claims.claim(correlationId, SurfaceId.create());

      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: makeChunkPayload(correlationId),
      });

      expect(streamRouter.routeStreamEventForSurface).not.toHaveBeenCalled();
      expect(chatStore.processStreamEvent).toHaveBeenCalledTimes(1);
      expect(streamRouter.routeStreamEvent).toHaveBeenCalledTimes(1);
    });

    it('drops an unclaimed surfaceMode chunk silently', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: makeChunkPayload('tab-1', true),
      });

      expect(streamRouter.routeStreamEventForSurface).not.toHaveBeenCalled();
      expect(chatStore.processStreamEvent).not.toHaveBeenCalled();
      expect(streamRouter.routeStreamEvent).not.toHaveBeenCalled();
    });

    it('routes a normal (unclaimed, non-surfaceMode) chunk through the tab path', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: makeChunkPayload('tab-1'),
      });

      expect(chatStore.processStreamEvent).toHaveBeenCalledTimes(1);
      expect(streamRouter.routeStreamEvent).toHaveBeenCalledTimes(1);
      expect(streamRouter.routeStreamEventForSurface).not.toHaveBeenCalled();
    });

    // TASK_2026_437 C15: a tab replaying resume history in chunks takes a live
    // chunk after its history; the deferred delivery is the whole tab path.
    it('holds a tab-path chunk the replay fence accepts and delivers it through the tab path later', () => {
      let deferred: (() => void) | null = null;
      chatStore.deferLiveStreamEvent.mockImplementation(
        (
          _event: unknown,
          _tabId: unknown,
          _sessionId: unknown,
          deliver: () => void,
        ) => {
          deferred = deliver;
          return true;
        },
      );

      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: makeChunkPayload('tab-1'),
      });

      expect(chatStore.deferLiveStreamEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-1' }),
        'tab-1',
        CHUNK_SESSION,
        expect.any(Function),
      );
      expect(chatStore.processStreamEvent).not.toHaveBeenCalled();
      expect(streamRouter.routeStreamEvent).not.toHaveBeenCalled();

      expect(deferred).not.toBeNull();
      (deferred as unknown as () => void)();
      expect(chatStore.processStreamEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-1' }),
        'tab-1',
        CHUNK_SESSION,
      );
      expect(streamRouter.routeStreamEvent).toHaveBeenCalledTimes(1);
    });

    it('delivers a filtered live event to sibling tabs once without implicit fan-out', () => {
      let deferred: ((excludeTabIds?: ReadonlySet<string>) => void) | undefined;
      tabManager.tabs.mockReturnValue([
        { id: 'tab-1', claudeSessionId: CHUNK_SESSION },
        { id: 'tab-2', claudeSessionId: CHUNK_SESSION },
        { id: 'other', claudeSessionId: 'other-session' },
      ]);
      chatStore.deferLiveStreamEvent.mockImplementation(
        (_event: unknown, _tabId: unknown, _sessionId: unknown,
          deliver: (excludeTabIds?: ReadonlySet<string>) => void) => {
          deferred = deliver;
          return true;
        },
      );
      handler.handleMessage({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: makeChunkPayload('tab-1') });
      deferred?.(new Set(['tab-1']));
      expect(chatStore.processStreamEvent).toHaveBeenCalledTimes(1);
      expect(chatStore.processStreamEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-1' }), 'tab-2', CHUNK_SESSION, { fanOut: false },
      );
      expect(streamRouter.routeStreamEvent).toHaveBeenCalledTimes(1);
    });

    it('skips tab adoption on session:id-resolved for a claimed surface', () => {
      const correlationId = VALID_UUID;
      const surfaceId = SurfaceId.create();
      claims.claim(correlationId, surfaceId);
      registerSurfaceAdapter(surfaceId);

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
        payload: { tabId: correlationId, realSessionId: CHUNK_SESSION },
      });

      expect(chatStore.handleSessionIdResolved).not.toHaveBeenCalled();
      expect(
        streamRouter.refreshQuestionTargetsForSession,
      ).toHaveBeenCalledTimes(1);
    });

    it('adopts the tab on session:id-resolved for a hide-only claim (no surface adapter)', () => {
      const correlationId = VALID_UUID;
      claims.claim(correlationId, SurfaceId.create());

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
        payload: { tabId: correlationId, realSessionId: CHUNK_SESSION },
      });

      expect(chatStore.handleSessionIdResolved).toHaveBeenCalledTimes(1);
      expect(
        streamRouter.refreshQuestionTargetsForSession,
      ).toHaveBeenCalledTimes(1);
      // Nothing to append — the surface has no adapter, so the tab path owns
      // the session.
      expect(streamRouter.onSurfaceCreated).not.toHaveBeenCalled();
    });

    it('hands a claimed-surface turn_state chunk to TurnStateApplier instead of the surface router (TASK_2026_360)', () => {
      const correlationId = VALID_UUID;
      const surfaceId = SurfaceId.create();
      claims.claim(correlationId, surfaceId);
      registerSurfaceAdapter(surfaceId);
      const event = {
        id: 'ts-1',
        eventType: 'turn_state',
        timestamp: 1,
        sessionId: CHUNK_SESSION,
        messageId: `turn-state-${CHUNK_SESSION}`,
        phase: 'idle',
        revision: 3,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'completed',
      };

      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: { tabId: correlationId, sessionId: CHUNK_SESSION, event },
      });

      expect(turnStateApplier.apply).toHaveBeenCalledWith(event);
      expect(streamRouter.routeStreamEventForSurface).not.toHaveBeenCalled();
      expect(chatStore.processStreamEvent).not.toHaveBeenCalled();
    });

    it('marks liveness neither from chunks nor from the turn-end push (TASK_2026_360)', () => {
      const liveness = TestBed.inject(SessionLivenessRegistry);

      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: makeChunkPayload('tab-1'),
      });
      expect(liveness.status(CHUNK_SESSION)()).toBeUndefined();

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_TURN_ENDED,
        payload: {
          sessionId: CHUNK_SESSION,
          cwd: '/ws',
          lastAssistantMessage: null,
          backgroundTasks: [],
          sessionCrons: [],
          terminalReason: 'completed',
          timestamp: 1,
        },
      });
      expect(liveness.status(CHUNK_SESSION)()).toBeUndefined();
      expect(chatStore.handleTurnEndedNotification).toHaveBeenCalledTimes(1);
    });

    it('rekeys the liveness entry from the placeholder tab id to the real session id', () => {
      const liveness = TestBed.inject(SessionLivenessRegistry);
      const tabId = SessionId.create();
      // Chunks stream under the placeholder (the tab id) and light the dot.
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: {
          tabId,
          sessionId: tabId,
          event: { type: 'message_start', sessionId: tabId },
        },
      });
      liveness.markStreaming(tabId, 'D:\\projects\\property-hub');
      expect(liveness.liveWorkspaces().has('D:\\projects\\property-hub')).toBe(
        true,
      );

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
        payload: { tabId, realSessionId: CHUNK_SESSION },
      });

      // The idle turn_state arrives under the REAL id (applied through
      // TurnStateApplier, mocked here — this mark stands in for it) and must
      // clear the same entry.
      liveness.markIdle(CHUNK_SESSION);
      expect(liveness.status(tabId)()).toBe('idle');
      expect(liveness.liveWorkspaces().size).toBe(0);
    });

    // TASK_2026_263 — without this append the surface conversation never
    // contains the real session id, so question routing cannot find the
    // surface and the card never renders.
    it('appends the real session to the claimed surface conversation before refreshing question targets', () => {
      const correlationId = VALID_UUID;
      const surfaceId = SurfaceId.create();
      claims.claim(correlationId, surfaceId);
      registerSurfaceAdapter(surfaceId);

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
        payload: { tabId: correlationId, realSessionId: CHUNK_SESSION },
      });

      expect(streamRouter.onSurfaceCreated).toHaveBeenCalledWith(
        surfaceId,
        CHUNK_SESSION,
      );
      expect(
        streamRouter.onSurfaceCreated.mock.invocationCallOrder[0],
      ).toBeLessThan(
        streamRouter.refreshQuestionTargetsForSession.mock
          .invocationCallOrder[0],
      );
    });
  });

  // ----- TASK_2026_580: board-start capture + organization push ------------

  describe('session organization (TASK_2026_580)', () => {
    it('hands session:id-resolved to the board-task link capture after the store resolves it', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
        payload: { tabId: 'tab-board', realSessionId: 'real-session-1' },
      });

      expect(linkCapture.onSessionIdResolved).toHaveBeenCalledTimes(1);
      expect(linkCapture.onSessionIdResolved).toHaveBeenCalledWith(
        'tab-board',
        'real-session-1',
      );
      expect(
        chatStore.handleSessionIdResolved.mock.invocationCallOrder[0],
      ).toBeLessThan(
        linkCapture.onSessionIdResolved.mock.invocationCallOrder[0],
      );
    });

    it('does not hand a claimed-surface resolve to the link capture', () => {
      const correlationId = VALID_UUID;
      const surfaceId = SurfaceId.create();
      claims.claim(correlationId, surfaceId);
      registerSurfaceAdapter(surfaceId);

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
        payload: { tabId: correlationId, realSessionId: 'real-session-2' },
      });

      expect(linkCapture.onSessionIdResolved).not.toHaveBeenCalled();
    });

    it('handles session:organizationChanged', () => {
      expect(handler.handledMessageTypes).toContain(
        MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
      );
    });

    it('coalesces organization and metadata pushes into one debounced loadSessions', () => {
      jest.useFakeTimers();
      try {
        handler.handleMessage({
          type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
          payload: { sessionIds: ['s-1'] },
        });
        handler.handleMessage({
          type: MESSAGE_TYPES.SESSION_METADATA_CHANGED,
        });
        handler.handleMessage({
          type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
          payload: { sessionIds: ['s-2'] },
        });
        expect(chatStore.loadSessions).not.toHaveBeenCalled();

        jest.advanceTimersByTime(250);

        expect(chatStore.loadSessions).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('hands the pushed session ids to the organizer next to the list refresh (TASK_2026_679)', () => {
      jest.useFakeTimers();
      try {
        handler.handleMessage({
          type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
          payload: {
            workspaceRoot: '/work',
            sessionIds: ['s-1', 's-2'],
            reason: 'user',
          },
        });
        expect(organizer.onOrganizationChanged).toHaveBeenCalledTimes(1);
        expect(organizer.onOrganizationChanged).toHaveBeenCalledWith([
          's-1',
          's-2',
        ]);

        handler.handleMessage({
          type: MESSAGE_TYPES.SESSION_METADATA_CHANGED,
        });
        expect(organizer.onOrganizationChanged).toHaveBeenCalledTimes(1);

        handler.handleMessage({
          type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
          payload: { sessionIds: 'not-a-list' },
        });
        expect(organizer.onOrganizationChanged).toHaveBeenLastCalledWith([]);

        jest.advanceTimersByTime(250);
        expect(chatStore.loadSessions).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('stream snapshots (Phase 2)', () => {
    it('replays an ordered snapshot through the existing stream path once', () => {
      const first = { type: 'assistant_text', text: 'first' };
      const second = { type: 'assistant_text', text: 'second' };

      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
        payload: {
          protocolVersion: 2,
          tabId: 'tab-1',
          fromSequence: 4,
          toSequence: 5,
          events: [first, second],
        },
      });

      expect(chatStore.processStreamEvent).toHaveBeenNthCalledWith(
        1,
        first,
        'tab-1',
        undefined,
      );
      expect(chatStore.processStreamEvent).toHaveBeenNthCalledWith(
        2,
        second,
        'tab-1',
        undefined,
      );
    });

    it('requests the existing resume path for an overflow snapshot', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
        payload: {
          protocolVersion: 2,
          tabId: 'tab-1',
          sessionId: 'session-1',
          fromSequence: 9,
          toSequence: 9,
          resyncRequired: true,
        },
      });

      expect(chatStore.resyncStream).toHaveBeenCalledWith('tab-1', 'session-1');
    });

    it('passes the resync seed and applies only the events kept by the fence', () => {
      const first = { eventType: 'message_start', id: 'start' };
      const second = { eventType: 'text_delta', id: 'delta' };
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
        payload: {
          protocolVersion: 2, tabId: 'tab-1', sessionId: 'session-1',
          fromSequence: 1, toSequence: 1, resyncRequired: true,
          liveSeed: [first, second], liveSeedBlocks: { message: 1 },
        },
      });
      const seed = chatStore.resyncStream.mock.calls[0][2];
      expect(seed.events).toEqual([first, second]);
      expect(seed.liveSeedBlocks).toEqual({ message: 1 });
      seed.apply([second]);
      expect(chatStore.processStreamEvent).toHaveBeenCalledTimes(1);
      expect(chatStore.processStreamEvent).toHaveBeenCalledWith(
        second, 'tab-1', 'session-1', { fanOut: false },
      );
      expect(streamRouter.routeStreamEvent).toHaveBeenCalledTimes(1);
    });

    it('rejects liveSeed on an events snapshot', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
        payload: {
          protocolVersion: 2, tabId: 'tab-1', fromSequence: 1,
          toSequence: 1, events: [], liveSeed: [],
        },
      });
      expect(chatStore.resyncStream).not.toHaveBeenCalled();
      expect(chatStore.processStreamEvent).not.toHaveBeenCalled();
    });

    it('rejects a resync snapshot with a non-array liveSeed', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
        payload: {
          protocolVersion: 2, tabId: 'tab-1', sessionId: 'session-1',
          fromSequence: 1, toSequence: 1, resyncRequired: true,
          liveSeed: { eventType: 'message_start' },
        },
      });
      expect(chatStore.resyncStream).not.toHaveBeenCalled();
    });

    it.each([null, 42, { eventType: 42 }])('rejects a resync snapshot with a malformed seed element %p', (bad) => {
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
        payload: {
          protocolVersion: 2, tabId: 'tab-1', sessionId: 'session-1',
          fromSequence: 1, toSequence: 1, resyncRequired: true,
          liveSeed: [{ eventType: 'message_start' }, bad],
        },
      });
      expect(chatStore.resyncStream).not.toHaveBeenCalled();
    });

    it('ignores malformed liveSeedBlocks while retaining the snapshot', () => {
      handler.handleMessage({
        type: MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
        payload: {
          protocolVersion: 2, tabId: 'tab-1', sessionId: 'session-1',
          fromSequence: 1, toSequence: 1, resyncRequired: true,
          liveSeed: [{ eventType: 'message_start', id: 'start' }],
          liveSeedBlocks: { message: -1 },
        },
      });
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(chatStore.resyncStream.mock.calls[0][2].liveSeedBlocks).toBeUndefined();
    });
  });
});
