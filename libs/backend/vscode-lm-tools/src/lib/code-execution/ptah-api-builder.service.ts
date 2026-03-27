/**
 * Ptah API Builder Service
 *
 * Constructs the complete "ptah" API object with 13 namespaces for code execution context.
 * Delegates to specialized namespace builders for each domain:
 *
 * Core (workspace discovery):
 * - workspace: analysis, project type, frameworks detection
 * - search: file search and relevance
 * - diagnostics: errors, warnings, all diagnostics
 *
 * System (VS Code integration):
 * - files: read, list operations
 *
 * Analysis (workspace intelligence):
 * - context: token budget management and optimization
 * - project: monorepo detection, dependencies
 * - relevance: file scoring with explanations
 *
 * AST (code structure):
 * - ast: tree-sitter based code analysis
 *
 * TASK_2025_025: Expanded from 8 to 13 namespaces for better Claude discoverability
 */

import { injectable, inject, container } from 'tsyringe';
import { TOKENS, Logger, FileSystemManager } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  IDiagnosticsProvider,
} from '@ptah-extension/platform-core';
import {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
  ContextSizeOptimizerService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FileRelevanceScorerService,
  TokenCounterService,
  WorkspaceIndexerService,
  ProjectDetectorService,
  TreeSitterParserService,
  AstAnalysisService,
  ContextEnrichmentService,
  DependencyGraphService,
} from '@ptah-extension/workspace-intelligence';
import { PtahAPI } from './types';
import { WebSearchService } from './services/web-search.service';
import {
  // Core namespace builders
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  // System namespace builders
  buildFilesNamespace,
  buildHelpMethod,
  // Analysis namespace builders
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  buildDependencyNamespace,
  // AST namespace builder
  buildAstNamespace,
  // IDE namespace builder (TASK_2025_039)
  buildIDENamespace,
  // Orchestration namespace builder (TASK_2025_111)
  buildOrchestrationNamespace,
  // Agent namespace builder (TASK_2025_157)
  buildAgentNamespace,
} from './namespace-builders';
import {
  AgentProcessManager,
  CliDetectionService,
} from '@ptah-extension/llm-abstraction';

/**
 * Duplicated from SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_SESSION_LIFECYCLE_MANAGER = Symbol.for('SdkSessionLifecycleManager');

/**
 * Duplicated from SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_ENHANCED_PROMPTS_SERVICE = Symbol.for('SdkEnhancedPromptsService');

/**
 * Duplicated from SDK_TOKENS.SDK_PTAH_CLI_REGISTRY to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_PTAH_CLI_REGISTRY in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_PTAH_CLI_REGISTRY = Symbol.for('SdkPtahCliRegistry');

/**
 * Duplicated from SDK_TOKENS.SDK_PLUGIN_LOADER to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Must match the string in:
 * libs/backend/agent-sdk/src/lib/di/tokens.ts
 *
 * @see SDK_TOKENS.SDK_PLUGIN_LOADER in libs/backend/agent-sdk/src/lib/di/tokens.ts
 * @warning Keep Symbol.for() string value in sync with the canonical definition
 */
const SDK_PLUGIN_LOADER = Symbol.for('SdkPluginLoader');

@injectable()
export class PtahAPIBuilder {
  constructor(
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceAnalyzer: WorkspaceAnalyzerService,

    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,

    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,

    @inject(TOKENS.FILE_SYSTEM_MANAGER)
    private readonly fileSystemManager: FileSystemManager,

    // Analysis services
    @inject(TOKENS.CONTEXT_SIZE_OPTIMIZER)
    private readonly contextOptimizer: ContextSizeOptimizerService,

    @inject(TOKENS.MONOREPO_DETECTOR_SERVICE)
    private readonly monorepoDetector: MonorepoDetectorService,

    @inject(TOKENS.DEPENDENCY_ANALYZER_SERVICE)
    private readonly dependencyAnalyzer: DependencyAnalyzerService,

    @inject(TOKENS.FILE_RELEVANCE_SCORER)
    private readonly relevanceScorer: FileRelevanceScorerService,

    @inject(TOKENS.TOKEN_COUNTER_SERVICE)
    private readonly tokenCounter: TokenCounterService,

    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly workspaceIndexer: WorkspaceIndexerService,

    @inject(TOKENS.PROJECT_DETECTOR_SERVICE)
    private readonly projectDetector: ProjectDetectorService,

    // Context enrichment & dependency graph (TASK_2025_182)
    @inject(TOKENS.CONTEXT_ENRICHMENT_SERVICE)
    private readonly contextEnrichment: ContextEnrichmentService,

    @inject(TOKENS.DEPENDENCY_GRAPH_SERVICE)
    private readonly dependencyGraph: DependencyGraphService,

    // AST services
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly treeSitterParser: TreeSitterParserService,

    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,

    // Agent orchestration services (TASK_2025_157)
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,

    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetectionService: CliDetectionService,

    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,

    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystemProvider: IFileSystemProvider,

    @inject(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)
    private readonly diagnosticsProvider: IDiagnosticsProvider,
  ) {
    this.logger.info('PtahAPIBuilder initialized with 13 namespaces');
  }

