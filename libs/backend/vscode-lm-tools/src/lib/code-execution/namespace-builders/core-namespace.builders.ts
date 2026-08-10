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
import type {
  IDiagnosticsProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
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
  /**
   * Session-aware workspace provider supplied by `PtahAPIBuilder.build()`.
   * `getWorkspaceRoot()` resolves the CALLING session's root, so it MUST be
   * consulted once per tool invocation — see `resolveRootPerCall` below.
   */
  workspaceProvider: IWorkspaceProvider;
}

/**
 * Resolve the calling session's workspace root.
 *
 * TASK_2026_200 — this MUST be evaluated inside each tool method, never hoisted
 * to build time. `PtahAPIBuilder` builds the namespace object once per process
 * but the provider is session-aware: its answer changes per MCP caller. Caching
 * the value at build time would pin every subsequent call to whichever session
 * happened to be active during `build()`, which is the exact silent-wrong-root
 * defect this task exists to remove (context.md §2).
 *
 * `undefined` is passed straight through: the downstream services treat an
 * absent root as "use the process-global active folder", which is the pre-fix
 * behaviour and the documented fallback.
 */
function resolveRootPerCall(
  workspaceProvider: IWorkspaceProvider,
): string | undefined {
  return workspaceProvider.getWorkspaceRoot();
}

/**
 * Build workspace analysis namespace
 * Delegates to WorkspaceAnalyzerService
 */
export function buildWorkspaceNamespace(
  deps: CoreNamespaceDependencies,
): WorkspaceNamespace {
  const { workspaceAnalyzer, workspaceProvider } = deps;

  return {
    analyze: async () => {
      const root = resolveRootPerCall(workspaceProvider);
      const [info, structure, projectInfo] = await Promise.all([
        workspaceAnalyzer.getCurrentWorkspaceInfo(root),
        workspaceAnalyzer.analyzeWorkspaceStructure(root),
        workspaceAnalyzer.getProjectInfo(root).catch(() => undefined),
      ]);
      return { info, structure, projectInfo };
    },
    getInfo: async () =>
      workspaceAnalyzer.getCurrentWorkspaceInfo(
        resolveRootPerCall(workspaceProvider),
      ),
    getProjectType: async () => {
      const info = await workspaceAnalyzer.getCurrentWorkspaceInfo(
        resolveRootPerCall(workspaceProvider),
      );
      return info?.projectType || 'unknown';
    },
    getFrameworks: async () => {
      const info = await workspaceAnalyzer.getCurrentWorkspaceInfo(
        resolveRootPerCall(workspaceProvider),
      );
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
  const { contextOrchestration, workspaceProvider } = deps;

  return {
    // `ptah_search_files` reaches `searchFiles` (NOT `getAllFiles`), which is
    // why task 2.3 extended `SearchFilesRequest` with `workspaceRoot`. Passing
    // it makes the shared file index rebuild for the calling session's root, or
    // fail loudly on a lost race — it can never answer with another root's
    // files (plan risk R5; concurrency limits per context.md §7.2).
    findFiles: async (pattern: string, limit = 20) => {
      try {
        const result = await contextOrchestration.searchFiles({
          requestId: `mcp-search-${Date.now()}` as CorrelationId,
          query: pattern,
          includeImages: false,
          maxResults: limit,
          workspaceRoot: resolveRootPerCall(workspaceProvider),
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
          workspaceRoot: resolveRootPerCall(workspaceProvider),
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
