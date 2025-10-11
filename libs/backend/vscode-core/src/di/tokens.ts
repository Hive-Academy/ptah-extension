/**
 * DI Token Symbols - Type-safe dependency injection tokens
 * Eliminates string-based tokens to prevent typos and improve type safety
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 176-194
 *
 * Note: Uses Symbol.for() instead of Symbol() to create global symbols that can be
 * shared across module boundaries. This allows workspace-intelligence and other
 * libraries to use local token definitions without circular dependencies.
 */

// VS Code API tokens
export const EXTENSION_CONTEXT = Symbol.for('ExtensionContext');
export const WEBVIEW_PROVIDER = Symbol.for('WebviewProvider');
export const COMMAND_REGISTRY = Symbol.for('CommandRegistry');

// Messaging system tokens
export const EVENT_BUS = Symbol.for('EventBus');
export const MESSAGE_ROUTER = Symbol.for('MessageRouter');

// Provider system tokens
export const AI_PROVIDER_FACTORY = Symbol.for('AIProviderFactory');
export const AI_PROVIDER_MANAGER = Symbol.for('AIProviderManager');
export const PROVIDER_STRATEGY = Symbol.for('ProviderStrategy');

// API wrapper service tokens
export const OUTPUT_MANAGER = Symbol.for('OutputManager');
export const STATUS_BAR_MANAGER = Symbol.for('StatusBarManager');
export const FILE_SYSTEM_MANAGER = Symbol.for('FileSystemManager');

// Core infrastructure service tokens (TASK_CORE_001)
export const LOGGER = Symbol.for('Logger');
export const ERROR_HANDLER = Symbol.for('ErrorHandler');
export const CONFIG_MANAGER = Symbol.for('ConfigManager');
export const MESSAGE_VALIDATOR = Symbol.for('MessageValidator');
export const CONTEXT_MANAGER = Symbol.for('ContextManager');

// Business logic service tokens
export const CLAUDE_SERVICE = Symbol.for('ClaudeService');
export const SESSION_MANAGER = Symbol.for('SessionManager');
export const WORKSPACE_ANALYZER = Symbol.for('WorkspaceAnalyzer');

// Claude domain service tokens (MONSTER Week 5)
export const CLAUDE_CLI_DETECTOR = Symbol.for('ClaudeCliDetector');
export const CLAUDE_CLI_LAUNCHER = Symbol.for('ClaudeCliLauncher');
export const CLAUDE_SESSION_MANAGER = Symbol.for('ClaudeSessionManager');
export const CLAUDE_PERMISSION_SERVICE = Symbol.for('ClaudePermissionService');
export const CLAUDE_PROCESS_MANAGER = Symbol.for('ClaudeProcessManager');
export const CLAUDE_DOMAIN_EVENT_PUBLISHER = Symbol.for(
  'ClaudeDomainEventPublisher'
);

// Workspace intelligence service tokens (TASK_PRV_005)
export const TOKEN_COUNTER_SERVICE = Symbol.for('TokenCounterService');
export const FILE_SYSTEM_SERVICE = Symbol.for('FileSystemService');
export const CONTEXT_SERVICE = Symbol.for('ContextService');
export const PROJECT_DETECTOR_SERVICE = Symbol.for('ProjectDetectorService');
export const FRAMEWORK_DETECTOR_SERVICE = Symbol.for(
  'FrameworkDetectorService'
);
export const DEPENDENCY_ANALYZER_SERVICE = Symbol.for(
  'DependencyAnalyzerService'
);
export const MONOREPO_DETECTOR_SERVICE = Symbol.for('MonorepoDetectorService');
export const PATTERN_MATCHER_SERVICE = Symbol.for('PatternMatcherService');
export const IGNORE_PATTERN_RESOLVER_SERVICE = Symbol.for(
  'IgnorePatternResolverService'
);
export const FILE_TYPE_CLASSIFIER_SERVICE = Symbol.for(
  'FileTypeClassifierService'
);
export const WORKSPACE_INDEXER_SERVICE = Symbol.for('WorkspaceIndexerService');
export const FILE_INDEXER_SERVICE = Symbol.for('FileIndexerService');
export const WORKSPACE_ANALYZER_SERVICE = Symbol.for(
  'WorkspaceAnalyzerService'
);
export const WORKSPACE_SERVICE = Symbol.for('WorkspaceService');
export const FILE_RELEVANCE_SCORER = Symbol.for('FileRelevanceScorer');
export const CONTEXT_SIZE_OPTIMIZER = Symbol.for('ContextSizeOptimizer');
export const SEMANTIC_CONTEXT_EXTRACTOR = Symbol.for(
  'SemanticContextExtractor'
);