  /**
   * Build the complete Ptah API object with all 13 namespaces
   */
  build(): PtahAPI {
    this.logger.debug('Building Ptah API with all namespaces');

    // Prepare dependency objects for namespace builders
    const coreDeps = {
      workspaceAnalyzer: this.workspaceAnalyzer,
      contextOrchestration: this.contextOrchestration,
    };

    const systemDeps = {
      fileSystemManager: this.fileSystemManager,
      workspaceProvider: this.workspaceProvider,
      fileSystemProvider: this.fileSystemProvider,
    };

    const analysisDeps = {
      contextOptimizer: this.contextOptimizer,
      monorepoDetector: this.monorepoDetector,
      dependencyAnalyzer: this.dependencyAnalyzer,
      relevanceScorer: this.relevanceScorer,
      tokenCounter: this.tokenCounter,
      workspaceIndexer: this.workspaceIndexer,
      projectDetector: this.projectDetector,
      workspaceAnalyzer: this.workspaceAnalyzer,
      contextEnrichment: this.contextEnrichment,
      dependencyGraph: this.dependencyGraph,
      workspaceProvider: this.workspaceProvider,
    };

    const astDeps = {
      treeSitterParser: this.treeSitterParser,
      astAnalysis: this.astAnalysis,
      fileSystemProvider: this.fileSystemProvider,
      workspaceProvider: this.workspaceProvider,
    };

    // Get workspace root for orchestration namespace
    const workspaceRoot = this.getWorkspaceRoot();
    const orchestrationDeps = {
      workspaceRoot,
    };

    return {
      // Core namespaces (workspace discovery)
      workspace: buildWorkspaceNamespace(coreDeps),
      search: buildSearchNamespace(coreDeps),
      diagnostics: buildDiagnosticsNamespace(this.diagnosticsProvider),

      // System namespaces (VS Code integration)
      files: buildFilesNamespace(systemDeps),

      // Analysis namespaces (workspace intelligence)
      context: buildContextNamespace(analysisDeps),
      project: buildProjectNamespace(analysisDeps),
      relevance: buildRelevanceNamespace(analysisDeps),

      // Dependencies namespace (TASK_2025_182 - import-based dependency graph)
      dependencies: buildDependencyNamespace(analysisDeps),

      // AST namespace (code structure)
      ast: buildAstNamespace(astDeps),

      // IDE namespace (TASK_2025_039 - LSP, editor, actions, testing)
      ide: buildIDENamespace(),

      // Orchestration namespace (TASK_2025_111 - workflow state management)
      orchestration: buildOrchestrationNamespace(orchestrationDeps),

      // Agent orchestration namespace (TASK_2025_157, session linking TASK_2025_161)
      agent: buildAgentNamespace({
        agentProcessManager: this.agentProcessManager,
        cliDetectionService: this.cliDetectionService,
        workspaceRoot,
        getActiveSessionId: () => {
          // SessionLifecycleManager.getActiveSessionIds() returns all active sessions.
          // In single-session mode (current), there's at most one.
          // Resolved lazily: if SDK_SESSION_LIFECYCLE_MANAGER token is unregistered, returns undefined
          // instead of crashing the MCP server during DI resolution.
          if (!container.isRegistered(SDK_SESSION_LIFECYCLE_MANAGER)) {
            return undefined;
          }
          try {
            const manager = container.resolve<{
              getActiveSessionIds(): string[];
            }>(SDK_SESSION_LIFECYCLE_MANAGER);
            const ids = manager.getActiveSessionIds();
            return ids.length > 0 ? (ids[0] as string) : undefined;
          } catch {
            return undefined;
          }
        },
        getProjectGuidance: async () => {
          // Resolve EnhancedPromptsService lazily via DI (same pattern as SDK_SESSION_LIFECYCLE_MANAGER).
          // Avoids hard dependency from vscode-lm-tools -> agent-sdk.
          if (!container.isRegistered(SDK_ENHANCED_PROMPTS_SERVICE)) {
            return undefined;
          }
          try {
            const service = container.resolve<{
              getProjectGuidanceContent(
                workspacePath: string,
              ): Promise<string | null>;
            }>(SDK_ENHANCED_PROMPTS_SERVICE);
            const workspacePath = this.getWorkspaceRoot();
            const content =
              await service.getProjectGuidanceContent(workspacePath);
            return content ?? undefined;
          } catch {
            return undefined;
          }
        },
        getSystemPrompt: async () => {
          // Resolve EnhancedPromptsService lazily for the full enhanced prompt content.
          // Returns the full enhanced prompts (project guidance + framework guidelines +
          // coding standards + architecture notes) for use as CLI agent system prompt.
          if (!container.isRegistered(SDK_ENHANCED_PROMPTS_SERVICE)) {
            return undefined;
          }
          try {
            const service = container.resolve<{
              getEnhancedPromptContent(
                workspacePath: string,
              ): Promise<string | null>;
            }>(SDK_ENHANCED_PROMPTS_SERVICE);
            const workspacePath = this.getWorkspaceRoot();
            const content =
              await service.getEnhancedPromptContent(workspacePath);
            return content ?? undefined;
          } catch {
            return undefined;
          }
        },
        getPluginPaths: async () => {
          // Resolve PluginLoaderService lazily to get enabled plugin paths (premium-gated).
          // Skills are synced to CLI directories by CliPluginSyncService on activation.
          if (!container.isRegistered(SDK_PLUGIN_LOADER)) {
            return undefined;
          }
          try {
            const pluginLoader = container.resolve<{
              getWorkspacePluginConfig(): {
                enabledPluginIds: string[];
              };
              resolvePluginPaths(pluginIds: string[]): string[];
            }>(SDK_PLUGIN_LOADER);
            const config = pluginLoader.getWorkspacePluginConfig();
            if (
              !config.enabledPluginIds ||
              config.enabledPluginIds.length === 0
            ) {
              return undefined;
            }
            return pluginLoader.resolvePluginPaths(config.enabledPluginIds);
          } catch {
            return undefined;
          }
        },
        getPtahCliRegistry: () => {
          // Resolve PtahCliRegistry lazily via DI (same pattern as SDK_SESSION_LIFECYCLE_MANAGER).
          // Avoids hard dependency from vscode-lm-tools -> agent-sdk.
          if (!container.isRegistered(SDK_PTAH_CLI_REGISTRY)) {
            return undefined;
          }
          try {
            return container.resolve<{
              listAgents(): Promise<
                Array<{
                  id: string;
                  name: string;
                  providerName: string;
                  hasApiKey: boolean;
                  enabled: boolean;
                }>
              >;
              spawnAgent(
                id: string,
                task: string,
                options?: {
                  projectGuidance?: string;
                  workingDirectory?: string;
                },
              ): Promise<
                | {
                    handle: {
                      abort: AbortController;
                      done: Promise<number>;
                      onOutput: (cb: (data: string) => void) => void;
                    };
                    agentName: string;
                  }
                | {
                    status:
                      | 'not_found'
                      | 'disabled'
                      | 'no_api_key'
                      | 'unknown_provider';
                    message: string;
                  }
              >;
            }>(SDK_PTAH_CLI_REGISTRY);
          } catch {
            return undefined;
          }
        },
      }),

      // Web search namespace (TASK_2025_189 - Gemini CLI web search)
      webSearch: new WebSearchService({
        cliDetectionService: this.cliDetectionService,
        logger: this.logger,
      }),

      // Help method at root level (ptah.help())
      help: buildHelpMethod(),
    };
  }

  /**
   * Get the workspace root path
   * Falls back to current working directory if no workspace is open
   */
  private getWorkspaceRoot(): string {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (workspaceRoot) {
      return workspaceRoot;
    }
    // Fallback to current working directory
    return process.cwd();
  }
}
