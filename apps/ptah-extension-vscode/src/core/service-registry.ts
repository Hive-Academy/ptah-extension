import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { ClaudeCliService } from '../services/claude-cli.service';
import { SessionManager } from '../services/session-manager';
import { ContextManager } from '../services/context-manager';
import { WorkspaceManager } from '../services/workspace-manager';
import { CommandBuilderService } from '../services/command-builder.service';
import { AnalyticsDataCollector } from '../services/analytics-data-collector';
import { AngularWebviewProvider } from '../providers/angular-webview.provider';
import { PtahConfigService } from '../config/ptah-config.service';
import {
  ProviderFactory,
  ProviderManager,
  ProviderFactoryConfig,
  ProviderManagerConfig,
} from '../services/ai-providers';

export interface ServiceDependencies {
  context: vscode.ExtensionContext;
  configService: PtahConfigService;
  claudeCliService: ClaudeCliService;
  sessionManager: SessionManager;
  contextManager: ContextManager;
  workspaceManager: WorkspaceManager;
  commandBuilderService: CommandBuilderService;
  analyticsDataCollector: AnalyticsDataCollector;
  angularWebviewProvider: AngularWebviewProvider;
  providerFactory: ProviderFactory;
  providerManager: ProviderManager;
}

/**
 * Service Registry - Manages service initialization and dependency injection
 */
export class ServiceRegistry implements vscode.Disposable {
  private services: Partial<ServiceDependencies> = {};
  private isInitialized = false;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Initialize all core services
   */
  async initialize(): Promise<ServiceDependencies> {
    if (this.isInitialized) {
      return this.services as ServiceDependencies;
    }

    Logger.info('Initializing core services...');

    try {
      // Initialize configuration service first (required by other services)
      this.services.configService = PtahConfigService.getInstance();

      // Initialize core services in dependency order
      this.services.claudeCliService = new ClaudeCliService();
      this.services.sessionManager = new SessionManager(this.context);
      this.services.contextManager = new ContextManager();
      this.services.workspaceManager = new WorkspaceManager();
      this.services.commandBuilderService = new CommandBuilderService(this.context);

      // Initialize analytics data collector with dependencies
      this.services.analyticsDataCollector = new AnalyticsDataCollector(
        this.context,
        this.services.sessionManager,
        this.services.commandBuilderService,
        this.services.claudeCliService,
        this.services.contextManager
      );

      // Verify Claude CLI availability
      const isClaudeAvailable = await this.services.claudeCliService.verifyInstallation();
      if (!isClaudeAvailable) {
        throw new Error('Claude Code CLI not available');
      }

      // Initialize provider factory and manager
      const providerFactoryConfig: ProviderFactoryConfig = {
        claudeCli: {
          service: this.services.claudeCliService,
        },
        vscodeLm: {
          preferredFamily: 'gpt-4',
          fallbackModels: ['gpt-4', 'gpt-3.5-turbo'],
          modelSelectionStrategy: 'first-available',
        },
      };

      this.services.providerFactory = new ProviderFactory(providerFactoryConfig);

      const providerManagerConfig: ProviderManagerConfig = {
        defaultProvider: 'claude-cli',
        fallbackEnabled: true,
        autoSwitchOnFailure: true,
        healthCheckIntervalMs: 30000,
        maxRetryAttempts: 3,
        retryDelayMs: 1000,
      };

      this.services.providerManager = new ProviderManager(
        this.services.providerFactory,
        this.services.configService,
        providerManagerConfig
      );

      // Initialize provider manager
      await this.services.providerManager.initialize();

      // Initialize UI provider with dependencies (now including provider manager)
      this.services.angularWebviewProvider = new AngularWebviewProvider(
        this.context,
        this.services.sessionManager,
        this.services.claudeCliService,
        this.services.contextManager,
        this.services.commandBuilderService,
        this.services.analyticsDataCollector,
        this.services.providerManager
      );

      this.isInitialized = true;
      Logger.info('Core services initialized successfully');

      // Include context in the returned dependencies
      const dependencies: ServiceDependencies = {
        context: this.context,
        ...(this.services as Required<Omit<ServiceDependencies, 'context'>>),
      };

      return dependencies;
    } catch (error) {
      Logger.error('Failed to initialize services', error);
      throw error;
    }
  }

  /**
   * Get service instance
   */
  getService<K extends keyof ServiceDependencies>(
    serviceName: K
  ): ServiceDependencies[K] | undefined {
    return this.services[serviceName];
  }

  /**
   * Get all services (throws if not initialized)
   */
  getAllServices(): ServiceDependencies {
    if (!this.isInitialized) {
      throw new Error('Services not initialized. Call initialize() first.');
    }
    return this.services as ServiceDependencies;
  }

  /**
   * Check if services are initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Dispose all services
   */
  dispose(): void {
    Logger.info('Disposing services...');

    // Dispose services in reverse order
    this.services.angularWebviewProvider?.dispose?.();
    this.services.providerManager?.dispose();
    this.services.providerFactory?.dispose();
    this.services.analyticsDataCollector?.dispose();
    this.services.commandBuilderService?.dispose();
    this.services.workspaceManager?.dispose();
    this.services.contextManager?.dispose();
    this.services.sessionManager?.dispose();
    this.services.claudeCliService?.dispose();
    this.services.configService?.dispose();

    this.services = {};
    this.isInitialized = false;

    Logger.info('Services disposed');
  }
}
