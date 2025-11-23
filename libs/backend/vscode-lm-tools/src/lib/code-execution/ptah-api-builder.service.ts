/**
 * Ptah API Builder Service
 *
 * Constructs the complete "ptah" API object with 7 namespaces for code execution context.
 * Delegates to workspace-intelligence services and VS Code APIs to provide:
 * - workspace: analysis, project type, frameworks detection
 * - search: file search and relevance
 * - symbols: workspace symbol search
 * - diagnostics: errors, warnings, all diagnostics
 * - git: repository status
 * - ai: multi-agent VS Code LM API access
 * - files: read, list operations
 * - commands: execute VS Code commands
 *
 * Pattern: Injectable service with DI (analyze-workspace.tool.ts:17-24)
 */

import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger, FileSystemManager, CommandManager } from '@ptah-extension/vscode-core';
import {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
  FileIndexerService,
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
} from './types';

@injectable()
export class PtahAPIBuilder {
  constructor(
    @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)
    private readonly workspaceAnalyzer: WorkspaceAnalyzerService,

    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,

    @inject(TOKENS.FILE_INDEXER_SERVICE)
    private readonly fileIndexer: FileIndexerService,

    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,

    @inject(TOKENS.FILE_SYSTEM_MANAGER)
    private readonly fileSystemManager: FileSystemManager,

    @inject(TOKENS.COMMAND_MANAGER)
    private readonly commandManager: CommandManager
  ) {}

  /**
   * Build complete ptah API object for code execution context
   * Returns object with 7 namespaces exposing extension capabilities
   */
  buildAPI(): PtahAPI {
    return {
      workspace: this.buildWorkspaceNamespace(),
      search: this.buildSearchNamespace(),
      symbols: this.buildSymbolsNamespace(),
      diagnostics: this.buildDiagnosticsNamespace(),
      git: this.buildGitNamespace(),
      ai: this.buildAINamespace(),
      files: this.buildFilesNamespace(),
      commands: this.buildCommandsNamespace(),
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
        return info?.frameworks || [];
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
        const result = await this.contextOrchestration.getRelevantFiles({
          requestId: `mcp-relevant-${Date.now()}` as CorrelationId,
          query,
          maxFiles,
        });
        return result.files || [];
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
          modified: repo.state.workingTreeChanges.map(
            (c: any) => c.uri.fsPath
          ),
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
        return models.map((m) => ({ id: m.id, family: m.family, name: m.name }));
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
        return content;
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