// Claude domain orchestration service tokens (MAIN_APP_CLEANUP Phase 1-2)
export const CHAT_ORCHESTRATION_SERVICE = Symbol.for(
  'ChatOrchestrationService'
);
export const PROVIDER_ORCHESTRATION_SERVICE = Symbol.for(
  'ProviderOrchestrationService'
);
export const ANALYTICS_ORCHESTRATION_SERVICE = Symbol.for(
  'AnalyticsOrchestrationService'
);
export const CONFIG_ORCHESTRATION_SERVICE = Symbol.for(
  'ConfigOrchestrationService'
);
export const CONTEXT_ORCHESTRATION_SERVICE = Symbol.for(
  'ContextOrchestrationService'
);
export const MESSAGE_HANDLER_SERVICE = Symbol.for('MessageHandlerService');

/**
 * TOKENS constant for convenient access to all DI tokens
 * Provides a single source of truth for all dependency injection symbols
 */
export const TOKENS = {
  // VS Code APIs
  EXTENSION_CONTEXT,
  WEBVIEW_PROVIDER,
  COMMAND_REGISTRY,

  // Messaging
  EVENT_BUS,
  MESSAGE_ROUTER,

  // API Wrappers
  OUTPUT_MANAGER,
  STATUS_BAR_MANAGER,
  FILE_SYSTEM_MANAGER,

  // Core Infrastructure (TASK_CORE_001)
  LOGGER,
  ERROR_HANDLER,
  CONFIG_MANAGER,
  MESSAGE_VALIDATOR,
  CONTEXT_MANAGER,

  // Providers
  AI_PROVIDER_FACTORY,
  AI_PROVIDER_MANAGER,
  PROVIDER_STRATEGY,

  // Business Logic
  CLAUDE_SERVICE,
  SESSION_MANAGER,
  WORKSPACE_ANALYZER,

  // Claude Domain (MONSTER Week 5)
  CLAUDE_CLI_DETECTOR,
  CLAUDE_CLI_LAUNCHER,
  CLAUDE_SESSION_MANAGER,
  CLAUDE_PERMISSION_SERVICE,
  CLAUDE_PROCESS_MANAGER,
  CLAUDE_DOMAIN_EVENT_PUBLISHER,

  // Workspace Intelligence (TASK_PRV_005)
  TOKEN_COUNTER_SERVICE,
  FILE_SYSTEM_SERVICE,
  CONTEXT_SERVICE,
  PROJECT_DETECTOR_SERVICE,
  FRAMEWORK_DETECTOR_SERVICE,
  DEPENDENCY_ANALYZER_SERVICE,
  MONOREPO_DETECTOR_SERVICE,
  PATTERN_MATCHER_SERVICE,
  IGNORE_PATTERN_RESOLVER_SERVICE,
  FILE_TYPE_CLASSIFIER_SERVICE,
  WORKSPACE_INDEXER_SERVICE,
  FILE_INDEXER_SERVICE,
  WORKSPACE_ANALYZER_SERVICE,
  WORKSPACE_SERVICE,
  FILE_RELEVANCE_SCORER,
  CONTEXT_SIZE_OPTIMIZER,
  SEMANTIC_CONTEXT_EXTRACTOR,

  // Claude Orchestration Services (MAIN_APP_CLEANUP Phase 1-2)
  CHAT_ORCHESTRATION_SERVICE,
  PROVIDER_ORCHESTRATION_SERVICE,
  ANALYTICS_ORCHESTRATION_SERVICE,
  CONFIG_ORCHESTRATION_SERVICE,
  CONTEXT_ORCHESTRATION_SERVICE,
  MESSAGE_HANDLER_SERVICE,
} as const;

/**
 * Type helper to extract token types for type-safe usage
 */
export type DIToken = keyof typeof TOKENS;
