/**
 * Session Lifecycle Manager - Handles SDK session creation and management
 *
 * Responsibilities:
 * - Session creation and storage
 * - Message queue management
 * - Abort controller lifecycle
 * - Session cleanup
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SessionId, AISessionConfig } from '@ptah-extension/shared';
import { SdkSessionStorage } from '../sdk-session-storage';
import { StoredSession } from '../types/sdk-session.types';
import { SDK_TOKENS } from '../di/tokens';
import * as vscode from 'vscode';

/**
 * UUID type for SDK message identifiers
 */
type UUID = `${string}-${string}-${string}-${string}-${string}`;

/**
 * User message structure for SDK streaming input
 *
 * Matches the official SDK type from @anthropic-ai/claude-agent-sdk/sdk.d.ts:
 * - type: 'user'
 * - message: APIUserMessage (role + content)
 * - parent_tool_use_id: string | null (required)
 * - uuid?: UUID (optional)
 * - session_id: string (required)
 */
export type SDKUserMessage = {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  parent_tool_use_id: string | null;
  uuid?: UUID;
  session_id: string;
};

/**
 * Content block for multi-modal messages (text + images)
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
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
  // Query may be null during pre-registration (before SDK query is created)
  query: Query | null;
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
@injectable()
export class SessionLifecycleManager {
  private activeSessions = new Map<string, ActiveSession>();
  /** Maps real Claude session ID → placeholder session ID for reverse lookup */
  private sessionIdMapping = new Map<string, string>();

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_STORAGE) private storage: SdkSessionStorage
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
   * Pre-register active session (before SDK query is created)
   * This allows UserMessageStreamFactory to find the session and queue messages
   * before the SDK query object exists.
   */
  preRegisterActiveSession(
    sessionId: SessionId,
    config: AISessionConfig,
    abortController: AbortController
  ): void {
    const session: ActiveSession = {
      sessionId,
      query: null, // Will be set later via setSessionQuery
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      currentModel: config.model || '', // Set from SDK via RPC layer
    };

    this.activeSessions.set(sessionId as string, session);
    this.logger.info(
      `[SessionLifecycle] Pre-registered active session: ${sessionId}`
    );
  }

  /**
   * Set the SDK query for a pre-registered session
   */
  setSessionQuery(sessionId: SessionId, query: Query): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.error(
        `[SessionLifecycle] Cannot set query - session not found: ${sessionId}`
      );
      return;
    }

    session.query = query;
    this.logger.debug(`[SessionLifecycle] Set query for session: ${sessionId}`);
  }

  /**
   * Register active session (legacy - combines pre-register and set query)
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
      currentModel: config.model || '', // Set from SDK via RPC layer
    };

    this.activeSessions.set(sessionId as string, session);
    this.logger.info(
      `[SessionLifecycle] Registered active session: ${sessionId}`
    );
  }

  /**
   * Register mapping from real Claude session ID to placeholder
   * Called by StreamTransformer when session ID is resolved
   */
  registerSessionIdMapping(
    realSessionId: string,
    placeholderSessionId: string
  ): void {
    this.sessionIdMapping.set(realSessionId, placeholderSessionId);
    this.logger.debug(
      `[SessionLifecycle] Registered ID mapping: ${realSessionId.slice(
        0,
        8
      )}... → ${placeholderSessionId.slice(0, 8)}...`
    );
  }

  /**
   * Get active session - checks both placeholder and real session IDs
   */
  getActiveSession(sessionId: SessionId): ActiveSession | undefined {
    // First try direct lookup by sessionId
    let session = this.activeSessions.get(sessionId as string);
    if (session) return session;

    // Try mapping from real Claude ID to placeholder
    const placeholderId = this.sessionIdMapping.get(sessionId as string);
    if (placeholderId) {
      session = this.activeSessions.get(placeholderId);
    }
    return session;
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

    // Interrupt the SDK query (if initialized)
    if (session.query) {
      session.query.interrupt().catch((err) => {
        this.logger.warn(
          `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
          err
        );
      });
    }

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
      if (session.query) {
        session.query.interrupt().catch((err) => {
          this.logger.warn(
            `[SessionLifecycle] Failed to interrupt session ${sessionId}`,
            err
          );
        });
      }
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
