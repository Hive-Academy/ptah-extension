/**
 * DI Token Symbols - Type-safe dependency injection tokens
 * Eliminates string-based tokens to prevent typos and improve type safety
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 176-194
 */

// VS Code API tokens
export const EXTENSION_CONTEXT = Symbol('ExtensionContext');
export const WEBVIEW_PROVIDER = Symbol('WebviewProvider');
export const COMMAND_REGISTRY = Symbol('CommandRegistry');

// Messaging system tokens
export const EVENT_BUS = Symbol('EventBus');
export const MESSAGE_ROUTER = Symbol('MessageRouter');

// Provider system tokens
export const AI_PROVIDER_FACTORY = Symbol('AIProviderFactory');
export const AI_PROVIDER_MANAGER = Symbol('AIProviderManager');
export const PROVIDER_STRATEGY = Symbol('ProviderStrategy');

// API wrapper service tokens
export const OUTPUT_MANAGER = Symbol('OutputManager');
export const STATUS_BAR_MANAGER = Symbol('StatusBarManager');
export const FILE_SYSTEM_MANAGER = Symbol('FileSystemManager');

// Business logic service tokens
export const CLAUDE_SERVICE = Symbol('ClaudeService');
export const SESSION_MANAGER = Symbol('SessionManager');
export const WORKSPACE_ANALYZER = Symbol('WorkspaceAnalyzer');

// Claude domain service tokens (MONSTER Week 5)
export const CLAUDE_CLI_DETECTOR = Symbol('ClaudeCliDetector');
export const CLAUDE_CLI_LAUNCHER = Symbol('ClaudeCliLauncher');
export const CLAUDE_SESSION_MANAGER = Symbol('ClaudeSessionManager');
export const CLAUDE_PERMISSION_SERVICE = Symbol('ClaudePermissionService');
export const CLAUDE_PROCESS_MANAGER = Symbol('ClaudeProcessManager');
export const CLAUDE_DOMAIN_EVENT_PUBLISHER = Symbol(
  'ClaudeDomainEventPublisher'
);

// Workspace intelligence service tokens (TASK_PRV_005)
export const TOKEN_COUNTER_SERVICE = Symbol('TokenCounterService');
export const FILE_SYSTEM_SERVICE = Symbol('FileSystemService');
export const PROJECT_DETECTOR_SERVICE = Symbol('ProjectDetectorService');
export const FRAMEWORK_DETECTOR_SERVICE = Symbol('FrameworkDetectorService');
export const DEPENDENCY_ANALYZER_SERVICE = Symbol('DependencyAnalyzerService');
export const MONOREPO_DETECTOR_SERVICE = Symbol('MonorepoDetectorService');
export const PATTERN_MATCHER_SERVICE = Symbol('PatternMatcherService');
export const FILE_INDEXER_SERVICE = Symbol('FileIndexerService');
export const WORKSPACE_ANALYZER_SERVICE = Symbol('WorkspaceAnalyzerService');
export const FILE_RELEVANCE_SCORER = Symbol('FileRelevanceScorer');
export const CONTEXT_SIZE_OPTIMIZER = Symbol('ContextSizeOptimizer');
export const SEMANTIC_CONTEXT_EXTRACTOR = Symbol('SemanticContextExtractor');

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
  PROJECT_DETECTOR_SERVICE,
  FRAMEWORK_DETECTOR_SERVICE,
  DEPENDENCY_ANALYZER_SERVICE,
  MONOREPO_DETECTOR_SERVICE,
  PATTERN_MATCHER_SERVICE,
  FILE_INDEXER_SERVICE,
  WORKSPACE_ANALYZER_SERVICE,
  FILE_RELEVANCE_SCORER,
  CONTEXT_SIZE_OPTIMIZER,
  SEMANTIC_CONTEXT_EXTRACTOR,
} as const;

/**
 * Type helper to extract token types for type-safe usage
 */
export type DIToken = keyof typeof TOKENS;
