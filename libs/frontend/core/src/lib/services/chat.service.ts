import {
  Injectable,
  computed,
  inject,
  DestroyRef,
  signal,
} from '@angular/core';
import { Observable } from 'rxjs';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

// Types
import {
  StrictChatMessage,
  SessionId,
  MessageId,
  ChatSendMessagePayload,
  ChatNewSessionPayload,
  ChatSessionSwitchedPayload,
  ChatSessionCreatedPayload,
  ChatHistoryLoadedPayload,
  InitialDataPayload,
} from '@ptah-extension/shared';
import { MessageProcessingService } from './message-processing.service';
import { ChatValidationService } from './chat-validation.service';
import { ChatStateService } from './chat-state.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { LoggingService } from './logging.service';

// TODO: Migrate StreamHandlingService to chat library
// For now, using simple signal-based streaming state
interface StreamState {
  isStreaming: boolean;
  isConnected: boolean;
  lastMessageTimestamp: number;
}

/**
 * Legacy interface for backward compatibility
 * TODO: Phase out this interface in favor of signal-based state
 */
export interface StreamConsumptionState {
  isConnected: boolean;
  lastMessageTimestamp: number;
  streamErrors: readonly unknown[];
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
 * Chat Service - Main Orchestrator for Chat Functionality
 *
 * ARCHITECTURE EVOLUTION:
 * - BEFORE: 1,111 lines, 55 methods, massive ChatService
 * - AFTER: Clean orchestration layer using specialized services
 *
 * RESPONSIBILITIES:
 * - Orchestrate chat operations (send, receive, stream)
 * - Coordinate between specialized services
 * - Provide public API for chat features
 * - Handle session management coordination
 *
 * DELEGATES TO:
 * - MessageProcessingService: Message transformation & validation (core)
 * - ChatValidationService: Message & data validation (core)
 * - ChatStateService: Centralized state management (core)
 * - VSCodeService: Backend communication (core)
 *
 * MODERNIZATIONS APPLIED:
 * - inject() pattern instead of constructor injection
 * - DestroyRef with takeUntilDestroyed() for cleanup
 * - Pure signal-based state (delegates to ChatStateService)
 * - Computed signals for derived state
 * - Type-safe message handling
 * - Zero any types - strict typing throughout
 *
 * NOTE: StreamHandlingService will be migrated in next phase
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  // Core service dependencies
  private readonly messageProcessor = inject(MessageProcessingService);
  private readonly validator = inject(ChatValidationService);
  private readonly chatState = inject(ChatStateService);
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly destroyRef = inject(DestroyRef);

  // Temporary streaming state (until StreamHandlingService migration)
  private readonly _streamState = signal<StreamState>({
    isStreaming: false,
    isConnected: true, // Default to true - backend connection is established when webview loads
    lastMessageTimestamp: 0,
  });

  // Public signal-based API - delegates to ChatStateService
  readonly messages = this.chatState.messages;
  readonly claudeMessages = this.chatState.claudeMessages;
  readonly currentSession = this.chatState.currentSession;
  readonly isStreaming = computed(() => this._streamState().isStreaming);

  // Computed properties
  readonly hasMessages = this.chatState.hasMessages;
  readonly messageCount = this.chatState.messageCount;

  /**
   * Legacy stream consumption state for backward compatibility
   * TODO: Phase out in favor of signal-based streamHandler.streamState()
   */
  readonly streamConsumptionState = computed((): StreamConsumptionState => {
    const streamState = this._streamState();
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
   *
   * @param content - Message content to send
   * @param agent - Agent type (general, code, architect, researcher)
   * @throws Error if no active session or content is empty
   */
  async sendMessage(content: string, agent = 'general'): Promise<void> {
    const currentSession = this.currentSession();
    if (!currentSession) {
      throw new Error('No active session available');
    }

    // Validate and sanitize message content
    const sanitizedContent = this.validator.sanitizeMessageContent(content);
    if (!sanitizedContent.trim()) {
      throw new Error('Message content cannot be empty');
    }

    // Create message payload (ChatSendMessagePayload doesn't have sessionId)
    const messagePayload: ChatSendMessagePayload = {
      content: sanitizedContent,
      files: [],
    };

    // Add user message to state immediately for optimistic UI update
    const userMessage: StrictChatMessage = {
      id: crypto.randomUUID() as MessageId,
      sessionId: currentSession.id,
      type: 'user',
      content: sanitizedContent,
      timestamp: Date.now(),
      streaming: false,
      metadata: { agent },
    };

    this.chatState.addMessage(userMessage);

    // Send to backend
    try {
      this.vscode.postStrictMessage('chat:sendMessage', messagePayload);
    } catch (error) {
      this.logger.error(
        'Failed to send message to backend',
        'ChatService',
        error
      );
      // Remove user message on failure (rollback optimistic update)
      this.chatState.removeMessage(userMessage.id);
      throw error;
    }
  }

  /**
   * Switch to a different session
   *
   * @param sessionId - The session ID to switch to
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
      this.logger.error('Failed to switch session', 'ChatService', error);
      throw error;
    } finally {
      this.appState.setLoading(false);
    }
  }

  /**
   * Create a new session
   *
   * @param name - Optional session name
   */
  async createNewSession(name?: string): Promise<void> {
    try {
      this.appState.setLoading(true);

      const sessionName = name || `Session ${Date.now()}`;
      const payload: ChatNewSessionPayload = {
        name: sessionName,
      };
      this.vscode.postStrictMessage('chat:newSession', payload);
    } catch (error) {
      this.logger.error('Failed to create new session', 'ChatService', error);
      throw error;
    } finally {
      this.appState.setLoading(false);
    }
  }

  /**
   * Stop current streaming
   */
  stopStreaming(): void {
    this._streamState.update((state) => ({ ...state, isStreaming: false }));
    // TODO: Send stop signal to backend when StreamHandlingService is migrated
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
   *
   * @param sessionId - The session ID to get history for
   * @returns Observable of messages
   */
  getMessageHistory(
    sessionId: SessionId
  ): Observable<readonly StrictChatMessage[]> {
    // Request history from backend
    this.vscode.postStrictMessage('chat:getHistory', { sessionId });
    return toObservable(this.messages);
  }

  // Private initialization methods

  /**
   * Initialize message handling subscriptions
   */
  private initializeMessageHandling(): void {
    // TODO: Subscribe to StreamHandlingService.messageStream$ when migrated
    // For now, handle direct message chunks
    this.vscode
      .onMessageType('chat:messageChunk')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        this._streamState.update((state) => ({
          ...state,
          isStreaming: !payload.isComplete,
          lastMessageTimestamp: Date.now(),
        }));

        // Process message chunk
        // TODO: Use StreamHandlingService processing when migrated
      });

    // Handle session switch response (backend sends :response, not event notifications)
    this.vscode
      .onMessageType('chat:switchSession:response')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        // Mark as connected when we receive responses
        this._streamState.update((state) => ({ ...state, isConnected: true }));

        // Extract session from MessageResponse wrapper
        if (response.success && response.data) {
          const result = response.data as { session?: unknown };
          const sessionData = result.session;
          if (
            sessionData &&
            this.validator.validateSession(sessionData).isValid
          ) {
            // Type guard passed, safe to cast
            this.chatState.setCurrentSession(sessionData as never);
            this.logger.info('Session switched successfully', 'ChatService');
          }
        } else if (response.error) {
          this.logger.error(
            'Failed to switch session',
            'ChatService',
            response.error
          );
        }
      });

