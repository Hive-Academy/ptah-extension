/**
 * VS Code Webview Manager with Message Routing
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 361-420
 * Provides enhanced webview management with event bus integration
 */

import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type {
  WebviewMessage,
  StrictMessageType,
  MessagePayloadMap,
} from '@ptah-extension/shared';
import { isSystemMessage, isRoutableMessage } from '@ptah-extension/shared';

/**
 * Webview panel configuration options
 */
export interface WebviewPanelConfig {
  readonly viewType: string;
  readonly title: string;
  readonly showOptions?: {
    readonly viewColumn?: vscode.ViewColumn;
    readonly preserveFocus?: boolean;
  };
  readonly options?: {
    readonly enableScripts?: boolean;
    readonly retainContextWhenHidden?: boolean;
    readonly enableForms?: boolean;
    readonly enableCommandUris?: boolean;
    readonly localResourceRoots?: readonly vscode.Uri[];
  };
}

/**
 * Webview message event payload for event bus integration
 */
export interface WebviewMessagePayload {
  readonly webviewId: string;
  readonly message: WebviewMessage;
  readonly timestamp: number;
}

/**
 * Webview lifecycle event payloads
 */
export interface WebviewCreatedPayload {
  readonly webviewId: string;
  readonly viewType: string;
  readonly title: string;
  readonly timestamp: number;
}

export interface WebviewDisposedPayload {
  readonly webviewId: string;
  readonly viewType: string;
  readonly timestamp: number;
}

/**
 * Enhanced Webview Manager with event integration
 * Manages webview lifecycle and provides message routing to event bus
 */
