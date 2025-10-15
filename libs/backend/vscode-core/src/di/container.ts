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
      useValue: context,
    });

    // Register event bus as singleton
    // Import EventBus dynamically to avoid circular dependencies
    const { EventBus } = require('../messaging/event-bus');
    container.registerSingleton(TOKENS.EVENT_BUS, EventBus);

    // Register API wrappers as singletons
    const { CommandManager } = require('../api-wrappers/command-manager');
    const { WebviewManager } = require('../api-wrappers/webview-manager');
    const { OutputManager } = require('../api-wrappers/output-manager');
    const { StatusBarManager } = require('../api-wrappers/status-bar-manager');
    const {
      FileSystemManager,
    } = require('../api-wrappers/file-system-manager');
    container.registerSingleton(TOKENS.COMMAND_REGISTRY, CommandManager);
    container.registerSingleton(TOKENS.WEBVIEW_PROVIDER, WebviewManager);
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
    container.registerSingleton(TOKENS.STATUS_BAR_MANAGER, StatusBarManager);
    container.registerSingleton(TOKENS.FILE_SYSTEM_MANAGER, FileSystemManager);

    // Register core infrastructure services (TASK_CORE_001)
    // Logger, ErrorHandler, ConfigManager, MessageValidator
    const { Logger } = require('../logging/logger');
    const { ErrorHandler } = require('../error-handling/error-handler');
    const { ConfigManager } = require('../config/config-manager');
    const {
      MessageValidatorService,
    } = require('../validation/message-validator.service');
    container.registerSingleton(TOKENS.LOGGER, Logger);
    container.registerSingleton(TOKENS.ERROR_HANDLER, ErrorHandler);
    container.registerSingleton(TOKENS.CONFIG_MANAGER, ConfigManager);
    container.registerSingleton(
      TOKENS.MESSAGE_VALIDATOR,
      MessageValidatorService
    );

    // ========================================
    // END OF INFRASTRUCTURE SETUP
    // Domain services registered by main app
    // ========================================
    //
    // NOTE: Domain services (claude-domain, workspace-intelligence, etc.)
    // are NO LONGER registered here to maintain proper layer separation.
    //
    // Per LIBRARY_INTEGRATION_ARCHITECTURE.md:
    // - vscode-core = infrastructure only
    // - Domain libraries = self-contained with bootstrap functions
    // - Main app = orchestrator that calls bootstrap functions
    //
    // See: docs/LIBRARY_INTEGRATION_ARCHITECTURE.md
    // See: task-tracking/TASK_CORE_001/architectural-alignment-strategy.md
    //
    // Domain service registration now handled in:
    // - apps/ptah-extension-vscode/src/main.ts

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
   * Register a singleton service
   * Provides a convenient static method for service registration
   *
   * @param token - The Symbol token for the service
   * @param target - The constructor function or class to register
   */
  static registerSingleton<T>(
    token: symbol,
    target: new (...args: unknown[]) => T
  ): void {
    container.registerSingleton<T>(token, target);
  }

  /**
   * Register a service with a value
   * Provides a convenient static method for value registration
   *
   * @param token - The Symbol token for the service
   * @param value - The value to register
   */
  static registerValue<T>(token: symbol, value: T): void {
    container.register<T>(token, { useValue: value });
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
