/**
 * Core Namespace Builders
 *
 * Provides workspace analysis, file search, and diagnostics.
 * These are the foundational namespaces for codebase exploration.
 * All functions are platform-agnostic — diagnostics use IDiagnosticsProvider
 * injected from platform-core (VS Code or Electron implementation).
 */

import * as path from 'path';
import {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
  DEFAULT_WORKSPACE_EXCLUDES,
} from '@ptah-extension/workspace-intelligence';
import { withCoverageVerdict } from '@ptah-extension/platform-core';
import type {
  IDiagnosticsProvider,
  IWorkspaceProvider,
  IFileSystemProvider,
  DiagnosticsResult,
  FileDiagnostics,
  LanguageCoverage,
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
      // degradation-audit: optional-capability - projectInfo is an enrichment
      // on top of the required info/structure results (which are left to reject
      // the whole call on failure); a missing package.json or manifest parse
      // error degrades to "no project info" rather than failing the whole
      // analyze() call.
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
      //
      // Truthiness, not `=== false`: `success` is a REQUIRED boolean on
      // `GetFileSuggestionsResult`, so an absent one is a malformed result and
      // should be rejected rather than read through. This had to be written
      // `=== false` in TASK_2026_299 only because two mocks in this builder's
      // spec omitted `success` entirely; they now carry it (TASK_2026_303).
      if (!result.success) {
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
 * Calls `diagnosticsProvider.getDiagnostics(root, scope)` (async,
 * capability-aware) and flattens the result into `DiagnosticsPayload` —
 * preserving status, source, and reason so the formatter can distinguish
 * unavailable from clean.
 *
 * An empty `files` array is passed on as NO scope rather than as an empty one.
 * The two read alike at a call site and mean opposite things: a provider that
 * compiles treats an empty scope as "nothing to check", and a caller that built
 * its list from a filter that matched nothing would silently get a clean answer
 * about no files at all.
 *
 * Relative `files` entries are resolved against the same session root the
 * provider receives, so the provider and the formatter agree on which files
 * were asked about; the resolved absolute scope rides on the payload as
 * `requestedFiles`. See {@link resolveRequestedFiles}.
 *
 * The provider's `coverage` and `notChecked` are forwarded on both arms
 * (TASK_2026_559 Batch 25b); a provider that reports no coverage gets
 * {@link providerDefinedCoverage}, never a clean one.
 */
export function buildDiagnosticsNamespace(
  diagnosticsProvider: IDiagnosticsProvider,
  workspaceProvider: IWorkspaceProvider,
): DiagnosticsNamespace {
  const getPayload = async (
    severityFilter?: 'error' | 'warning',
    files?: readonly string[],
  ): Promise<DiagnosticsPayload> => {
    const root = resolveRootPerCall(workspaceProvider);
    const scopeFiles =
      files && files.length > 0 ? resolveRequestedFiles(files, root) : [];
    const result: DiagnosticsResult = await diagnosticsProvider.getDiagnostics(
      root,
      scopeFiles.length > 0 ? { files: scopeFiles } : undefined,
    );

    // Coverage rides on both arms (Batch 25b): an answer that did not check
    // every file must say so to the formatter, whatever its status.
    const coverage = result.coverage ?? providerDefinedCoverage();
    const notChecked =
      result.notChecked && result.notChecked.length > 0
        ? { notChecked: result.notChecked }
        : {};

    if (result.status === 'unavailable') {
      return {
        status: 'unavailable',
        source: result.source,
        reason: result.reason,
        coverage,
        ...notChecked,
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

    // Only entries with a known absolute identity can be matched against the
    // provider's diagnostic paths; see `resolveRequestedFiles`.
    const requestedFiles = scopeFiles.filter(
      (f) => typeof f === 'string' && path.isAbsolute(f),
    );

    return {
      status: 'available',
      source: result.source,
      coverage,
      ...notChecked,
      diagnostics,
      ...(requestedFiles.length > 0 ? { requestedFiles } : {}),
    };
  };

  return {
    getErrors: (files) => getPayload('error', files),
    getWarnings: (files) => getPayload('warning', files),
    getAll: (files) => getPayload(undefined, files),
  };
}

/**
 * The coverage of an answer whose provider reports none. The contract
 * (`DiagnosticsCoverageFields` in platform-core) reads that as
 * `provider-defined`, never as a complete census: the VS Code provider
 * returns whatever the installed language extensions publish, so which
 * languages and files were checked is not knowable here. Every count is
 * `null` and the census `unknown`, so the answer is never clean.
 */
function providerDefinedCoverage(): LanguageCoverage {
  return withCoverageVerdict({
    // No capability claim: the host's language extensions decide.
    supportedLanguages: [],
    census: 'unknown',
    analyzed: null,
    unchecked: null,
    failed: null,
    unsupported: null,
    unrecognised: null,
    nonSource: null,
    excluded: null,
    omittedByCap: null,
    checks: 'provider-defined',
  });
}

/**
 * The `files` scope with every relative entry resolved against the session
 * root — the root the provider is handed, never the process cwd, which in a
 * multi-session host is some other workspace.
 *
 * Without a root a relative entry has no identity to resolve to: it is passed
 * on unchanged (the provider's documented no-root fallback) and, being
 * relative, is left out of `requestedFiles`, so the formatter renders the
 * result as unscoped rather than declaring a file it cannot identify clean.
 * `files` arrives from tool arguments; a non-string entry is passed on as
 * given and is never treated as requested.
 */
function resolveRequestedFiles(
  files: readonly string[],
  root: string | undefined,
): string[] {
  return files.map((file) =>
    typeof file === 'string' && root && !path.isAbsolute(file)
      ? path.resolve(root, file)
      : file,
  );
}
