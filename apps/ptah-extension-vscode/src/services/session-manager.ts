import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { Logger } from '../core/logger';
import { SessionInfo } from '@ptah-extension/shared';
import { SessionId, MessageId } from '@ptah-extension/shared';
import { StrictChatSession, StrictChatMessage } from '@ptah-extension/shared';

/**
 * UI-specific session data for enhanced session management
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
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly isActive: boolean;
}

/**
 * Session state change events for real-time UI updates
 */
export interface SessionStateEvents {
  sessionCreated: (session: StrictChatSession) => void;
  sessionSwitched: (session: StrictChatSession) => void;
  sessionRenamed: (sessionId: string, newName: string) => void;
  sessionDeleted: (sessionId: string) => void;
  sessionUpdated: (session: StrictChatSession) => void;
  sessionsChanged: (sessions: StrictChatSession[]) => void;
  messageAdded: (sessionId: string, message: StrictChatMessage) => void;
  tokenUsageUpdated: (sessionId: string, tokenUsage: StrictChatSession['tokenUsage']) => void;
}

export class SessionManager extends EventEmitter implements vscode.Disposable {
  private sessions: Map<string, StrictChatSession> = new Map();
  private currentSessionId?: string;
  private disposables: vscode.Disposable[] = [];
  private sessionUpdateTimer?: NodeJS.Timeout;
  private readonly sessionStateChangeCallbacks = new Map<
    string,
    ((sessions: SessionUIData[]) => void)[]
  >();

  // Track Claude CLI session IDs for resumption
  private claudeSessionIds = new Map<string, string>(); // sessionId -> claudeSessionId

  // Track detailed Claude CLI session info (from system init messages)
  private claudeSessionInfo = new Map<
    string,
    {
      model: string;
      tools: string[];
      cwd: string;
      capabilities: Record<string, any>;
    }
  >();

  constructor(private context: vscode.ExtensionContext) {
    super();
    this.loadSessions();
    this.setupPeriodicUpdates();
  }

  /**
   * Get Claude CLI session ID for resumption
   */
  getClaudeSessionId(sessionId: string): string | undefined {
    return this.claudeSessionIds.get(sessionId);
  }

  /**
   * Get current session's Claude CLI session ID for resumption
   */
  getCurrentClaudeSessionId(): string | undefined {
    if (!this.currentSessionId) return undefined;
    return this.claudeSessionIds.get(this.currentSessionId);
  }

  /**
   * Set Claude CLI session ID for session resumption
   */
  setClaudeSessionId(sessionId: string, claudeSessionId: string): void {
    this.claudeSessionIds.set(sessionId, claudeSessionId);
    Logger.info(`Mapped session ${sessionId} to Claude CLI session ${claudeSessionId}`);
  }

  /**
   * Store Claude CLI session information from system init
   */
  setClaudeSessionInfo(
    sessionId: string,
    info: {
      model: string;
      tools: string[];
      cwd: string;
      capabilities: Record<string, any>;
    }
  ): void {
    this.claudeSessionInfo.set(sessionId, info);
    Logger.info(`Stored Claude CLI info for session ${sessionId}:`, {
      model: info.model,
      toolCount: info.tools.length,
      cwd: info.cwd,
    });
  }

  /**
   * Get Claude CLI session information
   */
  getClaudeSessionInfo(sessionId: string):
    | {
        model: string;
        tools: string[];
        cwd: string;
        capabilities: Record<string, any>;
      }
    | undefined {
    return this.claudeSessionInfo.get(sessionId);
  }

  async createSession(name?: string): Promise<StrictChatSession> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceId = workspaceFolder ? workspaceFolder.uri.fsPath : undefined;

