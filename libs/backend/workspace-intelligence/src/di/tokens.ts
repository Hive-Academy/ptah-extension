/**
 * Dependency Injection Tokens for Workspace Intelligence Services
 *
 * Local tokens to avoid circular dependency with vscode-core.
 * These services are registered in vscode-core/di/container.ts.
 */

/** Token counter service for AI context token counting */
export const FILE_SYSTEM_SERVICE = Symbol.for('FILE_SYSTEM_SERVICE');

/** File system service for workspace.fs wrapper */
export const TOKEN_COUNTER_SERVICE = Symbol.for('TOKEN_COUNTER_SERVICE');

/** Project type detection service */
export const PROJECT_DETECTOR_SERVICE = Symbol.for('PROJECT_DETECTOR_SERVICE');

/** Pattern matching service for glob patterns */
export const PATTERN_MATCHER_SERVICE = Symbol.for('PATTERN_MATCHER_SERVICE');

/** Ignore pattern resolver service for .gitignore, .prettierignore, etc. */
export const IGNORE_PATTERN_RESOLVER_SERVICE = Symbol.for(
  'IGNORE_PATTERN_RESOLVER_SERVICE'
);

/** File indexer service for workspace file scanning */
export const FILE_INDEXER_SERVICE = Symbol.for('FILE_INDEXER_SERVICE');

/** Workspace analyzer service for comprehensive workspace analysis */
export const WORKSPACE_ANALYZER_SERVICE = Symbol.for(
  'WORKSPACE_ANALYZER_SERVICE'
);
