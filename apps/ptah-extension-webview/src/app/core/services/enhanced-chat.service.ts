import { Injectable, computed, inject, OnDestroy } from '@angular/core';
import { Observable, Subject, takeUntil } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

// Types
import {
  StrictChatSession,
  StrictChatMessage,
  ProcessedClaudeMessage,
  SessionId,
  MessageId,
  ChatSendMessagePayload,
} from '@ptah-extension/shared';

// Specialized Services
import { MessageProcessingService } from './chat/message-processing.service';
import { StreamHandlingService } from './chat/stream-handling.service';
import { ChatValidationService } from './chat/validation.service';
import { ChatStateService } from './chat/state.service';

// Core Services
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { LoggingService } from './logging.service';

// Legacy interface for backward compatibility
export interface StreamConsumptionState {
  isConnected: boolean;
  lastMessageTimestamp: number;
  streamErrors: readonly any[];
  performanceMetrics: {
    messageLatencyHistory: readonly number[];
    lastMessageStartTime: number;
    lastMessageEndTime: number;
    totalMessagesProcessed: number;
    totalBytesProcessed: number;
    streamingStartTimes: ReadonlyMap<MessageId, number>;
  };
}

/**
 * Enhanced Chat Service - Refactored with Single Responsibility Services
 *
 * BEFORE: 1,111 lines, 55 methods, massive complexity
 * AFTER: Orchestration layer using specialized services
 *
 * Architecture:
 * - MessageProcessingService: Message transformation & validation
 * - StreamHandlingService: Real-time streaming & connections
 * - ChatValidationService: Message & data validation
 * - ChatStateService: Centralized state management
 * - This service: Orchestration & public API
 *
 * Benefits:
 * - Single responsibility principle compliance
 * - Easier testing and maintenance
 * - Clear separation of concerns
 * - Reusable specialized services
 */
@Injectable({ providedIn: 'root' })
export class EnhancedChatService implements OnDestroy {
  // Specialized services
  private readonly messageProcessor = inject(MessageProcessingService);
  private readonly streamHandler = inject(StreamHandlingService);
  private readonly validator = inject(ChatValidationService);
  private readonly chatState = inject(ChatStateService);

