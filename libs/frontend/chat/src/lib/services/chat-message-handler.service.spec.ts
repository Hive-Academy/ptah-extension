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
  StreamRouter,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  SessionLivenessRegistry,
  SurfaceId,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { ChatMessageHandler } from './chat-message-handler.service';
import { ChatStore } from './chat.store';

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
    handleSessionIdResolved: jest.Mock;
  };
  let streamRouter: {
    routePermissionPrompt: jest.Mock;
    routeQuestionPrompt: jest.Mock;
    refreshQuestionTargetsForSession: jest.Mock;
    routeStreamEvent: jest.Mock;
    routeStreamEventForSurface: jest.Mock;
  };
  let tabManager: {
    tabs: jest.Mock;
    resetTabToFresh: jest.Mock;
    findTabBySessionIdAcrossWorkspaces: jest.Mock;
  };
  let claims: WorkflowSessionClaimService;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    chatStore = {
      handlePermissionRequest: jest.fn(),
      handleQuestionRequest: jest.fn(),
      handleTurnEndedNotification: jest.fn(),
      handleTurnFailedNotification: jest.fn(),
      handleSubagentEndedNotification: jest.fn(),
      processStreamEvent: jest.fn(),
      handleSessionIdResolved: jest.fn(),
    };
    streamRouter = {
      routePermissionPrompt: jest.fn(),
      routeQuestionPrompt: jest.fn(),
      refreshQuestionTargetsForSession: jest.fn(),
      routeStreamEvent: jest.fn(),
      routeStreamEventForSurface: jest.fn(),
    };
    tabManager = {
      tabs: jest.fn(() => [{ id: 'tab-1' }]),
      resetTabToFresh: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
    };

    TestBed.configureTestingModule({
      providers: [
        ChatMessageHandler,
        { provide: ChatStore, useValue: chatStore },
        { provide: StreamRouter, useValue: streamRouter },
        {
          provide: AgentMonitorStore,
          useValue: { resolveParentSessionId: jest.fn() },
        },
        { provide: TabManagerService, useValue: tabManager },
      ],
    });

    handler = TestBed.inject(ChatMessageHandler);
    claims = TestBed.inject(WorkflowSessionClaimService);
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

    it('skips tab adoption on session:id-resolved for a claimed correlation', () => {
      const correlationId = VALID_UUID;
      claims.claim(correlationId, SurfaceId.create());

      handler.handleMessage({
        type: MESSAGE_TYPES.SESSION_ID_RESOLVED,
        payload: { tabId: correlationId, realSessionId: CHUNK_SESSION },
      });

      expect(chatStore.handleSessionIdResolved).not.toHaveBeenCalled();
      expect(
        streamRouter.refreshQuestionTargetsForSession,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
