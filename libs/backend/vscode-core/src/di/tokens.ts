/**
 * DI Token Registry - Core Infrastructure Tokens
 *
 * This file is the CANONICAL reference for DI token conventions.
 * Other token files (@see below) follow these same conventions.
 *
 * CONVENTION: All DI tokens MUST use Symbol.for('DescriptiveName')
 *
 * Why Symbol.for():
 * - Symbol.for() creates globally shared symbols (same description = same symbol)
 * - String tokens ('Name') and Symbol.for('Name') are different — causes silent DI failures
 * - Plain Symbol('Name') !== Symbol('Name') — creates unique symbols per call
 * - Symbol.for('Name') === Symbol.for('Name') — always matches, even across modules
 *
 * Rules:
 * 1. Always use Symbol.for() for token values
 * 2. Never use string literals as DI tokens
 * 3. Never use plain Symbol() (without .for)
 * 4. Always inject via token constants (TOKENS.X, SDK_TOKENS.X), never hardcode strings
 *    in @inject() decorators
 * 5. Each Symbol.for() description must be globally unique across all token files
 *    (unless intentionally shared for cross-library resolution, e.g.,
 *    TOKENS.SDK_AGENT_ADAPTER and SDK_TOKENS.SDK_AGENT_ADAPTER both resolve to
 *    Symbol.for('SdkAgentAdapter') so they reference the same registration)
 *
 * Token files:
 * - vscode-core/src/di/tokens.ts    (this file) — core infrastructure tokens
 * - agent-sdk/src/lib/di/tokens.ts  — SDK-specific tokens (SDK_TOKENS)
 * - agent-generation/src/lib/di/tokens.ts — agent generation tokens (AGENT_GENERATION_TOKENS)
 */

// ========================================
// VS Code API Tokens
// ========================================
export const EXTENSION_CONTEXT = Symbol.for('ExtensionContext');
// WEBVIEW_PROVIDER - DELETED in TASK_2025_078 (never registered, use WEBVIEW_MANAGER)
// COMMAND_REGISTRY - DELETED in TASK_2025_078 (never registered, use COMMAND_MANAGER)

// ========================================
// Messaging System Tokens (DELETED - event-based system removed)
// ========================================
// EVENT_BUS - DELETED
// MESSAGE_ROUTER - DELETED
// WEBVIEW_MESSAGE_BRIDGE - DELETED

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
export const RPC_HANDLER = Symbol.for('RpcHandler');
export const RPC_METHOD_REGISTRATION_SERVICE = Symbol.for(
  'RpcMethodRegistrationService'
);
// SDK_RPC_HANDLERS - DELETED in TASK_2025_092 (dead code - permission emitter moved to SdkPermissionHandler)
export const AGENT_SESSION_WATCHER_SERVICE = Symbol.for(
  'AgentSessionWatcherService'
);
export const SUBAGENT_REGISTRY_SERVICE = Symbol.for('SubagentRegistryService');

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
export const AGENT_DISCOVERY_SERVICE = Symbol.for('AgentDiscoveryService');
export const COMMAND_DISCOVERY_SERVICE = Symbol.for('CommandDiscoveryService');

// ========================================
// LLM Abstraction Service Tokens
// ========================================
export const LLM_SERVICE = Symbol.for('LlmService');
export const PROVIDER_REGISTRY = Symbol.for('ProviderRegistry');
export const LLM_SECRETS_SERVICE = Symbol.for('LlmSecretsService');
export const LLM_CONFIGURATION_SERVICE = Symbol.for('LlmConfigurationService');
export const LLM_RPC_HANDLERS = Symbol.for('LlmRpcHandlers');

// ========================================
// Auth Secrets Service Token (TASK_2025_076)
// ========================================
export const AUTH_SECRETS_SERVICE = Symbol.for('AuthSecretsService');

// ========================================
// License Service Token (TASK_2025_075)
// ========================================
export const LICENSE_SERVICE = Symbol.for('LicenseService');
export const LICENSE_COMMANDS = Symbol.for('LicenseCommands');

// ========================================
// Feature Gate Service Token (TASK_2025_121)
// ========================================
export const FEATURE_GATE_SERVICE = Symbol.for('FeatureGateService');

