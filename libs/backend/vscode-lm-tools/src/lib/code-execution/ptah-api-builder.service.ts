/**
 * Ptah API Builder Service
 *
 * Constructs the complete "ptah" API object with 15 namespaces for code execution context.
 * Delegates to specialized namespace builders for each domain:
 *
 * Core (workspace discovery):
 * - workspace: analysis, project type, frameworks detection
 * - search: file search and relevance
 * - symbols: workspace symbol search
 * - diagnostics: errors, warnings, all diagnostics
 * - git: repository status
 *
 * System (VS Code integration):
 * - ai: multi-agent VS Code LM API access
 * - files: read, list operations
 * - commands: execute VS Code commands
 *
 * Analysis (workspace intelligence):
 * - context: token budget management and optimization
 * - project: monorepo detection, dependencies
 * - relevance: file scoring with explanations
 *
 * AST (code structure):
 * - ast: tree-sitter based code analysis
 *
 * TASK_2025_025: Expanded from 8 to 12 namespaces for better Claude discoverability
 */

import * as vscode from 'vscode';
import { injectable, inject, container } from 'tsyringe';
import {
  TOKENS,
  Logger,
  FileSystemManager,
  CommandManager,
} from '@ptah-extension/vscode-core';
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
} from '@ptah-extension/workspace-intelligence';
import { PtahAPI } from './types';
import {
  // Core namespace builders
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildSymbolsNamespace,
  buildDiagnosticsNamespace,
  buildGitNamespace,
  // System namespace builders
  buildAINamespace,
  buildFilesNamespace,
  buildCommandsNamespace,
  buildHelpMethod,
  // Analysis namespace builders
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  // AST namespace builder
  buildAstNamespace,
  // IDE namespace builder (TASK_2025_039)
  buildIDENamespace,
  // LLM namespace builder (VS Code LM provider)
  buildLLMNamespace,
  // Orchestration namespace builder (TASK_2025_111)
  buildOrchestrationNamespace,
  // Agent namespace builder (TASK_2025_157)
  buildAgentNamespace,
} from './namespace-builders';
import {
  LlmService,
  LlmConfigurationService,
  ILlmSecretsService,
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

    @inject(TOKENS.COMMAND_MANAGER)
    private readonly commandManager: CommandManager,

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

    // AST services
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly treeSitterParser: TreeSitterParserService,

    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,

    // LLM services
    @inject(TOKENS.LLM_SERVICE)
    private readonly llmService: LlmService,

    @inject(TOKENS.LLM_CONFIGURATION_SERVICE)
    private readonly llmConfigService: LlmConfigurationService,

    @inject(TOKENS.LLM_SECRETS_SERVICE)
    private readonly llmSecretsService: ILlmSecretsService,

    // Agent orchestration services (TASK_2025_157)
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,

    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetectionService: CliDetectionService
  ) {
    this.logger.info('PtahAPIBuilder initialized with 16 namespaces');
  }

  /**
   * Build the complete Ptah API object with all 16 namespaces
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
      commandManager: this.commandManager,
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
    };

    const astDeps = {
      treeSitterParser: this.treeSitterParser,
      astAnalysis: this.astAnalysis,
      fileSystemManager: this.fileSystemManager,
    };

    const llmDeps = {
      llmService: this.llmService,
      configService: this.llmConfigService,
      secretsService: this.llmSecretsService,
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
      symbols: buildSymbolsNamespace(),
      diagnostics: buildDiagnosticsNamespace(),
      git: buildGitNamespace(),

      // System namespaces (VS Code integration)
      ai: buildAINamespace(),
      files: buildFilesNamespace(systemDeps),
      commands: buildCommandsNamespace(),

      // Analysis namespaces (workspace intelligence)
      context: buildContextNamespace(analysisDeps),
      project: buildProjectNamespace(analysisDeps),
      relevance: buildRelevanceNamespace(analysisDeps),

      // AST namespace (code structure)
      ast: buildAstNamespace(astDeps),

      // IDE namespace (TASK_2025_039 - LSP, editor, actions, testing)
      ide: buildIDENamespace(),

      // LLM namespace (VS Code LM provider)
      llm: buildLLMNamespace(llmDeps),

      // Orchestration namespace (TASK_2025_111 - workflow state management)
      orchestration: buildOrchestrationNamespace(orchestrationDeps),

      // Agent orchestration namespace (TASK_2025_157, session linking TASK_2025_161)
      agent: buildAgentNamespace({
        agentProcessManager: this.agentProcessManager,
        cliDetectionService: this.cliDetectionService,
        workspaceRoot: workspaceRoot.fsPath,
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
                workspacePath: string
              ): Promise<string | null>;
            }>(SDK_ENHANCED_PROMPTS_SERVICE);
            const workspacePath = this.getWorkspaceRoot().fsPath;
            const content = await service.getProjectGuidanceContent(
              workspacePath
            );
            return content ?? undefined;
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
                projectGuidance?: string
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

      // Help method at root level (ptah.help())
      help: buildHelpMethod(),
    };
  }

  /**
   * Get the workspace root URI
   * Falls back to current working directory if no workspace is open
   */
  private getWorkspaceRoot(): vscode.Uri {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri;
    }
    // Fallback to current working directory
    return vscode.Uri.file(process.cwd());
  }
}
