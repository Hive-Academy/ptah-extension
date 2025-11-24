import * as vscode from 'vscode';
import { TOKENS } from '@ptah-extension/vscode-core';
import { DIContainer } from '../di/container';
import type {
  Logger,
  ErrorHandler,
  ConfigManager,
  CommandManager,
  WebviewManager,
  EventBus,
  WebviewMessageBridge,
} from '@ptah-extension/vscode-core';
import type { WorkspaceAnalyzerService } from '@ptah-extension/workspace-intelligence';
import type { SessionManager } from '@ptah-extension/claude-domain';
import { CommandBuilderService } from '../services/command-builder.service';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';
import { CommandHandlers } from '../handlers/command-handlers';

export interface ServiceDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  errorHandler: ErrorHandler;
  configManager: ConfigManager;
  commandManager: CommandManager;
  webviewManager: WebviewManager;
  eventBus: EventBus;
  sessionManager: SessionManager; // DI-resolved from claude-domain
  workspaceAnalyzer: WorkspaceAnalyzerService; // DI-resolved from workspace-intelligence
  commandBuilderService: CommandBuilderService;
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
  private eventBus: EventBus;
  private webviewMessageBridge: WebviewMessageBridge;

  // DI-resolved domain services (TASK_CORE_001 - Phase 3)
  private sessionManager?: SessionManager; // From claude-domain
  private workspaceAnalyzer?: WorkspaceAnalyzerService; // From workspace-intelligence

  // Remaining legacy services
  private commandBuilderService?: CommandBuilderService;
  private angularWebviewProvider?: AngularWebviewProvider;

  // Command handlers (uses library services instead of legacy registries)
  private commandHandlers?: CommandHandlers;

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
    this.eventBus = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
    this.webviewMessageBridge = DIContainer.resolve<WebviewMessageBridge>(
      TOKENS.WEBVIEW_MESSAGE_BRIDGE
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

      // Initialize WebviewMessageBridge (forwards EventBus messages to webview)
      this.webviewMessageBridge.initialize();
      this.logger.info(
        'WebviewMessageBridge initialized - responses will now reach webview'
      );

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
      this.sessionManager = DIContainer.resolve<SessionManager>(
        TOKENS.SESSION_MANAGER
      );
      this.workspaceAnalyzer = DIContainer.resolve<WorkspaceAnalyzerService>(
        TOKENS.WORKSPACE_ANALYZER_SERVICE
      );

      // Resolve services from DI container
      this.commandBuilderService = DIContainer.resolve<CommandBuilderService>(
        TOKENS.COMMAND_BUILDER_SERVICE
      );
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
        eventBus: this.eventBus,
        sessionManager: this.sessionManager,
        workspaceAnalyzer: this.workspaceAnalyzer,
        commandBuilderService: this.commandBuilderService,
        angularWebviewProvider: this.angularWebviewProvider,
      };

      this.logger.info('Services initialized successfully (DI-based)');
    } catch (error) {
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

    // Initialize command handlers (uses DI-enabled services but services object still passed manually)
    // CommandHandlers expects 3 parameters: logger, chatOrchestration, services
    // We'll manually pass all dependencies since services is not a registered token
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    const chatOrchestration = DIContainer.resolve<ChatOrchestrationService>(
      TOKENS.CHAT_ORCHESTRATION_SERVICE
    );
    this.commandHandlers = new CommandHandlers(
      logger,
      chatOrchestration,
      this.services
    );

    // NOTE: Legacy registries removed (TASK_CORE_001)
    // Commands now registered via CommandManager from vscode-core
    // Webviews now registered via WebviewManager from vscode-core
    // Events now registered via EventBus from vscode-core
  }

  /**
   * Register all components using library services (TASK_CORE_001)
   */
  private async registerAllComponents(): Promise<void> {
    console.log('[PtahExtension.registerAllComponents] START');

    if (!this.commandHandlers) {
      const error = 'Command handlers not initialized';
      console.error('[PtahExtension.registerAllComponents] ERROR:', error);
      throw new Error(error);
    }

    // Register commands using CommandManager from vscode-core
    console.log(
      '[PtahExtension.registerAllComponents] Step 1: Registering commands...'
    );
    this.registerCommands();
    console.log(
      '[PtahExtension.registerAllComponents] Step 1: Commands registered'
    );

    // Register webview providers using WebviewManager from vscode-core
    console.log(
      '[PtahExtension.registerAllComponents] Step 2: Registering webviews...'
    );
    this.registerWebviews();
    console.log(
      '[PtahExtension.registerAllComponents] Step 2: Webviews registered'
    );

    // Set up event handlers using EventBus from vscode-core
    console.log(
      '[PtahExtension.registerAllComponents] Step 3: Registering events...'
    );
    this.registerEvents();
    console.log(
      '[PtahExtension.registerAllComponents] Step 3: Events registered'
    );

    this.logger.info('All components registered successfully');
    console.log('[PtahExtension.registerAllComponents] COMPLETE');
  }

  /**
   * Register extension commands using CommandManager
   */
  private registerCommands(): void {
    this.logger.info('Registering extension commands...');

    const handlers = this.commandHandlers;
    if (!handlers) {
      throw new Error('Command handlers not initialized');
    }

    const commands = [
      // Core commands
      { id: 'ptah.quickChat', handler: () => handlers.quickChat() },
      {
        id: 'ptah.reviewCurrentFile',
        handler: () => handlers.reviewCurrentFile(),
      },
      { id: 'ptah.generateTests', handler: () => handlers.generateTests() },
      { id: 'ptah.buildCommand', handler: () => handlers.buildCommand() },

      // Session management
      { id: 'ptah.newSession', handler: () => handlers.newSession() },
      { id: 'ptah.switchSession', handler: () => handlers.switchSession() },

      // Context management
      {
        id: 'ptah.includeFile',
        handler: (uri: vscode.Uri) => handlers.includeFile(uri),
      },
      {
        id: 'ptah.excludeFile',
        handler: (uri: vscode.Uri) => handlers.excludeFile(uri),
      },
      { id: 'ptah.optimizeContext', handler: () => handlers.optimizeContext() },

      // Analytics and insights
      { id: 'ptah.showAnalytics', handler: () => handlers.showAnalytics() },

      // Diagnostic (debugging)
      { id: 'ptah.runDiagnostic', handler: () => handlers.runDiagnostic() },
    ];

    // Register all commands with CommandManager
    commands.forEach(({ id, handler }) => {
      this.commandManager.registerCommand({
        id,
        title: id, // Use id as title for now
        handler,
      });
    });

    this.logger.info(`Registered ${commands.length} commands`);
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
   * Set up event handlers using EventBus
   */
  private registerEvents(): void {
    this.logger.info('Setting up event handlers...');

    // Subscribe to relevant events
    // (Event subscriptions will be added as needed)

    this.logger.info('Event handlers registered');
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
    } catch (error) {
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

      // Dispose WebviewMessageBridge
      this.webviewMessageBridge.dispose();

      // Dispose legacy services
      this.angularWebviewProvider?.dispose?.();
      this.analyticsDataCollector?.dispose();
      this.commandBuilderService?.dispose();

      // DI-managed services are disposed by the container
      // (sessionManager, contextManager, workspaceAnalyzer, providerManager)

      this.logger.info('Ptah extension disposed successfully');
    } catch (error) {
      this.logger.error('Extension disposal failed', error);
    }
  }
}
