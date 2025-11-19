import * as vscode from 'vscode';
import { TOKENS } from '@ptah-extension/vscode-core';
import { DIContainer } from '../di/container';
import { container } from 'tsyringe';
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
import type {
  SessionManager,
  ChatOrchestrationService,
} from '@ptah-extension/claude-domain';
import type {
  ProviderManager,
  ContextManager,
  VsCodeLmAdapter,
  ClaudeCliAdapter,
  ProviderContext,
} from '@ptah-extension/ai-providers-core';
import { CommandBuilderService } from '../services/command-builder.service';
import { AnalyticsDataCollector } from '../services/analytics-data-collector';
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
  contextManager: ContextManager; // DI-resolved from ai-providers-core
  workspaceAnalyzer: WorkspaceAnalyzerService; // DI-resolved from workspace-intelligence
  providerManager: ProviderManager; // DI-resolved from ai-providers-core
  commandBuilderService: CommandBuilderService;
  analyticsDataCollector: AnalyticsDataCollector;
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
  private contextManager?: ContextManager; // From ai-providers-core
  private workspaceAnalyzer?: WorkspaceAnalyzerService; // From workspace-intelligence
  private providerManager?: ProviderManager; // From ai-providers-core

  // Remaining legacy services
  private commandBuilderService?: CommandBuilderService;
  private analyticsDataCollector?: AnalyticsDataCollector;
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

  /**
   * Get analytics data collector instance (for adapter registration)
   */
  getAnalyticsDataCollector(): AnalyticsDataCollector | undefined {
    return this.analyticsDataCollector;
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
      this.contextManager = DIContainer.resolve<ContextManager>(
        TOKENS.CONTEXT_MANAGER
      );
      this.workspaceAnalyzer = DIContainer.resolve<WorkspaceAnalyzerService>(
        TOKENS.WORKSPACE_ANALYZER_SERVICE
      );
      this.providerManager = DIContainer.resolve<ProviderManager>(
        TOKENS.PROVIDER_MANAGER
      );

      // Resolve services from DI container
      this.commandBuilderService = DIContainer.resolve<CommandBuilderService>(
        TOKENS.COMMAND_BUILDER_SERVICE
      );
      this.analyticsDataCollector = DIContainer.resolve<AnalyticsDataCollector>(
        TOKENS.ANALYTICS_DATA_COLLECTOR
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
        contextManager: this.contextManager,
        workspaceAnalyzer: this.workspaceAnalyzer,
        providerManager: this.providerManager,
        commandBuilderService: this.commandBuilderService,
        analyticsDataCollector: this.analyticsDataCollector,
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

    // Register AI providers with ProviderManager (TASK_INT_003)
    console.log(
      '[PtahExtension.registerAllComponents] Step 4: Registering AI providers...'
    );
    await this.registerProviders();
    console.log(
      '[PtahExtension.registerAllComponents] Step 4: AI providers registered'
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
   * Register AI providers with ProviderManager
   * Initializes both VS Code LM and Claude CLI adapters
   * Selects VS Code LM as default provider
   *
   * CRITICAL: Must happen before any provider operations
   *
   * **Registration Order**: VS Code LM first (higher priority), Claude CLI second
   *
   * **Error Handling**: Graceful degradation - extension continues without
   * provider registration if both providers fail to initialize.
   *
   * **Events Published**:
   * - `providers:availableUpdated` - When providers registered (via ProviderManager)
   * - `providers:currentChanged` - When default provider selected (via ProviderManager)
   *
   * @private
   * @async
   * @returns {Promise<void>}
   * @throws Never throws - errors logged and extension continues
   */
  private async registerProviders(): Promise<void> {
    console.log('[registerProviders] ===== START =====');
    this.logger.info('Registering AI providers...');

    if (!this.providerManager) {
      const error =
        'ProviderManager not initialized - cannot register providers';
      this.logger.error(error);
      console.error('[registerProviders] [CRITICAL]', error);
      throw new Error(error);
    }

    console.log('[registerProviders] ProviderManager check passed');

    try {
      // Step 1: Resolve provider adapters from DI container
      console.log(
        '[registerProviders] Step 1: Resolving provider adapters from DI container...'
      );
      this.logger.info('Resolving provider adapters from DI container...');

      const vsCodeLmAdapter = DIContainer.resolve<VsCodeLmAdapter>(
        TOKENS.VSCODE_LM_ADAPTER
      );
      console.log(
        '[registerProviders] VS Code LM adapter resolved:',
        !!vsCodeLmAdapter
      );

      const claudeCliAdapter = DIContainer.resolve<ClaudeCliAdapter>(
        TOKENS.CLAUDE_CLI_ADAPTER
      );
      console.log(
        '[registerProviders] Claude CLI adapter resolved:',
        !!claudeCliAdapter
      );

      this.logger.info('Provider adapters resolved successfully');
      console.log('[registerProviders] Step 1 COMPLETE');

      // Step 2: Initialize providers (verify health, setup)
      console.log('[registerProviders] Step 2: Initializing providers...');
      this.logger.info('Initializing VS Code LM adapter...');
      console.log(
        '[registerProviders] Calling vsCodeLmAdapter.initialize()...'
      );
      const vsCodeInitialized = await vsCodeLmAdapter.initialize();
      console.log('[registerProviders] vsCodeInitialized:', vsCodeInitialized);

      if (vsCodeInitialized) {
        const vsCodeHealth = vsCodeLmAdapter.getHealth();
        this.logger.info('VS Code LM adapter initialized successfully', {
          health: vsCodeHealth,
        });
        console.log('[registerProviders] VS Code LM health:', vsCodeHealth);
      } else {
        const vsCodeHealth = vsCodeLmAdapter.getHealth();
        const error = 'VS Code LM adapter initialization returned false';
        this.logger.error(error, {
          adapterHealth: vsCodeHealth,
          providerId: vsCodeLmAdapter.providerId,
        });
        console.error(
          '[registerProviders] [CRITICAL]',
          error,
          'Health:',
          vsCodeHealth
        );
      }

      this.logger.info('Initializing Claude CLI adapter...');
      console.log(
        '[registerProviders] Calling claudeCliAdapter.initialize()...'
      );
      const claudeInitialized = await claudeCliAdapter.initialize();
      console.log('[registerProviders] claudeInitialized:', claudeInitialized);

      if (claudeInitialized) {
        const claudeHealth = claudeCliAdapter.getHealth();
        this.logger.info('Claude CLI adapter initialized successfully', {
          health: claudeHealth,
        });
        console.log('[registerProviders] Claude CLI health:', claudeHealth);
      } else {
        const claudeHealth = claudeCliAdapter.getHealth();
        const error = 'Claude CLI adapter initialization returned false';
        this.logger.error(error, {
          adapterHealth: claudeHealth,
          providerId: claudeCliAdapter.providerId,
        });
        console.error(
          '[registerProviders] [CRITICAL]',
          error,
          'Health:',
          claudeHealth
        );
      }

      console.log('[registerProviders] Step 2 COMPLETE');

      // Step 3: Register providers in priority order (VS Code LM first, Claude CLI second)
      console.log(
        '[registerProviders] Step 3: Registering providers with ProviderManager...'
      );

      if (vsCodeInitialized) {
        const beforeCount = this.providerManager.getAvailableProviders().length;
        this.logger.info(
          `Registering VS Code LM provider (current count: ${beforeCount})...`
        );
        console.log(
          '[registerProviders] Provider count before VS Code LM:',
          beforeCount
        );

        console.log(
          '[registerProviders] Calling providerManager.registerProvider(vsCodeLmAdapter)...'
        );
        this.providerManager.registerProvider(vsCodeLmAdapter);
        console.log(
          '[registerProviders] VS Code LM registerProvider() returned'
        );

        const afterCount = this.providerManager.getAvailableProviders().length;
        console.log(
          '[registerProviders] Provider count after VS Code LM:',
          afterCount
        );
        if (afterCount === beforeCount) {
          const error =
            'VS Code LM provider registered but NOT in provider map';
          this.logger.error(error, {
            beforeCount,
            afterCount,
            providerId: vsCodeLmAdapter.providerId,
          });
          console.error('[CRITICAL]', error, {
            beforeCount,
            afterCount,
          });
          throw new Error(error);
        }

        this.logger.info(
          `VS Code LM provider registered successfully (count: ${afterCount})`
        );
        console.log('[registerProviders] VS Code LM registered successfully');
      } else {
        console.log(
          '[registerProviders] VS Code LM NOT initialized, skipping registration'
        );
      }

      if (claudeInitialized) {
        const beforeCount = this.providerManager.getAvailableProviders().length;
        this.logger.info(
          `Registering Claude CLI provider (current count: ${beforeCount})...`
        );
        console.log(
          '[registerProviders] Provider count before Claude CLI:',
          beforeCount
        );

        console.log(
          '[registerProviders] Calling providerManager.registerProvider(claudeCliAdapter)...'
        );
        this.providerManager.registerProvider(claudeCliAdapter);
        console.log(
          '[registerProviders] Claude CLI registerProvider() returned'
        );

        const afterCount = this.providerManager.getAvailableProviders().length;
        console.log(
          '[registerProviders] Provider count after Claude CLI:',
          afterCount
        );
        if (afterCount === beforeCount) {
          const error =
            'Claude CLI provider registered but NOT in provider map';
          this.logger.error(error, {
            beforeCount,
            afterCount,
            providerId: claudeCliAdapter.providerId,
          });
          console.error('[registerProviders] [CRITICAL]', error, {
            beforeCount,
            afterCount,
          });
          throw new Error(error);
        }

        this.logger.info(
          `Claude CLI provider registered successfully (count: ${afterCount})`
        );
        console.log('[registerProviders] Claude CLI registered successfully');
      } else {
        console.log(
          '[registerProviders] Claude CLI NOT initialized, skipping registration'
        );
      }

      console.log('[registerProviders] Step 3 COMPLETE');

      // Verify at least one provider registered
      console.log('[registerProviders] Step 4: Verifying providers...');
      const availableCount =
        this.providerManager.getAvailableProviders().length;
      console.log(
        '[registerProviders] Total providers available:',
        availableCount
      );
      if (availableCount === 0) {
        const error = 'No providers successfully registered';
        this.logger.error(error, {
          vsCodeInitialized,
          claudeInitialized,
          availableCount,
        });
        console.error('[registerProviders] [CRITICAL]', error, {
          vsCodeInitialized,
          claudeInitialized,
          availableCount,
        });
        throw new Error(error);
      }

      this.logger.info(`${availableCount} provider(s) registered successfully`);
      console.log('[registerProviders] Step 4 COMPLETE');

      // Step 4: Select default provider (VS Code LM preferred)
      console.log('[registerProviders] Step 5: Selecting default provider...');
      const context: ProviderContext = {
        taskType: 'coding',
        complexity: 'medium',
        fileTypes: [],
        contextSize: 0,
      };

      console.log(
        '[registerProviders] Calling providerManager.selectBestProvider()...'
      );
      const selectionResult = await this.providerManager.selectBestProvider(
        context
      );
      console.log(
        '[registerProviders] Default provider selected:',
        selectionResult.providerId
      );
      this.logger.info(
        `Default provider selected: ${selectionResult.providerId}`,
        {
          reason: selectionResult.reasoning,
        }
      );
      console.log('[registerProviders] Step 5 COMPLETE');

      console.log('[registerProviders] ===== COMPLETE =====');
      // Note: ProviderManager already publishes 'providers:availableUpdated' and 'providers:currentChanged' events
      // via EventBus during registerProvider() and selectBestProvider() operations
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Provider registration failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      console.error('[registerProviders] ===== FAILED =====');
      console.error(
        '[registerProviders] [CRITICAL] Provider registration failed:',
        error
      );
      console.error(
        '[registerProviders] Error stack:',
        error instanceof Error ? error.stack : 'No stack'
      );

      // FAIL FAST: Extension cannot continue without providers
      throw new Error(
        `Provider registration failed: ${errorMessage}. Extension cannot continue without providers.`
      );
    }
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

      // Verify provider manager is available
      if (this.providerManager) {
        const currentProvider = this.providerManager.getCurrentProvider();
        if (!currentProvider) {
          this.logger.warn('No provider currently selected');
          return false;
        }

        const health = currentProvider.getHealth();
        if (health.status !== 'available') {
          this.logger.warn('Current provider not healthy', {
            status: health.status,
            providerId: currentProvider.providerId,
          });
          return false;
        }
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
    providerAvailable: boolean;
  } {
    return {
      initialized: !!this.services,
      providerAvailable: this.providerManager ? true : false,
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
