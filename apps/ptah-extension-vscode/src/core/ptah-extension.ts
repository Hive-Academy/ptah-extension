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
import type { WorkspaceAnalyzerService } from '@ptah-extension/workspace-intelligence';
// SessionManager DELETED in TASK_2025_023 purge - sessions now managed by ClaudeProcess
import { AngularWebviewProvider } from '../providers/angular-webview.provider';

export interface ServiceDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  errorHandler: ErrorHandler;
  configManager: ConfigManager;
  commandManager: CommandManager;
  webviewManager: WebviewManager;

  // sessionManager DELETED in TASK_2025_023 - ClaudeProcess handles sessions via CLI --session-id
  workspaceAnalyzer: WorkspaceAnalyzerService; // DI-resolved from workspace-intelligence
  angularWebviewProvider: AngularWebviewProvider;
}

/**
 * Main extension class for Ptah - Lightweight coordinator using DI pattern
 */
export class PtahExtension implements vscode.Disposable {
  private static _instance: PtahExtension;
  private disposables: vscode.Disposable[] = [];

  // DI-resolved services (from libraries)
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private configManager: ConfigManager;
  private commandManager: CommandManager;
  private webviewManager: WebviewManager;

  // DI-resolved domain services (TASK_CORE_001 - Phase 3)
  // sessionManager DELETED in TASK_2025_023 - ClaudeProcess handles sessions
  private workspaceAnalyzer?: WorkspaceAnalyzerService; // From workspace-intelligence

  // Webview provider
  private angularWebviewProvider?: AngularWebviewProvider;

  // Services reference for backward compatibility
  private services?: ServiceDependencies;

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

      // Initialize legacy services (to be migrated in future tasks)
      await this.initializeLegacyServices();

      // Initialize handlers and registries
      this.initializeComponents();

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
    console.log('[PtahExtension.registerAll] START');
    try {
      this.logger.info('Registering extension components...');

      // Register everything
      console.log(
        '[PtahExtension.registerAll] Calling registerAllComponents()...'
      );
      await this.registerAllComponents();
      console.log(
        '[PtahExtension.registerAll] registerAllComponents() complete'
      );

      this.logger.info('Extension components registered successfully');
      console.log('[PtahExtension.registerAll] COMPLETE');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error('[PtahExtension.registerAll] ERROR:', errorMessage);
      console.error(
        '[PtahExtension.registerAll] Error stack:',
        error instanceof Error ? error.stack : 'No stack'
      );
      this.logger.error('Component registration failed', {
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Initialize legacy services (temporary - to be migrated)
   * TASK_CORE_001 - Phase 3: Now resolves domain services from DI
   */
  private async initializeLegacyServices(): Promise<void> {
    this.logger.info('Initializing services...');

    try {
      // Resolve domain services from DI (TASK_CORE_001 - Phase 3)
      // SessionManager DELETED in TASK_2025_023 - ClaudeProcess handles sessions via CLI --session-id
      this.workspaceAnalyzer = DIContainer.resolve<WorkspaceAnalyzerService>(
        TOKENS.WORKSPACE_ANALYZER_SERVICE
      );

      // Resolve webview provider from DI container
      this.angularWebviewProvider = DIContainer.resolve<AngularWebviewProvider>(
        TOKENS.ANGULAR_WEBVIEW_PROVIDER
      );

      // Build services object for backward compatibility
      if (!this.workspaceAnalyzer) {
        throw new Error('WorkspaceAnalyzerService not initialized');
      }

      this.services = {
        context: this.context,
        logger: this.logger,
        errorHandler: this.errorHandler,
        configManager: this.configManager,
        commandManager: this.commandManager,
        webviewManager: this.webviewManager,
        // sessionManager DELETED - sessions now via ClaudeProcess + CLI
        workspaceAnalyzer: this.workspaceAnalyzer,
        angularWebviewProvider: this.angularWebviewProvider,
      };

      this.logger.info('Services initialized successfully (DI-based)');
    } catch (error: any) {
      this.logger.error('Failed to initialize services', error);
      throw error;
    }
  }

  /**
   * Initialize handlers and registries
   */
  private initializeComponents(): void {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    // NOTE: All command handlers deleted (commands were removed in purge)
    // Webviews registered via AngularWebviewProvider
    // EventBus removed in Phase 0 purge (TASK_2025_021)
  }

  /**
   * Register all components using library services (TASK_CORE_001)
   */
  private async registerAllComponents(): Promise<void> {
    console.log('[PtahExtension.registerAllComponents] START');

    // Register webview providers
    console.log(
      '[PtahExtension.registerAllComponents] Registering webviews...'
    );
    this.registerWebviews();
    console.log('[PtahExtension.registerAllComponents] Webviews registered');

    this.logger.info('All components registered successfully');
    console.log('[PtahExtension.registerAllComponents] COMPLETE');
  }

  /**
   * Register webview providers using WebviewManager
   */
  private registerWebviews(): void {
    if (!this.angularWebviewProvider) {
      this.logger.warn(
        'Angular webview provider not initialized, skipping webview registration'
      );
      return;
    }

    this.logger.info('Registering webview providers...');

    // Register Angular webview provider
    // WebviewManager doesn't have register() - it uses VS Code's built-in webview view registration
    // The webview provider is registered through VS Code's registerWebviewViewProvider
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
      // Open chat sidebar and show quick tour
      await vscode.commands.executeCommand('ptah.main.focus');
    } else if (selection === 'Documentation') {
      vscode.env.openExternal(
        vscode.Uri.parse(
          'https://github.com/your-org/ptah-extension-vscode#readme'
        )
      );
    }
  }

  /**
   * Get service access for external components
   */
  getServices(): ServiceDependencies | undefined {
    return this.services;
  }

  /**
   * Get webview registry for external access
   * @deprecated Legacy method - will be removed
   */
  getWebviewRegistry(): undefined {
    return undefined;
  }

  /**
   * Get command registry for external access
   * @deprecated Legacy method - will be removed
   */
  getCommandRegistry(): undefined {
    return undefined;
  }

  /**
   * Health check - verify all components are operational
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.services) {
        this.logger.warn('Extension components not fully initialized');
        return false;
      }

      this.logger.info('Extension health check passed');
      return true;
    } catch (error: any) {
      this.logger.error('Health check failed', error);
      return false;
    }
  }

  /**
   * Get extension status information
   */
  getStatus(): {
    initialized: boolean;
  } {
    return {
      initialized: !!this.services,
    };
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.logger.info('Disposing Ptah extension...');

    try {
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];

      // Dispose webview provider
      this.angularWebviewProvider?.dispose?.();

      // DI-managed services are disposed by the container
      // (sessionManager, contextManager, workspaceAnalyzer, providerManager)

      this.logger.info('Ptah extension disposed successfully');
    } catch (error: any) {
      this.logger.error('Extension disposal failed', error);
    }
  }
}
