/**
 * DI Token Symbols - Type-safe dependency injection tokens
 * SINGLE SOURCE OF TRUTH for ALL dependency injection tokens
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 176-194
 *
 * ⚠️ CRITICAL: This is the ONLY file that defines DI tokens in the entire codebase
 * All libraries import from here. No other token definitions should exist.
 *
 * Uses Symbol.for() to create global symbols shared across module boundaries
 */

// ========================================
// VS Code API Tokens
// ========================================
export const EXTENSION_CONTEXT = Symbol.for('ExtensionContext');
export const WEBVIEW_PROVIDER = Symbol.for('WebviewProvider');
export const COMMAND_REGISTRY = Symbol.for('CommandRegistry');

// ========================================
// Messaging System Tokens
// ========================================
export const EVENT_BUS = Symbol.for('EventBus');
export const MESSAGE_ROUTER = Symbol.for('MessageRouter');
export const WEBVIEW_MESSAGE_BRIDGE = Symbol.for('WebviewMessageBridge');

// ========================================
// API Wrapper Service Tokens
// ========================================
export const OUTPUT_MANAGER = Symbol.for('OutputManager');
export const STATUS_BAR_MANAGER = Symbol.for('StatusBarManager');
export const FILE_SYSTEM_MANAGER = Symbol.for('FileSystemManager');
export const COMMAND_MANAGER = Symbol.for('CommandManager');
export const WEBVIEW_MANAGER = Symbol.for('WebviewManager');

// ========================================
// Core Infrastructure Service Tokens
// ========================================
export const LOGGER = Symbol.for('Logger');
export const ERROR_HANDLER = Symbol.for('ErrorHandler');
export const CONFIG_MANAGER = Symbol.for('ConfigManager');
export const MESSAGE_VALIDATOR = Symbol.for('MessageValidator');
export const CONTEXT_MANAGER = Symbol.for('ContextManager');

// ========================================
// Workspace Intelligence Service Tokens
// ========================================
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
export const CONTEXT_ORCHESTRATION_SERVICE = Symbol.for(
  'ContextOrchestrationService'
);
export const TREE_SITTER_PARSER_SERVICE = Symbol.for('TreeSitterParserService');
export const AST_ANALYSIS_SERVICE = Symbol.for('AstAnalysisService');

// ========================================
// LLM Abstraction Service Tokens
// ========================================
export const LLM_SERVICE = Symbol.for('LlmService');
export const PROVIDER_REGISTRY = Symbol.for('ProviderRegistry');

// ========================================
// VS Code Language Model Tools
// ========================================
export const ANALYZE_WORKSPACE_TOOL = Symbol.for('AnalyzeWorkspaceTool');
export const SEARCH_FILES_TOOL = Symbol.for('SearchFilesTool');
export const GET_RELEVANT_FILES_TOOL = Symbol.for('GetRelevantFilesTool');
export const GET_DIAGNOSTICS_TOOL = Symbol.for('GetDiagnosticsTool');
export const FIND_SYMBOL_TOOL = Symbol.for('FindSymbolTool');
export const GET_GIT_STATUS_TOOL = Symbol.for('GetGitStatusTool');
export const LM_TOOLS_REGISTRATION_SERVICE = Symbol.for(
  'LMToolsRegistrationService'
);

// ========================================
// AI Providers Core Tokens
// ========================================
export const PROVIDER_MANAGER = Symbol.for('ProviderManager');
export const INTELLIGENT_PROVIDER_STRATEGY = Symbol.for(
  'IntelligentProviderStrategy'
);
export const CLAUDE_CLI_ADAPTER = Symbol.for('ClaudeCliAdapter');
export const VSCODE_LM_ADAPTER = Symbol.for('VsCodeLmAdapter');

// ========================================
// Claude Domain Service Tokens
// ========================================
// Core domain services
export const SESSION_MANAGER = Symbol.for('SessionManager');
export const SESSION_PROXY = Symbol.for('SessionProxy');
export const CLAUDE_CLI_DETECTOR = Symbol.for('ClaudeCliDetector');
export const CLAUDE_CLI_SERVICE = Symbol.for('ClaudeCliService');
export const CLAUDE_CLI_LAUNCHER = Symbol.for('ClaudeCliLauncher');
export const PERMISSION_SERVICE = Symbol.for('PermissionService');
export const PROCESS_MANAGER = Symbol.for('ProcessManager');
export const CLAUDE_DOMAIN_EVENT_PUBLISHER = Symbol.for(
  'ClaudeDomainEventPublisher'
);

// Orchestration services
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
export const MESSAGE_HANDLER_SERVICE = Symbol.for('MessageHandlerService');

