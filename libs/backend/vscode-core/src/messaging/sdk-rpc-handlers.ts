/**
 * SDK RPC Handlers - Frontend-backend communication for Agent SDK
 *
 * TASK_2025_044 Batch 3: RPC handlers for SDK operations
 * TASK_2025_086: Fixed message type from sdk:executionNode to chat:chunk
 *
 * Handles:
 * - sdk:startSession - Start new SDK session and stream FlatStreamEventUnion events
 * - sdk:sendMessage - Send user message to existing session
 * - sdk:resumeSession - Resume session from storage
 * - sdk:getSession - Get session data from storage
 * - sdk:deleteSession - Delete session from storage (TASK_2025_086)
 * - sdk:permission.response - Handle permission approval/denial
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';
import type { SessionId, FlatStreamEventUnion } from '@ptah-extension/shared';
import { MessageId } from '@ptah-extension/shared';

// SDK adapter interface (avoid circular import)
// NOTE: SdkAgentAdapter.startChatSession() returns FlatStreamEventUnion, NOT ExecutionNode
interface SdkAgentAdapter {
  startChatSession(
    sessionId: SessionId,
    config?: {
      workspaceId?: string;
      systemPrompt?: string;
      model?: string;
      projectPath?: string;
    }
  ): Promise<AsyncIterable<FlatStreamEventUnion>>;
  sendMessageToSession(sessionId: SessionId, content: string): Promise<void>;
}

// SDK session storage interface (avoid circular import)
interface SdkSessionStorage {
  deleteSession(sessionId: SessionId): Promise<void>;
}

// SDK permission handler interface
interface SdkPermissionHandler {
  handleResponse(
    requestId: string,
    response: {
      approved: boolean;
      modifiedInput?: any;
      reason?: string;
    }
  ): void;
  setEventEmitter(emitter: (event: string, payload: any) => void): void;
}

// Webview manager interface
interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: any): Promise<void>;
}

/**
 * SDK RPC Handlers Service
 *
 * Manages RPC communication between frontend and SDK adapter
 */
