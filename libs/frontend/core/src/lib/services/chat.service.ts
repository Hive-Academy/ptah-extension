/**
 * ChatService - PURGED for TASK_2025_023
 *
 * Will be rebuilt in Batch 5 as thin wrapper over ChatStore.
 * Keeping minimal shell for component compatibility.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { ChatStateService, AgentMetadata } from './chat-state.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { LoggingService } from './logging.service';
import { ClaudeRpcService } from './claude-rpc.service';
import {
  SessionId,
  SessionSummary,
  ClaudeToolEvent,
} from '@ptah-extension/shared';

/**
 * Agent Tree Node - Keeping for component compatibility
 */
export interface AgentTreeNode {
  readonly agent: AgentMetadata;
  readonly activities: readonly ClaudeToolEvent[];
  readonly status: 'running' | 'complete' | 'error';
  readonly duration?: number;
  readonly errorMessage?: string;
}

/**
 * TEMPORARY: Minimal ChatService shell
 * Full implementation in Batch 5
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly chatState = inject(ChatStateService);
  private readonly vscode = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly rpcService = inject(ClaudeRpcService);

  // Minimal signals for component compatibility
  private readonly _sessions = signal<SessionSummary[]>([]);
  readonly sessions = this._sessions.asReadonly();

  // Delegate to ChatStateService (will be replaced by ChatStore)
  readonly messages = this.chatState.messages;
  readonly claudeMessages = this.chatState.claudeMessages;
  readonly currentSession = this.chatState.currentSession;
  readonly isStreaming = this.chatState.isStreaming;
  readonly toolTimeline = this.chatState.toolTimeline;
  readonly toolExecutions = this.chatState.toolTimeline;
  readonly activeAgents = this.chatState.activeAgents;
  readonly sessionMetrics = this.chatState.sessionMetrics;
  readonly claudeSessionId = this.chatState.claudeSessionId;

  // Computed for components
  readonly activeAgentNodes = computed<readonly AgentTreeNode[]>(() => []);
  readonly pendingPermissions = computed(() => {
    const permission = this.chatState.permissionDialog();
    return permission ? [permission] : [];
  });
  readonly currentThinking = computed(() => null);
  readonly hasMessages = this.chatState.hasMessages;
  readonly messageCount = this.chatState.messageCount;
  readonly recentSessions = computed(() =>
    this.sessions()
      .slice()
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 10)
      .filter((s) => s.messageCount > 0)
  );

  // STUB methods - will be implemented in Batch 5
  async sendMessage(content: string, files?: string[]): Promise<void> {
    console.warn(
      '[ChatService] STUB - sendMessage() not implemented (TASK_2025_023)'
    );
    this.logger.info('sendMessage STUB', 'ChatService', { content, files });
  }

  async switchToSession(sessionId: SessionId): Promise<void> {
    console.warn(
      '[ChatService] STUB - switchToSession() not implemented (TASK_2025_023)'
    );
  }

  async createNewSession(name?: string): Promise<void> {
    console.warn(
      '[ChatService] STUB - createNewSession() not implemented (TASK_2025_023)'
    );
  }

  async pauseChat(): Promise<void> {
    console.warn(
      '[ChatService] STUB - pauseChat() not implemented (TASK_2025_023)'
    );
  }

  async resumeChat(): Promise<void> {
    console.warn(
      '[ChatService] STUB - resumeChat() not implemented (TASK_2025_023)'
    );
  }

  async stopChat(): Promise<void> {
    console.warn(
      '[ChatService] STUB - stopChat() not implemented (TASK_2025_023)'
    );
  }

  stopStreaming(): void {
    console.warn(
      '[ChatService] STUB - stopStreaming() not implemented (TASK_2025_023)'
    );
  }

  clearMessages(): void {
    this.chatState.clearMessages();
    this.chatState.clearClaudeMessages();
  }

  async refreshSessions(): Promise<void> {
    console.warn(
      '[ChatService] STUB - refreshSessions() not implemented (TASK_2025_023)'
    );
  }
}