// Service dependencies
export const STORAGE_SERVICE = Symbol.for('StorageService');
export const CONFIGURATION_PROVIDER = Symbol.for('ConfigurationProvider');

// ========================================
// Main App Service Tokens
// ========================================
export const COMMAND_BUILDER_SERVICE = Symbol.for('CommandBuilderService');
export const ANALYTICS_DATA_COLLECTOR = Symbol.for('AnalyticsDataCollector');
export const ANGULAR_WEBVIEW_PROVIDER = Symbol.for('AngularWebviewProvider');
export const COMMAND_HANDLERS = Symbol.for('CommandHandlers');
export const WEBVIEW_EVENT_QUEUE = Symbol.for('WebviewEventQueue');
export const WEBVIEW_INITIAL_DATA_BUILDER = Symbol.for(
  'WebviewInitialDataBuilder'
);

// Legacy tokens (being phased out)
export const CLAUDE_SERVICE = Symbol.for('ClaudeService');
export const WORKSPACE_ANALYZER = Symbol.for('WorkspaceAnalyzer');

/**
 * TOKENS constant for convenient access to all DI tokens
 * Provides a single source of truth for all dependency injection symbols
 */
export const TOKENS = {
  // ========================================
  // VS Code APIs
  // ========================================
  EXTENSION_CONTEXT,
  WEBVIEW_PROVIDER,
  COMMAND_REGISTRY,
  COMMAND_MANAGER,
  WEBVIEW_MANAGER,

  // ========================================
  // Messaging
  // ========================================
  EVENT_BUS,
  MESSAGE_ROUTER,
  WEBVIEW_MESSAGE_BRIDGE,

  // ========================================
  // API Wrappers
  // ========================================
  OUTPUT_MANAGER,
  STATUS_BAR_MANAGER,
  FILE_SYSTEM_MANAGER,

  // ========================================
  // Core Infrastructure
  // ========================================
  LOGGER,
  ERROR_HANDLER,
  CONFIG_MANAGER,
  MESSAGE_VALIDATOR,
  CONTEXT_MANAGER,

  // ========================================
  // Workspace Intelligence
  // ========================================
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
  CONTEXT_ORCHESTRATION_SERVICE,
  TREE_SITTER_PARSER_SERVICE,
  AST_ANALYSIS_SERVICE,

  // ========================================
  // LLM Abstraction
  // ========================================
  LLM_SERVICE,
  PROVIDER_REGISTRY,

  // ========================================
  // VS Code Language Model Tools
  // ========================================
  ANALYZE_WORKSPACE_TOOL,
  SEARCH_FILES_TOOL,
  GET_RELEVANT_FILES_TOOL,
  GET_DIAGNOSTICS_TOOL,
  FIND_SYMBOL_TOOL,
  GET_GIT_STATUS_TOOL,
  LM_TOOLS_REGISTRATION_SERVICE,

  // ========================================
  // AI Providers Core
  // ========================================
  PROVIDER_MANAGER,
  INTELLIGENT_PROVIDER_STRATEGY,
  CLAUDE_CLI_ADAPTER,
  VSCODE_LM_ADAPTER,

  // ========================================
  // Claude Domain Services
  // ========================================
  SESSION_MANAGER,
  SESSION_PROXY,
  CLAUDE_CLI_DETECTOR,
  CLAUDE_CLI_SERVICE,
  CLAUDE_CLI_LAUNCHER,
  PERMISSION_SERVICE,
  PROCESS_MANAGER,
  CLAUDE_DOMAIN_EVENT_PUBLISHER,
  CHAT_ORCHESTRATION_SERVICE,
  PROVIDER_ORCHESTRATION_SERVICE,
  ANALYTICS_ORCHESTRATION_SERVICE,
  CONFIG_ORCHESTRATION_SERVICE,
  MESSAGE_HANDLER_SERVICE,
  STORAGE_SERVICE,
  CONFIGURATION_PROVIDER,

  // ========================================
  // Main App Services
  // ========================================
  COMMAND_BUILDER_SERVICE,
  ANALYTICS_DATA_COLLECTOR,
  ANGULAR_WEBVIEW_PROVIDER,
  COMMAND_HANDLERS,
  WEBVIEW_EVENT_QUEUE,
  WEBVIEW_INITIAL_DATA_BUILDER,

  // Legacy (being phased out)
  CLAUDE_SERVICE,
  WORKSPACE_ANALYZER,
} as const;

/**
 * Type helper to extract token types for type-safe usage
 */
export type DIToken = keyof typeof TOKENS;
