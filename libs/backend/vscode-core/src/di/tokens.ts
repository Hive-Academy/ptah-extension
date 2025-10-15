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

// Note: AI provider tokens moved to claude-domain library (proper boundary separation)
// Infrastructure layer should not define domain service tokens

// API wrapper service tokens
export const OUTPUT_MANAGER = Symbol.for('OutputManager');
export const STATUS_BAR_MANAGER = Symbol.for('StatusBarManager');
export const FILE_SYSTEM_MANAGER = Symbol.for('FileSystemManager');
export const COMMAND_MANAGER = Symbol.for('CommandManager');
export const WEBVIEW_MANAGER = Symbol.for('WebviewManager');

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

// Main app service tokens (legacy services being migrated)
export const COMMAND_BUILDER_SERVICE = Symbol.for('CommandBuilderService');
export const ANALYTICS_DATA_COLLECTOR = Symbol.for('AnalyticsDataCollector');
export const ANGULAR_WEBVIEW_PROVIDER = Symbol.for('AngularWebviewProvider');
export const COMMAND_HANDLERS = Symbol.for('CommandHandlers');

// Claude domain orchestration service tokens (retained by main app)
// Note: CONTEXT_ORCHESTRATION_SERVICE belongs to workspace-intelligence,
// other orchestration services now owned by claude-domain library
export const CONTEXT_ORCHESTRATION_SERVICE = Symbol.for(
  'ContextOrchestrationService'
);

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

  // Note: AI provider tokens moved to claude-domain (architectural boundary fix)

  // Business Logic
  CLAUDE_SERVICE,
  SESSION_MANAGER,
  WORKSPACE_ANALYZER,

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

  // Context orchestration (used by workspace-intelligence)
  CONTEXT_ORCHESTRATION_SERVICE,

  // Main app services
  COMMAND_BUILDER_SERVICE,
  ANALYTICS_DATA_COLLECTOR,
  ANGULAR_WEBVIEW_PROVIDER,
  COMMAND_HANDLERS,
} as const;

/**
 * Type helper to extract token types for type-safe usage
 */
export type DIToken = keyof typeof TOKENS;