// ========================================
// Template Generation Service Tokens
// ========================================
// TASK_2025_071 Batch 5: Dedicated token for template-generation's FileSystemAdapter
// This resolves the collision where both workspace-intelligence (FileSystemService)
// and template-generation (FileSystemAdapter) were using TOKENS.FILE_SYSTEM_SERVICE
export const TEMPLATE_FILE_SYSTEM_ADAPTER = Symbol.for(
  'TemplateFileSystemAdapter'
);
export const TEMPLATE_MANAGER = Symbol.for('TemplateManager');
export const CONTENT_GENERATOR = Symbol.for('ContentGenerator');
export const CONTENT_PROCESSOR = Symbol.for('ContentProcessor');
export const TEMPLATE_PROCESSOR = Symbol.for('TemplateProcessor');
export const TEMPLATE_FILE_MANAGER = Symbol.for('TemplateFileManager');
export const TEMPLATE_ORCHESTRATOR = Symbol.for('TemplateOrchestrator');
export const TEMPLATE_GENERATOR_SERVICE = Symbol.for(
  'TemplateGeneratorService'
);

// ========================================
// Code Execution MCP (TASK_2025_025)
// ========================================
// DELETED in TASK_2025_025: ANALYZE_WORKSPACE_TOOL, SEARCH_FILES_TOOL, GET_RELEVANT_FILES_TOOL,
// GET_DIAGNOSTICS_TOOL, FIND_SYMBOL_TOOL, GET_GIT_STATUS_TOOL, LM_TOOLS_REGISTRATION_SERVICE
// (These languageModelTools only worked with Copilot, not Claude CLI)

export const PTAH_API_BUILDER = Symbol.for('PtahAPIBuilder');
export const CODE_EXECUTION_MCP = Symbol.for('CodeExecutionMCP');
// MCP_CONFIG_MANAGER_SERVICE - DELETED (SDK tools are native, no .mcp.json needed)
export const PERMISSION_PROMPT_SERVICE = Symbol.for('PermissionPromptService');
export const IMAGE_GENERATION_SERVICE = Symbol.for('ImageGenerationService');

// ========================================
// AI Providers Core Tokens (DELETED - library removed)
// ========================================
// PROVIDER_MANAGER - DELETED
// INTELLIGENT_PROVIDER_STRATEGY - DELETED
// CLAUDE_CLI_ADAPTER - DELETED
// VSCODE_LM_ADAPTER - DELETED

// ========================================
// Claude Domain Service Tokens (PARTIALLY DELETED)
// ========================================
// Core domain services (KEPT)
export const CLAUDE_CLI_DETECTOR = Symbol.for('ClaudeCliDetector');
export const CLAUDE_CLI_SERVICE = Symbol.for('ClaudeCliService');
export const PROCESS_MANAGER = Symbol.for('ProcessManager');
export const PRICING_SERVICE = Symbol.for('PricingService');

// VS Code Memento for pricing cache
export const GLOBAL_STATE = Symbol.for('GlobalState');

// Agent SDK adapter token (TASK_2025_057 Batch 1)
export const SDK_AGENT_ADAPTER = Symbol.for('SdkAgentAdapter');
// PERMISSION_SERVICE - DELETED (over-engineered, unused)

// DELETED tokens (TASK_2025_023 purge)
// SESSION_MANAGER - DELETED (in-memory session duplication)
// INTERACTIVE_SESSION_MANAGER - DELETED (complex state machine)
// SESSION_PROXY - DELETED (event-based orchestration removed)
// CLAUDE_DOMAIN_EVENT_PUBLISHER - DELETED
// CHAT_ORCHESTRATION_SERVICE - DELETED
// PROVIDER_ORCHESTRATION_SERVICE - DELETED
// ANALYTICS_ORCHESTRATION_SERVICE - DELETED
// CONFIG_ORCHESTRATION_SERVICE - DELETED
// MESSAGE_HANDLER_SERVICE - DELETED

// Service dependencies
export const STORAGE_SERVICE = Symbol.for('StorageService');
// CONFIGURATION_PROVIDER - DELETED in TASK_2025_078 (orphaned, never registered)

// ========================================
// Project Intelligence Service Tokens (TASK_2025_141)
// ========================================

