/**
 * Claude Domain Services Registration
 *
 * Bootstrap function for registering all claude-domain services
 * in the DI container. Called by main application during activation.
 *
 * Follows LIBRARY_INTEGRATION_ARCHITECTURE.md pattern:
 * - Domain libraries export bootstrap functions
 * - Main app orchestrates service registration
 * - vscode-core remains pure infrastructure
 *
 * NOTE: This function receives TOKENS and EventBus from the caller to avoid
 * circular dependency between claude-domain and vscode-core.
 */

import { DependencyContainer } from 'tsyringe';
import {
  ClaudeCliDetector,
  ClaudeCliService,
  SessionManager,
  PermissionService,
  ProcessManager,
  ClaudeDomainEventPublisher,
  InMemoryPermissionRulesStore,
  // Phase 1: Orchestration Services
  ChatOrchestrationService,
  ProviderOrchestrationService,
  AnalyticsOrchestrationService,
  ConfigOrchestrationService,
  // Phase 2: MessageHandlerService
  MessageHandlerService,
} from '../index';

/**
 * Token registry interface for claude-domain services
 * Passed by main app to avoid circular dependencies
 *
 * Pattern source: workspace-intelligence/src/di/register.ts:15-30 (WorkspaceIntelligenceTokens)
 * Verified: Interface defines all external tokens required for registration
 *
 * NOTE: Main app maps vscode-core infrastructure tokens to these tokens during registration.
 */
export interface ClaudeDomainTokens {
  // Infrastructure dependencies (from vscode-core)
  EVENT_BUS: symbol;
  STORAGE_SERVICE: symbol;
  CONTEXT_ORCHESTRATION_SERVICE: symbol;

  // Core domain service tokens
  SESSION_MANAGER: symbol;
  CLAUDE_CLI_DETECTOR: symbol;
  CLAUDE_CLI_SERVICE: symbol;
  // Note: CLAUDE_CLI_LAUNCHER removed - not registered (requires runtime params, created on-demand)
  PERMISSION_SERVICE: symbol;
  PROCESS_MANAGER: symbol;
  EVENT_PUBLISHER: symbol;

  // Orchestration service tokens (exposed to main app)
  CHAT_ORCHESTRATION_SERVICE: symbol;
  PROVIDER_ORCHESTRATION_SERVICE: symbol;
  ANALYTICS_ORCHESTRATION_SERVICE: symbol;
  CONFIG_ORCHESTRATION_SERVICE: symbol;
  MESSAGE_HANDLER_SERVICE: symbol;

  // Service-specific tokens
  CONTEXT_SERVICE: symbol;
  PROVIDER_MANAGER: symbol;
  CONFIGURATION_PROVIDER: symbol;
  ANALYTICS_DATA_COLLECTOR: symbol;
}

/**
 * EventBus interface for adapter creation
 * Avoids importing from vscode-core
 */
export interface IEventBus {
  publish<T>(topic: string, payload: T): void;
}

/**
 * Storage service interface - must be provided by main app
 * Matches IStorageService from SessionManager
 */
export interface IStorageService {
  get<T>(key: string, defaultValue?: T): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
}

/**
 * Register all claude-domain services in the DI container
 *
 * This function encapsulates the registration logic for all services
 * in the claude-domain library, including:
 * - Claude CLI detection and launching
 * - Session management
 * - Permission handling
 * - Process management
 * - Event publishing
 *
 * @param container - The TSyringe DependencyContainer instance
 * @param tokens - Token registry from vscode-core (avoids circular dependency)
 * @param eventBus - EventBus instance for adapter (avoids circular dependency)
 * @param storage - Storage service for session persistence (from main app's ExtensionContext)
 * @param contextOrchestration - Context orchestration service from workspace-intelligence
 *
 * @example
 * ```typescript
 * // In main app activation (apps/ptah-extension-vscode/src/main.ts)
 * import { TOKENS, DIContainer } from '@ptah-extension/vscode-core';
 *
 * const container = DIContainer.setup(context);
 * const eventBus = container.resolve(TOKENS.EVENT_BUS);
 *
 * // Create storage adapter from VS Code ExtensionContext
 * const storage: IStorageService = {
 *   get: <T>(key: string, defaultValue?: T) =>
 *     context.workspaceState.get<T>(key, defaultValue),
 *   set: <T>(key: string, value: T) =>
 *     context.workspaceState.update(key, value),
 * };
 *
 * const contextOrchestration = container.resolve(TOKENS.CONTEXT_ORCHESTRATION_SERVICE);
 * registerClaudeDomainServices(container, TOKENS, eventBus, storage, contextOrchestration);
 * ```
 */
