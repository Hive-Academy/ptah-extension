import { Injectable, signal, computed } from '@angular/core';
import {
  StrictChatSession,
  StrictChatMessage,
  MessageId,
  SessionId,
  ContentBlock,
  ClaudeToolEvent,
  ClaudePermissionRequest,
} from '@ptah-extension/shared';

// JSONL Message Types (local copy to avoid importing backend claude-domain)
// TODO: Move these to @ptah-extension/shared when backend work is complete
export interface JSONLAssistantMessage {
  readonly type: 'assistant';
  readonly delta?: string;
  readonly content?: string;
  readonly thinking?: string;
  readonly index?: number;
  readonly parent_tool_use_id?: string;
  readonly message?: {
    readonly model?: string;
    readonly id?: string;
    readonly role?: 'assistant';
    readonly content?: Array<{
      readonly type: 'text' | 'tool_use';
      readonly text?: string;
      readonly id?: string;
      readonly name?: string;
      readonly input?: Record<string, unknown>;
    }>;
  };
}

export interface JSONLToolMessage {
  readonly type: 'tool';
  readonly subtype?: 'start' | 'progress' | 'result' | 'error';
  readonly tool_call_id?: string;
  readonly tool?: string;
  readonly args?: Record<string, unknown>;
  readonly output?: unknown;
  readonly message?: string;
  readonly error?: string;
  readonly parent_tool_use_id?: string;
}

export interface JSONLPermissionMessage {
  readonly type: 'permission';
  readonly subtype: 'request';
  readonly tool_call_id: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly description?: string;
}

export interface JSONLStreamEvent {
  readonly type: 'stream_event';
  readonly event: {
    readonly type: string;
    readonly index?: number;
    readonly delta?: {
      readonly type: 'text_delta' | 'input_json_delta';
      readonly text?: string;
      readonly partial_json?: string;
    };
    readonly content_block?: {
      readonly type: string;
      readonly text: string;
    };
    readonly message?: {
      readonly model?: string;
      readonly id?: string;
    };
  };
  readonly session_id?: string;
}

export interface JSONLResultMessage {
  readonly type: 'result';
  readonly subtype: 'success' | 'error';
  readonly session_id?: string;
  readonly result?: string;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  readonly modelUsage?: unknown;
}

export interface JSONLSystemMessage {
  readonly type: 'system';
  readonly subtype?: 'init';
  readonly session_id?: string;
  readonly model?: string;
  readonly tools?: unknown[];
  readonly cwd?: string;
}

export type JSONLMessage =
  | JSONLSystemMessage
  | JSONLAssistantMessage
  | JSONLToolMessage
  | JSONLPermissionMessage
  | JSONLStreamEvent
  | JSONLResultMessage;

// ProcessedClaudeMessage: Content blocks from JSONL messages
export interface ProcessedClaudeMessage {
  id: MessageId;
  type: 'assistant' | 'system';
  content: ContentBlock[];
  timestamp: number;
  sessionId?: string;
  model?: string;
}

// Agent metadata for Task tool tracking
export interface AgentMetadata {
  agentId: string;
  subagentType?: string;
  description?: string;
  prompt?: string;
  model?: string;
  startTime: number;

  // Optional properties being added by backend (RPC Phase 3.5)
  cost?: number;
  tokens?: {
    readonly input: number;
    readonly output: number;
  };
  mcpTools?: string[];
  isCustomAgent?: boolean;
}

// Session metrics from result messages
export interface SessionMetrics {
  duration?: number;
  cost?: number;
  tokens?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  modelUsage?: unknown;
}

export interface ChatState {
  currentSession: StrictChatSession | null;
  messages: readonly StrictChatMessage[];
  claudeMessages: readonly ProcessedClaudeMessage[];
  lastUpdated: number;
}

/**
 * Chat State Service - Centralized Chat State Management
 *
 * Responsibilities:
 * - Manage current session state
 * - Store and update message collections
 * - Handle Claude message collections
 * - Provide reactive state updates via signals
 * - Maintain state consistency and history
 *
 * Extracted from ChatService for single responsibility principle
 *
 * **Modern Angular Patterns**:
 * - Pure signal-based state management
 * - No BehaviorSubject or manual subscriptions
 * - Readonly signals for immutability
 * - Computed signals for derived state
 * - No manual cleanup needed (signals are managed by Angular)
 */