@injectable()
export class SdkRpcHandlers {
  // Active SDK sessions (sessionId -> stream iterator)
  private readonly activeSessions = new Map<
    string,
    AsyncIterator<FlatStreamEventUnion>
  >();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter,
    @inject('SdkPermissionHandler')
    private readonly permissionHandler: SdkPermissionHandler,
    @inject('SdkSessionStorage')
    private readonly sessionStorage: SdkSessionStorage
  ) {
    // Wire up permission handler to send events to webview
    this.initializePermissionEmitter();
  }

  /**
   * Initialize permission event emitter
   * Connects SdkPermissionHandler to webview messaging
   */
  private initializePermissionEmitter(): void {
    this.logger.info(
      '[SdkRpcHandlers] Initializing permission event emitter...'
    );

    // Create emitter that sends permission requests to webview
    const emitter = (event: string, payload: any): void => {
      this.logger.debug(`[SdkRpcHandlers] Permission event: ${event}`, {
        payload,
      });

      // Send to webview - fire and forget (async but we don't await)
      this.webviewManager
        .sendMessage('ptah.main', event, payload)
        .catch((error) => {
          this.logger.error(
            `[SdkRpcHandlers] Failed to send permission event: ${event}`,
            { error }
          );
        });
    };

    // Wire up the permission handler
    this.permissionHandler.setEventEmitter(emitter);
    this.logger.info(
      '[SdkRpcHandlers] Permission event emitter initialized successfully'
    );
  }

  /**
   * RPC: sdk:startSession
   * Starts new SDK session and streams ExecutionNodes to webview
   */
  async handleStartSession(params: {
    sessionId: SessionId;
    workspaceId?: string;
    systemPrompt?: string;
    model?: string;
    prompt?: string;
  }): Promise<void> {
    try {
      this.logger.info('[SdkRpcHandlers] Starting SDK session', {
        sessionId: params.sessionId,
      });

      // Start SDK session
      const stream = await this.sdkAdapter.startChatSession(params.sessionId, {
        workspaceId: params.workspaceId,
        systemPrompt: params.systemPrompt,
        model: params.model,
        projectPath: params.workspaceId,
      });

      // Send initial message if provided
      if (params.prompt) {
        await this.sdkAdapter.sendMessageToSession(
          params.sessionId,
          params.prompt
        );
      }

      // Get async iterator
      const iterator = stream[Symbol.asyncIterator]();
      this.activeSessions.set(params.sessionId as string, iterator);

      // Stream FlatStreamEventUnion events to webview via chat:chunk messages
      this.streamEventsToWebview(params.sessionId, iterator);

      this.logger.debug('[SdkRpcHandlers] SDK session stream started', {
        sessionId: params.sessionId,
      });
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] Failed to start SDK session', {
        error,
        sessionId: params.sessionId,
      });

      // Send error to webview via chat:error
      await this.webviewManager.sendMessage('ptah.main', 'chat:error', {
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * RPC: sdk:sendMessage
   * Send user message to existing session
   */
  async handleSendMessage(params: {
    sessionId: SessionId;
    content: string;
  }): Promise<void> {
    try {
      this.logger.info('[SdkRpcHandlers] Sending message to SDK session', {
        sessionId: params.sessionId,
        contentLength: params.content.length,
      });

      await this.sdkAdapter.sendMessageToSession(
        params.sessionId,
        params.content
      );

      this.logger.debug('[SdkRpcHandlers] Message sent successfully', {
        sessionId: params.sessionId,
      });
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] Failed to send message', {
        error,
        sessionId: params.sessionId,
      });

      // Send error to webview via chat:error
      await this.webviewManager.sendMessage('ptah.main', 'chat:error', {
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * RPC: sdk:resumeSession
   * Resume existing session from storage
   */
  async handleResumeSession(params: { sessionId: SessionId }): Promise<void> {
    try {
      this.logger.info('[SdkRpcHandlers] Resuming SDK session', {
        sessionId: params.sessionId,
      });

      // TODO: Implement session resume logic
      // 1. Load session from storage
      // 2. Send existing messages to webview
      // 3. Ready for new messages

      this.logger.warn('[SdkRpcHandlers] Session resume not yet implemented', {
        sessionId: params.sessionId,
      });
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] Failed to resume session', {
        error,
        sessionId: params.sessionId,
      });
    }
  }

  /**
   * RPC: sdk:getSession
   * Get session data from storage
   */
  async handleGetSession(params: { sessionId: SessionId }): Promise<any> {
    try {
      this.logger.debug('[SdkRpcHandlers] Getting SDK session', {
        sessionId: params.sessionId,
      });

      // TODO: Return session data from storage
      this.logger.warn('[SdkRpcHandlers] Get session not yet implemented', {
        sessionId: params.sessionId,
      });

      return null;
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] Failed to get session', {
        error,
        sessionId: params.sessionId,
      });
      return null;
    }
  }

  /**
   * RPC: sdk:deleteSession
   * Delete session from storage (TASK_2025_086)
   */
  async handleDeleteSession(params: {
    sessionId: SessionId;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      this.logger.info('[SdkRpcHandlers] Deleting SDK session', {
        sessionId: params.sessionId,
      });

      // Remove from active sessions map if present
      this.activeSessions.delete(params.sessionId as string);

      // Delete from storage
      await this.sessionStorage.deleteSession(params.sessionId);

      this.logger.info('[SdkRpcHandlers] SDK session deleted successfully', {
        sessionId: params.sessionId,
      });

      // Notify webview of deletion
      await this.webviewManager.sendMessage('ptah.main', 'sdk:sessionDeleted', {
        sessionId: params.sessionId,
      });

      return { success: true };
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] Failed to delete session', {
        error,
        sessionId: params.sessionId,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * RPC: sdk:permission.response
   * Handle permission approval/denial from webview
   */
  handlePermissionResponse(params: {
    requestId: string;
    approved: boolean;
    modifiedInput?: any;
    reason?: string;
  }): void {
    try {
      this.logger.info('[SdkRpcHandlers] Handling permission response', {
        requestId: params.requestId,
        approved: params.approved,
      });

      this.permissionHandler.handleResponse(params.requestId, {
        approved: params.approved,
        modifiedInput: params.modifiedInput,
        reason: params.reason,
      });

      this.logger.debug('[SdkRpcHandlers] Permission response handled', {
        requestId: params.requestId,
      });
    } catch (error) {
      this.logger.error(
        '[SdkRpcHandlers] Failed to handle permission response',
        {
          error,
          requestId: params.requestId,
        }
      );
    }
  }

  /**
   * Stream FlatStreamEventUnion events to webview in background
   * TASK_2025_086: Fixed to send 'chat:chunk' messages that frontend expects
   */
  private async streamEventsToWebview(
    sessionId: SessionId,
    iterator: AsyncIterator<FlatStreamEventUnion>
  ): Promise<void> {
    let eventCount = 0;
    try {
      while (true) {
        const { value: event, done } = await iterator.next();

        if (done) {
          // Signal completion via chat:complete (matches MESSAGE_TYPES.CHAT_COMPLETE)
          await this.webviewManager.sendMessage('ptah.main', 'chat:complete', {
            sessionId,
            code: 0,
          });
          this.activeSessions.delete(sessionId as string);
          this.logger.info('[SdkRpcHandlers] SDK session stream completed', {
            sessionId,
            totalEvents: eventCount,
          });
          break;
        }

        eventCount++;

        // Log every event for debugging
        this.logger.debug(
          `[SdkRpcHandlers] Streaming event #${eventCount} to webview`,
          {
            sessionId,
            eventType: event.eventType,
            messageId: event.messageId,
          }
        );

        // Send FlatStreamEventUnion to webview via chat:chunk (matches MESSAGE_TYPES.CHAT_CHUNK)
        // Frontend expects payload: { sessionId, event }
        await this.webviewManager.sendMessage('ptah.main', 'chat:chunk', {
          sessionId,
          event,
        });
      }
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] SDK session stream error', {
        error,
        sessionId,
        eventsBeforeError: eventCount,
      });

      // Send error to webview via chat:error (matches MESSAGE_TYPES.CHAT_ERROR)
      await this.webviewManager.sendMessage('ptah.main', 'chat:error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.activeSessions.delete(sessionId as string);
    }
  }
}
