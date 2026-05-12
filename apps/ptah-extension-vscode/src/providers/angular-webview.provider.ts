import {
  TOKENS,
  WebviewManager,
  WebviewMessageHandlerService,
  type Logger,
} from '@ptah-extension/vscode-core';
import { inject, injectable } from 'tsyringe';
import * as vscode from 'vscode';
// SessionManager, InteractiveSessionManager DELETED in TASK_2025_023 purge
// Sessions now handled by ClaudeProcess via CLI --session-id flag
import {
  type WebviewMessage,
  type WorkspaceChangedPayload,
} from '@ptah-extension/shared';
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
  private readonly _panels = new Map<string, vscode.WebviewPanel>();
  private readonly _panelEventQueues = new Map<string, WebviewEventQueue>();
  private htmlGenerator: WebviewHtmlGenerator;
  private fileWatcher?: vscode.FileSystemWatcher;

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    // SessionManager DELETED in TASK_2025_023 - ClaudeProcess handles sessions
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.WEBVIEW_EVENT_QUEUE)
    private readonly eventQueue: WebviewEventQueue,
    @inject(TOKENS.WEBVIEW_MESSAGE_HANDLER)
    private readonly messageHandler: WebviewMessageHandlerService, // InteractiveSessionManager DELETED in TASK_2025_023 - ClaudeProcess handles sessions // RpcHandler REMOVED - message handling delegated to WebviewMessageHandlerService
  ) {
    this.htmlGenerator = new WebviewHtmlGenerator(context);
    this.initializeDevelopmentWatcher();
    this.logger.info(
      'AngularWebviewProvider initialized - using shared WebviewMessageHandlerService',
    );
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this._view = webviewView;

    // CRITICAL: Register webview with WebviewManager for message routing
    this.webviewManager.registerWebviewView('ptah.main', webviewView);
    this.logger.info('Webview registered with WebviewManager as "ptah.main"');

    // InteractiveSessionManager DELETED in TASK_2025_023
    // Sessions now handled by ClaudeProcess via CLI --session-id flag

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
      this.htmlGenerator.buildWorkspaceInfo(),
    );

    // TASK_2025_019 Phase 1: Setup RPC message listener using shared service
    // Uses WebviewMessageHandlerService for unified message handling (RPC, permissions, etc.)
    this.messageHandler.setupMessageListener(
      {
        webviewId: 'ptah.main',
        webview: webviewView.webview,
        onReady: () => {
          this.logger.info('Sidebar webview ready signal received');
          this.markWebviewReady();
          // Send current workspace info after Angular bootstraps — handles the
          // race condition where workspaceFolders wasn't yet available when the
          // HTML was generated (common on Linux when VS Code starts without a folder).
          this.broadcastWorkspaceChanged();
        },
      },
      this._disposables,
    );

    // Keep workspace root in sync when the user opens/closes folders while the
    // sidebar is already visible (e.g. File > Open Folder on Linux/macOS).
    this._disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.broadcastWorkspaceChanged();
      }),
    );
  }

  /**
   * Create a full-screen Angular SPA panel
   * Uses shared WebviewMessageHandlerService for unified message handling
   * TASK_2025_117: Supports multiple independent panels with unique IDs
   */
  public async createPanel(options?: {
    initialSessionId?: string;
    initialSessionName?: string;
    initialView?: string;
  }): Promise<void> {
    const panelId = `ptah.panel.${crypto.randomUUID()}`;

    // Backward compat: 'orchestra-canvas' panel title kept for the ptah.openOrchestraCanvas command.
    // AppStateManager maps this to layoutMode('grid') + chat view at runtime.
    const panelTitle =
      options?.initialView === 'analytics'
        ? 'Ptah - Session Analytics'
        : options?.initialView === 'orchestra-canvas'
          ? 'Ptah - Orchestra Canvas'
          : options?.initialSessionName
            ? `Ptah - ${options.initialSessionName}`
            : 'Ptah - AI Coding Orchestra';
    const panel = vscode.window.createWebviewPanel(
      'ptah-angular-spa',
      panelTitle,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'browser'),
          vscode.Uri.joinPath(this.context.extensionUri, 'assets'),
          this.context.extensionUri, // Allow all extension resources
        ],
      },
    );

    // Track in local registry
    this._panels.set(panelId, panel);

    // Register with WebviewManager for broadcast message routing
    // Uses existing cast pattern (both WebviewPanel and WebviewView have .webview property)
    this.webviewManager.registerWebviewView(
      panelId,
      panel as unknown as vscode.WebviewView,
    );

    // Per-panel event queue for readiness gating (manually instantiated, not from DI)
    const panelEventQueue = new WebviewEventQueue(this.logger as Logger);
    this._panelEventQueues.set(panelId, panelEventQueue);

    // Per-panel disposables to avoid stale entries in shared _disposables
    const panelDisposables: vscode.Disposable[] = [];

    // Setup message handling using shared service
    this.messageHandler.setupMessageListener(
      {
        webviewId: panelId,
        webview: panel.webview,
        onReady: () => {
          if (!this._panels.has(panelId)) {
            this.logger.warn(
              `Panel ${panelId} ready signal received after disposal, ignoring`,
            );
            return;
          }
          this.logger.info(`Panel ${panelId} webview ready`);
          panelEventQueue.markReady();
          panelEventQueue.flush((event) => panel.webview.postMessage(event));
        },
      },
      panelDisposables,
    );

    // Generate HTML with panelId and optional initial session in ptahConfig
    panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(
      panel.webview,
      {
        workspaceInfo: this.htmlGenerator.buildWorkspaceInfo(),
        panelId,
        initialSessionId: options?.initialSessionId,
        initialSessionName: options?.initialSessionName,
        initialView: options?.initialView,
      },
    );

    // Cleanup on dispose: remove from local Map, dispose event queue and per-panel disposables
    // WebviewManager auto-removes via its own onDidDispose listener (registerWebviewView sets this up)
    panel.onDidDispose(() => {
      this._panels.delete(panelId);
      panelEventQueue.dispose();
      this._panelEventQueues.delete(panelId);
      panelDisposables.forEach((d) => d.dispose());
      this.logger.info(
        `Panel ${panelId} disposed, ${this._panels.size} panels remaining`,
      );
    });

    this.logger.info(
      `Panel ${panelId} created, ${this._panels.size} total panels`,
    );
  }

  /**
   * Broadcast the current workspace root to all open webviews.
   * Called on initial webview ready and on onDidChangeWorkspaceFolders.
   */
  private broadcastWorkspaceChanged(): void {
    const workspaceInfo = this.htmlGenerator.buildWorkspaceInfo();
    const message = {
      type: 'workspaceChanged',
      payload: {
        workspaceInfo,
        origin: null,
      } satisfies WorkspaceChangedPayload,
    };
    this._view?.webview.postMessage(message);
    for (const panel of this._panels.values()) {
      panel.webview.postMessage(message);
    }
  }

  /**
   * Get count of active editor panels
   * TASK_2025_117: Useful for monitoring and UI decisions
   */
  public get panelCount(): number {
    return this._panels.size;
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
   * Send message directly to sidebar webview (bypasses readiness check)
   * Internal method used by postMessage and flushEventQueue for SIDEBAR only.
   * TASK_2025_117: Panel event queues flush directly via their own closure in createPanel().
   */
  private postMessageDirect(message: WebviewMessage): void {
    if (this._view?.webview) {
      this._view.webview.postMessage(message);
    } else {
      this.logger.warn(
        `No sidebar webview available to send message: ${message.type}`,
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
        'browser',
      );

      // Create file system watcher for webview changes
      this.fileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(webviewDistPath, '**/*'),
        false, // Don't ignore creates
        false, // Don't ignore changes
        false, // Don't ignore deletes
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
        `Webview file changed: ${uri.fsPath} - Reloading webview`,
      );
      this.reloadWebview();
    } catch (error) {
      this.logger.error(
        'Error during hot reload:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Reload webview content (for hot reload during development)
   * TASK_2025_117: Iterates all panels and sidebar for reload
   */
  private async reloadWebview(): Promise<void> {
    let reloadedCount = 0;

    // Reset sidebar event queue on reload
    this.eventQueue.reset();

    // Reload all editor panels
    for (const [panelId, panel] of this._panels) {
      if (panel.webview) {
        const panelEventQueue = this._panelEventQueues.get(panelId);
        if (panelEventQueue) {
          panelEventQueue.reset();
        }
        const newHtml = this.htmlGenerator.generateAngularWebviewContent(
          panel.webview,
          {
            workspaceInfo: this.htmlGenerator.buildWorkspaceInfo(),
            panelId,
          },
        );
        panel.webview.html = newHtml;
        reloadedCount++;
        this.logger.info(`Panel ${panelId} webview reloaded`);
      }
    }

    // Reload sidebar
    if (this._view?.webview) {
      const newHtml = this.htmlGenerator.generateAngularWebviewContent(
        this._view.webview,
        this.htmlGenerator.buildWorkspaceInfo(),
      );
      this._view.webview.html = newHtml;
      reloadedCount++;
      this.logger.info('Sidebar webview reloaded');
    }

    if (reloadedCount === 0) {
      this.logger.warn('No webviews available to reload.');
    }
    // NOTE: Hot-reload works by replacing webview.html entirely, no need for refresh signal
  }

  // NOTE: handleWebviewMessage() REMOVED - All message handling now unified via
  // WebviewMessageHandlerService.setupMessageListener() in resolveWebviewView() and createPanel()
  // This eliminates ~160 lines of duplicate RPC, permission, and ready-signal handling code.

  /**
   * Dispose of resources
   * TASK_2025_117: Also disposes all per-panel event queues
   */
  dispose(): void {
    this.logger.info('Disposing Angular Webview Provider...');

    // Clear sidebar event queue using DI-injected service
    this.eventQueue.dispose();

    // Dispose all per-panel event queues
    for (const [panelId, panelEventQueue] of this._panelEventQueues) {
      panelEventQueue.dispose();
      this.logger.info(`Panel ${panelId} event queue disposed`);
    }
    this._panelEventQueues.clear();
    this._panels.clear();

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