@Injectable({
  providedIn: 'root',
})
export class ChatStateService {
  // Private state signals
  private readonly _currentSession = signal<StrictChatSession | null>(null);
  private readonly _messages = signal<readonly StrictChatMessage[]>([]);
  private readonly _claudeMessages = signal<readonly ProcessedClaudeMessage[]>(
    []
  );
  private readonly _lastUpdated = signal<number>(Date.now());

  // Public readonly signals
  readonly currentSession = this._currentSession.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly claudeMessages = this._claudeMessages.asReadonly();
  readonly lastUpdated = this._lastUpdated.asReadonly();

  // Computed state
  readonly chatState = computed(
    (): ChatState => ({
      currentSession: this._currentSession(),
      messages: this._messages(),
      claudeMessages: this._claudeMessages(),
      lastUpdated: this._lastUpdated(),
    })
  );

  readonly hasMessages = computed(() => {
    return this._messages().length > 0 || this._claudeMessages().length > 0;
  });

  readonly messageCount = computed(() => ({
    total: this._messages().length + this._claudeMessages().length,
    strict: this._messages().length,
    claude: this._claudeMessages().length,
  }));

  readonly sessionInfo = computed(() => {
    const session = this._currentSession();
    if (!session) return null;

    return {
      id: session.id,
      name: session.name,
      messageCount: this.messageCount().total,
      lastActivity: session.lastActiveAt || session.createdAt,
      hasTokenUsage: !!session.tokenUsage,
    };
  });

  // Session management
  setCurrentSession(session: StrictChatSession | null): void {
    this._currentSession.set(session);
    this.updateTimestamp();
  }

  updateSession(updates: Partial<StrictChatSession>): void {
    const currentSession = this._currentSession();
    if (!currentSession) return;

    this._currentSession.set({
      ...currentSession,
      ...updates,
      lastActiveAt: Date.now(),
    });
    this.updateTimestamp();
  }

  // Message management
  setMessages(messages: readonly StrictChatMessage[]): void {
    this._messages.set(messages);
    this.updateTimestamp();
  }

  addMessage(message: StrictChatMessage): void {
    const currentMessages = this._messages();
    this._messages.set([...currentMessages, message]);
    this.updateTimestamp();
  }

  updateMessage(
    messageId: MessageId,
    updates: Partial<StrictChatMessage>
  ): void {
    const currentMessages = this._messages();
    const updatedMessages = currentMessages.map((msg) =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    );
    this._messages.set(updatedMessages);
    this.updateTimestamp();
  }

  removeMessage(messageId: MessageId): void {
    const currentMessages = this._messages();
    const filteredMessages = currentMessages.filter(
      (msg) => msg.id !== messageId
    );
    this._messages.set(filteredMessages);
    this.updateTimestamp();
  }

  clearMessages(): void {
    this._messages.set([]);
    this.updateTimestamp();
  }

  // Claude message management
  setClaudeMessages(messages: readonly ProcessedClaudeMessage[]): void {
    this._claudeMessages.set(messages);
    this.updateTimestamp();
  }

  addClaudeMessage(message: ProcessedClaudeMessage): void {
    const currentMessages = this._claudeMessages();
    this._claudeMessages.set([...currentMessages, message]);
    this.updateTimestamp();
  }

  updateClaudeMessage(
    messageId: MessageId,
    updates: Partial<ProcessedClaudeMessage>
  ): void {
    const currentMessages = this._claudeMessages();
    const updatedMessages = currentMessages.map((msg) =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    );
    this._claudeMessages.set(updatedMessages);
    this.updateTimestamp();
  }

  removeClaudeMessage(messageId: MessageId): void {
    const currentMessages = this._claudeMessages();
    const filteredMessages = currentMessages.filter(
      (msg) => msg.id !== messageId
    );
    this._claudeMessages.set(filteredMessages);
    this.updateTimestamp();
  }

  clearClaudeMessages(): void {
    this._claudeMessages.set([]);
    this.updateTimestamp();
  }

  // Message queries
  findMessage(messageId: MessageId): StrictChatMessage | null {
    return this._messages().find((msg) => msg.id === messageId) || null;
  }

  findClaudeMessage(messageId: MessageId): ProcessedClaudeMessage | null {
    return this._claudeMessages().find((msg) => msg.id === messageId) || null;
  }

  getMessagesByType(
    type: 'user' | 'assistant' | 'system'
  ): StrictChatMessage[] {
    return this._messages().filter((msg) => msg.type === type);
  }

