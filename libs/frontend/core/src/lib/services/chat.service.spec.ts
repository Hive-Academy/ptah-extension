import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatService } from './chat.service';
import { MessageProcessingService } from './message-processing.service';
import { ChatValidationService } from './chat-validation.service';
import { ChatStateService } from './chat-state.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { LoggingService } from './logging.service';
import {
  StrictChatMessage,
  MessageId,
  SessionId,
} from '@ptah-extension/shared';
import { of } from 'rxjs';

describe('ChatService - Message Consolidation (TASK_2025_014)', () => {
  let service: ChatService;
  let mockChatState: {
    messages: ReturnType<typeof signal<readonly StrictChatMessage[]>>;
    claudeMessages: ReturnType<typeof signal<any[]>>;
    currentSession: ReturnType<typeof signal<any>>;
    setMessages: jest.Mock;
    setClaudeMessages: jest.Mock;
    clearMessages: jest.Mock;
    clearClaudeMessages: jest.Mock;
    addMessage: jest.Mock;
    removeMessage: jest.Mock;
    setCurrentSession: jest.Mock;
    hasMessages: jest.Mock;
    messageCount: jest.Mock;
  };
  let mockMessageProcessor: { convertToProcessedMessage: jest.Mock };
  let mockValidator: {
    validateChatMessage: jest.Mock;
    validateSession: jest.Mock;
    sanitizeMessageContent: jest.Mock;
  };
  let mockVscode: { postStrictMessage: jest.Mock; onMessageType: jest.Mock };
  let mockAppState: { setLoading: jest.Mock; handleError: jest.Mock };
  let mockLogger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(() => {
    // Create mock services
    mockChatState = {
      messages: signal<readonly StrictChatMessage[]>([]),
      claudeMessages: signal([]),
      currentSession: signal(null),
      setMessages: jest.fn(),
      setClaudeMessages: jest.fn(),
      clearMessages: jest.fn(),
      clearClaudeMessages: jest.fn(),
      addMessage: jest.fn(),
      removeMessage: jest.fn(),
      setCurrentSession: jest.fn(),
      hasMessages: jest.fn(),
      messageCount: jest.fn(),
    };

    mockMessageProcessor = {
      convertToProcessedMessage: jest.fn().mockReturnValue({
        id: 'msg-1' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'user',
        content: [{ type: 'text', text: 'Test message' }],
        timestamp: Date.now(),
        isComplete: true,
        isStreaming: false,
      }),
    };

    mockValidator = {
      validateChatMessage: jest
        .fn()
        .mockReturnValue({ isValid: true, errors: [], warnings: [] }),
      validateSession: jest
        .fn()
        .mockReturnValue({ isValid: true, errors: [], warnings: [] }),
      sanitizeMessageContent: jest
        .fn()
        .mockImplementation((content: string) => content),
    };

    mockVscode = {
      postStrictMessage: jest.fn(),
      onMessageType: jest.fn().mockReturnValue(of({})),
    };

    mockAppState = {
      setLoading: jest.fn(),
      handleError: jest.fn(),
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ChatService,
        { provide: MessageProcessingService, useValue: mockMessageProcessor },
        { provide: ChatValidationService, useValue: mockValidator },
        { provide: ChatStateService, useValue: mockChatState },
        { provide: VSCodeService, useValue: mockVscode },
        { provide: AppStateManager, useValue: mockAppState },
        { provide: LoggingService, useValue: mockLogger },
      ],
    });

    service = TestBed.inject(ChatService);
  });

  describe('updateMessages() - Consolidated Entry Point', () => {
    it('should deduplicate messages by MessageId', () => {
      // Arrange
      const existingMessage: StrictChatMessage = {
        id: 'msg-1' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'user',
        contentBlocks: [{ type: 'text', text: 'Original' }],
        timestamp: 1000,
        streaming: false,
      };

      const duplicateMessage: StrictChatMessage = {
        id: 'msg-1' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'user',
        contentBlocks: [{ type: 'text', text: 'Updated' }],
        timestamp: 2000,
        streaming: false,
      };

      mockChatState.messages = signal<readonly StrictChatMessage[]>([
        existingMessage,
      ]);
      mockChatState.claudeMessages = signal([]);

      // Act - call private method via type assertion
      (service as any).updateMessages([duplicateMessage], 'TEST');

      // Assert
      expect(mockChatState.setMessages).toHaveBeenCalledTimes(1);
      expect(mockChatState.setClaudeMessages).toHaveBeenCalledTimes(1);

      // Verify only one message in final state (deduplicated)
      const messagesArg = mockChatState.setMessages.mock.calls[0][0];
      expect(messagesArg.length).toBe(1);
      expect(messagesArg[0].id).toBe('msg-1' as MessageId);
      expect((messagesArg[0].contentBlocks[0] as any).text).toBe('Updated'); // Newer data wins
    });

    it('should sort messages by timestamp', () => {
      // Arrange
      const message1: StrictChatMessage = {
        id: 'msg-1' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'user',
        contentBlocks: [{ type: 'text', text: 'Later' }],
        timestamp: 2000,
        streaming: false,
      };

      const message2: StrictChatMessage = {
        id: 'msg-2' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Earlier' }],
        timestamp: 1000,
        streaming: false,
      };

      mockChatState.messages = signal<readonly StrictChatMessage[]>([]);
      mockChatState.claudeMessages = signal([]);

      // Act - add messages out of order
      (service as any).updateMessages([message1, message2], 'TEST');

      // Assert
      const messagesArg = mockChatState.setMessages.mock.calls[0][0];
      expect(messagesArg.length).toBe(2);
      expect(messagesArg[0].timestamp).toBe(1000); // Earlier first
      expect(messagesArg[1].timestamp).toBe(2000); // Later second
    });

    it('should transform messages to ProcessedClaudeMessage format', () => {
      // Arrange
      const message: StrictChatMessage = {
        id: 'msg-1' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'user',
        contentBlocks: [{ type: 'text', text: 'Test' }],
        timestamp: 1000,
        streaming: false,
      };

      mockChatState.messages = signal<readonly StrictChatMessage[]>([]);
      mockChatState.claudeMessages = signal([]);

      // Act
      (service as any).updateMessages([message], 'TEST');

      // Assert
      expect(
        mockMessageProcessor.convertToProcessedMessage
      ).toHaveBeenCalledWith(message);
      expect(mockChatState.setClaudeMessages).toHaveBeenCalledTimes(1);
    });

    it('should log deduplication statistics', () => {
      // Arrange
      const message: StrictChatMessage = {
        id: 'msg-1' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'user',
        contentBlocks: [{ type: 'text', text: 'Test' }],
        timestamp: 1000,
        streaming: false,
      };

      mockChatState.messages = signal<readonly StrictChatMessage[]>([]);
      mockChatState.claudeMessages = signal([]);

      // Act
      (service as any).updateMessages([message], 'GET_HISTORY');

      // Assert
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Messages updated from GET_HISTORY',
        'ChatService',
        expect.objectContaining({
          incomingCount: 1,
          deduplicatedCount: expect.any(Number),
          processedCount: expect.any(Number),
        })
      );
    });
  });

  describe('Consolidated State Updates', () => {
    it('should call setMessages and setClaudeMessages only once per updateMessages()', () => {
      // Arrange
      const message: StrictChatMessage = {
        id: 'msg-1' as MessageId,
        sessionId: 'session-1' as SessionId,
        type: 'user',
        contentBlocks: [{ type: 'text', text: 'Test' }],
        timestamp: 1000,
        streaming: false,
      };

      mockChatState.messages = signal<readonly StrictChatMessage[]>([]);
      mockChatState.claudeMessages = signal([]);

      // Act
      (service as any).updateMessages([message], 'MESSAGE_ADDED');

      // Assert - CRITICAL: Only 1 call each (not 3x like before)
      expect(mockChatState.setMessages).toHaveBeenCalledTimes(1);
      expect(mockChatState.setClaudeMessages).toHaveBeenCalledTimes(1);
    });
  });
});
