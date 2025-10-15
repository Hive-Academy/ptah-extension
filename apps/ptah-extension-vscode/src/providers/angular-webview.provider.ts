import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger, EventBus } from '@ptah-extension/vscode-core';
// Import from libraries instead of local services
import {
  SessionManager,
  SESSION_MANAGER as CLAUDE_SESSION_MANAGER,
} from '@ptah-extension/claude-domain';
import {
  ContextManager,
  ProviderManager,
} from '@ptah-extension/ai-providers-core';
import { CommandBuilderService } from '../services/command-builder.service';
import { AnalyticsDataCollector } from '../services/analytics-data-collector';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';
import { WebviewMessage, isRoutableMessage } from '@ptah-extension/shared';

/**
 * Workspace information interface
 */
interface WorkspaceInfo {
  name: string;
  path: string;
  projectType: string;
}

/**
 * Unified Angular Webview Provider - REFACTORED with EventBus Architecture
 * Single Responsibility: Manage webview lifecycle and publish messages to EventBus
 * Follows Dependency Inversion: Depends on EventBus abstraction
 *
 * ARCHITECTURE: Webview → EventBus → MessageHandlerService → Orchestration Services
 */
@injectable()
export class AngularWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _panel?: vscode.WebviewPanel;
  private htmlGenerator: WebviewHtmlGenerator;
  private fileWatcher?: vscode.FileSystemWatcher;

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(CLAUDE_SESSION_MANAGER)
    private readonly sessionManager: SessionManager,
    @inject(TOKENS.CONTEXT_MANAGER)
    private readonly contextManager: ContextManager,
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.AI_PROVIDER_MANAGER)
    private readonly providerManager: ProviderManager,
    // TODO: Convert these to DI once they are available
    private commandBuilderService: CommandBuilderService,
    private analyticsDataCollector: AnalyticsDataCollector
  ) {
    this.htmlGenerator = new WebviewHtmlGenerator(context);
    this.initializeDevelopmentWatcher();
    this.logger.info(
      'AngularWebviewProvider initialized with EventBus architecture'
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    // Configure webview for Angular app
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this.context.extensionUri,
          'dist',
          'apps',
          'ptah-extension-vscode',
          'webview',
          'browser'
        ),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };

    // Set Angular HTML content using dedicated generator
    const workspaceInfo = this.getWorkspaceInfo();
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
  public createPanel(): void {
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
          vscode.Uri.joinPath(
            this.context.extensionUri,
            'dist',
            'apps',
            'ptah-extension-vscode',
            'webview',
            'browser'
          ),
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
          vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        ],
      }
    );

    const workspaceInfo = this.getWorkspaceInfo();
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
   */
  public sendMessage(message: WebviewMessage): void {
    this.postMessage(message);
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
        await this.sendInitialData();
        return;
      }

      if (message.type === 'requestInitialData') {
        this.logger.info('Angular requested initial data');
        await this.sendInitialData();
        return;
      }

      // Publish all routable messages to EventBus
      // MessageHandlerService will handle routing to appropriate orchestration services
      if (isRoutableMessage(message)) {
        this.logger.info(`Publishing message to EventBus: ${message.type}`);

        // Publish to EventBus with webview as source
        this.eventBus.publish(
          message.type as keyof import('@ptah-extension/shared').MessagePayloadMap,
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
   * Send initial data to Angular application
   */
  private async sendInitialData(webview?: vscode.Webview): Promise<void> {
    const target = webview || this._view?.webview || this._panel?.webview;
    if (!target) return;

    try {
      // Get current state
      const currentSession = this.sessionManager.getCurrentSession();
      const context = await this.contextManager.getCurrentContext();
      const workspaceInfo = this.getWorkspaceInfo();

      const initialData = {
        type: 'initialData',
        payload: {
          success: true,
          data: {
            sessions: this.sessionManager.getAllSessions(),
            currentSession: currentSession,
          },
          config: {
            context,
            workspaceInfo,
            theme: vscode.window.activeColorTheme.kind,
            isVSCode: true,
            extensionVersion: this.context.extension.packageJSON.version,
          },
          timestamp: Date.now(),
        },
      };

      target.postMessage(initialData);
      this.logger.info('Initial data sent to webview');
    } catch (error) {
      this.logger.error('Error sending initial data:', error);
    }
  }

  /**
   * Send message to Angular application - Type-safe messaging
   */
  private postMessage(message: WebviewMessage): void {
    if (this._panel?.webview) {
      this._panel.webview.postMessage(message);
    } else if (this._view?.webview) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Get workspace information
   */
  private getWorkspaceInfo(): WorkspaceInfo | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    return {
      name: workspaceFolders[0].name,
      path: workspaceFolders[0].uri.fsPath,
      projectType: this.detectProjectType(workspaceFolders[0].uri.fsPath),
    };
  }

  /**
   * Detect project type based on files
   */
  private detectProjectType(workspacePath: string): string {
    const fs = require('fs');
    const path = require('path');

    try {
      // Check for package.json first
      const packageJsonPath = path.join(workspacePath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf8')
        );

        // Check for specific framework indicators
        if (packageJson.dependencies || packageJson.devDependencies) {
          const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
          };

          if (allDeps['@angular/core']) return 'angular';
          if (allDeps['react']) return 'react';
          if (allDeps['vue']) return 'vue';
          if (allDeps['@nestjs/core']) return 'nestjs';
          if (allDeps['express']) return 'express';
          if (allDeps['next']) return 'nextjs';
          if (allDeps['nuxt']) return 'nuxt';
          if (allDeps['svelte']) return 'svelte';
          if (allDeps['typescript']) return 'typescript';
        }

        return 'nodejs';
      }

      // Check for other project indicators
      if (fs.existsSync(path.join(workspacePath, 'angular.json')))
        return 'angular';
      if (fs.existsSync(path.join(workspacePath, 'nx.json'))) return 'nx';
      if (fs.existsSync(path.join(workspacePath, 'pom.xml')))
        return 'java-maven';
      if (fs.existsSync(path.join(workspacePath, 'build.gradle')))
        return 'java-gradle';
      if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) return 'rust';
      if (fs.existsSync(path.join(workspacePath, 'go.mod'))) return 'go';
      if (
        fs.existsSync(path.join(workspacePath, 'requirements.txt')) ||
        fs.existsSync(path.join(workspacePath, 'pyproject.toml'))
      )
        return 'python';
      if (fs.existsSync(path.join(workspacePath, 'Gemfile'))) return 'ruby';
      if (fs.existsSync(path.join(workspacePath, 'composer.json')))
        return 'php';
      if (
        fs.existsSync(path.join(workspacePath, '.csproj')) ||
        fs.existsSync(path.join(workspacePath, '*.sln'))
      )
        return 'csharp';

      return 'generic';
    } catch (error) {
      this.logger.warn('Error detecting project type:', error);
      return 'unknown';
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
        'dist',
        'apps',
        'ptah-extension-vscode',
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
    const workspaceInfo = this.getWorkspaceInfo();
    const webview = this._panel?.webview || this._view?.webview;
    if (!webview) {
      this.logger.warn('No webview available to reload.');
      return;
    }
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