/**
 * CodeQualityAssessmentService - Anti-pattern detection and quality scoring
 * Responsibilities: Sample files, detect anti-patterns, calculate quality score
 */
export const CODE_QUALITY_ASSESSMENT_SERVICE = Symbol.for(
  'CodeQualityAssessmentService'
);

/**
 * AntiPatternDetectionService - Rule-based anti-pattern detection
 * Responsibilities: Load rules, execute detection, aggregate results
 */
export const ANTI_PATTERN_DETECTION_SERVICE = Symbol.for(
  'AntiPatternDetectionService'
);

/**
 * ProjectIntelligenceService - Unified facade for project intelligence
 * Responsibilities: Orchestrate workspace analysis + quality assessment + guidance generation
 */
export const PROJECT_INTELLIGENCE_SERVICE = Symbol.for(
  'ProjectIntelligenceService'
);

/**
 * PrescriptiveGuidanceService - Generate corrective recommendations
 * Responsibilities: Prioritize issues, generate actionable guidance, respect token budgets
 */
export const PRESCRIPTIVE_GUIDANCE_SERVICE = Symbol.for(
  'PrescriptiveGuidanceService'
);

/**
 * FileHashCacheService - SHA-256 content hashing for incremental analysis (TASK_2025_144)
 * Responsibilities: Cache file content hashes, detect changed files, store per-file analysis results
 */
export const FILE_HASH_CACHE_SERVICE = Symbol.for('FileHashCacheService');

/**
 * QualityHistoryService - Assessment history persistence via globalState (TASK_2025_144)
 * Responsibilities: Record assessment snapshots, retrieve history, manage max entries limit
 */
export const QUALITY_HISTORY_SERVICE = Symbol.for('QualityHistoryService');

/**
 * QualityExportService - Quality report export in multiple formats (TASK_2025_144)
 * Responsibilities: Generate Markdown, JSON, and CSV reports from ProjectIntelligence data
 */
export const QUALITY_EXPORT_SERVICE = Symbol.for('QualityExportService');

// ========================================
// Main App Service Tokens (PARTIALLY DELETED)
// ========================================
// COMMAND_BUILDER_SERVICE - DELETED in TASK_2025_078 (never used)
// ANALYTICS_DATA_COLLECTOR - DELETED (analytics-data-collector removed)
export const ANGULAR_WEBVIEW_PROVIDER = Symbol.for('AngularWebviewProvider');
export const COMMAND_HANDLERS = Symbol.for('CommandHandlers');
export const WEBVIEW_EVENT_QUEUE = Symbol.for('WebviewEventQueue');
export const WEBVIEW_INITIAL_DATA_BUILDER = Symbol.for(
  'WebviewInitialDataBuilder'
);
export const WEBVIEW_HTML_GENERATOR = Symbol.for('WebviewHtmlGenerator');
export const WEBVIEW_MESSAGE_HANDLER = Symbol.for('WebviewMessageHandler');

/**
 * TOKENS constant for convenient access to all DI tokens
 * Provides a single source of truth for all dependency injection symbols
 */
