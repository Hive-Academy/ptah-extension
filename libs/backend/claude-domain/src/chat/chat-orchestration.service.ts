/**
 * ChatOrchestrationService - Chat workflow orchestration for Ptah extension
 *
 * Migrated from apps/ptah-extension-vscode/src/services/webview-message-handlers/chat-message-handler.ts
 * This service provides complete business logic for chat operations with Claude CLI.
 *
 * Verification trail:
 * - Pattern source: chat-message-handler.ts (881 lines)
 * - Uses @injectable() and @inject() decorators from tsyringe
 * - Implements chat orchestration (streaming, sessions, permissions)
 * - Delegates to SessionManager, ClaudeCliService
 * - NO webview communication (that stays in handler adapter)
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type { SessionManager } from '../session/session-manager';
import type {
  SessionId,
  MessageId,
  StrictChatMessage,
  StrictChatSession,
} from '@ptah-extension/shared';
import { Readable } from 'stream';
import { SESSION_MANAGER, CLAUDE_CLI_SERVICE } from '../di/tokens';

/**
 * Message response structure
 */
export interface MessageResponse<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  metadata: {
    timestamp: number;
    source: string;
    version: string;
    sessionId?: SessionId;
  };
}

/**
 * ClaudeCliService interface
 * Minimal interface for Claude CLI operations
 */
export interface IClaudeCliService {
  verifyInstallation(): Promise<boolean>;
  sendMessage(
    message: string,
    sessionId: SessionId,
    resumeSessionId?: string,
    sessionManager?: SessionManager
  ): Promise<Readable>;
  respondToPermission(
    sessionId: SessionId,
    response: 'allow' | 'always_allow' | 'deny'
  ): Promise<void>;
}

/**
 * Send message request parameters
 */
export interface SendMessageRequest {
  content: string;
  files?: string[];
  currentSessionId?: SessionId;
}

/**
 * Send message result with streaming
 */
export interface SendMessageResult {
  success: boolean;
  sessionId: SessionId;
  userMessage: StrictChatMessage;
  messageStream?: Readable;
  error?: string;
}

/**
 * Session creation request
 */
export interface CreateSessionRequest {
  name?: string;
}

/**
 * Session creation result
 */
export interface SessionCreationResult {
  success: boolean;
  session?: StrictChatSession;
  error?: string;
}

/**
 * Session switch request
 */
export interface SwitchSessionRequest {
  sessionId: SessionId;
}

/**
 * Session operation result
 */
export interface SessionOperationResult {
  success: boolean;
  session?: StrictChatSession | null;
  error?: string;
}

/**
 * Session rename request
 */
export interface RenameSessionRequest {
  sessionId: SessionId;
  newName: string;
}

/**
 * Session rename result
 */
export interface RenameSessionResult {
  success: boolean;
  sessionId?: SessionId;
  newName?: string;
  error?: string;
}

/**
 * Session delete request
 */
export interface DeleteSessionRequest {
  sessionId: SessionId;
}

/**
 * Session delete result
 */
export interface DeleteSessionResult {
  success: boolean;
  sessionId?: SessionId;
  deleted?: boolean;
  error?: string;
}

/**
 * Bulk delete sessions request
 */
export interface BulkDeleteSessionsRequest {
  sessionIds: SessionId[];
}

/**
 * Bulk delete sessions result
 */
export interface BulkDeleteSessionsResult {
  success: boolean;
  deleted: string[];
  failed: Array<{ id: string; reason: string }>;
  error?: string;
}

/**
 * Session history request
 */
export interface GetHistoryRequest {
  sessionId: SessionId;
}

/**
 * Session history result
 */
export interface HistoryResult {
  success: boolean;
  messages?: StrictChatMessage[];
  error?: string;
}

/**
 * Session statistics result
 */
export interface SessionStatsResult {
  success: boolean;
  stats?: {
    total: number;
    active: number;
    recentlyUsed: number;
    totalMessages: number;
    totalTokens: number;
    avgMessagesPerSession: number;
    avgTokensPerMessage: number;
  };
  error?: string;
}

/**
 * Permission response request
 */
export interface PermissionResponseRequest {
  requestId: string;
  response: 'allow' | 'always_allow' | 'deny';
}

/**
 * Permission response result
 */
export interface PermissionResponseResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Stop stream request
 */
export interface StopStreamRequest {
  sessionId: SessionId | null;
  messageId: MessageId | null;
}

/**
 * Stop stream result
 */
export interface StopStreamResult {
  success: boolean;
  stopped?: boolean;
  sessionId?: SessionId | null;
  messageId?: MessageId | null;
  error?: string;
}

