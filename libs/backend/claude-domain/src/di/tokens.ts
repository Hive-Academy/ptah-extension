/**
 * Claude Domain DI Token Symbols
 *
 * Centralized token definitions for all claude-domain services.
 * This file is the single source of truth for DI tokens in the claude-domain library.
 *
 * Pattern source: libs/backend/workspace-intelligence/src/di/tokens.ts
 * Verified: Symbol.for() with descriptive string keys
 *
 * Token Ownership:
 * - claude-domain library owns ALL tokens defined here
 * - vscode-core should NOT define any of these tokens (library boundary violation)
 * - Main app maps vscode-core infrastructure tokens to these tokens during registration
 *
 * Usage:
 * ```typescript
 * import { SESSION_MANAGER } from '@ptah-extension/claude-domain';
 *
 * @injectable()
 * export class MyService {
 *   constructor(@inject(SESSION_MANAGER) private readonly sessionManager: SessionManager) {}
 * }
 * ```
 */

/**
 * Infrastructure tokens (used across multiple services)
 */

/** Event bus for domain event publishing */
export const EVENT_BUS = Symbol.for('EventBus');

/** Storage service for session persistence */
export const STORAGE_SERVICE = Symbol.for('StorageService');

/** Context orchestration service from workspace-intelligence */
export const CONTEXT_ORCHESTRATION_SERVICE = Symbol.for(
  'ContextOrchestrationService'
);

/**
 * Core domain service tokens (internal services)
 */

/** Session management service */
export const SESSION_MANAGER = Symbol.for('SessionManager');

/** Claude CLI installation detector */
export const CLAUDE_CLI_DETECTOR = Symbol.for('ClaudeCliDetector');

/** Claude CLI high-level service facade */
export const CLAUDE_CLI_SERVICE = Symbol.for('ClaudeCliService');

/** Claude CLI launcher (not registered - created dynamically) */
export const CLAUDE_CLI_LAUNCHER = Symbol.for('ClaudeCliLauncher');

/** Permission service for Claude tool execution */
export const PERMISSION_SERVICE = Symbol.for('PermissionService');

/** Process manager for Claude CLI process lifecycle */
export const PROCESS_MANAGER = Symbol.for('ProcessManager');

/** Domain event publisher for Claude events */
export const EVENT_PUBLISHER = Symbol.for('ClaudeDomainEventPublisher');

/**
 * Orchestration service tokens (exposed to main app)
 */

/** Chat workflow orchestration service */
export const CHAT_ORCHESTRATION_SERVICE = Symbol.for(
  'ChatOrchestrationService'
);

/** AI provider orchestration service */
export const PROVIDER_ORCHESTRATION_SERVICE = Symbol.for(
  'ProviderOrchestrationService'
);

/** Analytics orchestration service */
export const ANALYTICS_ORCHESTRATION_SERVICE = Symbol.for(
  'AnalyticsOrchestrationService'
);

/** Configuration orchestration service */
export const CONFIG_ORCHESTRATION_SERVICE = Symbol.for(
  'ConfigOrchestrationService'
);

/** Message handler service (main webview message router) */
export const MESSAGE_HANDLER_SERVICE = Symbol.for('MessageHandlerService');

/**
 * Service-specific tokens (used by orchestration services)
 */

/** Context service from workspace-intelligence */
export const CONTEXT_SERVICE = Symbol.for('ContextService');

/** Provider manager for AI provider management */
export const PROVIDER_MANAGER = Symbol.for('ProviderManager');

/** Configuration provider for extension settings */
export const CONFIGURATION_PROVIDER = Symbol.for('ConfigurationProvider');

/** Analytics data collector for usage metrics */
export const ANALYTICS_DATA_COLLECTOR = Symbol.for('AnalyticsDataCollector');
