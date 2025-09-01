/**
 * Type-Safe Dependency Injection Container
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 171-208
 * Uses TSyringe with Symbol-based tokens for compile-time type safety
 */

import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS } from './tokens';

/**
 * DIContainer setup utility class
 * Provides centralized configuration of all dependency injection bindings
 */
export class DIContainer {
  /**
   * Setup the DI container with VS Code extension context
   * Registers core services and prepares container for service resolution
   * 
   * @param context - VS Code extension context for lifecycle management
   * @returns Configured DependencyContainer instance
   */
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    // Register VS Code extension context as singleton
    container.register(TOKENS.EXTENSION_CONTEXT, { 
      useValue: context 
    });

    // Register event bus as singleton
    // Import EventBus dynamically to avoid circular dependencies
    const { EventBus } = require('../messaging/event-bus');
    container.registerSingleton(TOKENS.EVENT_BUS, EventBus);

    // Register API wrappers as singletons
    const { CommandManager } = require('../api-wrappers/command-manager');
    const { WebviewManager } = require('../api-wrappers/webview-manager');
    container.registerSingleton(TOKENS.COMMAND_REGISTRY, CommandManager);
    container.registerSingleton(TOKENS.WEBVIEW_PROVIDER, WebviewManager);
    
    // Additional service registrations will be added here as services are implemented
    // This follows a phased approach where services are registered as they become available
    
    return container;
  }

  /**
   * Get the global container instance
   * Provides access to the configured container for service resolution
   * 
   * @returns The global DependencyContainer instance
   */
  static getContainer(): DependencyContainer {
    return container;
  }

  /**
   * Resolve a service by its token
   * Type-safe service resolution using Symbol-based tokens
   * 
   * @param token - The Symbol token for the service to resolve
   * @returns The resolved service instance
   */
  static resolve<T>(token: symbol): T {
    return container.resolve<T>(token);
  }

  /**
   * Check if a service is registered
   * Useful for conditional service resolution and validation
   * 
   * @param token - The Symbol token to check
   * @returns True if the service is registered, false otherwise
   */
  static isRegistered(token: symbol): boolean {
    return container.isRegistered(token);
  }

  /**
   * Clear all registrations
   * Useful for testing and cleanup scenarios
   */
  static clear(): void {
    container.clearInstances();
    // Note: TSyringe doesn't expose a method to clear registrations
    // So we clear instances only, which is sufficient for most testing scenarios
  }
}

// Re-export for convenience
export { TOKENS } from './tokens';
export { container };
export type { DependencyContainer };