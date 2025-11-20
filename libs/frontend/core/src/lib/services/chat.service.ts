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
  InitialDataPayload,
  CHAT_MESSAGE_TYPES,
  SYSTEM_MESSAGE_TYPES,
  toResponseType,
  ClaudeAgentStartEvent,
  ClaudeAgentActivityEvent,
  ChatThinkingPayload,
  ChatToolStartPayload,
  ChatToolProgressPayload,
  ChatToolResultPayload,
  ChatToolErrorPayload,
  ChatPermissionRequestPayload,
  ChatPermissionResponsePayload,
  ChatSessionInitPayload,
  ChatHealthUpdatePayload,
  ChatCliErrorPayload,
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

interface ToolExecution {
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  output?: unknown;
  error?: string;
  progress?: string;
  duration?: number;
}

interface PendingPermission {
  requestId: string;
  type: string;
  details: Record<string, unknown>;
  timestamp: number;
}

/**
 * Agent Tree Node - Represents a subagent in the agent execution tree
 *
 * FORWARD COMPATIBILITY (IMPLEMENTATION_PLAN Integration):
 * - cost/tokens: Future integration with Phase 4 (Cost Tracking)
 * - mcpTools: Future integration with Phase 3 (MCP Server Status)
 * - isCustomAgent: Future integration with Phase 1.3 (SessionCapabilities)
 */
export interface AgentTreeNode {
  readonly agent: ClaudeAgentStartEvent;
  readonly activities: readonly ClaudeAgentActivityEvent[];
  readonly status: 'running' | 'complete' | 'error';
  readonly duration?: number;
  readonly errorMessage?: string;

  // Forward-compatible fields for IMPLEMENTATION_PLAN integration
  readonly cost?: number; // Future: from result messages (IMPL Phase 4)
  readonly tokens?: {
    // Future: token tracking (IMPL Phase 4)
    input: number;
    output: number;
  };
  readonly mcpTools?: string[]; // Future: MCP tool correlation (IMPL Phase 3)
  readonly isCustomAgent?: boolean; // Future: from SessionCapabilities (IMPL Phase 1.3)
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

  // Deduplication sets (TASK_2025_008 - Bug 1)
  private readonly processedMessageIds = new Set<string>();
  private readonly processedChunkIds = new Set<string>();

  // Temporary streaming state (until StreamHandlingService migration)
  private readonly _streamState = signal<StreamState>({
    isStreaming: false,
    isConnected: true, // Default to true - backend connection is established when webview loads
    lastMessageTimestamp: 0,
  });

  // Agent state signals (TASK_2025_004)
  private readonly _agents = signal<readonly AgentTreeNode[]>([]);
  readonly agents = this._agents.asReadonly();

  private readonly _agentActivities = signal<
    ReadonlyMap<string, readonly ClaudeAgentActivityEvent[]>
  >(new Map());
  readonly agentActivities = this._agentActivities.asReadonly();

  // Event relay state signals (TASK_2025_006 - Batch 3)
  // Thinking display state
  private readonly _currentThinking = signal<{
    content: string;
    timestamp: number;
  } | null>(null);
  public readonly currentThinking = this._currentThinking.asReadonly();

  // Tool execution state
  private readonly _toolExecutions = signal<ToolExecution[]>([]);
  public readonly toolExecutions = this._toolExecutions.asReadonly();

  // Permission request state
  private readonly _pendingPermissions = signal<PendingPermission[]>([]);
  public readonly pendingPermissions = this._pendingPermissions.asReadonly();

  // Agent computed signals
  readonly activeAgents = computed(() =>
    this.agents().filter((node) => node.status === 'running')
  );

