/**
 * SDK RPC Handlers - Frontend-backend communication for Agent SDK
 *
 * TASK_2025_044 Batch 3: RPC handlers for SDK operations
 *
 * Handles:
 * - sdk:startSession - Start new SDK session and stream ExecutionNodes
 * - sdk:sendMessage - Send user message to existing session
 * - sdk:resumeSession - Resume session from storage
 * - sdk:getSession - Get session data from storage
 * - sdk:permission.response - Handle permission approval/denial
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';
import type { SessionId, ExecutionNode } from '@ptah-extension/shared';
import { MessageId } from '@ptah-extension/shared';

// SDK adapter interface (avoid circular import)
interface SdkAgentAdapter {
  startChatSession(
    sessionId: SessionId,
    config?: {
      workspaceId?: string;
      systemPrompt?: string;
      model?: string;
      projectPath?: string;
    }
  ): Promise<AsyncIterable<ExecutionNode>>;
  sendMessageToSession(sessionId: SessionId, content: string): Promise<void>;
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
  private readonly activeSessions = new Map<string, AsyncIterator<ExecutionNode>>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: WebviewManager,
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter,
    @inject('SdkPermissionHandler')
    private readonly permissionHandler: SdkPermissionHandler
  ) {}

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

      // Stream ExecutionNodes to webview
      this.streamExecutionNodesToWebview(params.sessionId, iterator);

      this.logger.debug('[SdkRpcHandlers] SDK session stream started', {
        sessionId: params.sessionId,
      });
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] Failed to start SDK session', {
        error,
        sessionId: params.sessionId,
      });

      // Send error to webview
      await this.webviewManager.sendMessage('ptah.main', 'sdk:error', {
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

      // Send error to webview
      await this.webviewManager.sendMessage('ptah.main', 'sdk:error', {
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
      this.logger.error('[SdkRpcHandlers] Failed to handle permission response', {
        error,
        requestId: params.requestId,
      });
    }
  }

  /**
   * Stream ExecutionNodes to webview in background
   */
  private async streamExecutionNodesToWebview(
    sessionId: SessionId,
    iterator: AsyncIterator<ExecutionNode>
  ): Promise<void> {
    try {
      while (true) {
        const { value: node, done } = await iterator.next();

        if (done) {
          // Signal completion
          await this.webviewManager.sendMessage('ptah.main', 'sdk:sessionComplete', {
            sessionId,
          });
          this.activeSessions.delete(sessionId as string);
          this.logger.info('[SdkRpcHandlers] SDK session stream completed', {
            sessionId,
          });
          break;
        }

        // Send ExecutionNode to webview
        await this.webviewManager.sendMessage('ptah.main', 'sdk:executionNode', {
          sessionId,
          node,
        });
      }
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] SDK session stream error', {
        error,
        sessionId,
      });

      // Send error to webview
      await this.webviewManager.sendMessage('ptah.main', 'sdk:error', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.activeSessions.delete(sessionId as string);
    }
  }
}
