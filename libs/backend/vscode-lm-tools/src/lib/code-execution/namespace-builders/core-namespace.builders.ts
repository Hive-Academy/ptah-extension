/**
 * Core Namespace Builders
 *
 * Provides workspace analysis, file search, and diagnostics.
 * These are the foundational namespaces for codebase exploration.
 * All functions are platform-agnostic — diagnostics use IDiagnosticsProvider
 * injected from platform-core (VS Code or Electron implementation).
 */

import {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
} from '@ptah-extension/workspace-intelligence';
import type { IDiagnosticsProvider } from '@ptah-extension/platform-core';
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
  deps: CoreNamespaceDependencies,
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
  deps: CoreNamespaceDependencies,
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
        return (result.files || [])
          .filter((s: { relativePath?: string }) => s != null)
          .map((s: { relativePath?: string }) => s.relativePath || String(s));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Build diagnostics namespace
 * Delegates to IDiagnosticsProvider for platform-agnostic diagnostics access
 */
export function buildDiagnosticsNamespace(
  diagnosticsProvider: IDiagnosticsProvider,
): DiagnosticsNamespace {
  return {
    getErrors: async () => {
      const fileDiagnostics = diagnosticsProvider.getDiagnostics();
      const errors: DiagnosticInfo[] = [];
      for (const entry of fileDiagnostics) {
        errors.push(
          ...entry.diagnostics
            .filter((d) => d.severity === 'error')
            .map((d) => ({
              file: entry.file,
              message: d.message,
              line: d.line,
            })),
        );
      }
      return errors;
    },
    getWarnings: async () => {
      const fileDiagnostics = diagnosticsProvider.getDiagnostics();
      const warnings: DiagnosticInfo[] = [];
      for (const entry of fileDiagnostics) {
        warnings.push(
          ...entry.diagnostics
            .filter((d) => d.severity === 'warning')
            .map((d) => ({
              file: entry.file,
              message: d.message,
              line: d.line,
            })),
        );
      }
      return warnings;
    },
    getAll: async () => {
      const fileDiagnostics = diagnosticsProvider.getDiagnostics();
      const all: DiagnosticInfo[] = [];
      for (const entry of fileDiagnostics) {
        all.push(
          ...entry.diagnostics.map((d) => ({
            file: entry.file,
            message: d.message,
            line: d.line,
            severity: d.severity,
          })),
        );
      }
      return all;
    },
  };
}
