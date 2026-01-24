/**
 * WizardWebviewLifecycleService - Webview Panel Management Service
 * TASK_2025_115: Setup Wizard Service Decomposition
 *
 * Responsibility:
 * - Create webview panel with message handlers
 * - Send RPC responses to webview
 * - Emit progress events to webview
 * - Dispose webview on cleanup
 *
 * Pattern Source: setup-wizard.service.ts:141-221, 1757-1820, 1563-1589
 * Extracted from: SetupWizardService webview management methods
 */

import { injectable, inject } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type WebviewManager,
  type WebviewMessageHandlerService,
  type IWebviewHtmlGenerator,
} from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import type { WizardStep } from '../../types/wizard.types';

/**
 * Custom message handler function type.
 * Returns true if the message was handled, false otherwise.
 */
export type CustomMessageHandler = (
  message: unknown
) => Promise<boolean>;

/**
 * Initial data for webview panel creation.
 */
export interface WizardPanelInitialData {
  /** Resumed session data for restoring wizard state */
  resumedSession?: {
    sessionId: string;
    currentStep: WizardStep;
    projectContext?: Record<string, unknown>;
    selectedAgentIds?: string[];
  };
  /** Additional custom data to pass to the webview */
  [key: string]: unknown;
}

/**
 * Service responsible for webview panel lifecycle management.
 *
 * This service handles:
 * - Webview panel creation with proper configuration
 * - Message handler registration
 * - RPC response sending
 * - Progress event emission
 * - Panel disposal and cleanup
 *
 * All methods handle null panel gracefully and log operations.
 * Message send failures are caught and logged (do not throw).
 *
 * @injectable
 */
