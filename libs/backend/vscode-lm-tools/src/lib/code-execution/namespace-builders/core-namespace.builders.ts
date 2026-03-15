/**
 * Core Namespace Builders
 *
 * Provides workspace analysis, file search, symbol search, diagnostics, and git status.
 * These are the foundational namespaces for codebase exploration.
 *
 * APPROVED EXCEPTION: This file retains `import * as vscode from 'vscode'`
 * because buildSymbolsNamespace() uses vscode.commands.executeCommand for workspace
 * symbol provider, buildDiagnosticsNamespace() uses vscode.languages.getDiagnostics()
 * and vscode.DiagnosticSeverity, and buildGitNamespace() uses
 * vscode.extensions.getExtension('vscode.git'). These are VS Code-specific IDE APIs
 * with no platform-core equivalent. The buildWorkspaceNamespace() and
 * buildSearchNamespace() functions are already platform-agnostic (use injected services).
 */

import * as vscode from 'vscode';
import {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
} from '@ptah-extension/workspace-intelligence';
import { CorrelationId } from '@ptah-extension/shared';
import {
  WorkspaceNamespace,
  SearchNamespace,
  SymbolsNamespace,
  DiagnosticsNamespace,
  DiagnosticInfo,
  GitNamespace,
  GitStatus,
} from '../types';

/**
 * Dependencies required for core namespaces
 */
export interface CoreNamespaceDependencies {
  workspaceAnalyzer: WorkspaceAnalyzerService;
  contextOrchestration: ContextOrchestrationService;
}

/**
 * Build workspace analysis namespace
 * Delegates to WorkspaceAnalyzerService
 */
export function buildWorkspaceNamespace(
  deps: CoreNamespaceDependencies
): WorkspaceNamespace {
  const { workspaceAnalyzer } = deps;

  return {
    analyze: async () => {
      const [info, structure, projectInfo] = await Promise.all([
        workspaceAnalyzer.getCurrentWorkspaceInfo(),
        workspaceAnalyzer.analyzeWorkspaceStructure(),
        workspaceAnalyzer.getProjectInfo().catch(() => undefined),
      ]);
      return { info, structure, projectInfo };
    },
    getInfo: async () => workspaceAnalyzer.getCurrentWorkspaceInfo(),
    getProjectType: async () => {
      const info = await workspaceAnalyzer.getCurrentWorkspaceInfo();
      return info?.projectType || 'unknown';
    },
    getFrameworks: async () => {
      const info = await workspaceAnalyzer.getCurrentWorkspaceInfo();
      return info?.frameworks ? [...info.frameworks] : [];
    },
  };
}

/**
 * Build file search namespace
 * Delegates to ContextOrchestrationService
 */
export function buildSearchNamespace(
  deps: CoreNamespaceDependencies
): SearchNamespace {
  const { contextOrchestration } = deps;

  return {
    findFiles: async (pattern: string, limit = 20) => {
      try {
        const result = await contextOrchestration.searchFiles({
          requestId: `mcp-search-${Date.now()}` as CorrelationId,
          query: pattern,
          includeImages: false,
          maxResults: limit,
        });
        return (result.results || [])
          .filter((r) => r != null)
          .map((r) => r.relativePath || String(r));
      } catch {
        return [];
      }
    },
    getRelevantFiles: async (query: string, maxFiles = 10) => {
      try {
        const result = await contextOrchestration.getFileSuggestions({
          requestId: `mcp-relevant-${Date.now()}` as CorrelationId,
          query,
          limit: maxFiles,
        });
        return (result.suggestions || [])
          .filter((s) => s != null)
          .map((s) => s.relativePath || String(s));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Build symbol search namespace
 * Uses VS Code's workspace symbol provider API
 */
export function buildSymbolsNamespace(): SymbolsNamespace {
  return {
    find: async (name: string, type?: string) => {
      const symbols = await vscode.commands.executeCommand<
        vscode.SymbolInformation[]
      >('vscode.executeWorkspaceSymbolProvider', name);
      if (!symbols) return [];
      if (type) {
        const symbolKind = parseSymbolKind(type);
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
export function buildDiagnosticsNamespace(): DiagnosticsNamespace {
  return {
    getErrors: async () => {
      return getDiagnosticsByLevel(vscode.DiagnosticSeverity.Error);
    },
    getWarnings: async () => {
      return getDiagnosticsByLevel(vscode.DiagnosticSeverity.Warning);
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
            severity: severityToString(d.severity),
          }))
        );
      }
      return all;
    },
  };
}

/** Git extension status code for untracked files */
const GIT_STATUS_UNTRACKED = 7;

/** Shape of a git extension change object (VS Code git extension API is untyped) */
interface GitChange {
  uri?: { fsPath: string };
  status?: number;
}

/**
 * Build git status namespace
 * Uses VS Code's git extension API
 */
export function buildGitNamespace(): GitNamespace {
  return {
    getStatus: async () => {
      try {
        const gitExtension =
          vscode.extensions.getExtension('vscode.git')?.exports;
        if (!gitExtension) {
          return { branch: 'unknown', modified: [], staged: [], untracked: [] };
        }
        const git = gitExtension.getAPI(1);
        const repo = git.repositories[0];
        if (!repo) {
          return { branch: 'unknown', modified: [], staged: [], untracked: [] };
        }

        const status: GitStatus = {
          branch: repo.state.HEAD?.name || 'unknown',
          modified: ((repo.state.workingTreeChanges || []) as GitChange[])
            .filter((c): c is GitChange & { uri: { fsPath: string } } =>
              Boolean(c?.uri?.fsPath)
            )
            .map((c) => c.uri.fsPath),
          staged: ((repo.state.indexChanges || []) as GitChange[])
            .filter((c): c is GitChange & { uri: { fsPath: string } } =>
              Boolean(c?.uri?.fsPath)
            )
            .map((c) => c.uri.fsPath),
          untracked: ((repo.state.workingTreeChanges || []) as GitChange[])
            .filter(
              (c): c is GitChange & { uri: { fsPath: string } } =>
                c?.status === GIT_STATUS_UNTRACKED && Boolean(c?.uri?.fsPath)
            )
            .map((c) => c.uri.fsPath),
        };
        return status;
      } catch {
        return { branch: 'unknown', modified: [], staged: [], untracked: [] };
      }
    },
  };
}

// ========================================
// Helper Functions
// ========================================

/**
 * Parse string symbol type to VS Code SymbolKind enum
 */
function parseSymbolKind(type: string): vscode.SymbolKind {
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
function severityToString(severity: vscode.DiagnosticSeverity): string {
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
function getDiagnosticsByLevel(
  severity: vscode.DiagnosticSeverity
): DiagnosticInfo[] {
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
