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
  DEFAULT_WORKSPACE_EXCLUDES,
} from '@ptah-extension/workspace-intelligence';
import type {
  IDiagnosticsProvider,
  IWorkspaceProvider,
  IFileSystemProvider,
  DiagnosticsResult,
  FileDiagnostics,
} from '@ptah-extension/platform-core';
import { CorrelationId } from '@ptah-extension/shared';
import {
  WorkspaceNamespace,
  SearchNamespace,
  DiagnosticsNamespace,
  DiagnosticsPayload,
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
  /**
   * Filesystem provider for true glob discovery (`ptah_search_files`).
   * Routed through `coreDeps` from `PtahAPIBuilder` (TASK_2026_299).
   */
  fileSystemProvider: IFileSystemProvider;
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
 * Normalize an absolute path to a workspace-relative path with forward slashes.
 * Returns the original path (forward-slashed) if the root prefix is not present.
 */
function toWorkspaceRelative(
  absolutePath: string,
  root: string | undefined,
): string {
  const normPath = absolutePath.replace(/\\/g, '/');
  if (!root) return normPath;
  const normRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  if (normPath.startsWith(normRoot + '/')) {
    return normPath.slice(normRoot.length + 1);
  }
  if (normPath === normRoot) return '';
  return normPath;
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
 * Build file search namespace.
 *
 * `findFiles` is a TRUE filesystem glob — it delegates to
 * `IFileSystemProvider.findFiles()` with `DEFAULT_WORKSPACE_EXCLUDES` and the
 * session root as `cwd`. Results are normalized to workspace-relative paths.
 * Errors propagate to the MCP dispatcher's `isError: true` handler (TASK_2026_299).
 *
 * `getRelevantFiles` stays fuzzy (delegates to `ContextOrchestrationService`),
 * but propagates thrown and `{ success: false }` failures instead of swallowing.
 */
export function buildSearchNamespace(
  deps: CoreNamespaceDependencies,
): SearchNamespace {
  const { contextOrchestration, workspaceProvider, fileSystemProvider } = deps;

  return {
    findFiles: async (pattern: string, limit = 20) => {
      const root = resolveRootPerCall(workspaceProvider);
      const absolutePaths = await fileSystemProvider.findFiles(
        pattern,
        [...DEFAULT_WORKSPACE_EXCLUDES],
        limit,
        root,
      );
      return absolutePaths
        .map((p) => toWorkspaceRelative(p, root))
        .filter((p) => p.length > 0);
    },
    getRelevantFiles: async (query: string, maxFiles = 10) => {
      const result = await contextOrchestration.getFileSuggestions({
        requestId: `mcp-relevant-${Date.now()}` as CorrelationId,
        query,
        limit: maxFiles,
        workspaceRoot: resolveRootPerCall(workspaceProvider),
      });
      // `getFileSuggestions` catches internally and RESOLVES with
      // `{ success: false, error }` rather than throwing, so a resolved
      // failure must be propagated explicitly or it degrades to `[]` —
      // indistinguishable from "no relevant files" (TASK_2026_299).
      if (result.success === false) {
        throw new Error(
          result.error?.message ?? 'getFileSuggestions failed for query.',
        );
      }
      return (result.files || [])
        .filter((s: { relativePath?: string }) => s != null)
        .map((s: { relativePath?: string }) => s.relativePath || String(s));
    },
  };
}

/**
 * Build diagnostics namespace.
 *
 * Calls `diagnosticsProvider.getDiagnostics(root)` (async, capability-aware)
 * and flattens the result into `DiagnosticsPayload` — preserving status,
 * source, and reason so the formatter can distinguish unavailable from clean.
 */
export function buildDiagnosticsNamespace(
  diagnosticsProvider: IDiagnosticsProvider,
  workspaceProvider: IWorkspaceProvider,
): DiagnosticsNamespace {
  const getPayload = async (
    severityFilter?: 'error' | 'warning',
  ): Promise<DiagnosticsPayload> => {
    const root = resolveRootPerCall(workspaceProvider);
    const result: DiagnosticsResult =
      await diagnosticsProvider.getDiagnostics(root);

    if (result.status === 'unavailable') {
      return {
        status: 'unavailable',
        source: result.source,
        reason: result.reason,
        diagnostics: [],
      };
    }

    const diagnostics: DiagnosticInfo[] = [];
    for (const entry of result.diagnostics as FileDiagnostics[]) {
      for (const d of entry.diagnostics) {
        if (severityFilter && d.severity !== severityFilter) continue;
        diagnostics.push({
          file: entry.file,
          message: d.message,
          line: d.line,
          severity: d.severity,
          ...(d.code !== undefined ? { code: d.code } : {}),
        });
      }
    }

    return {
      status: 'available',
      source: result.source,
      diagnostics,
    };
  };

  return {
    getErrors: () => getPayload('error'),
    getWarnings: () => getPayload('warning'),
    getAll: () => getPayload(undefined),
  };
}
