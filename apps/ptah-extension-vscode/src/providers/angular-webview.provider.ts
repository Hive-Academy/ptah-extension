import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  EventBus,
  WebviewManager,
} from '@ptah-extension/vscode-core';
// Import from libraries instead of local services
import { SessionManager } from '@ptah-extension/claude-domain';
import {
  ContextManager,
  ProviderManager,
} from '@ptah-extension/ai-providers-core';
import { CommandBuilderService } from '../services/command-builder.service';
import { AnalyticsDataCollector } from '../services/analytics-data-collector';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';
import { WebviewEventQueue } from '../services/webview-event-queue';
import { WebviewInitialDataBuilder } from '../services/webview-initial-data-builder';
import {
  type MessagePayloadMap,
  type WebviewMessage,
} from '@ptah-extension/shared';

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
    @inject(TOKENS.CONTEXT_MANAGER)
    private readonly contextManager: ContextManager,
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.PROVIDER_MANAGER)
    private readonly providerManager: ProviderManager,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.WEBVIEW_EVENT_QUEUE)
    private readonly eventQueue: WebviewEventQueue,
    @inject(TOKENS.WEBVIEW_INITIAL_DATA_BUILDER)
    private readonly initialDataBuilder: WebviewInitialDataBuilder,
    // TODO: Convert these to DI once they are available
    private commandBuilderService: CommandBuilderService,
    private analyticsDataCollector: AnalyticsDataCollector
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

    // Set Angular HTML content using dedicated generator
    // Get workspace info from initial data builder
    const initialData = await this.initialDataBuilder.build();
    const workspaceInfo = initialData.config.workspaceInfo;

    webviewView.webview.html = this.htmlGenerator.generateAngularWebviewContent(
      webviewView.webview,
      workspaceInfo
    );

    // Handle messages using the router
    webviewView.webview.onDidReceiveMessage(
      this.handleWebviewMessage.bind(this),
      undefined,
      this._disposables
    );

    // Handle visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendInitialData();
      }
    });

    // Send initial data when webview loads
    this.sendInitialData();

    // Register command to open full panel
    this.registerPanelCommand();
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

    // Get workspace info from initial data builder
    const initialData = await this.initialDataBuilder.build();
    const workspaceInfo = initialData.config.workspaceInfo;

    this._panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(
      this._panel.webview,
      workspaceInfo
    );

    // Handle messages from Angular app
    this._panel.webview.onDidReceiveMessage(
      this.handleWebviewMessage.bind(this),
      undefined,
      this._disposables
    );

    // Handle panel disposal
    this._panel.onDidDispose(
      () => {
        this._panel = undefined;
      },
      undefined,
      this._disposables
    );

    // Send initial data
    this.sendInitialData(this._panel.webview);
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
   * Handle messages from Angular application using EventBus
   * Single Responsibility: Receive webview messages and publish to EventBus
   * MessageHandlerService subscribes to EventBus and routes to orchestration services
   *
   * ARCHITECTURE: Webview → this.eventBus.publish() → MessageHandlerService → Orchestration Services
   */
  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    try {
      this.logger.info(`Received webview message: ${message.type}`, {
        hasPayload: !!message.payload,
      });

      // Handle special system messages locally (don't publish to EventBus)
      if (message.type === 'ready' || message.type === 'webview-ready') {
        this.logger.info('Webview ready signal received');
        this.markWebviewReady(); // Mark as ready and flush queue
        await this.sendInitialData();
        return;
      }

      if (message.type === 'requestInitialData') {
        this.logger.info('Angular requested initial data');
        await this.sendInitialData();
        return;
      }

      // Publish all routable messages to EventBus (exclude system messages)
      // MessageHandlerService will handle routing to appropriate orchestration services
      // System messages: initialData, ready, webview-ready, requestInitialData, themeChanged, navigate, error, refresh
      const systemMessageTypes = [
        'initialData',
        'ready',
        'webview-ready',
        'requestInitialData',
        'themeChanged',
        'navigate',
        'error',
        'refresh',
      ];
      const isSystemMessage = systemMessageTypes.includes(message.type);

      if (!isSystemMessage) {
        this.logger.info(`Publishing message to EventBus: ${message.type}`);

        // Publish to EventBus with webview as source
        this.eventBus.publish(
          message.type as keyof MessagePayloadMap,
          message.payload,
          'webview'
        );

        this.logger.info(`Message ${message.type} published to EventBus`);
      } else {
        // System message not handled above
        this.logger.warn(`Unrecognized system message type: ${message.type}`);
      }
    } catch (error) {
      this.logger.error('Error handling webview message:', error);
      this.postMessage({
        type: 'error',
        payload: {
          message: error instanceof Error ? error.message : 'Unknown error',
          source: message.type,
        },
      });
    }
  }

  /**
   * Send initial data to Angular application (with guard to prevent redundant calls)
   * Now uses WebviewInitialDataBuilder for type-safe construction
   */
  private async sendInitialData(webview?: vscode.Webview): Promise<void> {
    const target = webview || this._view?.webview || this._panel?.webview;
    if (!target) return;

    // Guard: Prevent redundant initializations
    if (this._initialDataSent) {
      this.logger.info('Initial data already sent, skipping redundant call');
      return;
    }

    try {
      // Build type-safe initial data using service
      const payload = await this.initialDataBuilder.build();

      // Send to webview
      target.postMessage({
        type: 'initialData',
        payload,
      });

      this._initialDataSent = true;
      this.logger.info('Initial data sent to webview', {
        sessionCount: payload.data.sessions.length,
        providerCount: payload.data.providers.available.length,
      });
    } catch (error) {
      // Reset flag on error to allow retry
      this._initialDataSent = false;
      this.logger.error('Error sending initial data:', error);
    }
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
    } catch (error) {
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

    // Get workspace info from builder
    const payload = await this.initialDataBuilder.build();
    const workspaceInfo = payload.config.workspaceInfo;

    const newHtml = this.htmlGenerator.generateAngularWebviewContent(
      webview,
      workspaceInfo
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
