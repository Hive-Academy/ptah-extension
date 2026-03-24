/**
 * Core Namespace Builders
 *
 * Provides workspace analysis, file search, and diagnostics.
 * These are the foundational namespaces for codebase exploration.
 *
 * APPROVED EXCEPTION: This file retains `import * as vscode from 'vscode'`
 * because buildDiagnosticsNamespace() uses vscode.languages.getDiagnostics()
 * and vscode.DiagnosticSeverity. These are VS Code-specific IDE APIs
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
  DiagnosticsNamespace,
  DiagnosticInfo,
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

// ========================================
// Helper Functions
// ========================================

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
