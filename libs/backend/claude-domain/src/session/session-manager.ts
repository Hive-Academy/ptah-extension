/**
 * SessionManager - Complete session management business logic
 *
 * Migrated from apps/ptah-extension-vscode/src/services/session-manager.ts (763 lines)
 * This service provides comprehensive session lifecycle management with real-time updates.
 *
 * Verification trail:
 * - Pattern source: workspace.service.ts (Phase 6.2), context.service.ts (Phase 6.1)
 * - Uses @injectable() and @inject() decorators from tsyringe
 * - Implements complete session CRUD operations
 * - Event-driven architecture with IEventBus
 * - Persistence through injected storage service
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import {
  SessionId,
  MessageId,
  StrictChatSession,
  StrictChatMessage,
  CHAT_MESSAGE_TYPES,
} from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { IEventBus } from '../events/claude-domain.events';
import { SessionProxy } from './session-proxy';

/**
 * Storage service interface for persistence
 */
export interface IStorageService {
  get<T>(key: string, defaultValue?: T): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
}

/**
 * UI-specific session data for session management
 */
export interface SessionUIData {
  readonly id: string;
  readonly name: string;
  readonly workspaceId?: string;
  readonly messageCount: number;
  readonly tokenUsage: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
  };
  readonly createdAt: number; // Changed to timestamp for consistency
  readonly lastActiveAt: number; // Changed to timestamp
  readonly isActive: boolean;
}

/**
 * Claude CLI session information (from system init messages)
 */
export interface ClaudeSessionInfo {
  model: string;
  tools: string[];
  cwd: string;
  capabilities: Record<string, unknown>;
}

/**
 * Session creation options
 */
export interface CreateSessionOptions {
  name?: string;
  workspaceId?: string;
}

/**
 * Message addition options
 */
export interface AddMessageOptions {
  sessionId: SessionId;
  content: string;
  type: 'user' | 'assistant' | 'system';
  files?: string[];
  tokenCount?: number;
}

/**
 * Session statistics for analytics
 */
export interface SessionStatistics {
  total: number;
  active: number;
  recentlyUsed: number;
  totalMessages: number;
  totalTokens: number;
  avgMessagesPerSession: number;
  avgTokensPerMessage: number;
}

/**
 * Bulk delete result
 */
export interface BulkDeleteResult {
  deleted: string[];
  failed: Array<{ id: string; reason: string }>;
}

/**
 * SessionManager - Complete session lifecycle management
 *
 * Complete business logic implementation for:
 * - Session CRUD operations
 * - Message management
 * - Token usage tracking
 * - Claude CLI session mapping
 * - Real-time UI updates via events
 * - Persistence management
 * - Session export (JSON/Markdown)
 * - Analytics and statistics
 *
 * Pattern: Event-driven architecture with dependency injection
 * No VS Code API dependencies (all injected)
 *
 * @example
 * ```typescript
 * const sessionManager = container.resolve<SessionManager>(TOKENS.SESSION_MANAGER);
 *
 * // Create session
 * const session = await sessionManager.createSession({ name: 'My Session' });
 *
 * // Send message
 * await sessionManager.addUserMessage({
 *   sessionId: session.id,
 *   content: 'Hello Claude',
 *   files: ['/path/to/file.ts']
 * });
 *
 * // Get all sessions
 * const sessions = sessionManager.getAllSessions();
 * ```
 */
@injectable()
export class SessionManager {
  private sessions: Map<SessionId, StrictChatSession> = new Map();
  private currentSessionId?: SessionId;
  private claudeSessionIds = new Map<SessionId, string>(); // sessionId -> claudeSessionId
  private claudeSessionInfo = new Map<SessionId, ClaudeSessionInfo>();
  private sessionCounter = 1;

  // Storage keys
  private readonly SESSIONS_KEY = 'ptah.sessions';
  private readonly CURRENT_SESSION_KEY = 'ptah.currentSessionId';

  constructor(
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: IEventBus,
    @inject(TOKENS.STORAGE_SERVICE) private readonly storage: IStorageService,
    @inject(TOKENS.SESSION_PROXY) private readonly sessionProxy: SessionProxy
  ) {
    this.loadSessions();
  }