  getRecentMessages(count: number): StrictChatMessage[] {
    const messages = this._messages();
    return messages.slice(Math.max(0, messages.length - count));
  }

  getMessagesInTimeRange(
    startTime: number,
    endTime: number
  ): StrictChatMessage[] {
    return this._messages().filter(
      (msg) => msg.timestamp >= startTime && msg.timestamp <= endTime
    );
  }

  // State utilities
  getStateSnapshot(): ChatState {
    return this.chatState();
  }

  restoreState(state: ChatState): void {
    this._currentSession.set(state.currentSession);
    this._messages.set(state.messages);
    this._claudeMessages.set(state.claudeMessages);
    this.updateTimestamp();
  }

  resetState(): void {
    this._currentSession.set(null);
    this._messages.set([]);
    this._claudeMessages.set([]);
    this.updateTimestamp();
  }

  // Message merging and synchronization
  mergeMessages(newMessages: readonly StrictChatMessage[]): void {
    const currentMessages = this._messages();
    const messageMap = new Map(currentMessages.map((msg) => [msg.id, msg]));

    // Merge new messages, updating existing ones
    newMessages.forEach((newMsg) => {
      messageMap.set(newMsg.id, newMsg);
    });

    // Convert back to array and sort by timestamp
    const mergedMessages = Array.from(messageMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );

    this._messages.set(mergedMessages);
    this.updateTimestamp();
  }

  mergeClaudeMessages(newMessages: readonly ProcessedClaudeMessage[]): void {
    const currentMessages = this._claudeMessages();
    const messageMap = new Map(currentMessages.map((msg) => [msg.id, msg]));

    // Merge new messages, updating existing ones
    newMessages.forEach((newMsg) => {
      messageMap.set(newMsg.id, newMsg);
    });

    // Convert back to array and sort by timestamp
    const mergedMessages = Array.from(messageMap.values()).sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    );