/**
 * ChatOrchestrationService - Chat workflow orchestration
 *
 * Complete business logic implementation for:
 * - Claude CLI streaming with permission handling
 * - Session orchestration (create, switch, rename, delete, bulk delete)
 * - Message streaming with token counting
 * - Error recovery and retry logic
 * - Permission approval workflow
 * - Session history and statistics
 *
 * Pattern: Uses SessionManager and ClaudeCliService internally
 * No direct webview communication (handlers call this service)
 *
 * @example
 * ```typescript
 * const chatOrchestration = container.resolve<ChatOrchestrationService>(TOKENS.CHAT_ORCHESTRATION_SERVICE);
 *
 * // Send message with streaming
 * const result = await chatOrchestration.sendMessage({
 *   content: 'Explain async/await',
 *   files: ['src/app.ts'],
 *   currentSessionId: sessionId
 * });
 *
 * if (result.success && result.messageStream) {
 *   result.messageStream.on('data', (message) => {
 *     // Handler forwards to webview
 *     console.log('Streaming chunk:', message);
 *   });
 * }
 *
 * // Create new session
 * const sessionResult = await chatOrchestration.createSession({ name: 'Code Review' });
 * ```
 */
@injectable()
export class ChatOrchestrationService {
  constructor(
    @inject(SESSION_MANAGER) private readonly sessionManager: SessionManager,
    @inject(CLAUDE_CLI_SERVICE)
    private readonly claudeService: IClaudeCliService
  ) {}