    // Handle new session response (backend sends :response, not event notifications)
    this.vscode
      .onMessageType('chat:newSession:response')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        // Extract session from MessageResponse wrapper
        if (response.success && response.data) {
          const result = response.data as { session?: unknown };
          const sessionData = result.session;
          if (
            sessionData &&
            this.validator.validateSession(sessionData).isValid
          ) {
            // Type guard passed, safe to cast
            this.chatState.setCurrentSession(sessionData as never);
            this.logger.info('New session created successfully', 'ChatService');
          }
        } else if (response.error) {
          this.logger.error(
            'Failed to create session',
            'ChatService',
            response.error
          );
        }
      });

    // Handle get history response (backend sends :response, not event notifications)
    this.vscode
      .onMessageType('chat:getHistory:response')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        if (response.success && response.data) {
          const result = response.data as { messages?: unknown[] };
          const messages = result.messages;
          if (Array.isArray(messages)) {
            const validMessages = messages.filter(
              (msg) => this.validator.validateStrictMessage(msg).isValid
            ) as never[]; // Type guard passed, safe to cast
            this.chatState.setMessages(validMessages);
            this.logger.info('History loaded successfully', 'ChatService');

            // CRITICAL FIX: Transform StrictChatMessage[] to ProcessedClaudeMessage[] for UI display
            // Same fix as initialData handler - UI displays claudeMessages(), not messages()
            const processedMessages = validMessages.map((msg) =>
              this.messageProcessor.convertToProcessedMessage(msg)
            );
            this.chatState.setClaudeMessages(processedMessages);
            this.logger.info(
              `Transformed ${processedMessages.length} history messages to ProcessedClaudeMessage for UI`,
              'ChatService'
            );
          }
        } else if (response.error) {
          this.logger.error(
            'Failed to load history',
            'ChatService',
            response.error
          );
        }
      });

    // Handle initial data
    this.vscode
      .onMessageType('initialData')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload: InitialDataPayload) => {
        // Mark as connected when we receive initial data
        this._streamState.update((state) => ({ ...state, isConnected: true }));

        // Backend sends payload.data.sessions and payload.data.currentSession
        // (see AngularWebviewProvider.sendInitialData line 101-144)
        if (payload.success && payload.data) {
          // Set current session if provided
          if (payload.data.currentSession) {
            this.chatState.setCurrentSession(payload.data.currentSession);
            this.logger.info(
              'Current session loaded from initial data',
              'ChatService'
            );
          }

          // Load messages for current session if available
          if (payload.data.currentSession?.messages) {
            const validMessages = payload.data.currentSession.messages.filter(
              (msg) => this.validator.validateStrictMessage(msg).isValid
            );
            this.chatState.setMessages(validMessages);
            this.logger.info(
              `Loaded ${validMessages.length} messages from initial data`,
              'ChatService'
            );

            // CRITICAL FIX: Transform StrictChatMessage[] to ProcessedClaudeMessage[] for UI display
            // The UI displays claudeMessages(), not messages(), so we must populate both collections
            const processedMessages = validMessages.map((msg) =>
              this.messageProcessor.convertToProcessedMessage(msg)
            );
            this.chatState.setClaudeMessages(processedMessages);
            this.logger.info(
              `Transformed ${processedMessages.length} messages to ProcessedClaudeMessage for UI`,
              'ChatService'
            );
          }
        }
      });
  }
}
