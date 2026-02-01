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
import type { LicenseCommands } from '../commands/license-commands';

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
    // Register license commands (TASK_2025_075 Batch 6)
    const licenseCommands = DIContainer.resolve<LicenseCommands>(
      TOKENS.LICENSE_COMMANDS
    );
    licenseCommands.registerCommands(this.context);
    this.logger.info('License commands registered');

    // All other registration now happens in initialize()
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

    // TASK_2025_117: Register command to open editor panel
    // This command is declared in package.json and triggered from webview header button
    const provider = this.angularWebviewProvider;
    const logger = this.logger;
    const panelCommand = vscode.commands.registerCommand(
      'ptah.openFullPanel',
      async () => {
        try {
          await provider.createPanel();
        } catch (err) {
          logger.error('Failed to create editor panel', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    );
    this.disposables.push(panelCommand);

    this.logger.info('Webview providers and panel command registered');
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
   * Show onboarding notification when authentication is missing.
   * Guides users to configure authentication via the Ptah Angular settings panel.
   * Non-critical UI operation — errors are logged but never propagate to avoid
   * breaking extension activation.
   * TASK_2025_057 Batch 1 - Task 1.3
   */
  async showAuthenticationOnboarding(): Promise<void> {
    const message =
      'Ptah requires authentication. Configure your credentials in the Ptah settings panel.';
    const actions = ['Open Ptah Settings', 'Dismiss'];

    const selection = await vscode.window.showInformationMessage(
      message,
      ...actions
    );

    if (selection === 'Open Ptah Settings') {
      try {
        this.logger.info('Auth onboarding: user selected Open Ptah Settings');
        // Focus the PTAH webview sidebar panel
        await vscode.commands.executeCommand('ptah.main.focus');
        // Small delay to allow webview to initialize if it was just created.
        // ptah.main.focus resolves when the panel is focused, but the Angular
        // app inside may still be bootstrapping on first use.
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Navigate webview to settings view
        await this.webviewManager.broadcastMessage('switchView', {
          view: 'settings',
        });
      } catch (err) {
        this.logger.warn('Auth onboarding: failed to navigate to settings', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