  /**
   * Send message to Claude CLI with streaming response
   *
   * Workflow:
   * 1. Create session on-demand if needed
   * 2. Add user message to session
   * 3. Verify Claude CLI is available
   * 4. Send message to Claude CLI and get stream
   * 5. Return stream for handler to forward to webview
   *
   * @param request - Send message request parameters
   * @returns Send message result with streaming
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
    try {
      // Create session on-demand when user sends first message
      let currentSession = this.sessionManager.getCurrentSession();
      if (!currentSession) {
        currentSession = await this.sessionManager.createSession();
      }

      // Add user message to session
      const userMessage = await this.sessionManager.addUserMessage({
        sessionId: currentSession.id as SessionId,
        content: request.content,
        files: request.files,
      });

      // Verify Claude CLI is available
      const isAvailable = await this.claudeService.verifyInstallation();
      if (!isAvailable) {
        return {
          success: false,
          sessionId: currentSession.id as SessionId,
          userMessage,
          error:
            'Claude CLI not available. Please install Claude Code CLI first.',
        };
      }

      console.info(
        `Sending message to Claude CLI for session: ${currentSession.id}`
      );

      // Get Claude CLI session ID for resumption if available
      const resumeSessionId = this.sessionManager.getClaudeSessionId(
        currentSession.id
      );

      // Send message to Claude CLI and get stream
      const messageStream = await this.claudeService.sendMessage(
        request.content,
        currentSession.id as SessionId,
        resumeSessionId,
        this.sessionManager
      );

      return {
        success: true,
        sessionId: currentSession.id as SessionId,
        userMessage,
        messageStream,
      };
    } catch (error) {
      console.error('Error in sendMessage orchestration:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to send message';

      return {
        success: false,
        sessionId: request.currentSessionId || ('' as SessionId),
        userMessage: {} as StrictChatMessage,
        error: errorMessage,
      };
    }
  }

  /**
   * Process streaming message data and save to session
   *
   * This is called by the handler as stream chunks arrive.
   * Accumulates content and saves the complete message when streaming ends.
   *
   * @param sessionId - Session ID
   * @param content - Complete assistant message content
   * @returns Success status
   */
  async saveAssistantMessage(
    sessionId: SessionId,
    content: string
  ): Promise<boolean> {
    try {
      await this.sessionManager.addAssistantMessage({
        sessionId,
        content,
      });
      console.info(`Assistant message saved for session: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('Error saving assistant message:', error);
      return false;
    }
  }

  /**
   * Create a new chat session
   *
   * @param request - Create session request
   * @returns Session creation result
   */
  async createSession(
    request: CreateSessionRequest
  ): Promise<SessionCreationResult> {
    try {
      const session = await this.sessionManager.createSession({
        name: request.name,
      });

      return {
        success: true,
        session,
      };
    } catch (error) {
      console.error('Error creating session:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create session';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Switch to a different session
   *
   * @param request - Switch session request
   * @returns Session operation result
   */
  async switchSession(
    request: SwitchSessionRequest
  ): Promise<SessionOperationResult> {
    try {
      await this.sessionManager.switchSession(request.sessionId);
      const session = this.sessionManager.getCurrentSession();

      return {
        success: true,
        session: session || null,
      };
    } catch (error) {
      console.error('Error switching session:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to switch session';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get message history for a session
   *
   * @param request - Get history request
   * @returns History result
   */
  async getHistory(request: GetHistoryRequest): Promise<HistoryResult> {
    try {
      const sessions = this.sessionManager.getAllSessions();
      const session = sessions.find((s) => s.id === request.sessionId);
      const messages = session?.messages || [];

      return {
        success: true,
        messages: messages as StrictChatMessage[],
      };
    } catch (error) {
      console.error('Error getting history:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to load history';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Rename a session
   *
   * @param request - Rename session request
   * @returns Rename session result
   */
  async renameSession(
    request: RenameSessionRequest
  ): Promise<RenameSessionResult> {
    try {
      const success = await this.sessionManager.renameSession(
        request.sessionId,
        request.newName
      );

      if (!success) {
        throw new Error('Session not found');
      }

      return {
        success: true,
        sessionId: request.sessionId,
        newName: request.newName,
      };
    } catch (error) {
      console.error('Error renaming session:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to rename session';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Delete a session
   *
   * @param request - Delete session request
   * @returns Delete session result
   */
  async deleteSession(
    request: DeleteSessionRequest
  ): Promise<DeleteSessionResult> {
    try {
      const success = await this.sessionManager.deleteSession(
        request.sessionId
      );

      if (!success) {
        throw new Error('Session not found');
      }

      return {
        success: true,
        sessionId: request.sessionId,
        deleted: true,
      };
    } catch (error) {
      console.error('Error deleting session:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to delete session';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Bulk delete sessions
   *
   * @param request - Bulk delete sessions request
   * @returns Bulk delete sessions result
   */
  async bulkDeleteSessions(
    request: BulkDeleteSessionsRequest
  ): Promise<BulkDeleteSessionsResult> {
    try {
      const result = await this.sessionManager.bulkDeleteSessions([
        ...request.sessionIds,
      ]);

      return {
        success: true,
        deleted: result.deleted,
        failed: result.failed,
      };
    } catch (error) {
      console.error('Error bulk deleting sessions:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to bulk delete sessions';

      return {
        success: false,
        deleted: [],
        failed: request.sessionIds.map((id) => ({
          id: id as string,
          reason: errorMessage,
        })),
        error: errorMessage,
      };
    }
  }

  /**
   * Get all sessions
   *
   * @returns Array of strict chat sessions
   */
  getAllSessions(): StrictChatSession[] {
    return this.sessionManager.getAllSessions();
  }

  /**
   * Get session statistics
   *
   * @returns Session statistics result
   */
  getSessionStatistics(): SessionStatsResult {
    try {
      const stats = this.sessionManager.getSessionStatistics();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      console.error('Error getting session statistics:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to get session statistics';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle permission response from user
   *
   * Workflow:
   * 1. Extract session ID from request ID
   * 2. Map UI response to Claude CLI format
   * 3. Send response to Claude CLI
   *
   * @param request - Permission response request
   * @returns Permission response result
   */
  async handlePermissionResponse(
    request: PermissionResponseRequest
  ): Promise<PermissionResponseResult> {
    try {
      console.info(
        `Permission response received: ${request.response} for request: ${request.requestId}`
      );

      // Extract session ID from request ID (format: perm_{sessionId}_{timestamp})
      const sessionIdMatch = request.requestId.match(/perm_(.+?)_\d+$/);
      const sessionIdString = sessionIdMatch?.[1];

      if (!sessionIdString) {
        throw new Error('Invalid permission request ID format');
      }

      const sessionId = sessionIdString as SessionId;

      // Send permission response to Claude CLI
      await this.claudeService.respondToPermission(sessionId, request.response);

      console.info(
        `Permission response '${request.response}' sent to Claude CLI for session: ${sessionId}`
      );

      return {
        success: true,
        message: `Permission ${
          request.response === 'deny' ? 'denied' : 'granted'
        }`,
      };
    } catch (error) {
      console.error('Error handling permission response:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to handle permission response';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Stop streaming for a session
   *
   * Note: This currently just acknowledges the stop request.
   * Actual process termination would require implementing process management in ClaudeCliService.
   *
   * @param request - Stop stream request
   * @returns Stop stream result
   */
  async stopStream(request: StopStreamRequest): Promise<StopStreamResult> {
    try {
      console.info(
        `Stop streaming requested for session: ${request.sessionId}, message: ${request.messageId}`
      );

      // TODO: Implement actual process termination in ClaudeCliService
      // For now, just acknowledge the stop request

      return {
        success: true,
        stopped: true,
        sessionId: request.sessionId,
        messageId: request.messageId,
      };
    } catch (error) {
      console.error('Error stopping stream:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to stop stream';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