    const now = Date.now();
    const session: StrictChatSession = {
      id: SessionId.create(uuidv4()),
      name: name || `Session ${this.sessions.size + 1}`,
      workspaceId,
      messages: [],
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now,
      messageCount: 0,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
      },
    };

    this.sessions.set(session.id, session);
    this.currentSessionId = session.id;

    Logger.info(`Created new session: ${session.name} (${session.id})`);

    await this.saveSessions();

    // Emit session created event for UI updates
    this.emit('sessionCreated', session);
    this.notifySessionsChanged();

    return session;
  }

  getCurrentSession(): StrictChatSession | undefined {
    if (!this.currentSessionId) {
      return undefined;
    }
    return this.sessions.get(this.currentSessionId);
  }

  async switchSession(sessionId: string): Promise<boolean> {
    if (!this.sessions.has(sessionId)) {
      Logger.warn(`Attempted to switch to non-existent session: ${sessionId}`);
      return false;
    }

    this.currentSessionId = sessionId;
    const session = this.sessions.get(sessionId)!;
    session.lastActiveAt = new Date();

    Logger.info(`Switched to session: ${session.name} (${sessionId})`);

    await this.saveSessions();

    // Emit session switched event for UI updates
    this.emit('sessionSwitched', session);
    this.notifySessionsChanged();

    return true;
  }

  async sendMessage(content: string, files?: string[]): Promise<ChatMessage> {
    const session = this.getCurrentSession();

    // Require that a session exists - no auto-creation here
    if (!session) {
      throw new Error('No active session. Session must be created before sending messages.');
    }

    const message: ChatMessage = {
      id: uuidv4(),
      sessionId: session.id,
      type: 'user',
      content,
      timestamp: new Date(),
      files,
    };

    session.messages.push(message);
    session.lastActiveAt = new Date();

    // Estimate token count for user message (rough estimate: 1 token per 4 characters)
    const estimatedTokens = Math.ceil(content.length / 4);
    session.tokenUsage.input += estimatedTokens;
    session.tokenUsage.total += estimatedTokens;

    Logger.info(`Added message to session ${session.id}: ${content.substring(0, 100)}...`);

    await this.saveSessions();

    // Emit message added event for UI updates
    this.emit('messageAdded', session.id, message);
    this.emit('tokenUsageUpdated', session.id, session.tokenUsage);
    this.emit('sessionUpdated', session);
    this.notifySessionsChanged();

    return message;
  }

  async addAssistantMessage(
    sessionId: string,
    content: string,
    tokenCount?: number
  ): Promise<ChatMessage> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const message: ChatMessage = {
      id: uuidv4(),
      sessionId,
      type: 'assistant',
      content,
      timestamp: new Date(),
      tokenCount,
    };

    session.messages.push(message);
    session.lastActiveAt = new Date();

    // Update token usage (estimate if not provided)
    const actualTokenCount = tokenCount || Math.ceil(content.length / 4);
    session.tokenUsage.output += actualTokenCount;
    session.tokenUsage.total += actualTokenCount;

    Logger.info(`Added assistant message to session ${sessionId}`);

    await this.saveSessions();

    // Emit message added and token usage updated events for UI updates
    this.emit('messageAdded', sessionId, message);
    this.emit('tokenUsageUpdated', sessionId, session.tokenUsage);
    this.emit('sessionUpdated', session);
    this.notifySessionsChanged();

    return message;
  }

  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime()
    );
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    if (!this.sessions.has(sessionId)) {
      return false;
    }

    this.sessions.delete(sessionId);

    // If we deleted the current session, clear current session
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = undefined;
    }

    Logger.info(`Deleted session: ${sessionId}`);

    await this.saveSessions();

    // Emit session deleted event for UI updates
    this.emit('sessionDeleted', sessionId);
    this.notifySessionsChanged();

    return true;
  }

  async clearSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.messages = [];
    session.tokenUsage = { input: 0, output: 0, total: 0 };
    session.lastActiveAt = new Date();

    Logger.info(`Cleared session: ${sessionId}`);

    await this.saveSessions();
    return true;
  }

  async renameSession(sessionId: string, newName: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.name = newName;
    session.lastActiveAt = new Date();

    Logger.info(`Renamed session ${sessionId} to: ${newName}`);

    await this.saveSessions();

    // Emit session renamed event for UI updates
    this.emit('sessionRenamed', sessionId, newName);
    this.notifySessionsChanged();

    return true;
  }

  async exportSession(
    sessionId: string,
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
    let markdown = `# ${session.name}\\n\\n`;
    markdown += `**Created:** ${session.createdAt.toLocaleDateString()}\\n`;
    markdown += `**Last Active:** ${session.lastActiveAt.toLocaleDateString()}\\n`;
    markdown += `**Messages:** ${session.messages.length}\\n`;
    markdown += `**Tokens:** ${session.tokenUsage.total}\\n\\n`;
    markdown += `---\\n\\n`;

    for (const message of session.messages) {
      const timestamp = message.timestamp.toLocaleString();

      if (message.type === 'user') {
        markdown += `## 👤 User (${timestamp})\\n\\n`;
        markdown += `${message.content}\\n\\n`;

        if (message.files && message.files.length > 0) {
          markdown += `**Attached Files:**\\n`;
          for (const file of message.files) {
            markdown += `- ${file}\\n`;
          }
          markdown += `\\n`;
        }
      } else if (message.type === 'assistant') {
        markdown += `## 🤖 Claude (${timestamp})\\n\\n`;
        markdown += `${message.content}\\n\\n`;

        if (message.tokenCount) {
          markdown += `*Tokens: ${message.tokenCount}*\\n\\n`;
        }
      }

      markdown += `---\\n\\n`;
    }

    return markdown;
  }

  async showSessionPicker(): Promise<void> {
    const sessions = this.getAllSessions();

    if (sessions.length === 0) {
      vscode.window.showInformationMessage(
        'No sessions available. Create a new session to get started.'
      );
      return;
    }

    interface SessionQuickPickItem extends vscode.QuickPickItem {
      session: ChatSession;
    }

    const items: SessionQuickPickItem[] = sessions.map((session) => ({
      label: session.name,
      description: `${session.messages.length} messages • ${session.tokenUsage.total} tokens`,
      detail: `Last active: ${session.lastActiveAt.toLocaleDateString()}`,
      session,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a session to switch to',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await this.switchSession(selected.session.id);
    }
  }

  private loadSessions(): void {
    try {
      const sessionsData = this.context.globalState.get<any[]>('ptah.sessions', []);
      const currentSessionId = this.context.globalState.get<string>('ptah.currentSessionId');

      for (const sessionData of sessionsData) {
        // Convert date strings back to Date objects
        const session: ChatSession = {
          ...sessionData,
          createdAt: new Date(sessionData.createdAt),
          lastActiveAt: new Date(sessionData.lastActiveAt),
          messages: sessionData.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
          })),
        };

        this.sessions.set(session.id, session);
      }

      this.currentSessionId = currentSessionId;

      Logger.info(`Loaded ${this.sessions.size} sessions from storage`);
    } catch (error) {
      Logger.error('Failed to load sessions from storage', error);
    }
  }

  private async saveSessions(): Promise<void> {
    try {
      const sessionsData = Array.from(this.sessions.values());
      await this.context.globalState.update('ptah.sessions', sessionsData);
      await this.context.globalState.update('ptah.currentSessionId', this.currentSessionId);

      Logger.info(`Saved ${sessionsData.length} sessions to storage`);
    } catch (error) {
      Logger.error('Failed to save sessions to storage', error);
    }
  }

  /**
   * UI-SPECIFIC METHODS - Enhanced session management for Angular webview
   */

  /**
   * Get sessions formatted for UI display with real-time data
   */
  getSessionsUIData(): SessionUIData[] {
    return Array.from(this.sessions.values())
      .map(
        (session): SessionUIData => ({
          id: session.id,
          name: session.name,
          workspaceId: session.workspaceId,
          messageCount: session.messages.length,
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
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  /**
   * Convert ChatSession to StrictChatSession for webview
   * Now includes real Claude CLI metadata and model information
   */
  toStrictChatSession(session: ChatSession): StrictChatSession {
    const now = Date.now();

    // Get Claude CLI session info for enhanced metadata
    const claudeInfo = this.getClaudeSessionInfo(session.id);
    const model = claudeInfo?.model || 'claude-opus-4-1-20250805';

    // Determine max tokens based on actual model from Claude CLI
    const maxTokens = model.includes('opus')
      ? 200000
      : model.includes('sonnet')
        ? 200000
        : model.includes('haiku')
          ? 200000
          : 200000;

    return {
      id: session.id as SessionId,
      name: session.name,
      workspaceId: session.workspaceId,
      messages: session.messages.map((msg) => {
        if (msg.type === 'assistant') {
          return {
            type: 'assistant' as const,
            id: msg.id as MessageId,
            sessionId: msg.sessionId as SessionId,
            content: msg.content,
            timestamp: msg.timestamp.getTime(),
            streaming: msg.streaming || false,
            isComplete: !msg.streaming,
          };
        } else if (msg.type === 'user') {
          return {
            type: 'user' as const,
            id: msg.id as MessageId,
            sessionId: msg.sessionId as SessionId,
            content: msg.content,
            timestamp: msg.timestamp.getTime(),
            files: msg.files,
          };
        } else {
          return {
            type: 'system' as const,
            id: msg.id as MessageId,
            sessionId: msg.sessionId as SessionId,
            content: msg.content,
            timestamp: msg.timestamp.getTime(),
            level: 'info' as const,
          };
        }
      }),
      createdAt: session.createdAt.getTime(),
      lastActiveAt: session.lastActiveAt.getTime(),
      updatedAt: session.lastActiveAt.getTime(), // Alias
      messageCount: session.messages.length,
      tokenUsage: {
        input: session.tokenUsage.input || 0,
        output: session.tokenUsage.output || 0,
        total: session.tokenUsage.total || 0,
        percentage: maxTokens > 0 ? ((session.tokenUsage.total || 0) / maxTokens) * 100 : 0,
        maxTokens,
      },
    };
  }

  /**
   * Get all sessions as StrictChatSession array
   */
  getAllStrictSessions(): StrictChatSession[] {
    return Array.from(this.sessions.values())
      .map((session) => this.toStrictChatSession(session))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * Get current session as StrictChatSession
   */
  getCurrentStrictSession(): StrictChatSession | undefined {
    const session = this.getCurrentSession();
    return session ? this.toStrictChatSession(session) : undefined;
  }

  /**
   * Subscribe to session state changes for real-time UI updates
   * Returns an unsubscribe function
   */
  subscribeToSessionChanges(
    callbackId: string,
    callback: (sessions: SessionUIData[]) => void
  ): () => void {
    if (!this.sessionStateChangeCallbacks.has(callbackId)) {
      this.sessionStateChangeCallbacks.set(callbackId, []);
    }
    this.sessionStateChangeCallbacks.get(callbackId)!.push(callback);

    // Send initial data
    callback(this.getSessionsUIData());

    // Return unsubscribe function
    return () => {
      const callbacks = this.sessionStateChangeCallbacks.get(callbackId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index >= 0) {
          callbacks.splice(index, 1);
        }
        if (callbacks.length === 0) {
          this.sessionStateChangeCallbacks.delete(callbackId);
        }
      }
    };
  }

  /**
   * Get current session with UI-optimized data
   */
  getCurrentSessionUIData(): SessionUIData | undefined {
    const session = this.getCurrentSession();
    if (!session) return undefined;

    return {
      id: session.id,
      name: session.name,
      workspaceId: session.workspaceId,
      messageCount: session.messages.length,
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

  /**
   * Switch session with sub-100ms response time optimization
   */
  async switchSessionFast(sessionId: string): Promise<SessionUIData | null> {
    const startTime = Date.now();

    if (!this.sessions.has(sessionId)) {
      Logger.warn(`Fast switch attempted to non-existent session: ${sessionId}`);
      return null;
    }

    // Skip unnecessary operations for fast switching
    this.currentSessionId = sessionId;
    const session = this.sessions.get(sessionId)!;
    session.lastActiveAt = new Date();

    // Emit events first, then save asynchronously
    this.emit('sessionSwitched', session);
    this.notifySessionsChanged();

    // Save asynchronously to not block UI
    this.saveSessions().catch((error) => {
      Logger.error('Background session save failed after fast switch', error);
    });

    const endTime = Date.now();
    Logger.info(`Fast session switch completed in ${endTime - startTime}ms`);

    return this.getCurrentSessionUIData()!;
  }

  /**
   * Bulk operations for session management
   */
  async bulkDeleteSessions(sessionIds: string[]): Promise<{
    deleted: string[];
    failed: Array<{ id: string; reason: string }>;
  }> {
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

  /**
   * Get session statistics for dashboard
   */
  getSessionStatistics(): {
    total: number;
    active: number;
    recentlyUsed: number;
    totalMessages: number;
    totalTokens: number;
    avgMessagesPerSession: number;
    avgTokensPerMessage: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
    const totalTokens = sessions.reduce((sum, s) => sum + s.tokenUsage.total, 0);

    const dayAgo = new Date();
    dayAgo.setDate(dayAgo.getDate() - 1);

    return {
      total: sessions.length,
      active: sessions.filter((s) => s.messages.length > 0).length,
      recentlyUsed: sessions.filter((s) => s.lastActiveAt > dayAgo).length,
      totalMessages,
      totalTokens,
      avgMessagesPerSession: sessions.length > 0 ? totalMessages / sessions.length : 0,
      avgTokensPerMessage: totalMessages > 0 ? totalTokens / totalMessages : 0,
    };
  }

  /**
   * Private helper methods for enhanced functionality
   */
  private setupPeriodicUpdates(): void {
    // Update UI every 5 seconds with fresh session data
    this.sessionUpdateTimer = setInterval(() => {
      if (this.sessionStateChangeCallbacks.size > 0) {
        this.notifySessionsChanged();
      }
    }, 5000);
  }

  private notifySessionsChanged(): void {
    const uiData = this.getSessionsUIData();
    this.sessionStateChangeCallbacks.forEach((callbacks) => {
      callbacks.forEach((callback) => {
        try {
          callback(uiData);
        } catch (error) {
          Logger.error('Error in session change callback', error);
        }
      });
    });

    // Emit generic sessions changed event
    this.emit('sessionsChanged', Array.from(this.sessions.values()));
  }

  dispose(): void {
    Logger.info('Disposing Session Manager...');

    // Clear update timer
    if (this.sessionUpdateTimer) {
      clearInterval(this.sessionUpdateTimer);
    }

    // Clear all callbacks
    this.sessionStateChangeCallbacks.clear();

    // Remove all event listeners
    this.removeAllListeners();

    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
