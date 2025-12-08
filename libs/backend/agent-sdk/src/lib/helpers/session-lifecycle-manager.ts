/**
 * Session Lifecycle Manager - Handles SDK session creation and management
 *
 * Responsibilities:
 * - Session creation and storage
 * - Message queue management
 * - Abort controller lifecycle
 * - Session cleanup
 */

import { Logger } from '@ptah-extension/vscode-core';
import { SessionId, AISessionConfig } from '@ptah-extension/shared';
import { SdkSessionStorage } from '../sdk-session-storage';
import { StoredSession } from '../types/sdk-session.types';
import * as vscode from 'vscode';

/**
 * UUID type for SDK message identifiers
 */
type UUID = `${string}-${string}-${string}-${string}-${string}`;

/**
 * User message structure for SDK streaming input
 */
export type SDKUserMessage = {
  type: 'user';
  uuid: UUID;
  session_id: string;
  message: {
    role: 'user';
    content: string;
  };
  parent_tool_use_id: string | null;
};

/**
 * Query interface - matches SDK's Query runtime structure
 */
export interface Query {
  [Symbol.asyncIterator](): AsyncIterator<any, void>;
  next(...args: any[]): Promise<IteratorResult<any, void>>;
  return?(value?: any): Promise<IteratorResult<any, void>>;
  throw?(e?: any): Promise<IteratorResult<any, void>>;
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
}

/**
 * Active session tracking
 */
export interface ActiveSession {
  readonly sessionId: SessionId;
  readonly query: Query;
  readonly config: AISessionConfig;
  readonly abortController: AbortController;
  // Mutable: Message queue for streaming input mode
  messageQueue: SDKUserMessage[];
  // Mutable: Callback to wake iterator when message arrives
  resolveNext: (() => void) | null;
  // Mutable: Current model
  currentModel: string;
}

/**
 * Manages SDK session lifecycle
 */
export class SessionLifecycleManager {
  private activeSessions = new Map<string, ActiveSession>();

  constructor(
    private logger: Logger,
    private storage: SdkSessionStorage
  ) {}

  /**
   * Create initial session record in storage
   */
  async createSessionRecord(sessionId: SessionId): Promise<StoredSession> {
    const workspaceId =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';

    const storedSession: StoredSession = {
      id: sessionId,
      workspaceId,
      name: `Session ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messages: [],
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
    };

    await this.storage.saveSession(storedSession);
    this.logger.debug(
      `[SessionLifecycle] Created session record: ${sessionId}`
    );

    return storedSession;
  }

  /**
   * Register active session
   */
  registerActiveSession(
    sessionId: SessionId,
    query: Query,
    config: AISessionConfig,
    abortController: AbortController
  ): void {
    const session: ActiveSession = {
      sessionId,
      query,
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      currentModel: config.model || 'claude-sonnet-4.5-20250929',
    };

    this.activeSessions.set(sessionId as string, session);
    this.logger.info(`[SessionLifecycle] Registered active session: ${sessionId}`);
  }

  /**
   * Get active session
   */
  getActiveSession(sessionId: SessionId): ActiveSession | undefined {
    return this.activeSessions.get(sessionId as string);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessionIds(): SessionId[] {
    return Array.from(this.activeSessions.keys()) as SessionId[];
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: SessionId): boolean {
    return this.activeSessions.has(sessionId as string);
  }

  /**
   * End session and cleanup
   */
  endSession(sessionId: SessionId): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.warn(
        `[SessionLifecycle] Cannot end session - not found: ${sessionId}`
      );
      return;
    }

    this.logger.info(`[SessionLifecycle] Ending session: ${sessionId}`);

    // Abort the session
    session.abortController.abort();

    // Interrupt the SDK query
    session.query.interrupt().catch((err) => {
      this.logger.warn(
        `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
        err
      );
    });

    // Remove from active sessions
    this.activeSessions.delete(sessionId as string);

    this.logger.info(`[SessionLifecycle] Session ended: ${sessionId}`);
  }

  /**
   * Cleanup all active sessions
   */
  disposeAllSessions(): void {
    this.logger.info('[SessionLifecycle] Disposing all active sessions...');

    for (const [sessionId, session] of this.activeSessions.entries()) {
      this.logger.debug(`[SessionLifecycle] Ending session: ${sessionId}`);
      session.abortController.abort();
      session.query.interrupt().catch((err) => {
        this.logger.warn(
          `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
          err
        );
      });
    }

    this.activeSessions.clear();
    this.logger.info('[SessionLifecycle] All sessions disposed');
  }

  /**
   * Get session count
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}
