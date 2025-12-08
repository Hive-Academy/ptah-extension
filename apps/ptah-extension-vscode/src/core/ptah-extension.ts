import * as vscode from 'vscode';
import { TOKENS } from '@ptah-extension/vscode-core';
import { DIContainer } from '../di/container';
import type {
  Logger,
  ErrorHandler,
  ConfigManager,
  CommandManager,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';

/**
 * Main extension class for Ptah
 *
 * TASK_2025_023: Simplified after purge - no more "legacy" services or backward compatibility layers.
 * All services resolved from DI container. Extension only coordinates webview registration.
 */
export class PtahExtension implements vscode.Disposable {
  private static _instance: PtahExtension;
  private disposables: vscode.Disposable[] = [];

  // Core services from DI
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private configManager: ConfigManager;
  private commandManager: CommandManager;
  private webviewManager: WebviewManager;

  // Webview provider
  private angularWebviewProvider?: AngularWebviewProvider;

  constructor(private context: vscode.ExtensionContext) {
    PtahExtension._instance = this;

    // Resolve core services from DI container
    this.logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    this.errorHandler = DIContainer.resolve<ErrorHandler>(TOKENS.ERROR_HANDLER);
    this.configManager = DIContainer.resolve<ConfigManager>(
      TOKENS.CONFIG_MANAGER
    );
    this.commandManager = DIContainer.resolve<CommandManager>(
      TOKENS.COMMAND_MANAGER
    );
    this.webviewManager = DIContainer.resolve<WebviewManager>(
      TOKENS.WEBVIEW_MANAGER
    );
  }

  static get instance(): PtahExtension {
    return PtahExtension._instance;
  }

  /**
   * Initialize the extension
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Ptah extension...');

      // Resolve webview provider from DI
      this.angularWebviewProvider = DIContainer.resolve<AngularWebviewProvider>(
        TOKENS.ANGULAR_WEBVIEW_PROVIDER
      );

      // Register webview provider with VS Code
      this.registerWebviews();

      this.logger.info('Ptah extension initialized successfully');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Extension initialization failed', {
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Register all components - called after initialization
   */
  async registerAll(): Promise<void> {
    // All registration now happens in initialize()
    // This method kept for API compatibility with main.ts
    this.logger.info('Extension components registered');
  }

  /**
   * Register webview provider with VS Code
   */
  private registerWebviews(): void {
    if (!this.angularWebviewProvider) {
      this.logger.warn(
        'Angular webview provider not initialized, skipping webview registration'
      );
      return;
    }

    this.logger.info('Registering webview providers...');

    const disposable = vscode.window.registerWebviewViewProvider(
      'ptah.main',
      this.angularWebviewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    );
    this.disposables.push(disposable);

    this.logger.info('Webview providers registered');
  }

  /**
   * Welcome message for first-time users
   */
  async showWelcome(): Promise<void> {
    const message =
      'Welcome to Ptah! Ready to transform your Claude Code experience?';
    const actions = ['Get Started', 'Documentation'];

    const selection = await vscode.window.showInformationMessage(
      message,
      ...actions
    );

    if (selection === 'Get Started') {
      await vscode.commands.executeCommand('ptah.main.focus');
    } else if (selection === 'Documentation') {
      vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/anthropics/claude-code#readme')
      );
    }
  }

  /**
   * Show onboarding notification when authentication is missing
   * Guides users to configure authentication via Settings or OAuth token
   * TASK_2025_057 Batch 1 - Task 1.3
   */
  async showAuthenticationOnboarding(): Promise<void> {
    const message =
      'Ptah requires authentication to use Claude Code. Please configure your OAuth token or API key to get started.';
    const actions = ['Open Settings', 'Get OAuth Token', 'Dismiss'];

    const selection = await vscode.window.showInformationMessage(
      message,
      ...actions
    );

    if (selection === 'Open Settings') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'ptah'
      );
    } else if (selection === 'Get OAuth Token') {
      await vscode.env.openExternal(
        vscode.Uri.parse('https://docs.anthropic.com/en/docs/agents/quickstart')
      );
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.logger.info('Disposing Ptah extension...');

    try {
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];

      this.angularWebviewProvider?.dispose?.();

      this.logger.info('Ptah extension disposed successfully');
    } catch (error: any) {
      this.logger.error('Extension disposal failed', error);
    }
  }
}