  // ============================================================================
  // CORE SESSION CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new chat session
   *
   * @param options - Session creation options
   * @returns Created session
   */
  async createSession(
    options: CreateSessionOptions = {}
  ): Promise<StrictChatSession> {
    const now = Date.now();
    const sessionId = this.generateSessionId();

    const session: StrictChatSession = {
      id: sessionId,
      name: options.name || `Session ${this.sessionCounter++}`,
      workspaceId: options.workspaceId,
      messages: [],
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now,
      messageCount: 0,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
        percentage: 0,
        maxTokens: 200000, // Default max tokens
      },
    };

    this.sessions.set(session.id, session);
    this.currentSessionId = session.id;

    await this.saveSessions();

    // Publish session created event
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_CREATED, { session });
    this.notifySessionsChanged();

    return session;
  }

  /**
   * Get current active session
   *
   * UPDATED: Now delegates to SessionProxy for message reading
   * Only keeps session metadata in memory
   *
   * @returns Current session or undefined
   */
  async getCurrentSession(): Promise<StrictChatSession | undefined> {
    if (!this.currentSessionId) {
      return undefined;
    }

    const sessionMetadata = this.sessions.get(this.currentSessionId);
    if (!sessionMetadata) {
      return undefined;
    }

    // Read messages from .jsonl via SessionProxy
    const messages = await this.sessionProxy.getSessionMessages(
      this.currentSessionId
    );

    return {
      ...sessionMetadata,
      messages,
      messageCount: messages.length,
    };
  }

  /**
   * Get session by ID
   *
   * @param sessionId - Session ID to retrieve
   * @returns Session or undefined
   */
  getSession(sessionId: SessionId): StrictChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions sorted by last activity
   *
   * UPDATED: Now delegates to SessionProxy for session list
   * Messages are NOT loaded for list view (performance optimization)
   *
   * @returns Array of all sessions
   */
  async getAllSessions(): Promise<StrictChatSession[]> {
    // Read session list from .jsonl directory via SessionProxy
    const sessionSummaries = await this.sessionProxy.listSessions();

    // Convert summaries to StrictChatSession format (without messages)
    const sessions = sessionSummaries.map((summary) => ({
      id: summary.id as SessionId,
      name: summary.name,
      workspaceId: undefined, // SessionSummary doesn't have workspaceId
      messages: [] as unknown as readonly StrictChatMessage[], // Don't load messages for list
      createdAt: summary.createdAt,
      lastActiveAt: summary.lastActiveAt,
      updatedAt: summary.lastActiveAt,
      messageCount: summary.messageCount,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
        percentage: 0,
        maxTokens: 200000,
      },
    }));

    return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * Switch to a different session
   *
   * @param sessionId - Session ID to switch to
   * @returns True if successful, false if session not found
   */
  async switchSession(sessionId: SessionId): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.currentSessionId = sessionId;
    const now = Date.now();
    this.mutateSession(session, { lastActiveAt: now, updatedAt: now });

    await this.saveSessions();

    // Publish session switched event
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_SWITCHED, { session });
    this.notifySessionsChanged();

    return true;
  }

  /**
   * Delete a session
   *
   * @param sessionId - Session ID to delete
   * @returns True if deleted, false if not found
   */
  async deleteSession(sessionId: SessionId): Promise<boolean> {
    if (!this.sessions.has(sessionId)) {
      return false;
    }

    this.sessions.delete(sessionId);
    this.claudeSessionIds.delete(sessionId);
    this.claudeSessionInfo.delete(sessionId);

    // If we deleted the current session, clear it
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = undefined;
    }

    await this.saveSessions();

    // Publish session deleted event
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_DELETED, { sessionId });
    this.notifySessionsChanged();

    return true;
  }

  /**
   * Rename a session
   *
   * @param sessionId - Session ID to rename
   * @param newName - New session name
   * @returns True if renamed, false if not found
   */
  async renameSession(sessionId: SessionId, newName: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const now = Date.now();
    this.mutateSession(session, {
      name: newName,
      lastActiveAt: now,
      updatedAt: now,
    });

    await this.saveSessions();

    // Publish session renamed event
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_RENAMED, {
      sessionId,
      newName,
    });
    this.notifySessionsChanged();

    return true;
  }

  /**
   * Clear all messages from a session
   *
   * @param sessionId - Session ID to clear
   * @returns True if cleared, false if not found
   */
  async clearSession(sessionId: SessionId): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const now = Date.now();
    this.mutateSession(session, {
      messages: [] as unknown as readonly StrictChatMessage[],
      messageCount: 0,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
        percentage: 0,
        maxTokens: session.tokenUsage.maxTokens,
      },
      lastActiveAt: now,
      updatedAt: now,
    });

    await this.saveSessions();

    // Publish session updated event
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_UPDATED, { session });
    this.notifySessionsChanged();

    return true;
  }

  /**
   * Touch session to update last active time (for session resumption tracking)
   *
   * @param sessionId - Session ID to touch
   */
  touchSession(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const now = Date.now();
      this.mutateSession(session, { lastActiveAt: now, updatedAt: now });
    }
  }

  // ============================================================================
  // MESSAGE MANAGEMENT
  // ============================================================================

  /**
   * Add user message to session
   *
   * @param options - Message addition options
   * @returns Created message
   */
  async addUserMessage(
    options: Omit<AddMessageOptions, 'type'>
  ): Promise<StrictChatMessage> {
    const session = this.sessions.get(options.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }

    const message: StrictChatMessage = {
      id: this.generateMessageId(),
      sessionId: options.sessionId,
      type: 'user',
      contentBlocks: [{ type: 'text', text: options.content }] as const,
      timestamp: Date.now(),
      files: options.files,
    };

    // Mutate messages array (readonly is compile-time only)
    (session.messages as StrictChatMessage[]).push(message);

    const now = Date.now();
    const estimatedTokens = Math.ceil(options.content.length / 4);

    this.mutateSession(session, {
      messageCount: session.messages.length,
      lastActiveAt: now,
      updatedAt: now,
      tokenUsage: {
        ...session.tokenUsage,
        input: session.tokenUsage.input + estimatedTokens,
        total: session.tokenUsage.total + estimatedTokens,
      },
    });

    this.updateTokenPercentage(session);

    await this.saveSessions();

    // Publish events
    this.eventBus.publish(CHAT_MESSAGE_TYPES.MESSAGE_ADDED, {
      sessionId: options.sessionId,
      message,
    });
    this.eventBus.publish(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED, {
      sessionId: options.sessionId,
      tokenUsage: session.tokenUsage,
    });
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_UPDATED, { session });
    this.notifySessionsChanged();

    return message;
  }

  /**
   * Add assistant message to session
   *
   * @param options - Message addition options
   * @returns Created message
   */
  async addAssistantMessage(
    options: Omit<AddMessageOptions, 'type' | 'files'>
  ): Promise<StrictChatMessage> {
    const session = this.sessions.get(options.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${options.sessionId}`);
    }

    const message: StrictChatMessage = {
      id: this.generateMessageId(),
      sessionId: options.sessionId,
      type: 'assistant',
      contentBlocks: [{ type: 'text', text: options.content }] as const,
      timestamp: Date.now(),
      streaming: false,
      isComplete: true,
    };

    // Mutate messages array (readonly is compile-time only)
    (session.messages as StrictChatMessage[]).push(message);

    const now = Date.now();
    const tokenCount =
      options.tokenCount || Math.ceil(options.content.length / 4);

    this.mutateSession(session, {
      messageCount: session.messages.length,
      lastActiveAt: now,
      updatedAt: now,
      tokenUsage: {
        ...session.tokenUsage,
        output: session.tokenUsage.output + tokenCount,
        total: session.tokenUsage.total + tokenCount,
      },
    });

    this.updateTokenPercentage(session);

    await this.saveSessions();

    // Publish events
    this.eventBus.publish(CHAT_MESSAGE_TYPES.MESSAGE_ADDED, {
      sessionId: options.sessionId,
      message,
    });
    this.eventBus.publish(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED, {
      sessionId: options.sessionId,
      tokenUsage: session.tokenUsage,
    });
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_UPDATED, { session });
    this.notifySessionsChanged();

    return message;
  }

  // ============================================================================
  // CLAUDE CLI SESSION MAPPING
  // ============================================================================

  /**
   * Get Claude CLI session ID for resumption
   *
   * @param sessionId - Ptah session ID
   * @returns Claude CLI session ID or undefined
   */
  getClaudeSessionId(sessionId: SessionId): string | undefined {
    return this.claudeSessionIds.get(sessionId);
  }

  /**
   * Get current session's Claude CLI session ID
   *
   * @returns Claude CLI session ID or undefined
   */
  getCurrentClaudeSessionId(): string | undefined {
    if (!this.currentSessionId) return undefined;
    return this.claudeSessionIds.get(this.currentSessionId);
  }

  /**
   * Set Claude CLI session ID for session resumption
   *
   * @param sessionId - Ptah session ID
   * @param claudeSessionId - Claude CLI session ID
   */
  setClaudeSessionId(sessionId: SessionId, claudeSessionId: string): void {
    this.claudeSessionIds.set(sessionId, claudeSessionId);
  }

  /**
   * Store Claude CLI session information from system init
   *
   * @param sessionId - Ptah session ID
   * @param info - Claude session info
   */
  setClaudeSessionInfo(sessionId: SessionId, info: ClaudeSessionInfo): void {
    this.claudeSessionInfo.set(sessionId, info);

    // Update max tokens based on model
    const session = this.sessions.get(sessionId);
    if (session) {
      const maxTokens = this.getMaxTokensForModel(info.model);
      this.mutateSession(session, {
        tokenUsage: {
          ...session.tokenUsage,
          maxTokens,
        },
      });
      this.updateTokenPercentage(session);
    }
  }

  /**
   * Get Claude CLI session information
   *
   * @param sessionId - Ptah session ID
   * @returns Claude session info or undefined
   */
  getClaudeSessionInfo(sessionId: SessionId): ClaudeSessionInfo | undefined {
    return this.claudeSessionInfo.get(sessionId);
  }

  // ============================================================================
  // UI DATA FORMATTING
  // ============================================================================

  /**
   * Get sessions formatted for UI display
   *
   * UPDATED: Now delegates to SessionProxy
   *
   * @returns Array of UI-formatted session data
   */
  async getSessionsUIData(): Promise<SessionUIData[]> {
    const sessions = await this.getAllSessions();
    return sessions
      .map(
        (session): SessionUIData => ({
          id: session.id,
          name: session.name,
          workspaceId: session.workspaceId,
          messageCount: session.messageCount,
          tokenUsage: {
            input: session.tokenUsage.input,
            output: session.tokenUsage.output,
            total: session.tokenUsage.total,
          },
          createdAt: session.createdAt,
          lastActiveAt: session.lastActiveAt,
          isActive: this.currentSessionId === session.id,
        })
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * Get current session as UI data
   *
   * UPDATED: Now awaits getCurrentSession()
   *
   * @returns Current session UI data or undefined
   */
  async getCurrentSessionUIData(): Promise<SessionUIData | undefined> {
    const session = await this.getCurrentSession();
    if (!session) return undefined;

    return {
      id: session.id,
      name: session.name,
      workspaceId: session.workspaceId,
      messageCount: session.messageCount,
      tokenUsage: {
        input: session.tokenUsage.input,
        output: session.tokenUsage.output,
        total: session.tokenUsage.total,
      },
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      isActive: true,
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Delete multiple sessions at once
   *
   * @param sessionIds - Array of session IDs to delete
   * @returns Result with deleted and failed sessions
   */
  async bulkDeleteSessions(sessionIds: SessionId[]): Promise<BulkDeleteResult> {
    const deleted: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const sessionId of sessionIds) {
      try {
        if (await this.deleteSession(sessionId)) {
          deleted.push(sessionId);
        } else {
          failed.push({ id: sessionId, reason: 'Session not found' });
        }
      } catch (error) {
        failed.push({
          id: sessionId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (deleted.length > 0) {
      this.notifySessionsChanged();
    }

    return { deleted, failed };
  }

  // ============================================================================
  // EXPORT & ANALYTICS
  // ============================================================================

  /**
   * Export session to JSON or Markdown format
   *
   * @param sessionId - Session ID to export
   * @param format - Export format (json or markdown)
   * @returns Exported session string
   */
  async exportSession(
    sessionId: SessionId,
    format: 'json' | 'markdown' = 'markdown'
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (format === 'json') {
      return JSON.stringify(session, null, 2);
    }

    // Markdown format
    const lines: string[] = [];
    lines.push(`# ${session.name}\n`);
    lines.push(
      `**Created:** ${new Date(session.createdAt).toLocaleDateString()}`
    );
    lines.push(
      `**Last Active:** ${new Date(session.lastActiveAt).toLocaleDateString()}`
    );
    lines.push(`**Messages:** ${session.messageCount}`);
    lines.push(`**Tokens:** ${session.tokenUsage.total}\n`);
    lines.push(`---\n`);

    for (const message of session.messages) {
      const timestamp = new Date(message.timestamp).toLocaleString();

      if (message.type === 'user') {
        lines.push(`## 👤 User (${timestamp})\n`);
        // Extract text from contentBlocks
        const textContent = message.contentBlocks
          .filter((block) => block.type === 'text')
          .map((block) => (block as { type: 'text'; text: string }).text)
          .join('\n');
        lines.push(`${textContent}\n`);

        if (message.files && message.files.length > 0) {
          lines.push(`**Attached Files:**`);
          for (const file of message.files) {
            lines.push(`- ${file}`);
          }
          lines.push('');
        }
      } else if (message.type === 'assistant') {
        lines.push(`## 🤖 Claude (${timestamp})\n`);
        // Extract text from contentBlocks
        const textContent = message.contentBlocks
          .filter((block) => block.type === 'text')
          .map((block) => (block as { type: 'text'; text: string }).text)
          .join('\n');
        lines.push(`${textContent}\n`);
      }

      lines.push(`---\n`);
    }

    return lines.join('\n');
  }

  /**
   * Get session statistics for analytics dashboard
   *
   * @returns Session statistics
   */
  getSessionStatistics(): SessionStatistics {
    const sessions = Array.from(this.sessions.values());
    const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
    const totalTokens = sessions.reduce(
      (sum, s) => sum + s.tokenUsage.total,
      0
    );

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    return {
      total: sessions.length,
      active: sessions.filter((s) => s.messageCount > 0).length,
      recentlyUsed: sessions.filter((s) => s.lastActiveAt > dayAgo).length,
      totalMessages,
      totalTokens,
      avgMessagesPerSession:
        sessions.length > 0 ? totalMessages / sessions.length : 0,
      avgTokensPerMessage: totalMessages > 0 ? totalTokens / totalMessages : 0,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Generate unique session ID
   */
  private generateSessionId(): SessionId {
    return SessionId.create();
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): MessageId {
    return MessageId.create();
  }

  /**
   * Get max tokens for a specific model
   */
  private getMaxTokensForModel(model: string): number {
    if (model.includes('opus')) return 200000;
    if (model.includes('sonnet')) return 200000;
    if (model.includes('haiku')) return 200000;
    return 200000; // Default
  }

  /**
   * Update token usage percentage
   * Note: TypeScript readonly is compile-time only - safe to mutate at runtime
   */
  private updateTokenPercentage(session: StrictChatSession): void {
    const maxTokens = session.tokenUsage.maxTokens || 200000;
    (session.tokenUsage as { percentage: number }).percentage =
      (session.tokenUsage.total / maxTokens) * 100;
  }

  /**
   * Helper to mutate session properties (TypeScript readonly is compile-time only)
   */
  private mutateSession<K extends keyof StrictChatSession>(
    session: StrictChatSession,
    updates: Partial<Pick<StrictChatSession, K>>
  ): void {
    Object.assign(session, updates);
  }

  private loadSessions(): void {
    try {
      const sessionsData =
        this.storage.get<StrictChatSession[]>(this.SESSIONS_KEY) || [];
      const currentSessionId = this.storage.get<SessionId>(
        this.CURRENT_SESSION_KEY
      );

      for (const session of sessionsData) {
        this.sessions.set(session.id, session);
      }

      this.currentSessionId = currentSessionId;

      // Find highest session counter for new sessions
      const sessionNumbers = Array.from(this.sessions.values()).map((s) => {
        const match = s.name.match(/Session (\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      });

      if (sessionNumbers.length > 0) {
        this.sessionCounter = Math.max(...sessionNumbers) + 1;
      }
    } catch (error) {
      console.error('Failed to load sessions from storage:', error);
    }
  }

  /**
   * Save sessions to storage
   */
  private async saveSessions(): Promise<void> {
    try {
      const sessionsData = Array.from(this.sessions.values());
      await this.storage.set(this.SESSIONS_KEY, sessionsData);
      await this.storage.set(this.CURRENT_SESSION_KEY, this.currentSessionId);
    } catch (error) {
      console.error('Failed to save sessions to storage:', error);
    }
  }

  /**
   * Notify subscribers of session changes
   */
  private async notifySessionsChanged(): Promise<void> {
    const sessions = await this.getAllSessions();
    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSIONS_UPDATED, {
      sessions,
    });
  }
}