@injectable()
export class WebviewManager {
  private readonly activeWebviews = new Map<string, vscode.WebviewPanel>();
  private readonly activeWebviewViews = new Map<string, vscode.WebviewView>();
  private readonly webviewMetrics = new Map<
    string,
    {
      createdAt: number;
      messageCount: number;
      lastActivity: number;
      isVisible: boolean;
    }
  >();

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext
  ) {}

  /**
   * Create a webview panel with enhanced configuration and event integration
   * Automatically sets up message routing and lifecycle event publishing
   *
   * @param config - Webview panel configuration
   * @param initialData - Optional initial data to send to webview
   * @returns Created webview panel
   */
  createWebviewPanel<T extends Record<string, unknown>>(
    config: WebviewPanelConfig,
    initialData?: T
  ): vscode.WebviewPanel {
    // Check if webview already exists
    if (this.activeWebviews.has(config.viewType)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const existing = this.activeWebviews.get(config.viewType)!;
      existing.reveal(
        config.showOptions?.viewColumn,
        config.showOptions?.preserveFocus
      );
      return existing;
    }

    // Create webview panel with enhanced options
    const panel = vscode.window.createWebviewPanel(
      config.viewType,
      config.title,
      config.showOptions?.viewColumn || vscode.ViewColumn.One,
      {
        enableScripts: config.options?.enableScripts ?? true,
        retainContextWhenHidden:
          config.options?.retainContextWhenHidden ?? true,
        enableForms: config.options?.enableForms ?? true,
        enableCommandUris: config.options?.enableCommandUris ?? false,
        localResourceRoots: config.options?.localResourceRoots || [
          this.context.extensionUri,
          vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
          vscode.Uri.joinPath(this.context.extensionUri, 'webview'),
        ],
      }
    );

    // Set up message handling with type safety
    panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.handleWebviewMessage(config.viewType, message);
    });

    // Set up visibility change tracking
    panel.onDidChangeViewState(({ webviewPanel }) => {
      this.updateWebviewVisibility(config.viewType, webviewPanel.visible);
    });

    // Set up disposal handling
    panel.onDidDispose(() => {
      this.handleWebviewDisposal(config.viewType);
    });

    // Track the webview
    this.activeWebviews.set(config.viewType, panel);
    this.webviewMetrics.set(config.viewType, {
      createdAt: Date.now(),
      messageCount: 0,
      lastActivity: Date.now(),
      isVisible: true,
    });

    // Send initial data if provided
    if (initialData) {
      panel.webview.postMessage({
        type: 'initialData',
        payload: initialData,
      });
    }

    return panel;
  }

  /**
   * Register an existing WebviewView (for sidebar views created by VS Code)
   *
   * @param viewType - Unique identifier for the webview view
   * @param view - The webview view to register
   */
  registerWebviewView(viewType: string, view: vscode.WebviewView): void {
    console.log(`[WebviewManager] Registering WebviewView: ${viewType}`);

    // Track the webview view
    this.activeWebviewViews.set(viewType, view);
    this.webviewMetrics.set(viewType, {
      createdAt: Date.now(),
      messageCount: 0,
      lastActivity: Date.now(),
      isVisible: view.visible,
    });

    // Set up visibility change tracking
    view.onDidChangeVisibility(() => {
      this.updateWebviewVisibility(viewType, view.visible);
    });

    // Set up disposal handling
    view.onDidDispose(() => {
      console.log(`[WebviewManager] WebviewView disposed: ${viewType}`);
      this.activeWebviewViews.delete(viewType);
      this.webviewMetrics.delete(viewType);
    });

    console.log(
      `[WebviewManager] WebviewView registered successfully: ${viewType}`
    );
    console.log(`[WebviewManager] Active webviews:`, this.getActiveWebviews());
  }

  /**
   * Send a message to a specific webview
   * Provides type-safe message sending with error handling
   *
   * @param viewType - Target webview view type
   * @param message - Message to send
   * @returns Promise that resolves when message is sent
   */
  async sendMessage<T extends StrictMessageType>(
    viewType: string,
    type: T,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any
  ): Promise<boolean> {
    // Check both panels and views
    const panel = this.activeWebviews.get(viewType);
    const view = this.activeWebviewViews.get(viewType);
    const webview = panel?.webview || view?.webview;

    if (!webview) {
      console.error(`[WebviewManager] CRITICAL: Webview ${viewType} not found`);
      console.error(
        `[WebviewManager] Active panels:`,
        Array.from(this.activeWebviews.keys())
      );
      console.error(
        `[WebviewManager] Active views:`,
        Array.from(this.activeWebviewViews.keys())
      );
      return false;
    }

    try {
      console.log(`[WebviewManager] Calling webview.postMessage():`, {
        viewType,
        type,
        payloadKeys: Object.keys(payload || {}),
      });
      const result = await webview.postMessage({ type, payload });
      console.log(`[WebviewManager] postMessage() returned:`, result);
      return true;
    } catch (error) {
      console.error(`[WebviewManager] postMessage() threw error:`, error);
      return false;
    }
  }

  /**
   * Get a webview panel by view type
   *
   * @param viewType - The view type to look up
   * @returns Webview panel or undefined if not found
   */
  getWebviewPanel(viewType: string): vscode.WebviewPanel | undefined {
    return this.activeWebviews.get(viewType);
  }

  /**
   * Check if a webview exists and is active
   *
   * @param viewType - The view type to check
   * @returns True if webview exists
   */
  hasWebview(viewType: string): boolean {
    return this.activeWebviews.has(viewType);
  }

  /**
   * Get webview metrics for monitoring and debugging
   *
   * @param viewType - Optional specific webview, or all webviews if not provided
   * @returns Metrics for specified webview or all webviews
   */
  getWebviewMetrics(viewType?: string) {
    if (viewType) {
      return this.webviewMetrics.get(viewType) || null;
    }

    return Object.fromEntries(this.webviewMetrics);
  }

  /**
   * Get list of active webview types (both panels and views)
   *
   * @returns Array of active webview view types
   */
  getActiveWebviews(): readonly string[] {
    const panelKeys = Array.from(this.activeWebviews.keys());
    const viewKeys = Array.from(this.activeWebviewViews.keys());
    return [...panelKeys, ...viewKeys];
  }

  /**
   * Dispose a specific webview
   *
   * @param viewType - The webview to dispose
   * @returns True if webview was disposed
   */
  disposeWebview(viewType: string): boolean {
    const panel = this.activeWebviews.get(viewType);

    if (!panel) {
      return false;
    }

    panel.dispose();
    return true;
  }

  /**
   * Dispose all active webviews
   * Should be called during extension deactivation
   */
  dispose(): void {
    this.activeWebviews.forEach((panel) => panel.dispose());
    this.activeWebviews.clear();
    this.webviewMetrics.clear();
  }

  /**
   * Handle incoming webview messages with type safety
   * Routes messages to the event bus with proper type discrimination
   */
  private handleWebviewMessage(
    webviewId: string,
    message: WebviewMessage
  ): void {
    // Update metrics
    const metrics = this.webviewMetrics.get(webviewId);
    if (metrics) {
      metrics.messageCount++;
      metrics.lastActivity = Date.now();
    }

    // Route message based on type
    if (isSystemMessage(message)) {
      // Handle system messages internally
      this.handleSystemMessage(webviewId, message);
    } else if (isRoutableMessage(message)) {
      // TODO: Phase 2 - Route to RPC handler for message processing
      console.warn(
        `[WebviewManager] Routable message received but EventBus removed:`,
        message.type
      );
    } else {
      console.error(
        `[WebviewManager] Invalid message type:`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (message as any).type
      );
    }
  }

  /**
   * Handle system messages (ready, initialization, etc.)
   * These are handled internally and not routed to the event bus
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSystemMessage(webviewId: string, message: any): void {
    switch (message.type) {
      case 'webview-ready':
        // Webview ready event
        break;

      case 'requestInitialData':
        // This would typically be handled by sending initial data
        // Implementation depends on specific webview needs
        break;

      default:
        // Unknown system message
        break;
    }
  }

  /**
   * Handle webview disposal
   * Cleans up tracking and publishes disposal events
   */
  private handleWebviewDisposal(viewType: string): void {
    this.activeWebviews.delete(viewType);
    this.webviewMetrics.delete(viewType);
  }

  /**
   * Update webview visibility tracking
   */
  private updateWebviewVisibility(viewType: string, visible: boolean): void {
    const metrics = this.webviewMetrics.get(viewType);
    if (metrics) {
      metrics.isVisible = visible;
      metrics.lastActivity = Date.now();
    }
  }
}