export function registerClaudeDomainServices(
  container: DependencyContainer,
  tokens: ClaudeDomainTokens,
  eventBus: IEventBus,
  storage: IStorageService,
  contextOrchestration: unknown // IContextOrchestrationService from workspace-intelligence
): void {
  // Register permission rules store (infrastructure dependency)
  // CRITICAL: Single instance registered under string literal to match @inject('IPermissionRulesStore') in PermissionService
  const permissionStore = new InMemoryPermissionRulesStore();
  container.register('IPermissionRulesStore', {
    useValue: permissionStore,
  });

  // Register event bus adapter (converts vscode-core EventBus to claude-domain IEventBus)
  container.register(tokens.EVENT_BUS, {
    useValue: {
      publish: <T>(topic: string, payload: T) => {
        eventBus.publish(topic, payload);
      },
    },
  });

  // Register storage service (from main app's ExtensionContext)
  container.register(tokens.STORAGE_SERVICE, {
    useValue: storage,
  });

  // Register context orchestration service (from workspace-intelligence)
  container.register(tokens.CONTEXT_ORCHESTRATION_SERVICE, {
    useValue: contextOrchestration,
  });

  // ========================================
  // Core Domain Services Registration
  // ========================================
  // All core services registered under tokens provided by main app
  // Main app maps vscode-core infrastructure tokens to these domain tokens

  container.registerSingleton(tokens.CLAUDE_CLI_DETECTOR, ClaudeCliDetector);
  container.registerSingleton(tokens.SESSION_MANAGER, SessionManager);
  container.registerSingleton(tokens.PROCESS_MANAGER, ProcessManager);
  container.registerSingleton(
    tokens.EVENT_PUBLISHER,
    ClaudeDomainEventPublisher
  );
  container.registerSingleton(tokens.PERMISSION_SERVICE, PermissionService);
  container.registerSingleton(tokens.CLAUDE_CLI_SERVICE, ClaudeCliService);

  // ========================================
  // Phase 1: Register Orchestration Services
  // ========================================
  // Business logic layer - exposed to main app via external tokens
  container.registerSingleton(
    tokens.CHAT_ORCHESTRATION_SERVICE,
    ChatOrchestrationService
  );
  container.registerSingleton(
    tokens.PROVIDER_ORCHESTRATION_SERVICE,
    ProviderOrchestrationService
  );
  container.registerSingleton(
    tokens.ANALYTICS_ORCHESTRATION_SERVICE,
    AnalyticsOrchestrationService
  );
  container.registerSingleton(
    tokens.CONFIG_ORCHESTRATION_SERVICE,
    ConfigOrchestrationService
  );

  // ========================================
  // Phase 2: Register MessageHandlerService
  // ========================================
  // Thin routing layer - delegates to orchestration services
  container.registerSingleton(
    tokens.MESSAGE_HANDLER_SERVICE,
    MessageHandlerService
  );

  // Note: ClaudeCliLauncher is NOT registered here because it requires
  // ClaudeInstallation as a constructor parameter, which is determined at runtime
  // by ClaudeCliDetector. The main app or services that need ClaudeCliLauncher
  // should create instances dynamically after detection.
  //
  // Example usage:
  // const detector = container.resolve(TOKENS.CLAUDE_CLI_DETECTOR);
  // const installation = await detector.detectInstallation();
  // const launcher = new ClaudeCliLauncher(installation, {
  //   sessionManager: container.resolve(TOKENS.CLAUDE_SESSION_MANAGER),
  //   permissionService: container.resolve(TOKENS.CLAUDE_PERMISSION_SERVICE),
  //   processManager: container.resolve(TOKENS.CLAUDE_PROCESS_MANAGER),
  //   eventPublisher: container.resolve(TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER),
  // });
}
