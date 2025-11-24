import { Injectable, computed, inject, signal } from '@angular/core';
import { ChatStateService, AgentMetadata } from './chat-state.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { LoggingService } from './logging.service';
import { ClaudeRpcService } from './claude-rpc.service';
import {
  StrictChatMessage,
  SessionId,
  MessageId,
  SessionSummary,
  ClaudeToolEvent,
} from '@ptah-extension/shared';

/**
 * Agent Tree Node - Represents a subagent in the agent execution tree
 */
export interface AgentTreeNode {
  readonly agent: AgentMetadata;
  readonly activities: readonly ClaudeToolEvent[];
  readonly status: 'running' | 'complete' | 'error';
  readonly duration?: number;
  readonly errorMessage?: string;
}

/**
 * Chat Service - Main Orchestrator for Chat Functionality
 *
 * PURGED VERSION - ALL EVENT SUBSCRIPTIONS REMOVED
 *
 * This service now ONLY provides:
 * - Signal-based state access
 * - Command sending to backend (no response handling)
 * - State management delegation to ChatStateService
 *
 * ALL event handling, message processing, and validation REMOVED.
 * Backend will communicate directly via new RPC pattern (to be implemented).
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  // Core service dependencies
  private readonly chatState = inject(ChatStateService);
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly rpcService = inject(ClaudeRpcService);

  // Temporary state signals (NO event subscriptions updating these!)
  private readonly _sessions = signal<SessionSummary[]>([]);
  readonly sessions = this._sessions.asReadonly();

  // Public signal-based API - delegates to ChatStateService
  readonly messages = this.chatState.messages;
  readonly claudeMessages = this.chatState.claudeMessages;
  readonly currentSession = this.chatState.currentSession;
  readonly isStreaming = this.chatState.isStreaming; // Now has real streaming state (RPC Phase 3.5)

  // JSONL streaming state (RPC Phase 3.5)
  readonly toolTimeline = this.chatState.toolTimeline;
  readonly toolExecutions = this.chatState.toolTimeline; // Alias for backward compatibility
  readonly activeAgents = this.chatState.activeAgents;
  readonly sessionMetrics = this.chatState.sessionMetrics;
  readonly claudeSessionId = this.chatState.claudeSessionId;

  /**
   * Agent Tree Nodes - Converts activeAgents Map to AgentTreeNode[] for component consumption
   *
   * This computed signal adapts the Map<string, AgentMetadata> from ChatStateService
   * into the AgentTreeNode[] format expected by UI components.
   */
  readonly activeAgentNodes = computed<readonly AgentTreeNode[]>(() => {
    const agentsMap = this.chatState.activeAgents();
    const agentActivities = this.chatState.agentActivities();
    const nodes: AgentTreeNode[] = [];

    for (const [toolCallId, metadata] of agentsMap.entries()) {
      nodes.push({
        agent: metadata,
        activities: agentActivities.get(toolCallId) || [],
        status: 'running', // Active agents are always running
        duration: Date.now() - metadata.startTime,
        errorMessage: undefined,
      });
    }

    return nodes;
  });

  // Permission dialog state (converted to array format for backward compatibility)
  readonly pendingPermissions = computed(() => {
    const permission = this.chatState.permissionDialog();
    return permission ? [permission] : [];
  });

  // Thinking state (not yet implemented - returns null for now)
  readonly currentThinking = computed(() => null);

  // Computed properties
  readonly hasMessages = this.chatState.hasMessages;
  readonly messageCount = this.chatState.messageCount;

  /**
   * Recent sessions (top 10 by lastActiveAt)
   * Filters out empty sessions (0 messages)
   */
  readonly recentSessions = computed(() =>
    this.sessions()
      .slice()
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 10)
      .filter((s) => s.messageCount > 0)
  );

  constructor() {
    // NO message handling initialization
    // NO event subscriptions
    // Clean slate for RPC pattern
  }

  /**
   * Send a message to Claude
   *
   * This initiates a chat turn via RPC (chat:start).
   * Streaming responses arrive asynchronously via webview postMessage ('jsonl-message' events).
   *
   * @param content - Message content to send
   * @param files - Optional file paths to include
   */
  async sendMessage(content: string, files?: string[]): Promise<void> {
    const currentSession = this.currentSession();
    if (!currentSession) {
      throw new Error('No active session available');
    }

    if (!content.trim()) {
      throw new Error('Message content cannot be empty');
    }

    try {
      // Start chat via RPC - streaming handled by ClaudeCliLauncher postMessage callbacks
      const result = await this.rpcService.startChat(
        currentSession.id,
        content,
        files
      );

      if (!result.isSuccess()) {
        throw new Error(result.error || 'Failed to start chat');
      }

      this.logger.info('Chat started successfully', 'ChatService', {
        sessionId: currentSession.id,
        contentLength: content.length,
        fileCount: files?.length || 0,
      });
    } catch (error) {
      this.logger.error(
        'Failed to send message to backend',
        'ChatService',
        error
      );
      throw error;
    }
  }

  /**
   * Switch to a different session (command only)
   *
   * @param sessionId - The session ID to switch to
   */
  async switchToSession(sessionId: SessionId): Promise<void> {
    try {
      this.appState.setLoading(true);
      this.chatState.clearMessages();
      this.chatState.clearClaudeMessages();

      // TODO: Replace with RPC call
      this.logger.info(
        'Switching session (RPC not implemented yet)',
        'ChatService'
      );
    } catch (error) {
      this.logger.error('Failed to switch session', 'ChatService', error);
      throw error;
    } finally {
      this.appState.setLoading(false);
    }
  }

  /**
   * Create a new session (command only)
   *
   * @param name - Optional session name
   */
  async createNewSession(name?: string): Promise<void> {
    try {
      this.appState.setLoading(true);
      const sessionName = name || `Session ${Date.now()}`;

      // TODO: Replace with RPC call
      this.logger.info(
        `Creating new session: ${sessionName} (RPC not implemented yet)`,
        'ChatService'
      );
    } catch (error) {
      this.logger.error('Failed to create new session', 'ChatService', error);
      throw error;
    } finally {
      this.appState.setLoading(false);
    }
  }

  /**
   * Pause current turn in interactive session (SIGTSTP)
   * TASK_2025_010: Interactive session management
   */
  async pauseChat(): Promise<void> {
    const currentSession = this.currentSession();
    if (!currentSession) {
      throw new Error('No active session available');
    }

    try {
      const result = await this.rpcService.pauseChat(currentSession.id);

      if (!result.isSuccess()) {
        throw new Error(result.error || 'Failed to pause chat');
      }

      this.logger.info('Chat paused successfully', 'ChatService', {
        sessionId: currentSession.id,
      });
    } catch (error) {
      this.logger.error('Failed to pause chat', 'ChatService', error);
      throw error;
    }
  }

  /**
   * Resume paused turn in interactive session (SIGCONT)
   * TASK_2025_010: Interactive session management
   */
  async resumeChat(): Promise<void> {
    const currentSession = this.currentSession();
    if (!currentSession) {
      throw new Error('No active session available');
    }

    try {
      const result = await this.rpcService.resumeChat(currentSession.id);

      if (!result.isSuccess()) {
        throw new Error(result.error || 'Failed to resume chat');
      }

      this.logger.info('Chat resumed successfully', 'ChatService', {
        sessionId: currentSession.id,
      });
    } catch (error) {
      this.logger.error('Failed to resume chat', 'ChatService', error);
      throw error;
    }
  }

  /**
   * Stop current turn and clear message queue (SIGTERM)
   * TASK_2025_010: Interactive session management
   */
  async stopChat(): Promise<void> {
    const currentSession = this.currentSession();
    if (!currentSession) {
      throw new Error('No active session available');
    }

    try {
      const result = await this.rpcService.stopChat(currentSession.id);

      if (!result.isSuccess()) {
        throw new Error(result.error || 'Failed to stop chat');
      }

      this.logger.info('Chat stopped successfully', 'ChatService', {
        sessionId: currentSession.id,
      });
    } catch (error) {
      this.logger.error('Failed to stop chat', 'ChatService', error);
      throw error;
    }
  }

  /**
   * Stop current streaming (deprecated - use stopChat instead)
   * @deprecated Use stopChat() for interactive session management
   */
  stopStreaming(): void {
    this.stopChat().catch((error) => {
      this.logger.error('Failed to stop streaming', 'ChatService', error);
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
   * Refresh sessions list from backend (command only)
   */
  async refreshSessions(): Promise<void> {
    // TODO: Replace with RPC call
    this.logger.info(
      'Refreshing sessions (RPC not implemented yet)',
      'ChatService'
    );
  }
}