  // Core services
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);

  private readonly destroy$ = new Subject<void>();

  // Public API - delegates to specialized services
  readonly messages = this.chatState.messages;
  readonly claudeMessages = this.chatState.claudeMessages;
  readonly currentSession = this.chatState.currentSession;
  readonly isStreaming = this.streamHandler.isStreaming;

  // Computed properties
  readonly hasMessages = this.chatState.hasMessages;
  readonly messageCount = this.chatState.messageCount;

  // Legacy compatibility - simplified implementation
  readonly streamConsumptionState = computed((): StreamConsumptionState => {
    const streamState = this.streamHandler.streamState();
    return {
      isConnected: streamState.isConnected,
      lastMessageTimestamp: streamState.lastMessageTimestamp,
      streamErrors: [], // Simplified for now
      performanceMetrics: {
        messageLatencyHistory: [],
        lastMessageStartTime: 0,
        lastMessageEndTime: 0,
        totalMessagesProcessed: this.messageCount().total,
        totalBytesProcessed: 0,
        streamingStartTimes: new Map(),
      },
    };
  });

  constructor() {
    this.initializeMessageHandling();
  }

  /**
   * Send a message to Claude
   */
  async sendMessage(content: string, agent: string = 'general'): Promise<void> {
    const currentSession = this.currentSession();
    if (!currentSession) {
      throw new Error('No active session available');
    }

    // Validate message content
    const sanitizedContent = this.validator.sanitizeMessageContent(content);
    if (!sanitizedContent.trim()) {
      throw new Error('Message content cannot be empty');
    }

    // Create message payload
    const messagePayload: ChatSendMessagePayload = {
      content: sanitizedContent,
      sessionId: currentSession.id,
      agent,
      timestamp: Date.now(),
    };

    // Add user message to state immediately
    const userMessage: StrictChatMessage = {
      id: crypto.randomUUID() as MessageId,
      type: 'user',
      content: sanitizedContent,
      timestamp: Date.now(),
      streaming: false,
      agent,
    };

    this.chatState.addMessage(userMessage);

    // Send to backend
    try {
      this.vscode.postStrictMessage('chat:sendMessage', messagePayload);
    } catch (error) {
      this.logger.error('Failed to send message to backend', 'EnhancedChatService', error);
      // Remove user message on failure
      this.chatState.removeMessage(userMessage.id);
      throw error;
    }
  }

  /**
   * Switch to a different session
   */
  async switchToSession(sessionId: SessionId): Promise<void> {
    try {
      this.appState.setLoading(true);

      // Clear current messages
      this.chatState.clearMessages();
      this.chatState.clearClaudeMessages();

      // Request session switch
      this.vscode.postStrictMessage('chat:switchSession', { sessionId });
    } catch (error) {
      this.logger.error('Failed to switch session', 'EnhancedChatService', error);
      throw error;
    } finally {
      this.appState.setLoading(false);
    }
  }

  /**
   * Create a new session
   */
  async createNewSession(name?: string): Promise<void> {
    try {
      this.appState.setLoading(true);

      const sessionName = name || `Session ${Date.now()}`;
      this.vscode.postStrictMessage('chat:createSession', { name: sessionName });
    } catch (error) {
      this.logger.error('Failed to create new session', 'EnhancedChatService', error);
      throw error;
    } finally {
      this.appState.setLoading(false);
    }
  }

  /**
   * Stop current streaming
   */
  stopStreaming(): void {
    this.streamHandler.stopStreaming();
  }

  /**
   * Clear all messages in current session
   */
  clearMessages(): void {
    this.chatState.clearMessages();
    this.chatState.clearClaudeMessages();
  }

  /**
   * Get message history for session
   */
  getMessageHistory(sessionId: SessionId): Observable<StrictChatMessage[]> {
    // Request history from backend
    this.vscode.postStrictMessage('chat:getHistory', { sessionId });
    return toObservable(this.messages);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.streamHandler.destroy();
  }

  // Private methods
  private initializeMessageHandling(): void {
    // Subscribe to processed messages from stream handler
    this.streamHandler.messageStream$.pipe(takeUntil(this.destroy$)).subscribe((claudeMessage) => {
      // Add to Claude messages
      this.chatState.addClaudeMessage(claudeMessage);

      // Convert and add to regular messages for compatibility
      const strictMessage = this.messageProcessor.convertToStrictChatMessage(claudeMessage);
      this.chatState.addMessage(strictMessage);
    });

    // Handle session updates
    this.vscode
      .onMessageType('chat:sessionSwitched')
      .pipe(takeUntil(this.destroy$))
      .subscribe((response) => {
        const session = response.data?.session;
        if (session && this.validator.validateSession(session).isValid) {
          this.chatState.setCurrentSession(session);
        }
      });

    // Handle session creation
    this.vscode
      .onMessageType('chat:sessionCreated')
      .pipe(takeUntil(this.destroy$))
      .subscribe((response) => {
        const session = response.data?.session;
        if (session && this.validator.validateSession(session).isValid) {
          this.chatState.setCurrentSession(session);
        }
      });

    // Handle history loading
    this.vscode
      .onMessageType('chat:historyLoaded')
      .pipe(takeUntil(this.destroy$))
      .subscribe((response) => {
        const messages = response.data?.messages;
        if (Array.isArray(messages)) {
          const validMessages = messages.filter(
            (msg) => this.validator.validateStrictMessage(msg).isValid,
          );
          this.chatState.setMessages(validMessages);
        }
      });

    // Handle initial data
    this.vscode
      .onMessageType('initialData')
      .pipe(takeUntil(this.destroy$))
      .subscribe((response) => {
        const data = response.data;
        if (data?.currentSession) {
          this.chatState.setCurrentSession(data.currentSession);
        }
        if (data?.messages) {
          this.chatState.setMessages(data.messages);
        }
      });
  }
}
