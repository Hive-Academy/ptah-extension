import {
  TOKENS,
  WebviewManager,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import { inject, injectable } from 'tsyringe';
import * as vscode from 'vscode';
// Import from libraries instead of local services
import { SessionManager } from '@ptah-extension/claude-domain';
import { type WebviewMessage } from '@ptah-extension/shared';
import { WebviewEventQueue } from '../services/webview-event-queue';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';

/**
 * Workspace information interface
 */
/**
 * Unified Angular Webview Provider - REFACTORED with Service Extraction
 *
 * Responsibilities (SOLID Single Responsibility):
 * 1. Webview lifecycle management (create/resolve/dispose)
 * 2. Message routing (webview ↔ extension via EventBus)
 * 3. Development hot reload (file watching)
 *
 * Extracted Services (Priority 2):
 * - WebviewEventQueue: Event queueing before webview ready
 * - WebviewInitialDataBuilder: Type-safe initial data construction
 *
 * ARCHITECTURE: Webview → EventBus → MessageHandlerService → Orchestration Services
 */
/**
 * Maximum queue size constant removed - now in WebviewEventQueue
 */

@injectable()
export class AngularWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _panel?: vscode.WebviewPanel;
  private htmlGenerator: WebviewHtmlGenerator;
  private fileWatcher?: vscode.FileSystemWatcher;
  private _initialDataSent = false;

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SESSION_MANAGER)
    private readonly sessionManager: SessionManager,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.WEBVIEW_EVENT_QUEUE)
    private readonly eventQueue: WebviewEventQueue,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler
  ) {
    this.htmlGenerator = new WebviewHtmlGenerator(context);
    this.initializeDevelopmentWatcher();
    this.logger.info(
      'AngularWebviewProvider initialized - message forwarding handled by WebviewMessageBridge'
    );
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this._view = webviewView;

    // CRITICAL: Register webview with WebviewManager for message routing
    this.webviewManager.registerWebviewView('ptah.main', webviewView);
    this.logger.info('Webview registered with WebviewManager as "ptah.main"');

    // Configure webview for Angular app
    // NOTE: context.extensionUri already points to dist/apps/ptah-extension-vscode
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'browser'),
        vscode.Uri.joinPath(this.context.extensionUri, 'assets'),
        this.context.extensionUri, // Allow all extension resources
      ],
    };

    webviewView.webview.html = this.htmlGenerator.generateAngularWebviewContent(
      webviewView.webview,
      this.htmlGenerator.buildWorkspaceInfo() as Record<string, unknown>
    );

    // TASK_2025_019 Phase 1: Setup RPC message listener
    webviewView.webview.onDidReceiveMessage(
      async (message: any) => {
        await this.handleWebviewMessage(message);
      },
      undefined,
      this._disposables
    );
  }

  /**
   * Create a full-screen Angular SPA panel
   */
  public async createPanel(): Promise<void> {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'ptah-angular-spa',
      'Ptah - Claude Code Assistant',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'browser'),
          vscode.Uri.joinPath(this.context.extensionUri, 'assets'),
          this.context.extensionUri, // Allow all extension resources
        ],
      }
    );

    this._panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(
      this._panel.webview,
      this.htmlGenerator.buildWorkspaceInfo() as Record<string, unknown>
    );

    // Handle panel disposal
    this._panel.onDidDispose(
      () => {
        this._panel = undefined;
      },
      undefined,
      this._disposables
    );
  }

  /**
   * Switch the view mode (handled by Angular routing)
   */
  public switchView(viewType: 'chat' | 'command-builder' | 'analytics'): void {
    this.postMessage({
      type: 'navigate',
      payload: { route: `/${viewType}` },
    });
  }

  /**
   * Send message directly to Angular webview
   * Public interface for external services to communicate with the webview
   * Implements readiness gate to prevent events from being dropped
   */
  public sendMessage(message: WebviewMessage): void {
    this.postMessage(message);
  }

  /**
   * Mark webview as ready and flush queued events
   * Called after webview HTML loaded and Angular app initialized
   * FIX-002: Ensures all queued events are delivered after initialization
   */
  private markWebviewReady(): void {
    this.eventQueue.markReady();
    this.eventQueue.flush((event) => this.postMessageDirect(event));
  }

  /**
   * Send message to Angular application - Type-safe messaging
   * Uses WebviewEventQueue service for readiness gate
   */
  private postMessage(message: WebviewMessage): void {
    // Try to enqueue if not ready
    const wasQueued = this.eventQueue.enqueue(message);

    if (wasQueued) {
      // Event was queued (webview not ready)
      return;
    }

    // Webview ready - deliver immediately
    this.postMessageDirect(message);
  }

  /**
   * Send message directly to webview (bypasses readiness check)
   * Internal method used by postMessage and flushEventQueue
   */
  private postMessageDirect(message: WebviewMessage): void {
    if (this._panel?.webview) {
      this._panel.webview.postMessage(message);
    } else if (this._view?.webview) {
      this._view.webview.postMessage(message);
    } else {
      this.logger.warn(
        `No active webviews available to send message: ${message.type}`
      );
    }
  }

  /**
   * Initialize development file watcher for hot reload
   * Implements development file watching for hot reload during F5 debugging
   */
  private initializeDevelopmentWatcher(): void {
    // Only enable in development mode (when debugging)
    if (this.context.extensionMode === vscode.ExtensionMode.Development) {
      const webviewDistPath = vscode.Uri.joinPath(
        this.context.extensionUri,
        'webview',
        'browser'
      );

      // Create file system watcher for webview changes
      this.fileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(webviewDistPath, '**/*'),
        false, // Don't ignore creates
        false, // Don't ignore changes
        false // Don't ignore deletes
      );

      // Handle webview file changes
      this.fileWatcher.onDidChange(this.handleWebviewFileChange.bind(this));
      this.fileWatcher.onDidCreate(this.handleWebviewFileChange.bind(this));
      this.fileWatcher.onDidDelete(this.handleWebviewFileChange.bind(this));

      this._disposables.push(this.fileWatcher);
      this.logger.info('Development file watcher initialized for hot reload');
    }
  }

  /**
   * Handle webview file changes for hot reload
   * Implements webview HTML reloading on file changes
   */
  private async handleWebviewFileChange(uri: vscode.Uri): Promise<void> {
    // Debounce rapid file changes
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      this.logger.info(
        `Webview file changed: ${uri.fsPath} - Reloading webview`
      );
      this.reloadWebview();
    } catch (error: any) {
      this.logger.error('Error during hot reload:', error);
    }
  }

  /**
   * Reload webview content (for hot reload during development)
   */
  private async reloadWebview(): Promise<void> {
    const webview = this._panel?.webview || this._view?.webview;
    if (!webview) {
      this.logger.warn('No webview available to reload.');
      return;
    }

    // Reset initialization guards on reload
    this._initialDataSent = false;
    this.eventQueue.reset(); // Webview instance changes on reload

    const newHtml = this.htmlGenerator.generateAngularWebviewContent(
      webview,
      this.htmlGenerator.buildWorkspaceInfo() as Record<string, unknown>
    );

    if (this._panel?.webview) {
      this._panel.webview.html = newHtml;
      this.logger.info('Panel webview reloaded');
    }

    if (this._view?.webview) {
      this._view.webview.html = newHtml;
      this.logger.info('View webview reloaded');
    }

    // Send refresh signal to Angular app
    this.postMessage({
      type: 'refresh',
      payload: { reason: 'hot-reload', timestamp: Date.now() },
    });
  }

  /**
   * Register the panel command (DRY principle - extracted method)
   */
  private registerPanelCommand(): void {
    vscode.commands.registerCommand('ptah.openFullPanel', () => {
      this.createPanel();
    });
  }

  /**
   * Handle messages from webview (RPC requests)
   * TASK_2025_019 Phase 1: Route RPC requests to handler and send responses back
   */
  private async handleWebviewMessage(message: any): Promise<void> {
    // Handle RPC requests
    if (message.type === 'rpc:request') {
      const { requestId, method, params } = message;

      try {
        // Call RPC handler
        const response = await this.rpcHandler.handleMessage({
          method,
          params,
          correlationId: requestId,
        });

        // Send response back to webview
        this.postMessageDirect({
          type: 'rpc:response',
          requestId,
          result: response.data,
          error: response.error ? { message: response.error } : undefined,
        } as any);
      } catch (error) {
        // Send error response
        this.postMessageDirect({
          type: 'rpc:response',
          requestId,
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        } as any);
      }
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.logger.info('Disposing Angular Webview Provider...');

    // Clear event queue using service
    this.eventQueue.dispose();

    // Dispose file watcher
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = undefined;
    }

    // Dispose all other resources
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
