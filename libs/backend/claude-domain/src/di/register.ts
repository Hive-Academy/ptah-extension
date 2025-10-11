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
  EVENT_BUS,
  CONTEXT_ORCHESTRATION_SERVICE,
} from '../index';

/**
 * Token registry interface for claude-domain services
 * Passed by main app to avoid circular dependencies
 */
export interface ClaudeDomainTokens {
  CLAUDE_CLI_DETECTOR: symbol;
  CLAUDE_SESSION_MANAGER: symbol;
  CLAUDE_PROCESS_MANAGER: symbol;
  CLAUDE_DOMAIN_EVENT_PUBLISHER: symbol;
  CLAUDE_PERMISSION_SERVICE: symbol;
  PERMISSION_RULES_STORE: symbol;

  // Phase 1: Orchestration Services
  CHAT_ORCHESTRATION_SERVICE: symbol;
  PROVIDER_ORCHESTRATION_SERVICE: symbol;
  ANALYTICS_ORCHESTRATION_SERVICE: symbol;
  CONFIG_ORCHESTRATION_SERVICE: symbol;

  // Phase 2: MessageHandlerService
  MESSAGE_HANDLER_SERVICE: symbol;
}

/**
 * EventBus interface for adapter creation
 * Avoids importing from vscode-core
 */
export interface IEventBus {
  publish<T>(topic: string, payload: T): void;
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
 *
 * @example
 * ```typescript
 * // In main app activation (apps/ptah-extension-vscode/src/main.ts)
 * import { TOKENS, DIContainer } from '@ptah-extension/vscode-core';
 *
 * const container = DIContainer.setup(context);
 * const eventBus = container.resolve(TOKENS.EVENT_BUS);
 * registerClaudeDomainServices(container, TOKENS, eventBus);
 * ```
 */
export function registerClaudeDomainServices(
  container: DependencyContainer,
  tokens: ClaudeDomainTokens,
  eventBus: IEventBus,
  contextOrchestration: unknown // IContextOrchestrationService from workspace-intelligence
): void {
  // Register permission rules store (infrastructure dependency)
  container.register(tokens.PERMISSION_RULES_STORE, {
    useValue: new InMemoryPermissionRulesStore(),
  });

  // Register event bus adapter (converts vscode-core EventBus to claude-domain IEventBus)
  container.register(EVENT_BUS, {
    useValue: {
      publish: <T>(topic: string, payload: T) => {
        eventBus.publish(topic, payload);
      },
    },
  });

  // Register context orchestration service (from workspace-intelligence)
  container.register(CONTEXT_ORCHESTRATION_SERVICE, {
    useValue: contextOrchestration,
  });

  // Register core Claude domain services as singletons
  container.registerSingleton(tokens.CLAUDE_CLI_DETECTOR, ClaudeCliDetector);
  container.registerSingleton(tokens.CLAUDE_SESSION_MANAGER, SessionManager);
  container.registerSingleton(tokens.CLAUDE_PROCESS_MANAGER, ProcessManager);
  container.registerSingleton(
    tokens.CLAUDE_DOMAIN_EVENT_PUBLISHER,
    ClaudeDomainEventPublisher
  );
  container.registerSingleton(
    tokens.CLAUDE_PERMISSION_SERVICE,
    PermissionService
  );

  // ========================================
  // Phase 1: Register Orchestration Services
  // ========================================
  // Business logic layer - delegates to domain services
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