  readonly agentCount = computed(() => ({
    total: this.agents().length,
    active: this.activeAgents().length,
    complete: this.agents().filter((n) => n.status === 'complete').length,
  }));

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
      contentBlocks: [{ type: 'text', text: sanitizedContent }],
      timestamp: Date.now(),
      streaming: false,
      metadata: { agent },
    };

    this.chatState.addMessage(userMessage);

    // Send to backend
    try {
      this.vscode.postStrictMessage(
        CHAT_MESSAGE_TYPES.SEND_MESSAGE,
        messagePayload
      );
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
      this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.SWITCH_SESSION, {
        sessionId,
      });
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
      this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.NEW_SESSION, payload);
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
    // Update frontend state immediately for responsive UX
    this._streamState.update((state) => ({ ...state, isStreaming: false }));

    // Send stop signal to backend to kill CLI process
    const currentSession = this.currentSession();
    const messages = this.messages();
    const lastMessage =
      messages.length > 0 ? messages[messages.length - 1] : null;

    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.STOP_STREAM, {
      sessionId: currentSession?.id ?? null,
      messageId: lastMessage?.id ?? null,
      timestamp: Date.now(),
    });
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
    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.GET_HISTORY, {
      sessionId,
    });
    return toObservable(this.messages);
  }

  /**
   * Approve a permission request (TASK_2025_006 - Batch 4)
   *
   * @param requestId - The permission request ID to approve
   */
  approvePermission(requestId: string): void {
    this.logger.info('[ChatService] Approving permission:', requestId);
    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE, {
      requestId,
      response: 'allow',
      timestamp: Date.now(),
    } as ChatPermissionResponsePayload);
  }

  /**
   * Deny a permission request (TASK_2025_006 - Batch 4)
   *
   * @param requestId - The permission request ID to deny
   */
  denyPermission(requestId: string): void {
    this.logger.info('[ChatService] Denying permission:', requestId);
    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE, {
      requestId,
      response: 'deny',
      timestamp: Date.now(),
    } as ChatPermissionResponsePayload);
  }

  // Private initialization methods

  /**
   * Initialize message handling subscriptions
   */
  private initializeMessageHandling(): void {
    // FIX: Subscribe to chat:sendMessage:response (CRITICAL - was missing!)
    this.vscode
      .onMessageType(
        'chat:sendMessage:response' as keyof import('@ptah-extension/shared').MessagePayloadMap
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response: unknown) => {
        const typedResponse = response as {
          success: boolean;
          data?: unknown;
          error?: { code: string; message: string };
        };

        if (typedResponse.success) {
          this.logger.debug('Message sent successfully', 'ChatService');
          // Message will appear via chat:messageAdded event
        } else {
          const errorMsg =
            typedResponse.error?.message || 'Unknown error sending message';
          this.logger.error(`Message send failed: ${errorMsg}`, 'ChatService');

          // Show error to user
          this.appState.handleError(`Failed to send message: ${errorMsg}`);
        }
      });

    // TODO: Subscribe to StreamHandlingService.messageStream$ when migrated
    // For now, handle direct message chunks
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        // Validate payload has required fields
        if (!payload.messageId || !payload.sessionId) {
          this.logger.error(
            'Invalid MESSAGE_CHUNK payload: missing messageId or sessionId',
            'ChatService',
            { payload }
          );
          return;
        }

        // Safe destructuring with defaults
        const {
          messageId,
          contentBlocks = [],
          sessionId,
          isComplete = false,
        } = payload;

        // Deduplicate chunks (TASK_2025_008 - Bug 1)
        const chunkContent = JSON.stringify(contentBlocks);
        const chunkId = `${messageId}-${chunkContent}`;
        if (this.processedChunkIds.has(chunkId)) {
          this.logger.warn('Duplicate chunk detected:', 'ChatService', {
            chunkId,
          });
          return;
        }
        this.processedChunkIds.add(chunkId);

        // Update streaming state
        this._streamState.update((state) => ({
          ...state,
          isStreaming: !isComplete,
          lastMessageTimestamp: Date.now(),
        }));

        // Update the message in our state
        const currentMessages = this.chatState.messages();
        const messageIndex = currentMessages.findIndex(
          (m) => m.id === messageId
        );

        if (messageIndex >= 0) {
          // Update existing message by appending content
          const existingMessage = currentMessages[messageIndex];
          const updatedMessage: StrictChatMessage = {
            ...existingMessage,
            contentBlocks: [...existingMessage.contentBlocks, ...contentBlocks],
            streaming: !isComplete,
            timestamp: Date.now(),
          };

          const newMessages = [...currentMessages];
          newMessages[messageIndex] = updatedMessage;
          this.chatState.setMessages(newMessages);

          // Update claudeMessages for UI display
          const processedMessage =
            this.messageProcessor.convertToProcessedMessage(updatedMessage);
          const currentClaudeMessages = this.chatState.claudeMessages();
          const claudeIndex = currentClaudeMessages.findIndex(
            (m) => m.id === messageId
          );

          if (claudeIndex >= 0) {
            const newClaudeMessages = [...currentClaudeMessages];
            newClaudeMessages[claudeIndex] = processedMessage;
            this.chatState.setClaudeMessages(newClaudeMessages);
          } else {
            // Message exists in messages[] but not in claudeMessages[] - add it
            this.chatState.setClaudeMessages([
              ...currentClaudeMessages,
              processedMessage,
            ]);
          }
        } else {
          // First chunk - create new assistant message
          const newMessage: StrictChatMessage = {
            id: messageId,
            sessionId: sessionId,
            type: 'assistant',
            contentBlocks: contentBlocks,
            timestamp: Date.now(),
            streaming: !isComplete,
            metadata: {},
          };

          this.chatState.setMessages([...currentMessages, newMessage]);

          // Add to claudeMessages for UI
          const processedMessage =
            this.messageProcessor.convertToProcessedMessage(newMessage);
          const currentClaudeMessages = this.chatState.claudeMessages();
          this.chatState.setClaudeMessages([
            ...currentClaudeMessages,
            processedMessage,
          ]);
        }

        this.logger.debug('Message chunk processed', 'ChatService', {
          messageId,
          contentBlocksCount: contentBlocks?.length ?? 0,
          isComplete,
        });
      });

    // Listen for session created event (backend publishes chat:sessionCreated)
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.SESSION_CREATED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        // Mark as connected when we receive events
        this._streamState.update((state) => ({ ...state, isConnected: true }));

        // Extract session from event payload
        const sessionData = payload.session;
        if (
          sessionData &&
          this.validator.validateSession(sessionData).isValid
        ) {
          // Type guard passed, safe to cast
          this.chatState.setCurrentSession(sessionData as never);
          this.logger.debug('Session created', 'ChatService', {
            sessionId: sessionData.id,
          });
        }
      });

    // Listen for session switched event (backend publishes chat:sessionSwitched)
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.SESSION_SWITCHED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        // Mark as connected when we receive events
        this._streamState.update((state) => ({ ...state, isConnected: true }));

        // Extract session from event payload
        const sessionData = payload.session;
        if (
          sessionData &&
          this.validator.validateSession(sessionData).isValid
        ) {
          // Type guard passed, safe to cast
          this.chatState.setCurrentSession(sessionData as never);
          this.logger.debug('Session switched', 'ChatService', {
            sessionId: sessionData.id,
          });

          // Request messages for switched session
          this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.GET_HISTORY, {
            sessionId: sessionData.id,
          });
        }
      });

    // Listen for message added event (backend publishes chat:messageAdded)
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_ADDED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        // Extract message from event payload
        const message = payload.message;
        if (message && this.validator.validateChatMessage(message).isValid) {
          // Deduplicate messages (TASK_2025_008 - Bug 1)
          if (this.processedMessageIds.has(message.id)) {
            this.logger.warn('Duplicate message detected:', 'ChatService', {
              messageId: message.id,
            });
            return;
          }
          this.processedMessageIds.add(message.id);

          // Add message to state
          const currentMessages = this.chatState.messages();
          this.chatState.setMessages([...currentMessages, message as never]);

          // Transform to ProcessedClaudeMessage for UI display
          const processedMessage =
            this.messageProcessor.convertToProcessedMessage(message);
          const currentClaudeMessages = this.chatState.claudeMessages();
          this.chatState.setClaudeMessages([
            ...currentClaudeMessages,
            processedMessage,
          ]);

          this.logger.debug('Message added', 'ChatService', {
            messageId: message.id,
            type: message.type,
          });
        }
      });

    // Listen for token usage updates (backend publishes chat:tokenUsageUpdated)
    // TASK_2025_008 - Batch 3: Cumulative token tracking
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        // Extract sessionId and token usage from event payload
        const { sessionId, tokenUsage } = payload;
        if (tokenUsage) {
          // Update current session token usage if it matches
          const currentSession = this.chatState.currentSession();
          if (currentSession && currentSession.id === sessionId) {
            // Cumulative token tracking using Batch 2 fields
            const cumulativeInput =
              (currentSession.totalTokensInput || 0) + tokenUsage.input;
            const cumulativeOutput =
              (currentSession.totalTokensOutput || 0) + tokenUsage.output;

            const updatedSession = {
              ...currentSession,
              tokenUsage,
              totalTokensInput: cumulativeInput,
              totalTokensOutput: cumulativeOutput,
            } as never;

            this.chatState.setCurrentSession(updatedSession);
            this.logger.debug('Token usage updated', 'ChatService', {
              used: tokenUsage.input + tokenUsage.output,
              percentage: tokenUsage.percentage,
              cumulativeInput,
              cumulativeOutput,
            });
          }
        }
      });

    // Listen for sessions list updates (backend publishes chat:sessionsUpdated)
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.SESSIONS_UPDATED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        // Extract sessions array from event payload
        const sessions = payload.sessions;
        if (Array.isArray(sessions)) {
          const validSessions = sessions.filter(
            (session) => this.validator.validateSession(session).isValid
          ) as never[]; // Type guard passed, safe to cast
          // TODO: Update sessions list in state (currently no sessions state)
          this.logger.debug('Sessions list updated', 'ChatService', {
            count: validSessions.length,
          });
        }
      });

    // Listen for history response (backend publishes chat:getHistory:response)
    this.vscode
      .onMessageType(toResponseType(CHAT_MESSAGE_TYPES.GET_HISTORY))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        if (response.success && response.data) {
          const messages = (response.data as { messages?: StrictChatMessage[] })
            .messages;
          if (Array.isArray(messages)) {
            // 🔍 DIAGNOSTIC LOGGING: Log ALL raw messages received from backend
            console.group('📥 HISTORY LOADED - RAW MESSAGES FROM BACKEND');
            console.log('Total messages received:', messages.length);
            messages.forEach((msg, index) => {
              console.group(`Message ${index + 1} of ${messages.length}`);
              console.log('Message ID:', msg.id);
              console.log('Type:', msg.type);
              console.log('SessionId:', msg.sessionId);
              console.log('Timestamp:', new Date(msg.timestamp).toISOString());
              console.log(
                'Content preview:',
                msg.contentBlocks?.[0]?.type === 'text'
                  ? msg.contentBlocks[0].text.substring(0, 100)
                  : '(no content)'
              );
              console.log('Streaming:', msg.streaming);
              console.log('Metadata:', msg.metadata);
              console.log('FULL MESSAGE OBJECT:', JSON.stringify(msg, null, 2));
              console.groupEnd();
            });
            console.groupEnd();

            const validMessages = messages.filter(
              (msg) => this.validator.validateChatMessage(msg).isValid
            );

            // 🔍 DIAGNOSTIC LOGGING: Log validation results
            console.group('✅ VALIDATION RESULTS');
            console.log('Valid messages:', validMessages.length);
            console.log(
              'Invalid/filtered messages:',
              messages.length - validMessages.length
            );
            if (messages.length !== validMessages.length) {
              console.warn('⚠️ SOME MESSAGES WERE FILTERED OUT!');
              const invalidMessages = messages.filter(
                (msg) => !this.validator.validateChatMessage(msg).isValid
              );
              invalidMessages.forEach((msg) => {
                console.error('Invalid message:', {
                  id: msg.id,
                  type: msg.type,
                  validationResult: this.validator.validateChatMessage(msg),
                });
              });
            }
            console.groupEnd();

            this.chatState.setMessages(validMessages);
            this.logger.debug('Loaded history', 'ChatService', {
              messageCount: validMessages.length,
            });

            // Transform to ProcessedClaudeMessage for UI display
            const processedMessages = validMessages.map((msg) =>
              this.messageProcessor.convertToProcessedMessage(msg)
            );

            // 🔍 DIAGNOSTIC LOGGING: Log processed messages for UI
            console.group('🎨 PROCESSED MESSAGES FOR UI');
            console.log('Processed messages count:', processedMessages.length);
            processedMessages.forEach((msg, index) => {
              console.group(`Processed Message ${index + 1}`);
              console.log('ID:', msg.id);
              console.log('Type:', msg.type);
              console.log('Content items count:', msg.content.length);
              console.log(
                'Content types:',
                msg.content.map((c: { type: string }) => c.type)
              );
              console.log(
                'FULL PROCESSED MESSAGE:',
                JSON.stringify(msg, null, 2)
              );
              console.groupEnd();
            });
            console.groupEnd();

            this.chatState.setClaudeMessages(processedMessages);
            this.logger.debug('Transformed messages for UI', 'ChatService', {
              count: processedMessages.length,
            });
          }
        }
      });

    // CRITICAL FIX: Listen for messageComplete event to clear loading/streaming state
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        // Clear streaming state
        this._streamState.update((state) => ({
          ...state,
          isStreaming: false,
          lastMessageTimestamp: Date.now(),
        }));

        // Clear loading state in app
        this.appState.setLoading(false);

        this.logger.debug('Message complete', 'ChatService', {
          messageId: payload.message?.id,
        });
      });

    // Agent event handlers (TASK_2025_004)
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.AGENT_STARTED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        const newNode: AgentTreeNode = {
          agent: payload.agent,
          activities: [],
          status: 'running',
        };
        this._agents.update((agents) => [...agents, newNode]);
        this.logger.debug('Agent started', 'ChatService', {
          agentId: payload.agent.agentId,
          subagentType: payload.agent.subagentType,
        });
      });

    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.AGENT_ACTIVITY)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        const agentId = payload.agent.agentId;

        // Update activities map
        this._agentActivities.update((map) => {
          const activities = map.get(agentId) || [];
          const newMap = new Map(map);
          newMap.set(agentId, [...activities, payload.agent]);
          return newMap;
        });

        // Update agent node activities
        this._agents.update((agents) =>
          agents.map((node) =>
            node.agent.agentId === agentId
              ? {
                  ...node,
                  activities: this._agentActivities().get(agentId) || [],
                }
              : node
          )
        );

        this.logger.debug('Agent activity', 'ChatService', {
          agentId,
          toolName: payload.agent.toolName,
        });
      });

    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.AGENT_COMPLETED)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        this._agents.update((agents) =>
          agents.map((node) =>
            node.agent.agentId === payload.agent.agentId
              ? {
                  ...node,
                  status: 'complete',
                  duration: payload.agent.duration,
                }
              : node
          )
        );

        this.logger.debug('Agent completed', 'ChatService', {
          agentId: payload.agent.agentId,
          duration: payload.agent.duration,
        });
      });

    // Event relay subscriptions (TASK_2025_006 - Batch 3)
    // Thinking display
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.THINKING)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleThinking(payload));

    // Tool execution lifecycle
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.TOOL_START)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleToolStart(payload));

    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.TOOL_PROGRESS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleToolProgress(payload));

    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.TOOL_RESULT)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleToolResult(payload));

    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.TOOL_ERROR)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleToolError(payload));

    // Permission lifecycle
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.PERMISSION_REQUEST)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handlePermissionRequest(payload));

    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handlePermissionResponse(payload));

    // Session lifecycle
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.SESSION_INIT)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleSessionInit(payload));

    // System events
    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.HEALTH_UPDATE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleHealthUpdate(payload));

    this.vscode
      .onMessageType(CHAT_MESSAGE_TYPES.CLI_ERROR)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.handleCliError(payload));

    // Handle initial data
    this.vscode
      .onMessageType(SYSTEM_MESSAGE_TYPES.INITIAL_DATA)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload: InitialDataPayload) => {
        // Mark as connected when we receive initial data
        this._streamState.update((state) => ({ ...state, isConnected: true }));

        this.logger.debug('Received initial data', 'ChatService', {
          hasSession: !!payload.data?.currentSession,
          messageCount: payload.data?.currentSession?.messages?.length || 0,
        });

        // Backend sends payload.data.sessions and payload.data.currentSession
        // (see AngularWebviewProvider.sendInitialData line 101-144)
        if (payload.success && payload.data) {
          // Set current session if provided
          if (payload.data.currentSession) {
            this.chatState.setCurrentSession(payload.data.currentSession);
            this.logger.debug(
              'Session loaded from initial data',
              'ChatService',
              {
                sessionId: payload.data.currentSession.id,
              }
            );
          }

          // Load messages for current session if available
          if (payload.data.currentSession?.messages) {
            const validMessages = payload.data.currentSession.messages.filter(
              (msg) => this.validator.validateChatMessage(msg).isValid
            );

            this.chatState.setMessages(validMessages);

            // CRITICAL FIX: Transform StrictChatMessage[] to ProcessedClaudeMessage[] for UI display
            // The UI displays claudeMessages(), not messages(), so we must populate both collections
            const processedMessages = validMessages.map((msg) =>
              this.messageProcessor.convertToProcessedMessage(msg)
            );
            this.chatState.setClaudeMessages(processedMessages);

            this.logger.debug('Initial messages loaded', 'ChatService', {
              messageCount: processedMessages.length,
            });
          }
        }
      });
  }

  // Event relay handler methods (TASK_2025_006 - Batch 3)
  private handleThinking(payload: ChatThinkingPayload): void {
    // 🔍 DIAGNOSTIC LOGGING: Log ALL thinking events
    console.group('💭 THINKING EVENT RECEIVED');
    console.log('Content preview:', payload.content.substring(0, 200));
    console.log('Timestamp:', new Date(payload.timestamp).toISOString());
    console.log('FULL PAYLOAD:', JSON.stringify(payload, null, 2));
    console.groupEnd();

    this.logger.debug('ChatService', 'Thinking event received', payload);
    this._currentThinking.set({
      content: payload.content,
      timestamp: payload.timestamp,
    });
  }

  private handleToolStart(payload: ChatToolStartPayload): void {
    // 🔍 DIAGNOSTIC LOGGING: Log ALL tool start events
    console.group('🔧 TOOL_START EVENT RECEIVED');
    console.log('Tool name:', payload.tool);
    console.log('Tool call ID:', payload.toolCallId);
    console.log('Arguments:', payload.args);
    console.log('Timestamp:', new Date(payload.timestamp).toISOString());
    console.log('FULL PAYLOAD:', JSON.stringify(payload, null, 2));
    console.groupEnd();

    this.logger.debug('ChatService', 'Tool started', {
      tool: payload.tool,
      toolCallId: payload.toolCallId,
    });
    const execution: ToolExecution = {
      toolCallId: payload.toolCallId,
      tool: payload.tool,
      args: payload.args,
      status: 'running',
      startTime: payload.timestamp,
    };
    this._toolExecutions.update((executions) => [...executions, execution]);
  }

  private handleToolProgress(payload: ChatToolProgressPayload): void {
    this.logger.debug('ChatService', 'Tool progress', {
      toolCallId: payload.toolCallId,
      message: payload.message,
    });
    this._toolExecutions.update((executions) =>
      executions.map((exec) =>
        exec.toolCallId === payload.toolCallId
          ? { ...exec, progress: payload.message }
          : exec
      )
    );
  }

  private handleToolResult(payload: ChatToolResultPayload): void {
    // 🔍 DIAGNOSTIC LOGGING: Log ALL tool result events
    console.group('✅ TOOL_RESULT EVENT RECEIVED');
    console.log('Tool call ID:', payload.toolCallId);
    console.log('Duration:', payload.duration, 'ms');
    console.log(
      'Output preview:',
      JSON.stringify(payload.output).substring(0, 200)
    );
    console.log('FULL PAYLOAD:', JSON.stringify(payload, null, 2));
    console.groupEnd();

    this.logger.debug('ChatService', 'Tool result', {
      toolCallId: payload.toolCallId,
      duration: payload.duration,
    });
    this._toolExecutions.update((executions) =>
      executions.map((exec) =>
        exec.toolCallId === payload.toolCallId
          ? {
              ...exec,
              status: 'success',
              output: payload.output,
              duration: payload.duration,
              endTime: payload.timestamp,
            }
          : exec
      )
    );
  }

  private handleToolError(payload: ChatToolErrorPayload): void {
    this.logger.error('ChatService', 'Tool error', {
      toolCallId: payload.toolCallId,
      error: payload.error,
    });
    this._toolExecutions.update((executions) =>
      executions.map((exec) =>
        exec.toolCallId === payload.toolCallId
          ? {
              ...exec,
              status: 'error',
              error: payload.error,
              endTime: payload.timestamp,
            }
          : exec
      )
    );
  }

  private handlePermissionRequest(payload: ChatPermissionRequestPayload): void {
    // 🔍 DIAGNOSTIC LOGGING: Log ALL permission request events
    console.group('🔐 PERMISSION_REQUEST EVENT RECEIVED');
    console.log('Request ID:', payload.id);
    console.log('Tool:', payload.tool);
    console.log('Action:', payload.action);
    console.log('Description:', payload.description);
    console.log('Timestamp:', new Date(payload.timestamp).toISOString());
    console.log('FULL PAYLOAD:', JSON.stringify(payload, null, 2));
    console.groupEnd();

    this.logger.debug('ChatService', 'Permission requested', {
      id: payload.id,
      tool: payload.tool,
      action: payload.action,
    });
    this._pendingPermissions.update((permissions) => [
      ...permissions,
      {
        requestId: payload.id,
        type: payload.action,
        details: { tool: payload.tool, description: payload.description },
        timestamp: payload.timestamp,
      },
    ]);
  }

  private handlePermissionResponse(
    payload: ChatPermissionResponsePayload
  ): void {
    this.logger.debug('ChatService', 'Permission responded', {
      requestId: payload.requestId,
      response: payload.response,
    });
    this._pendingPermissions.update((permissions) =>
      permissions.filter((perm) => perm.requestId !== payload.requestId)
    );
  }

  private handleSessionInit(payload: ChatSessionInitPayload): void {
    this.logger.info('ChatService', 'CLI session initialized', {
      sessionId: payload.sessionId,
      claudeSessionId: payload.claudeSessionId,
      model: payload.model,
    });
    // Optional: Store CLI session metadata if needed
  }

  private handleHealthUpdate(payload: ChatHealthUpdatePayload): void {
    this.logger.debug('ChatService', 'CLI health update', {
      available: payload.available,
      version: payload.version,
      error: payload.error,
    });
    // Optional: Update provider health state if needed
  }

  private handleCliError(payload: ChatCliErrorPayload): void {
    this.logger.error('ChatService', 'CLI error', {
      error: payload.error,
      context: payload.context,
    });
    this.appState.handleError(payload.error);
  }
}
