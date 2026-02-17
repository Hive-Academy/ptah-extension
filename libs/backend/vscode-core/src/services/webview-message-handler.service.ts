/**
 * Shared Webview Message Handler Service
 *
 * Provides common message handling logic for all webviews (sidebar, wizard panels, etc.)
 * Handles core message types (webview-ready, RPC, permissions) and delegates
 * view-specific messages to custom handlers.
 *
 * @module @ptah-extension/vscode-core/services
 */

import { injectable, inject, container } from 'tsyringe';
import * as vscode from 'vscode';
import {
  MESSAGE_TYPES,
  type ISdkPermissionHandler,
} from '@ptah-extension/shared';
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
 * **Triple-Layered Message Routing Architecture:**
 *
 * This service implements a three-tier message routing system to provide flexible,
 * extensible message handling for all webviews (chat sidebar, wizard panels, etc.).
 *
 * **Routing Layers (Execution Order):**
 *
 * 1. **Global Layer (Custom Handlers)** - Executed FIRST
 *    - View-specific handlers provided via `customHandlers` configuration
 *    - Allows webview to intercept and override default behavior
 *    - Return `true` to mark message as handled (stops routing)
 *    - Return `false` to pass message to next layer
 *
 * 2. **Common Layer (Default Handlers)** - Executed SECOND (if not handled)
 *    - Built-in handlers for universal message types:
 *      - `MESSAGE_TYPES.WEBVIEW_READY`: Webview initialization signal
 *      - `MESSAGE_TYPES.RPC_REQUEST`, `MESSAGE_TYPES.RPC_CALL`: RPC method invocation
 *      - `MESSAGE_TYPES.SDK_PERMISSION_RESPONSE`: Claude SDK permission response
 *      - `MESSAGE_TYPES.MCP_PERMISSION_RESPONSE`: Code Execution MCP permission response
 *    - All webviews automatically support these message types
 *
 * 3. **Fallback Layer** - Executed THIRD (if not handled)
 *    - Logs unhandled messages for debugging
 *    - Does not throw errors (allows webview to continue)
 *
 * **Execution Flow:**
 * ```
 * Message received from webview
 *   ↓
 * Try custom handlers (layer 1)
 *   ↓ (if not handled)
 * Try default handlers (layer 2)
 *   ↓ (if not handled)
 * Log as unhandled (layer 3)
 * ```
 *
 * **Use Cases for Each Layer:**
 *
 * **Layer 1 - Custom Handlers (View-Specific Logic):**
 * - Setup wizard: Handle `wizard:start`, `wizard:submit-selection`, `wizard:cancel`
 * - Chat sidebar: Handle `chat:send-message`, `chat:cancel-generation`
 * - Settings panel: Handle `settings:save`, `settings:reset`
 *
 * **Layer 2 - Default Handlers (Universal Logic):**
 * - All webviews: RPC calls, permission responses, ready signals
 * - No custom code needed for these (handled automatically)
 *
 * **Layer 3 - Fallback (Debugging):**
 * - Helps identify missing handlers during development
 * - Safe to ignore in production (webview may send informational messages)
 *
 * **Code Example:**
 * ```typescript
 * const handler = container.resolve(WebviewMessageHandlerService);
 *
 * // Setup message listener with custom handlers (layer 1)
 * handler.setupMessageListener({
 *   webviewId: 'ptah.wizard',
 *   webview: panel.webview,
 *   customHandlers: [
 *     // Custom handler (layer 1) - executed FIRST
 *     async (msg, webview) => {
 *       if (msg.type === 'wizard:start') {
 *         await this.handleWizardStart(msg);
 *         return true; // Handled - stop routing
 *       }
 *       return false; // Not handled - continue to layer 2
 *     }
 *   ],
 *   // Common handlers (layer 2) - automatic
 *   // - webview-ready
 *   // - rpc:request, rpc:call
 *   // - permission:response, chat:permission-response
 *
 *   // Fallback (layer 3) - automatic logging
 *
 *   onReady: () => console.log('Webview ready!')
 * });
 * ```
 *
 * **Benefits of Triple-Layered Routing:**
 * - **Extensibility**: Custom handlers can override default behavior
 * - **Reusability**: Common message types handled once for all webviews
 * - **Debuggability**: Unhandled messages logged for investigation
 * - **Type Safety**: RPC handler validates message structure
 * - **Error Isolation**: Errors in one layer don't affect others
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
        case MESSAGE_TYPES.WEBVIEW_READY:
          this.logger.info(`[${webviewId}] Webview ready signal received`);
          if (onReady) {
            onReady();
          }
          return;

        case MESSAGE_TYPES.RPC_REQUEST:
        case MESSAGE_TYPES.RPC_CALL:
          await this.handleRpcMessage(webviewId, webview, message);
          return;

        case MESSAGE_TYPES.MCP_PERMISSION_RESPONSE:
          await this.handleMcpPermissionResponse(webviewId, message);
          return;

        case MESSAGE_TYPES.SDK_PERMISSION_RESPONSE:
          await this.handleSdkPermissionResponse(webviewId, message);
          return;

        case MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE:
          await this.handleAskUserQuestionResponse(webviewId, message);
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

      // Send error response to webview if message has correlationId
      if (message.correlationId || message.requestId) {
        const reqId = message.correlationId || message.requestId;
        await webview.postMessage({
          type: MESSAGE_TYPES.ERROR,
          correlationId: reqId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
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

      // Send response back (correlationId and data are the canonical fields)
      // TASK_2025_124: Include errorCode for license-related errors
      await webview.postMessage({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        correlationId: reqId,
        success: response.success,
        data: response.data,
        error: response.error ? { message: response.error } : undefined,
        errorCode: response.errorCode,
      });
    } catch (error) {
      await webview.postMessage({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        correlationId: reqId,
        success: false,
        data: undefined,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Handle MCP permission responses (Premium only - Code Execution MCP)
   *
   * SYSTEM 2: Code Execution MCP Permissions
   * - Triggered by: Ptah MCP Server's approval_prompt tool
   * - Message type: MESSAGE_TYPES.MCP_PERMISSION_RESPONSE ('permission:response')
   * - Handler: PermissionPromptService.resolveRequest()
   */
  private async handleMcpPermissionResponse(
    webviewId: string,
    message: any
  ): Promise<void> {
    try {
      if (container.isRegistered(TOKENS.PERMISSION_PROMPT_SERVICE)) {
        const permissionService = container.resolve<any>(
          TOKENS.PERMISSION_PROMPT_SERVICE
        );
        permissionService.resolveRequest(message.payload);
        this.logger.info(`[${webviewId}] MCP Permission response processed`, {
          requestId: message.payload?.id,
        });
      } else {
        this.logger.warn(
          `[${webviewId}] PermissionPromptService not registered (MCP not enabled)`
        );
      }
    } catch (error) {
      this.logger.error(
        `[${webviewId}] Failed to process MCP permission response`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Handle AskUserQuestion responses (SDK clarifying questions)
   *
   * TASK_2025_136: Routes user answers back to SdkPermissionHandler
   * - Triggered by: User answering questions in webview UI
   * - Message type: MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE ('ask-user-question:response')
   * - Handler: SdkPermissionHandler.handleQuestionResponse()
   */
  private async handleAskUserQuestionResponse(
    webviewId: string,
    message: any
  ): Promise<void> {
    try {
      const payload = message.payload;

      const SDK_PERMISSION_HANDLER = Symbol.for('SdkPermissionHandler');
      if (container.isRegistered(SDK_PERMISSION_HANDLER)) {
        const permissionHandler = container.resolve<ISdkPermissionHandler>(
          SDK_PERMISSION_HANDLER
        );
        permissionHandler.handleQuestionResponse({
          id: payload.id,
          answers: payload.answers,
        });
        this.logger.info(`[${webviewId}] AskUserQuestion response processed`, {
          requestId: payload.id,
          answerCount: Object.keys(payload.answers || {}).length,
        });
      } else {
        this.logger.warn(`[${webviewId}] SdkPermissionHandler not registered`);
      }
    } catch (error) {
      this.logger.error(
        `[${webviewId}] Failed to process AskUserQuestion response`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Handle SDK permission responses (Claude Agent SDK)
   *
   * SYSTEM 1: Claude Agent SDK Permissions (Primary, always active)
   * - Triggered by: SDK's canUseTool callback for Write, Edit, Bash tools
   * - Message type: MESSAGE_TYPES.SDK_PERMISSION_RESPONSE ('chat:permission-response')
   * - Handler: SdkPermissionHandler.handleResponse()
   *
   * NOTE: This handler ONLY processes SDK permissions.
   * MCP permissions use a separate message type and handler.
   */
  private async handleSdkPermissionResponse(
    webviewId: string,
    message: any
  ): Promise<void> {
    try {
      const payload = message.payload || message.response;
      const requestId = payload?.id;

      const SDK_PERMISSION_HANDLER = Symbol.for('SdkPermissionHandler');
      if (container.isRegistered(SDK_PERMISSION_HANDLER)) {
        const permissionHandler = container.resolve<ISdkPermissionHandler>(
          SDK_PERMISSION_HANDLER
        );
        // TASK_2025_101_FIX: Pass correct PermissionResponse structure
        // Previously passed 'approved' (boolean) which is NOT in PermissionResponse interface
        // Must pass 'id' and 'decision' fields matching SdkPermissionHandler.PermissionResponse
        const decision = payload?.decision ?? 'deny';
        permissionHandler.handleResponse(requestId, {
          id: requestId,
          decision,
          modifiedInput: payload?.modifiedInput,
          reason: payload?.reason,
        });
        this.logger.info(`[${webviewId}] SDK Permission response processed`, {
          requestId,
          decision,
        });
      } else {
        this.logger.warn(`[${webviewId}] SdkPermissionHandler not registered`, {
          requestId,
        });
      }
    } catch (error) {
      this.logger.error(
        `[${webviewId}] Failed to process SDK permission response`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