@injectable()
export class WizardWebviewLifecycleService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.WEBVIEW_MESSAGE_HANDLER)
    private readonly messageHandler: WebviewMessageHandlerService,
    @inject(TOKENS.WEBVIEW_HTML_GENERATOR)
    private readonly htmlGenerator: IWebviewHtmlGenerator
  ) {
    this.logger.debug('[WizardWebviewLifecycle] Service initialized');
  }

  /**
   * Create and configure a wizard webview panel.
   *
   * Creates a new webview panel with:
   * - Scripts enabled for Angular app
   * - Context retained when hidden (preserves state during tab switch)
   * - Message handlers registered before HTML is set
   * - HTML content generated with initial view and data
   *
   * @param title - Panel title displayed in VS Code
   * @param viewType - Unique identifier for the webview panel
   * @param customHandlers - Array of custom message handler functions
   * @param initialData - Optional initial data for the webview
   * @returns Created webview panel, or null if creation failed
   *
   * @example
   * ```typescript
   * const panel = await webviewLifecycle.createWizardPanel(
   *   'Setup Wizard',
   *   'ptah.setupWizard',
   *   [
   *     async (message) => {
   *       if (message.type === 'setup-wizard:start') {
   *         await handleStart(message);
   *         return true;
   *       }
   *       return false;
   *     }
   *   ]
   * );
   * ```
   */
  async createWizardPanel(
    title: string,
    viewType: string,
    customHandlers: CustomMessageHandler[],
    initialData?: WizardPanelInitialData
  ): Promise<vscode.WebviewPanel | null> {
    this.logger.debug('[WizardWebviewLifecycle] Creating wizard panel', {
      title,
      viewType,
      hasInitialData: !!initialData,
    });

    // Create webview panel
    const panel = await this.webviewManager.createWebviewPanel({
      viewType,
      title,
      showOptions: {
        viewColumn: 1,
        preserveFocus: false,
      },
      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    });

    if (!panel) {
      this.logger.error(
        '[WizardWebviewLifecycle] Failed to create wizard webview panel'
      );
      return null;
    }

    // Register message handlers (CRITICAL: before setting HTML)
    this.messageHandler.setupMessageListener({
      webviewId: viewType,
      webview: panel.webview,
      customHandlers: customHandlers.map((handler) => ({
        // Wrap the handler to match expected signature
        handler: async (message: unknown) => handler(message),
      })) as unknown as ((message: unknown) => Promise<boolean>)[],
      onReady: () => {
        this.logger.info('[WizardWebviewLifecycle] Wizard webview ready signal received');
      },
    });

    // Set webview HTML content
    panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(
      panel.webview,
      {
        workspaceInfo: this.htmlGenerator.buildWorkspaceInfo() as Record<
          string,
          unknown
        >,
        initialView: 'setup-wizard',
        ...initialData,
      }
    );

    this.logger.info('[WizardWebviewLifecycle] Wizard panel created successfully', {
      viewType,
    });

    return panel;
  }

  /**
   * Send RPC response to webview.
   *
   * Implements the RPC protocol expected by frontend WizardRpcService.
   * Uses MESSAGE_TYPES.RPC_RESPONSE for consistent messaging.
   *
   * Errors during send are caught and logged - this method does not throw.
   *
   * @param panel - Webview panel to send response to
   * @param messageId - Original message ID for correlation
   * @param payload - Success payload (optional)
   * @param error - Error message (optional)
   *
   * @example
   * ```typescript
   * // Success response
   * await webviewLifecycle.sendResponse(panel, msg.messageId, { status: 'ok' });
   *
   * // Error response
   * await webviewLifecycle.sendResponse(panel, msg.messageId, undefined, 'Analysis failed');
   * ```
   */
  async sendResponse(
    panel: vscode.WebviewPanel,
    messageId: string,
    payload?: unknown,
    error?: string
  ): Promise<void> {
    this.logger.debug('[WizardWebviewLifecycle] Sending RPC response', {
      messageId,
      hasPayload: !!payload,
      hasError: !!error,
    });

    try {
      await panel.webview.postMessage({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        messageId,
        payload,
        error,
      });
    } catch (err) {
      this.logger.error('[WizardWebviewLifecycle] Failed to send RPC response', {
        error: err,
        messageId,
        hasError: !!error,
      });
    }
  }

  /**
   * Emit progress event to webview.
   *
   * Sends progress updates during long-running operations.
   * Handles null panel gracefully (logs warning and returns).
   *
   * Errors during send are caught and logged - this method does not throw.
   *
   * @param panel - Webview panel to send progress to (null-safe)
   * @param eventType - Event type identifier (e.g., 'wizard:scan-progress')
   * @param data - Event data payload
   *
   * @example
   * ```typescript
   * await webviewLifecycle.emitProgress(panel, 'wizard:scan-progress', {
   *   phase: 'analyzing',
   *   percentComplete: 45,
   *   currentOperation: 'Detecting architecture patterns'
   * });
   * ```
   */
  async emitProgress(
    panel: vscode.WebviewPanel | null,
    eventType: string,
    data: unknown
  ): Promise<void> {
    if (!panel) {
      this.logger.warn(
        '[WizardWebviewLifecycle] Cannot emit progress: panel is null',
        { eventType }
      );
      return;
    }

    this.logger.debug('[WizardWebviewLifecycle] Emitting progress event', {
      eventType,
    });

    try {
      await panel.webview.postMessage({
        type: eventType,
        data,
      });
    } catch (error) {
      this.logger.error(
        '[WizardWebviewLifecycle] Failed to emit progress event',
        {
          error,
          eventType,
        }
      );
    }
  }

  /**
   * Dispose webview for a given view type.
   *
   * Cleans up webview resources. Safe to call even if no webview exists.
   *
   * @param viewType - View type identifier to dispose
   *
   * @example
   * ```typescript
   * webviewLifecycle.disposeWebview('ptah.setupWizard');
   * ```
   */
  disposeWebview(viewType: string): void {
    this.logger.debug('[WizardWebviewLifecycle] Disposing webview', {
      viewType,
    });

    try {
      this.webviewManager.disposeWebview(viewType);
      this.logger.debug('[WizardWebviewLifecycle] Webview disposed successfully', {
        viewType,
      });
    } catch (error) {
      this.logger.warn(
        '[WizardWebviewLifecycle] Error disposing webview',
        error as Error
      );
    }
  }

  /**
   * Check if a webview panel exists for the given view type.
   *
   * Useful for determining if wizard is currently open.
   *
   * @param viewType - View type identifier to check
   * @returns True if panel exists
   */
  hasPanel(viewType: string): boolean {
    try {
      return this.webviewManager.hasWebview(viewType);
    } catch {
      return false;
    }
  }

  /**
   * Get the webview panel for a given view type.
   *
   * @param viewType - View type identifier
   * @returns Webview panel if exists, undefined otherwise
   */
  getPanel(viewType: string): vscode.WebviewPanel | undefined {
    try {
      return this.webviewManager.getWebviewPanel(viewType);
    } catch {
      return undefined;
    }
  }

  /**
   * Send a generic message to the webview.
   *
   * Lower-level method for custom message types.
   * Handles null panel gracefully.
   *
   * @param panel - Webview panel to send message to
   * @param message - Message object to send
   */
  async sendMessage(
    panel: vscode.WebviewPanel | null,
    message: Record<string, unknown>
  ): Promise<void> {
    if (!panel) {
      this.logger.warn(
        '[WizardWebviewLifecycle] Cannot send message: panel is null',
        { messageType: message['type'] }
      );
      return;
    }

    try {
      await panel.webview.postMessage(message);
    } catch (error) {
      this.logger.error(
        '[WizardWebviewLifecycle] Failed to send message',
        {
          error,
          messageType: message['type'],
        }
      );
    }
  }
}