export const TOKENS = {
  // ========================================
  // VS Code APIs
  // ========================================
  EXTENSION_CONTEXT,
  // WEBVIEW_PROVIDER - DELETED in TASK_2025_078
  // COMMAND_REGISTRY - DELETED in TASK_2025_078
  COMMAND_MANAGER,
  WEBVIEW_MANAGER,

  // ========================================
  // Messaging (DELETED - event-based system removed)
  // ========================================
  // EVENT_BUS - DELETED
  // MESSAGE_ROUTER - DELETED
  // WEBVIEW_MESSAGE_BRIDGE - DELETED

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
  RPC_HANDLER,
  RPC_METHOD_REGISTRATION_SERVICE,
  // SDK_RPC_HANDLERS - DELETED in TASK_2025_092
  AGENT_SESSION_WATCHER_SERVICE,
  SUBAGENT_REGISTRY_SERVICE,

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
  AGENT_DISCOVERY_SERVICE,
  COMMAND_DISCOVERY_SERVICE,

  // Project Intelligence (TASK_2025_141)
  CODE_QUALITY_ASSESSMENT_SERVICE,
  ANTI_PATTERN_DETECTION_SERVICE,
  PROJECT_INTELLIGENCE_SERVICE,
  PRESCRIPTIVE_GUIDANCE_SERVICE,
  FILE_HASH_CACHE_SERVICE,
  QUALITY_HISTORY_SERVICE,
  QUALITY_EXPORT_SERVICE,

  // ========================================
  // LLM Abstraction
  // ========================================
  LLM_SERVICE,
  PROVIDER_REGISTRY,
  LLM_SECRETS_SERVICE,
  LLM_CONFIGURATION_SERVICE,
  LLM_RPC_HANDLERS,

  // Auth Secrets (TASK_2025_076)
  AUTH_SECRETS_SERVICE,

  // License Service (TASK_2025_075)
  LICENSE_SERVICE,
  LICENSE_COMMANDS,

  // Feature Gate Service (TASK_2025_121)
  FEATURE_GATE_SERVICE,

  // ========================================
  // Template Generation
  // ========================================
  TEMPLATE_FILE_SYSTEM_ADAPTER, // TASK_2025_071 Batch 5: Dedicated adapter token
  TEMPLATE_MANAGER,
  CONTENT_GENERATOR,
  CONTENT_PROCESSOR,
  TEMPLATE_PROCESSOR,
  TEMPLATE_FILE_MANAGER,
  TEMPLATE_ORCHESTRATOR,
  TEMPLATE_GENERATOR_SERVICE,

  // ========================================
  // Code Execution MCP (TASK_2025_025)
  // ========================================
  // DELETED: ANALYZE_WORKSPACE_TOOL, SEARCH_FILES_TOOL, GET_RELEVANT_FILES_TOOL,
  // GET_DIAGNOSTICS_TOOL, FIND_SYMBOL_TOOL, GET_GIT_STATUS_TOOL, LM_TOOLS_REGISTRATION_SERVICE
  // MCP_CONFIG_MANAGER_SERVICE - DELETED (SDK tools are native)
  PTAH_API_BUILDER,
  CODE_EXECUTION_MCP,
  PERMISSION_PROMPT_SERVICE,
  IMAGE_GENERATION_SERVICE,

  // ========================================
  // AI Providers Core (DELETED - library removed)
  // ========================================
  // PROVIDER_MANAGER - DELETED
  // INTELLIGENT_PROVIDER_STRATEGY - DELETED
  // CLAUDE_CLI_ADAPTER - DELETED
  // VSCODE_LM_ADAPTER - DELETED

  // ========================================
  // Claude Domain Services (PARTIALLY DELETED)
  // ========================================
  CLAUDE_CLI_DETECTOR,
  CLAUDE_CLI_SERVICE,
  PROCESS_MANAGER,
  PRICING_SERVICE,
  GLOBAL_STATE,
  STORAGE_SERVICE,
  // CONFIGURATION_PROVIDER - DELETED in TASK_2025_078
  SDK_AGENT_ADAPTER,
  // PERMISSION_SERVICE - DELETED (over-engineered, unused)
  // DELETED (TASK_2025_023 cleanup): SESSION_MANAGER, INTERACTIVE_SESSION_MANAGER,
  // SESSION_PROXY, CLAUDE_DOMAIN_EVENT_PUBLISHER, CHAT_ORCHESTRATION_SERVICE,
  // PROVIDER_ORCHESTRATION_SERVICE, ANALYTICS_ORCHESTRATION_SERVICE,
  // CONFIG_ORCHESTRATION_SERVICE, MESSAGE_HANDLER_SERVICE

  // ========================================
  // Main App Services (PARTIALLY DELETED)
  // ========================================
  // COMMAND_BUILDER_SERVICE - DELETED in TASK_2025_078
  // ANALYTICS_DATA_COLLECTOR - DELETED
  ANGULAR_WEBVIEW_PROVIDER,
  COMMAND_HANDLERS,
  WEBVIEW_EVENT_QUEUE,
  WEBVIEW_INITIAL_DATA_BUILDER,
  WEBVIEW_HTML_GENERATOR,
  WEBVIEW_MESSAGE_HANDLER,
} as const;

/**
 * Type helper to extract token types for type-safe usage
 */
export type DIToken = keyof typeof TOKENS;
