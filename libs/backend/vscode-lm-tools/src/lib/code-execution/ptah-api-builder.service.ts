/**
 * Ptah API Builder Service
 *
 * Constructs the complete "ptah" API object with 16 namespaces for code execution context.
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
import { injectable, inject } from 'tsyringe';
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
  // LLM namespace builder (native SDK abstraction)
  buildLLMNamespace,
  // Image namespace builder (TASK_2025_155)
  buildImageNamespace,
  // Orchestration namespace builder (TASK_2025_111)
  buildOrchestrationNamespace,
} from './namespace-builders';
import {
  LlmService,
  LlmConfigurationService,
  ILlmSecretsService,
} from '@ptah-extension/llm-abstraction';
import { ImageGenerationService } from './services/image-generation.service';

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

    // LLM services (Langchain abstraction)
    @inject(TOKENS.LLM_SERVICE)
    private readonly llmService: LlmService,

    @inject(TOKENS.LLM_CONFIGURATION_SERVICE)
    private readonly llmConfigService: LlmConfigurationService,

    @inject(TOKENS.LLM_SECRETS_SERVICE)
    private readonly llmSecretsService: ILlmSecretsService,

    // Image generation service (TASK_2025_155)
    @inject(TOKENS.IMAGE_GENERATION_SERVICE)
    private readonly imageGenerationService: ImageGenerationService
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

      // LLM namespace (Langchain provider abstraction)
      llm: buildLLMNamespace(llmDeps),

      // Image namespace (TASK_2025_155 - Google image generation)
      image: buildImageNamespace({
        imageGenerationService: this.imageGenerationService,
      }),

      // Orchestration namespace (TASK_2025_111 - workflow state management)
      orchestration: buildOrchestrationNamespace(orchestrationDeps),

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
