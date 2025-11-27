/**
 * Ptah API Builder Service
 *
 * Constructs the complete "ptah" API object with 11 namespaces for code execution context.
 * Delegates to workspace-intelligence services and VS Code APIs to provide:
 * - workspace: analysis, project type, frameworks detection
 * - search: file search and relevance
 * - symbols: workspace symbol search
 * - diagnostics: errors, warnings, all diagnostics
 * - git: repository status
 * - ai: multi-agent VS Code LM API access
 * - files: read, list operations
 * - commands: execute VS Code commands
 * - context: token budget management and optimization (NEW)
 * - project: monorepo detection, dependencies (NEW)
 * - relevance: file scoring with explanations (NEW)
 *
 * TASK_2025_025: Expanded from 8 to 11 namespaces for better Claude discoverability
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
} from '@ptah-extension/workspace-intelligence';
import { CorrelationId } from '@ptah-extension/shared';
import {
  PtahAPI,
  WorkspaceNamespace,
  SearchNamespace,
  SymbolsNamespace,
  DiagnosticsNamespace,
  DiagnosticInfo,
  GitNamespace,
  GitStatus,
  AINamespace,
  FilesNamespace,
  CommandsNamespace,
  ContextNamespace,
  ProjectNamespace,
  RelevanceNamespace,
  OptimizedContextResult,
  MonorepoResult,
  DependencyResult,
  FileRelevanceResult,
} from './types';

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

    // New service injections (TASK_2025_025)
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
    private readonly projectDetector: ProjectDetectorService
  ) {}

  /**
   * Build complete ptah API object for code execution context
   * Returns object with 11 namespaces exposing extension capabilities
   */
  buildAPI(): PtahAPI {
    return {
      // Original 8 namespaces
      workspace: this.buildWorkspaceNamespace(),
      search: this.buildSearchNamespace(),
      symbols: this.buildSymbolsNamespace(),
      diagnostics: this.buildDiagnosticsNamespace(),
      git: this.buildGitNamespace(),
      ai: this.buildAINamespace(),
      files: this.buildFilesNamespace(),
      commands: this.buildCommandsNamespace(),

      // New namespaces (TASK_2025_025)
      context: this.buildContextNamespace(),
      project: this.buildProjectNamespace(),
      relevance: this.buildRelevanceNamespace(),
    };
  }

  /**
   * Build workspace analysis namespace
   * Delegates to WorkspaceAnalyzerService (same as AnalyzeWorkspaceTool)
   */
  private buildWorkspaceNamespace(): WorkspaceNamespace {
    return {
      analyze: async () => {
        const info = await this.workspaceAnalyzer.getCurrentWorkspaceInfo();
        const structure =
          await this.workspaceAnalyzer.analyzeWorkspaceStructure();
        return { info, structure };
      },
      getInfo: async () => this.workspaceAnalyzer.getCurrentWorkspaceInfo(),
      getProjectType: async () => {
        const info = await this.workspaceAnalyzer.getCurrentWorkspaceInfo();
        return info?.projectType || 'unknown';
      },
      getFrameworks: async () => {
        const info = await this.workspaceAnalyzer.getCurrentWorkspaceInfo();
        return info?.frameworks ? [...info.frameworks] : [];
      },
    };
  }

  /**
   * Build file search namespace
   * Delegates to ContextOrchestrationService
   */
  private buildSearchNamespace(): SearchNamespace {
    return {
      findFiles: async (pattern: string, limit = 20) => {
        const result = await this.contextOrchestration.searchFiles({
          requestId: `mcp-search-${Date.now()}` as CorrelationId,
          query: pattern,
          includeImages: false,
          maxResults: limit,
        });
        return result.results || [];
      },
      getRelevantFiles: async (query: string, maxFiles = 10) => {
        const result = await this.contextOrchestration.getFileSuggestions({
          requestId: `mcp-relevant-${Date.now()}` as CorrelationId,
          query,
          limit: maxFiles,
        });
        return result.suggestions || [];
      },
    };
  }

  /**
   * Build symbol search namespace
   * Uses VS Code's workspace symbol provider API
   */
  private buildSymbolsNamespace(): SymbolsNamespace {
    return {
      find: async (name: string, type?: string) => {
        const symbols = await vscode.commands.executeCommand<
          vscode.SymbolInformation[]
        >('vscode.executeWorkspaceSymbolProvider', name);
        if (!symbols) return [];
        if (type) {
          const symbolKind = this.parseSymbolKind(type);
          return symbols.filter((s) => s.kind === symbolKind);
        }
        return symbols;
      },
    };
  }

  /**
   * Build diagnostics namespace
   * Uses VS Code's language diagnostics API
   */
  private buildDiagnosticsNamespace(): DiagnosticsNamespace {
    return {
      getErrors: async () => {
        return this.getDiagnosticsByLevel(vscode.DiagnosticSeverity.Error);
      },
      getWarnings: async () => {
        return this.getDiagnosticsByLevel(vscode.DiagnosticSeverity.Warning);
      },
      getAll: async () => {
        const diagnostics = vscode.languages.getDiagnostics();
        const all: DiagnosticInfo[] = [];
        for (const [uri, diags] of diagnostics) {
          all.push(
            ...diags.map((d) => ({
              file: uri.fsPath,
              message: d.message,
              line: d.range.start.line,
              severity: this.severityToString(d.severity),
            }))
          );
        }
        return all;
      },
    };
  }

  /**
   * Build git status namespace
   * Uses VS Code's git extension API
   */
  private buildGitNamespace(): GitNamespace {
    return {
      getStatus: async () => {
        const gitExtension =
          vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
          throw new Error('Git extension not available');
        }
        const git = gitExtension.getAPI(1);
        const repo = git.repositories[0];
        if (!repo) {
          throw new Error('No git repository found');
        }

        const status: GitStatus = {
          branch: repo.state.HEAD?.name || 'unknown',
          modified: repo.state.workingTreeChanges.map((c: any) => c.uri.fsPath),
          staged: repo.state.indexChanges.map((c: any) => c.uri.fsPath),
          untracked: repo.state.workingTreeChanges
            .filter((c: any) => c.status === 7) // Untracked = 7
            .map((c: any) => c.uri.fsPath),
        };
        return status;
      },
    };
  }

  /**
   * Build AI namespace (MULTI-AGENT SUPPORT)
   * Exposes VS Code Language Model API for Claude CLI → VS Code LM delegation
   */
  private buildAINamespace(): AINamespace {
    return {
      chat: async (message: string, model?: string) => {
        const models = await vscode.lm.selectChatModels({ family: model });
        if (models.length === 0) {
          throw new Error(
            `No language model found${model ? ` for family: ${model}` : ''}`
          );
        }

        const selectedModel = models[0];
        const messages = [vscode.LanguageModelChatMessage.User(message)];
        const response = await selectedModel.sendRequest(messages);

        let fullResponse = '';
        for await (const chunk of response.text) {
          fullResponse += chunk;
        }
        return fullResponse;
      },
      selectModel: async (family?: string) => {
        const models = await vscode.lm.selectChatModels(
          family ? { family } : undefined
        );
        return models.map((m) => ({
          id: m.id,
          family: m.family,
          name: m.name,
        }));
      },
    };
  }

  /**
   * Build files namespace
   * Delegates to FileSystemManager
   */
  private buildFilesNamespace(): FilesNamespace {
    return {
      read: async (path: string) => {
        const uri = vscode.Uri.file(path);
        const content = await this.fileSystemManager.readFile(uri);
        // Convert Uint8Array to string
        return new TextDecoder('utf-8').decode(content);
      },
      list: async (directory: string) => {
        const uri = vscode.Uri.file(directory);
        const entries = await this.fileSystemManager.readDirectory(uri);
        return entries.map(([name, type]) => ({
          name,
          type: type === vscode.FileType.Directory ? 'directory' : 'file',
        }));
      },
    };
  }

  /**
   * Build commands namespace
   * Uses VS Code's commands API
   */
  private buildCommandsNamespace(): CommandsNamespace {
    return {
      execute: async (commandId: string, ...args: any[]) => {
        return await vscode.commands.executeCommand(commandId, ...args);
      },
      list: async () => {
        const commands = await vscode.commands.getCommands();
        return commands.filter((c) => c.startsWith('ptah.'));
      },
    };
  }

  // ========================================
  // New Namespace Builders (TASK_2025_025)
  // ========================================

  /**
   * Build context optimization namespace
   * Manages token budgets and intelligent file selection
   */
  private buildContextNamespace(): ContextNamespace {
    return {
      optimize: async (
        query: string,
        maxTokens = 150000
      ): Promise<OptimizedContextResult> => {
        // Index workspace files with token estimation
        const index = await this.workspaceIndexer.indexWorkspace({
          estimateTokens: true,
          respectIgnoreFiles: true,
        });

        // Optimize context
        const result = await this.contextOptimizer.optimizeContext({
          files: index.files,
          query,
          maxTokens,
          responseReserve: 50000,
        });

        return {
          selectedFiles: result.selectedFiles.map((f) => ({
            path: f.path,
            relativePath: f.relativePath,
            size: f.size,
            estimatedTokens: f.estimatedTokens,
          })),
          totalTokens: result.totalTokens,
          tokensRemaining: result.tokensRemaining,
          stats: {
            totalFiles: result.stats.totalFiles,
            selectedFiles: result.stats.selectedFiles,
            excludedFiles: result.stats.excludedFiles,
            reductionPercentage: result.stats.reductionPercentage,
          },
        };
      },

      countTokens: async (text: string): Promise<number> => {
        return await this.tokenCounter.countTokens(text);
      },

      getRecommendedBudget: (
        projectType: 'monorepo' | 'library' | 'application' | 'unknown'
      ): number => {
        return this.contextOptimizer.getRecommendedBudget(projectType);
      },
    };
  }

  /**
   * Build project analysis namespace
   * Deep project analysis: monorepo detection, dependencies
   */
  private buildProjectNamespace(): ProjectNamespace {
    return {
      detectMonorepo: async (): Promise<MonorepoResult> => {
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceUri) {
          return {
            isMonorepo: false,
            type: '',
            workspaceFiles: [],
          };
        }

        const result = await this.monorepoDetector.detectMonorepo(workspaceUri);
        return {
          isMonorepo: result.isMonorepo,
          type: result.type || '',
          workspaceFiles: result.workspaceFiles,
          packageCount: result.packageCount,
        };
      },

      detectType: async (): Promise<string> => {
        const info = await this.workspaceAnalyzer.getCurrentWorkspaceInfo();
        return info?.projectType || 'unknown';
      },

      analyzeDependencies: async (): Promise<DependencyResult[]> => {
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceUri) {
          return [];
        }

        // Detect project type first (required by DependencyAnalyzerService)
        const projectType = await this.projectDetector.detectProjectType(
          workspaceUri
        );

        const analysis = await this.dependencyAnalyzer.analyzeDependencies(
          workspaceUri,
          projectType
        );
        return [
          ...analysis.dependencies.map((d) => ({
            name: d.name,
            version: d.version,
            isDev: false,
          })),
          ...analysis.devDependencies.map((d) => ({
            name: d.name,
            version: d.version,
            isDev: true,
          })),
        ];
      },
    };
  }

  /**
   * Build relevance scoring namespace
   * File ranking with transparent explanations
   */
  private buildRelevanceNamespace(): RelevanceNamespace {
    return {
      scoreFile: async (
        filePath: string,
        query: string
      ): Promise<FileRelevanceResult> => {
        // Index to get file info (needed for scoring)
        const index = await this.workspaceIndexer.indexWorkspace({
          estimateTokens: false,
          respectIgnoreFiles: true,
        });

        const file = index.files.find(
          (f) => f.relativePath === filePath || f.path === filePath
        );

        if (!file) {
          return {
            file: filePath,
            score: 0,
            reasons: ['File not found in workspace'],
          };
        }

        const result = this.relevanceScorer.scoreFile(file, query);
        return {
          file: file.relativePath,
          score: result.score,
          reasons: result.reasons,
        };
      },

      rankFiles: async (
        query: string,
        limit = 20
      ): Promise<FileRelevanceResult[]> => {
        // Index workspace
        const index = await this.workspaceIndexer.indexWorkspace({
          estimateTokens: false,
          respectIgnoreFiles: true,
        });

        // Get top files with reasons
        const results = this.relevanceScorer.getTopFiles(
          index.files,
          query,
          limit
        );

        return results.map((r) => ({
          file: r.file.relativePath,
          score: r.score,
          reasons: r.reasons,
        }));
      },
    };
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Parse string symbol type to VS Code SymbolKind enum
   */
  private parseSymbolKind(type: string): vscode.SymbolKind {
    const kindMap: Record<string, vscode.SymbolKind> = {
      class: vscode.SymbolKind.Class,
      function: vscode.SymbolKind.Function,
      method: vscode.SymbolKind.Method,
      interface: vscode.SymbolKind.Interface,
      variable: vscode.SymbolKind.Variable,
    };
    return kindMap[type.toLowerCase()] || vscode.SymbolKind.Variable;
  }

  /**
   * Convert VS Code DiagnosticSeverity enum to string
   */
  private severityToString(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'error';
      case vscode.DiagnosticSeverity.Warning:
        return 'warning';
      case vscode.DiagnosticSeverity.Information:
        return 'info';
      case vscode.DiagnosticSeverity.Hint:
        return 'hint';
      default:
        return 'unknown';
    }
  }

  /**
   * Get diagnostics filtered by severity level
   */
  private async getDiagnosticsByLevel(
    severity: vscode.DiagnosticSeverity
  ): Promise<DiagnosticInfo[]> {
    const diagnostics = vscode.languages.getDiagnostics();
    const filtered: DiagnosticInfo[] = [];
    for (const [uri, diags] of diagnostics) {
      filtered.push(
        ...diags
          .filter((d) => d.severity === severity)
          .map((d) => ({
            file: uri.fsPath,
            message: d.message,
            line: d.range.start.line,
          }))
      );
    }
    return filtered;
  }
}
