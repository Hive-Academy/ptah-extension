/**
 * Dependency Injection Tokens for Workspace Intelligence Services
 *
 * Local tokens to avoid circular dependency with vscode-core.
 * These services are registered in vscode-core/di/container.ts.
 *
 * Note: Uses Symbol.for() to create global symbols that match the tokens
 * defined in vscode-core. This allows TSyringe to resolve dependencies
 * across module boundaries without circular imports.
 *
 * CRITICAL: The string keys in Symbol.for() MUST match exactly with vscode-core tokens!
 */

/** File system service for workspace.fs wrapper */
export const FILE_SYSTEM_SERVICE = Symbol.for('FileSystemService');

/** Token counter service for AI context token counting */
export const TOKEN_COUNTER_SERVICE = Symbol.for('TokenCounterService');

/** Project type detection service */
export const PROJECT_DETECTOR_SERVICE = Symbol.for('ProjectDetectorService');

/** Framework detector service */
export const FRAMEWORK_DETECTOR_SERVICE = Symbol.for(
  'FrameworkDetectorService'
);

/** Dependency analyzer service */
export const DEPENDENCY_ANALYZER_SERVICE = Symbol.for(
  'DependencyAnalyzerService'
);

/** Monorepo detector service */
export const MONOREPO_DETECTOR_SERVICE = Symbol.for('MonorepoDetectorService');

/** Pattern matching service for glob patterns */
export const PATTERN_MATCHER_SERVICE = Symbol.for('PatternMatcherService');

/** Ignore pattern resolver service for .gitignore, .prettierignore, etc. */
export const IGNORE_PATTERN_RESOLVER_SERVICE = Symbol.for(
  'IgnorePatternResolverService'
);

/** File type classifier service for categorizing files */
export const FILE_TYPE_CLASSIFIER_SERVICE = Symbol.for(
  'FileTypeClassifierService'
);

/** Workspace indexer service for file discovery and indexing */
export const WORKSPACE_INDEXER_SERVICE = Symbol.for('WorkspaceIndexerService');

/** File indexer service for workspace file scanning */
export const FILE_INDEXER_SERVICE = Symbol.for('FileIndexerService');

/** Workspace analyzer service for comprehensive workspace analysis */
export const WORKSPACE_ANALYZER_SERVICE = Symbol.for(
  'WorkspaceAnalyzerService'
);

/** Workspace management service for workspace information and analysis */
export const WORKSPACE_SERVICE = Symbol.for('WorkspaceService');

/** Context service for file context management and AI interactions */
export const CONTEXT_SERVICE = Symbol.for('ContextService');
