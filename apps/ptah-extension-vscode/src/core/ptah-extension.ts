import * as vscode from 'vscode';
import { Logger } from './logger';
import { ServiceRegistry, ServiceDependencies } from './service-registry';
import { CommandHandlers } from '../handlers/command-handlers';
import { CommandRegistry } from '../registries/command-registry';
import { WebviewRegistry } from '../registries/webview-registry';
import { EventRegistry } from '../registries/event-registry';
import { ErrorHandler } from '../handlers/error-handler';

/**
 * Main extension class for Ptah - Lightweight coordinator using registry pattern
 */
export class PtahExtension implements vscode.Disposable {
  private static _instance: PtahExtension;
  private disposables: vscode.Disposable[] = [];

  // Registry components
  private serviceRegistry?: ServiceRegistry;
  private commandRegistry?: CommandRegistry;
  private webviewRegistry?: WebviewRegistry;
  private eventRegistry?: EventRegistry;

  // Handlers
  private commandHandlers?: CommandHandlers;

  // Services reference
  private services?: ServiceDependencies;

  constructor(private context: vscode.ExtensionContext) {
    PtahExtension._instance = this;
    Logger.initialize();
  }

  static get instance(): PtahExtension {
    return PtahExtension._instance;
  }

  /**
   * Initialize the extension
   */
  async initialize(): Promise<void> {
    const errorHandler = ErrorHandler.withContext('Extension initialization');

    try {
      Logger.info('Initializing Ptah extension...');

      // Initialize services through registry
      await this.initializeServices();

      // Initialize handlers and registries
      this.initializeComponents();

      Logger.info('Ptah extension initialized successfully');
    } catch (error) {
      errorHandler.handleExtension(error);
      throw error;
    }
  }

  /**
   * Register all components - called after initialization
   */
  async registerAll(): Promise<void> {
    const errorHandler = ErrorHandler.withContext('Component registration');

    try {
      Logger.info('Registering extension components...');

      // Register everything
      this.registerAllComponents();

      Logger.info('Extension components registered successfully');
    } catch (error) {
      errorHandler.handleExtension(error);
      throw error;
    }
  }

  /**
   * Initialize all services through ServiceRegistry
   */
  private async initializeServices(): Promise<void> {
    this.serviceRegistry = new ServiceRegistry(this.context);
    this.services = await this.serviceRegistry.initialize();

    this.disposables.push(this.serviceRegistry);
  }

  /**
   * Initialize handlers and registries
   */
  private initializeComponents(): void {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    // Initialize handlers
    this.commandHandlers = new CommandHandlers(this.services);

    // Initialize registries
    this.commandRegistry = new CommandRegistry(this.commandHandlers);
    this.webviewRegistry = new WebviewRegistry(this.services);
    this.eventRegistry = new EventRegistry(this.services);

    // Track for disposal
    this.disposables.push(this.commandRegistry, this.webviewRegistry, this.eventRegistry);
  }

  /**
   * Register all components
   */
  private registerAllComponents(): void {
    if (!this.commandRegistry || !this.webviewRegistry || !this.eventRegistry) {
      throw new Error('Registries not initialized');
    }

    // Register commands
    this.commandRegistry.registerAll();

    // Register webview providers
    this.webviewRegistry.registerAll();

    // Set up event handlers
    this.eventRegistry.registerAll();

    Logger.info('All components registered successfully');
  }

  /**
   * Welcome message for first-time users
   */
  async showWelcome(): Promise<void> {
    const message = 'Welcome to Ptah! Ready to transform your Claude Code experience?';
    const actions = ['Get Started', 'Documentation'];

    const selection = await vscode.window.showInformationMessage(message, ...actions);

    if (selection === 'Get Started') {
      // Open chat sidebar and show quick tour
      await vscode.commands.executeCommand('ptah.chatSidebar.focus');
    } else if (selection === 'Documentation') {
      vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/your-org/ptah-claude-code#readme')
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
   */
  getWebviewRegistry(): WebviewRegistry | undefined {
    return this.webviewRegistry;
  }

  /**
   * Get command registry for external access
   */
  getCommandRegistry(): CommandRegistry | undefined {
    return this.commandRegistry;
  }

  /**
   * Health check - verify all components are operational
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.services || !this.commandRegistry || !this.webviewRegistry || !this.eventRegistry) {
        Logger.warn('Extension components not fully initialized');
        return false;
      }

      // Verify Claude CLI is available
      if (this.services.claudeCliService) {
        const isAvailable = await this.services.claudeCliService.verifyInstallation();
        if (!isAvailable) {
          Logger.warn('Claude CLI not available');
          return false;
        }
      }

      Logger.info('Extension health check passed');
      return true;
    } catch (error) {
      ErrorHandler.handleExtensionError(error, 'Health check');
      return false;
    }
  }

  /**
   * Get extension status information
   */
  getStatus(): {
    initialized: boolean;
    claudeCliAvailable: boolean;
    registeredCommands: string[];
    registeredWebviews: string[];
  } {
    return {
      initialized: !!this.services,
      claudeCliAvailable: this.services?.claudeCliService ? true : false,
      registeredCommands: this.commandRegistry?.getRegisteredCommands() || [],
      registeredWebviews: this.webviewRegistry?.getRegisteredWebviews() || [],
    };
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    Logger.info('Disposing Ptah extension...');

    try {
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];

      Logger.dispose();
      Logger.info('Ptah extension disposed successfully');
    } catch (error) {
      ErrorHandler.handleExtensionError(error, 'Extension disposal');
    }
  }
}
