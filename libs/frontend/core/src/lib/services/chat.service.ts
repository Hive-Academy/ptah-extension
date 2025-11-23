import { Injectable, computed, inject, signal } from '@angular/core';
import { ChatStateService } from './chat-state.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { LoggingService } from './logging.service';
import {
  StrictChatMessage,
  SessionId,
  MessageId,
  SessionSummary,
} from '@ptah-extension/shared';

/**
 * Agent Tree Node - Represents a subagent in the agent execution tree
 */
export interface AgentTreeNode {
  readonly agent: unknown;
  readonly activities: readonly unknown[];
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

  // Temporary state signals (NO event subscriptions updating these!)
  private readonly _agents = signal<readonly AgentTreeNode[]>([]);
  readonly agents = this._agents.asReadonly();

  private readonly _sessions = signal<SessionSummary[]>([]);
  readonly sessions = this._sessions.asReadonly();

  // Public signal-based API - delegates to ChatStateService
  readonly messages = this.chatState.messages;
  readonly claudeMessages = this.chatState.claudeMessages;
  readonly currentSession = this.chatState.currentSession;
  readonly isStreaming = computed(() => false); // Static - no streaming state

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
   * Send a message to Claude (command only - no response handling)
   *
   * @param content - Message content to send
   */
  async sendMessage(content: string): Promise<void> {
    const currentSession = this.currentSession();
    if (!currentSession) {
      throw new Error('No active session available');
    }

    if (!content.trim()) {
      throw new Error('Message content cannot be empty');
    }

    // Send to backend (RPC will handle response)
    try {
      // TODO: Replace with RPC call when implemented
      this.logger.info(
        'Sending message (RPC not implemented yet)',
        'ChatService'
      );
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
   * Stop current streaming (no-op - streaming removed)
   */
  stopStreaming(): void {
    // No-op - streaming state removed
    this.logger.debug(
      'stopStreaming called (no-op - streaming removed)',
      'ChatService'
    );
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