    this._claudeMessages.set(mergedMessages);
    this.updateTimestamp();
  }

  // Streaming message handling
  upsertStreamingMessage(message: ProcessedClaudeMessage): void {
    const currentMessages = this._claudeMessages();
    const existingIndex = currentMessages.findIndex(
      (msg) => msg.id === message.id
    );

    if (existingIndex >= 0) {
      // Update existing message
      const updatedMessages = [...currentMessages];
      updatedMessages[existingIndex] = message;
      this._claudeMessages.set(updatedMessages);
    } else {
      // Add new message
      this._claudeMessages.set([...currentMessages, message]);
    }

    this.updateTimestamp();
  }

  // Private methods
  private updateTimestamp(): void {
    this._lastUpdated.set(Date.now());
  }

  // ========================================================================
  // JSONL MESSAGE HANDLERS (RPC Phase 3.5)
  // ========================================================================

  // Additional state signals for JSONL streaming
  private readonly _toolTimeline = signal<readonly ClaudeToolEvent[]>([]);
  private readonly _activeAgents = signal<Map<string, AgentMetadata>>(
    new Map()
  );
  private readonly _agentActivities = signal<
    Map<string, readonly ClaudeToolEvent[]>
  >(new Map());
  private readonly _permissionDialog = signal<ClaudePermissionRequest | null>(
    null
  );
  private readonly _sessionMetrics = signal<SessionMetrics | null>(null);
  private readonly _claudeSessionId = signal<string | null>(null);
  private readonly _isStreaming = signal<boolean>(false);

  // Public readonly signals for JSONL state
  readonly toolTimeline = this._toolTimeline.asReadonly();
  readonly activeAgents = this._activeAgents.asReadonly();
  readonly agentActivities = this._agentActivities.asReadonly();
  readonly permissionDialog = this._permissionDialog.asReadonly();
  readonly sessionMetrics = this._sessionMetrics.asReadonly();
  readonly claudeSessionId = this._claudeSessionId.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();

  /**
   * Handle session initialization (system message with session_id)
   */
  handleSessionInit(
    sessionId: SessionId,
    claudeSessionId: string,
    model?: string
  ): void {
    this._claudeSessionId.set(claudeSessionId);

    // Create system message for session init
    const systemMessage: ProcessedClaudeMessage = {
      id: MessageId.create(),
      type: 'system',
      content: [
        {
          type: 'text',
          text: `Session initialized: ${claudeSessionId}${
            model ? ` (${model})` : ''
          }`,
        },
      ],
      timestamp: Date.now(),
      sessionId: claudeSessionId,
      model,
    };

    this.addClaudeMessage(systemMessage);
  }

  /**
   * Handle assistant messages (thinking vs content discrimination)
   */
  handleAssistantMessage(
    sessionId: SessionId,
    message: JSONLAssistantMessage
  ): void {
    // Create or update the current assistant message
    const messageId = MessageId.create();
    const contentBlocks: ContentBlock[] = [];

    // Thinking content
    if (message.thinking) {
      contentBlocks.push({
        type: 'thinking',
        thinking: message.thinking,
        index: message.index,
      });
    }

    // Delta content (streaming text)
    if (message.delta) {
      contentBlocks.push({
        type: 'text',
        text: message.delta,
        index: message.index,
      });
    }

    // Complete content
    if (message.content) {
      contentBlocks.push({
        type: 'text',
        text: message.content,
        index: message.index,
      });
    }

    // Messages API format (message.content array)
    if (message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text) {
          contentBlocks.push({
            type: 'text',
            text: block.text,
            index: message.index,
          });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          contentBlocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input || {},
            index: message.index,
          });
        }
      }
    }

    // Update signal with content blocks
    if (contentBlocks.length > 0) {
      const assistantMessage: ProcessedClaudeMessage = {
        id: messageId,
        type: 'assistant',
        content: contentBlocks,
        timestamp: Date.now(),
        sessionId: this._claudeSessionId() || undefined,
      };

      // Use upsertStreamingMessage for real-time updates
      this.upsertStreamingMessage(assistantMessage);
    }

    // Agent activity correlation (if parent_tool_use_id present)
    if (message.parent_tool_use_id) {
      this.correlateAgentActivity(message.parent_tool_use_id, message);
    }
  }

  /**
   * Handle tool messages (timeline + agent correlation)
   */
  handleToolMessage(sessionId: SessionId, message: JSONLToolMessage): void {
    if (!message.tool_call_id || !message.subtype) {
      return;
    }

    // Update tool timeline signal
    const toolEvent = this.createToolEvent(message);
    if (toolEvent) {
      const currentTimeline = this._toolTimeline();
      this._toolTimeline.set([...currentTimeline, toolEvent]);

      // Track agent activity if this tool belongs to an agent
      if (message.parent_tool_use_id) {
        const agents = this._activeAgents();
        if (agents.has(message.parent_tool_use_id)) {
          // Update agent activities Map
          const activities = new Map(this._agentActivities());
          const agentEvents = activities.get(message.parent_tool_use_id) || [];
          activities.set(message.parent_tool_use_id, [
            ...agentEvents,
            toolEvent,
          ]);
          this._agentActivities.set(activities);
        }
      }
    }

    // Task tool lifecycle tracking (agent start/complete)
    if (message.tool === 'Task') {
      this.handleTaskToolLifecycle(message);
    }

    // Agent activity correlation (if parent_tool_use_id present)
    if (message.parent_tool_use_id) {
      this.correlateToolActivity(message.parent_tool_use_id, message);
    }
  }

  /**
   * Handle permission requests
   */
  handlePermissionRequest(
    sessionId: SessionId,
    message: JSONLPermissionMessage
  ): void {
    if (message.subtype !== 'request') {
      return;
    }

    // Update signal with permission dialog state
    const permissionRequest: ClaudePermissionRequest = {
      toolCallId: message.tool_call_id,
      tool: message.tool,
      args: message.args,
      description: message.description,
      timestamp: Date.now(),
    };

    this._permissionDialog.set(permissionRequest);
  }

  /**
   * Handle stream control events
   */
  handleStreamEvent(sessionId: SessionId, message: JSONLStreamEvent): void {
    switch (message.event.type) {
      case 'message_start':
        this._isStreaming.set(true);
        if (message.session_id) {
          this._claudeSessionId.set(message.session_id);
        }
        break;

      case 'content_block_delta':
        if (
          message.event.delta?.type === 'text_delta' &&
          message.event.delta.text
        ) {
          // Append text delta to current message
          const contentBlock: ContentBlock = {
            type: 'text',
            text: message.event.delta.text,
            index: message.event.index,
          };

          // Create or update streaming message
          const messageId = MessageId.create();
          const assistantMessage: ProcessedClaudeMessage = {
            id: messageId,
            type: 'assistant',
            content: [contentBlock],
            timestamp: Date.now(),
          };

          this.upsertStreamingMessage(assistantMessage);
        }
        break;

      case 'message_stop':
        this._isStreaming.set(false);
        break;
    }
  }

  /**
   * Handle final result (cost, usage, duration)
   */
  handleResult(sessionId: SessionId, message: JSONLResultMessage): void {
    const metrics: SessionMetrics = {
      duration: message.duration_ms,
      cost: message.total_cost_usd,
      tokens: message.usage,
      modelUsage: message.modelUsage,
    };

    this._sessionMetrics.set(metrics);
    this._isStreaming.set(false);

    // Add result message to timeline
    const resultText =
      message.subtype === 'success'
        ? `Session completed: ${message.result || 'success'}`
        : `Session error: ${message.result || 'unknown error'}`;

    const systemMessage: ProcessedClaudeMessage = {
      id: MessageId.create(),
      type: 'system',
      content: [{ type: 'text', text: resultText }],
      timestamp: Date.now(),
    };

    this.addClaudeMessage(systemMessage);
  }

  /**
   * Correlate agent activity from assistant messages with parent_tool_use_id
   */
  private correlateAgentActivity(
    parentToolUseId: string,
    message: JSONLAssistantMessage
  ): void {
    const agents = this._activeAgents();
    const agent = agents.get(parentToolUseId);

    if (!agent) {
      // Not an agent, just a nested tool call
      return;
    }

    // Extract tool information from message content
    if (message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'tool_use' && block.name) {
          // Agent is using a tool - could add to agent activity timeline if needed
          console.debug(
            '[ChatStateService] Agent activity:',
            agent.agentId,
            block.name
          );
        }
      }
    }
  }

  /**
   * Correlate tool activity from tool messages with parent_tool_use_id
   */
  private correlateToolActivity(
    parentToolUseId: string,
    message: JSONLToolMessage
  ): void {
    const agents = this._activeAgents();
    const agent = agents.get(parentToolUseId);

    if (!agent) {
      // Not an agent, just a nested tool call
      return;
    }

    // This is agent activity - could add to agent activity timeline if needed
    console.debug(
      '[ChatStateService] Agent tool activity:',
      agent.agentId,
      message.tool
    );
  }

  /**
   * Handle Task tool lifecycle (agent start/complete)
   */
  private handleTaskToolLifecycle(message: JSONLToolMessage): void {
    if (!message.tool_call_id) return;

    if (message.subtype === 'start' && message.args) {
      // Add to activeAgents Map
      const agents = new Map(this._activeAgents());
      agents.set(message.tool_call_id, {
        agentId: message.tool_call_id,
        subagentType: (message.args['subagent_type'] as string) || undefined,
        description: (message.args['description'] as string) || undefined,
        prompt: (message.args['prompt'] as string) || undefined,
        model: (message.args['model'] as string) || undefined,
        startTime: Date.now(),
      });
      this._activeAgents.set(agents);
    } else if (message.subtype === 'result' || message.subtype === 'error') {
      // Remove from activeAgents Map
      const agents = new Map(this._activeAgents());
      agents.delete(message.tool_call_id);
      this._activeAgents.set(agents);

      // Clean up agent activities
      const activities = new Map(this._agentActivities());
      activities.delete(message.tool_call_id);
      this._agentActivities.set(activities);
    }
  }

  /**
   * Create tool event from JSONL tool message
   */
  private createToolEvent(message: JSONLToolMessage): ClaudeToolEvent | null {
    if (!message.tool_call_id) return null;

    switch (message.subtype) {
      case 'start':
        return {
          type: 'start',
          toolCallId: message.tool_call_id,
          tool: message.tool || 'unknown',
          args: message.args || {},
          timestamp: Date.now(),
        };

      case 'result':
        return {
          type: 'result',
          toolCallId: message.tool_call_id,
          output: message.output,
          duration: 0, // Duration not provided in JSONL
          timestamp: Date.now(),
        };

      case 'error':
        return {
          type: 'error',
          toolCallId: message.tool_call_id,
          error: message.error || 'Unknown error',
          timestamp: Date.now(),
        };

      case 'progress':
        return {
          type: 'progress',
          toolCallId: message.tool_call_id,
          message: message.message || '',
          timestamp: Date.now(),
        };

      default:
        return null;
    }
  }

  /**
   * Clear permission dialog
   */
  clearPermissionDialog(): void {
    this._permissionDialog.set(null);
  }

  /**
   * Clear tool timeline
   */
  clearToolTimeline(): void {
    this._toolTimeline.set([]);
  }

  /**
   * Clear session metrics
   */
  clearSessionMetrics(): void {
    this._sessionMetrics.set(null);
  }
}
