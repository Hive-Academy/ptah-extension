/**
 * ChatMessageHandler specs.
 *
 * Validates the Zod safeParse guards added at the frontend receive point.
 * A malformed PermissionRequest or AskUserQuestionRequest payload MUST be
 * logged and dropped (early-return) without crashing the message-handler
 * loop and without invoking downstream services (ChatStore, StreamRouter).
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { StreamRouter } from '@ptah-extension/chat-routing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatMessageHandler } from './chat-message-handler.service';
import { ChatStore } from './chat.store';
import { MessageSenderService } from './message-sender.service';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

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
  };
  let streamRouter: {
    routePermissionPrompt: jest.Mock;
    routeQuestionPrompt: jest.Mock;
    refreshQuestionTargetsForSession: jest.Mock;
    routeStreamEvent: jest.Mock;
  };
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    chatStore = {
      handlePermissionRequest: jest.fn(),
      handleQuestionRequest: jest.fn(),
    };
    streamRouter = {
      routePermissionPrompt: jest.fn(),
      routeQuestionPrompt: jest.fn(),
      refreshQuestionTargetsForSession: jest.fn(),
      routeStreamEvent: jest.fn(),
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
        { provide: TabManagerService, useValue: {} },
        { provide: MessageSenderService, useValue: {} },
      ],
    });

    handler = TestBed.inject(ChatMessageHandler);
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
});
