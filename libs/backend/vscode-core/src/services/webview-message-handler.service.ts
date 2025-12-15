/**
 * Shared Webview Message Handler Service
 *
 * Provides common message handling logic for all webviews (sidebar, wizard panels, etc.)
 * Handles core message types (webview-ready, RPC, permissions) and delegates
 * view-specific messages to custom handlers.
 *
 * @module @ptah-extension/vscode-core/services
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging';
import type { RpcHandler } from '../messaging';

/**
 * Custom message handler function type
 */
export type CustomMessageHandler = (
  message: any,
  webview: vscode.Webview
) => Promise<boolean>;

/**
 * Configuration for webview message handling
 */
export interface WebviewMessageHandlerConfig {
  /** Webview identifier for logging */
  readonly webviewId: string;
  /** The webview instance to send messages to */
  readonly webview: vscode.Webview;
  /** Optional custom message handlers (processed before default handlers) */
  readonly customHandlers?: CustomMessageHandler[];
  /** Callback when webview signals ready */
  readonly onReady?: () => void;
}

/**
 * Shared service for handling webview messages
 *
 * Centralizes common message handling logic:
 * - webview-ready signal processing
 * - RPC request/response routing
 * - Permission response handling
 *
 * @example
 * ```typescript
 * const handler = container.resolve(WebviewMessageHandlerService);
 * handler.setupMessageListener({
 *   webviewId: 'ptah.wizard',
 *   webview: panel.webview,
 *   customHandlers: [
 *     async (msg, webview) => {
 *       if (msg.type === 'wizard:custom') {
 *         // handle custom message
 *         return true; // handled
 *       }
 *       return false; // not handled
 *     }
 *   ],
 *   onReady: () => console.log('Webview ready!')
 * });
 * ```
 */
@injectable()
export class WebviewMessageHandlerService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler
  ) {}

  /**
   * Setup message listener for a webview with common handling
   *
   * @param config - Configuration for message handling
   * @param disposables - Optional array to track disposables
   * @returns Disposable for cleanup
   */
  setupMessageListener(
    config: WebviewMessageHandlerConfig,
    disposables?: vscode.Disposable[]
  ): vscode.Disposable {
    const disposable = config.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(config, message);
    });

    if (disposables) {
      disposables.push(disposable);
    }

    return disposable;
  }

  /**
   * Handle a single message with common logic
   */
  async handleMessage(
    config: WebviewMessageHandlerConfig,
    message: any
  ): Promise<void> {
    const { webviewId, webview, customHandlers, onReady } = config;

    this.logger.debug(`[${webviewId}] Received message`, {
      type: message.type,
    });

    try {
      // Try custom handlers first
      if (customHandlers) {
        for (const handler of customHandlers) {
          const handled = await handler(message, webview);
          if (handled) {
            return;
          }
        }
      }

      // Handle common message types
      switch (message.type) {
        case 'webview-ready':
          this.logger.info(`[${webviewId}] Webview ready signal received`);
          if (onReady) {
            onReady();
          }
          return;

        case 'rpc:request':
        case 'rpc:call':
          await this.handleRpcMessage(webviewId, webview, message);
          return;

        case 'permission:response':
          await this.handlePermissionResponse(webviewId, message);
          return;

        case 'chat:permission-response':
          await this.handleSdkPermissionResponse(webviewId, message);
          return;

        default:
          this.logger.debug(`[${webviewId}] Unhandled message type`, {
            type: message.type,
          });
      }
    } catch (error) {
      this.logger.error(
        `[${webviewId}] Error handling message`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Handle RPC request messages
   */
  private async handleRpcMessage(
    webviewId: string,
    webview: vscode.Webview,
    message: any
  ): Promise<void> {
    // Frontend wraps RPC data in 'payload' object, so unwrap it
    const rpcData = message.payload || message;
    const { requestId, method, params, correlationId } = rpcData;
    const reqId = requestId || correlationId;

    this.logger.debug(`[${webviewId}] RPC call`, {
      method,
      correlationId: reqId,
    });

    try {
      const response = await this.rpcHandler.handleMessage({
        method,
        params,
        correlationId: reqId,
      });

      // Send response back with both field names for compatibility
      await webview.postMessage({
        type: 'rpc:response',
        requestId: reqId,
        correlationId: reqId,
        success: response.success,
        data: response.data,
        result: response.data,
        error: response.error ? { message: response.error } : undefined,
      });
    } catch (error) {
      await webview.postMessage({
        type: 'rpc:response',
        requestId: reqId,
        correlationId: reqId,
        success: false,
        data: undefined,
        result: undefined,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Handle MCP permission responses
   */
  private async handlePermissionResponse(
    webviewId: string,
    message: any
  ): Promise<void> {
    try {
      const PERMISSION_PROMPT_SERVICE = Symbol.for('PermissionPromptService');
      const { container } = await import('tsyringe');

      if (container.isRegistered(PERMISSION_PROMPT_SERVICE)) {
        const permissionService = container.resolve<any>(
          PERMISSION_PROMPT_SERVICE
        );
        permissionService.resolveRequest(message.payload);
        this.logger.info(`[${webviewId}] Permission response processed`, {
          requestId: message.payload?.id,
        });
      } else {
        this.logger.warn(
          `[${webviewId}] PermissionPromptService not registered`
        );
      }
    } catch (error) {
      this.logger.error(
        `[${webviewId}] Failed to process permission response`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Handle SDK permission responses (from chat UI)
   */
  private async handleSdkPermissionResponse(
    webviewId: string,
    message: any
  ): Promise<void> {
    try {
      const { container } = await import('tsyringe');
      const SDK_PERMISSION_HANDLER = 'SdkPermissionHandler';

      if (container.isRegistered(SDK_PERMISSION_HANDLER)) {
        const permissionHandler = container.resolve<any>(
          SDK_PERMISSION_HANDLER
        );
        const payload = message.payload || message.response;

        const approved =
          payload?.decision === 'allow' || payload?.decision === 'always_allow';

        permissionHandler.handleResponse(payload?.id, {
          approved,
          modifiedInput: payload?.modifiedInput,
          reason: payload?.reason,
        });

        this.logger.info(`[${webviewId}] SDK Permission response processed`, {
          requestId: payload?.id,
          decision: payload?.decision,
          approved,
        });
      } else {
        this.logger.warn(`[${webviewId}] SdkPermissionHandler not registered`);
      }
    } catch (error) {
      this.logger.error(
        `[${webviewId}] Failed to process SDK permission response`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
