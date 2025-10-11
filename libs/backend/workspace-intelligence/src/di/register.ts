/**
 * Workspace Intelligence Services Registration
 *
 * Bootstrap function for registering all workspace-intelligence services
 * in the DI container. Called by main application during activation.
 *
 * Follows LIBRARY_INTEGRATION_ARCHITECTURE.md pattern:
 * - Domain libraries export bootstrap functions
 * - Main app orchestrates service registration
 * - vscode-core remains pure infrastructure
 *
 * NOTE: This function receives TOKENS from the caller to avoid circular
 * dependency between workspace-intelligence and vscode-core.
 */

import { DependencyContainer } from 'tsyringe';
import {
  TokenCounterService,
  FileSystemService,
  ProjectDetectorService,
  FrameworkDetectorService,
  DependencyAnalyzerService,
  MonorepoDetectorService,
  PatternMatcherService,
  IgnorePatternResolverService,
  FileTypeClassifierService,
  WorkspaceIndexerService,
  ContextService,
  ContextOrchestrationService,
  WorkspaceAnalyzerService,
} from '../index';
import { WorkspaceService } from '../workspace/workspace.service';

/**
 * Token registry interface for workspace-intelligence services
 * Passed by main app to avoid circular dependencies
 */
export interface WorkspaceIntelligenceTokens {
  TOKEN_COUNTER_SERVICE: symbol;
  FILE_SYSTEM_SERVICE: symbol;
  PROJECT_DETECTOR_SERVICE: symbol;
  FRAMEWORK_DETECTOR_SERVICE: symbol;
  DEPENDENCY_ANALYZER_SERVICE: symbol;
  MONOREPO_DETECTOR_SERVICE: symbol;
  PATTERN_MATCHER_SERVICE: symbol;
  IGNORE_PATTERN_RESOLVER_SERVICE: symbol;
  WORKSPACE_INDEXER_SERVICE: symbol;
  FILE_TYPE_CLASSIFIER_SERVICE: symbol;
  CONTEXT_SERVICE: symbol;
  WORKSPACE_SERVICE: symbol;
  CONTEXT_ORCHESTRATION_SERVICE: symbol;
  WORKSPACE_ANALYZER_SERVICE: symbol;
}

/**
 * Register all workspace-intelligence services in the DI container
 *
 * This function encapsulates the registration logic for all services
 * in the workspace-intelligence domain library.
 *
 * @param container - The TSyringe DependencyContainer instance
 * @param tokens - Token registry from vscode-core (avoids circular dependency)
 *
 * @example
 * ```typescript
 * // In main app activation (apps/ptah-extension-vscode/src/main.ts)
 * import { TOKENS } from '@ptah-extension/vscode-core';
 *
 * const container = DIContainer.setup(context);
 * registerWorkspaceIntelligenceServices(container, TOKENS);
 * ```
 */
export function registerWorkspaceIntelligenceServices(
  container: DependencyContainer,
  tokens: WorkspaceIntelligenceTokens
): void {
  // Token counting and analysis
  container.registerSingleton(
    tokens.TOKEN_COUNTER_SERVICE,
    TokenCounterService
  );

  // File system operations
  container.registerSingleton(tokens.FILE_SYSTEM_SERVICE, FileSystemService);

  // Context management
  container.registerSingleton(tokens.CONTEXT_SERVICE, ContextService);

  // Workspace management
  container.registerSingleton(tokens.WORKSPACE_SERVICE, WorkspaceService);

  // Project analysis services
  container.registerSingleton(
    tokens.PROJECT_DETECTOR_SERVICE,
    ProjectDetectorService
  );
  container.registerSingleton(
    tokens.FRAMEWORK_DETECTOR_SERVICE,
    FrameworkDetectorService
  );
  container.registerSingleton(
    tokens.DEPENDENCY_ANALYZER_SERVICE,
    DependencyAnalyzerService
  );
  container.registerSingleton(
    tokens.MONOREPO_DETECTOR_SERVICE,
    MonorepoDetectorService
  );

  // File indexing services
  container.registerSingleton(
    tokens.PATTERN_MATCHER_SERVICE,
    PatternMatcherService
  );
  container.registerSingleton(
    tokens.IGNORE_PATTERN_RESOLVER_SERVICE,
    IgnorePatternResolverService
  );
  container.registerSingleton(
    tokens.WORKSPACE_INDEXER_SERVICE,
    WorkspaceIndexerService
  );

  // Context analysis services
  container.registerSingleton(
    tokens.FILE_TYPE_CLASSIFIER_SERVICE,
    FileTypeClassifierService
  );

  // Orchestration services (MAIN_APP_CLEANUP Phase 1)
  container.registerSingleton(
    tokens.CONTEXT_ORCHESTRATION_SERVICE,
    ContextOrchestrationService
  );

  // Composite services - Unified facades
  container.registerSingleton(
    tokens.WORKSPACE_ANALYZER_SERVICE,
    WorkspaceAnalyzerService
  );
}
