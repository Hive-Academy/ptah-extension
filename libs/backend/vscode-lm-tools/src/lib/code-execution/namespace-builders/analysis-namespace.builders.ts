/**
 * Analysis Namespace Builders
 *
 * Provides context optimization, project analysis, and file relevance scoring.
 * These namespaces leverage workspace-intelligence for intelligent file selection.
 */

import * as path from 'node:path';
import {
  ContextSizeOptimizerService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FileRelevanceScorerService,
  TokenCounterService,
  WorkspaceIndexerService,
  ProjectDetectorService,
  WorkspaceAnalyzerService,
  ContextEnrichmentService,
  DependencyGraphService,
  exportSymbolNames,
  resolveEnrichLanguage,
  type StructuralSummaryResult,
} from '@ptah-extension/workspace-intelligence';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  ContextNamespace,
  ProjectNamespace,
  RelevanceNamespace,
  DependenciesNamespace,
  OptimizedContextResult,
  MonorepoResult,
  DependencyResult,
  FileRelevanceResult,
  SymbolIndexEntry,
  SymbolIndexPage,
  SymbolIndexQuery,
} from '../types';
import { pageSymbolIndex, parseSymbolIndexQuery } from './symbol-index-query';

/**
 * Dependencies required for analysis namespaces
 */
export interface AnalysisNamespaceDependencies {
  contextOptimizer: ContextSizeOptimizerService;
  monorepoDetector: MonorepoDetectorService;
  dependencyAnalyzer: DependencyAnalyzerService;
  relevanceScorer: FileRelevanceScorerService;
  tokenCounter: TokenCounterService;
  workspaceIndexer: WorkspaceIndexerService;
  projectDetector: ProjectDetectorService;
  workspaceAnalyzer: WorkspaceAnalyzerService;
  contextEnrichment: ContextEnrichmentService;
  dependencyGraph: DependencyGraphService;
  workspaceProvider: IWorkspaceProvider;
}

/**
 * Resolve a tool-supplied file path to an absolute path, accepting either an
 * absolute path (POSIX, Windows drive, or UNC) or a workspace-relative one.
 */
function resolveWorkspaceFilePath(
  filePath: string,
  workspaceProvider: IWorkspaceProvider,
): string {
  if (isAbsoluteFileArg(filePath)) {
    return filePath;
  }
  const workspaceRoot = workspaceProvider.getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('No workspace folder open');
  }
  return path.join(workspaceRoot, filePath);
}

/** An absolute path (POSIX, Windows drive, or UNC), which resolves to itself. */
function isAbsoluteFileArg(filePath: string): boolean {
  return (
    filePath.startsWith('/') ||
    /^[A-Za-z]:/.test(filePath) ||
    filePath.startsWith('\\\\')
  );
}

// `resolveEnrichLanguage` (extension -> language inference for
// `ContextEnrichmentService.generateStructuralSummary`) now lives in
// `@ptah-extension/workspace-intelligence` (`context-analysis/enrich-language.ts`,
// TASK_2026_559 Batch 20 r1 defect 5): the production MCP path and the Task
// 20.2 regression bench call the exact same function, so a regression here is
// caught by the bench without a test-local reimplementation drifting from it.

/**
 * Build context optimization namespace
 * Manages token budgets and intelligent file selection
 */
export function buildContextNamespace(
  deps: AnalysisNamespaceDependencies,
): ContextNamespace {
  const {
    contextOptimizer,
    tokenCounter,
    workspaceIndexer,
    contextEnrichment,
    workspaceProvider,
  } = deps;

  return {
    enrichFile: async (
      filePath: string,
      language?: string,
    ): Promise<StructuralSummaryResult> => {
      try {
        const resolvedPath = resolveWorkspaceFilePath(
          filePath.trim(),
          workspaceProvider,
        );
        return await contextEnrichment.generateStructuralSummary(
          resolvedPath,
          resolveEnrichLanguage(resolvedPath, language),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // No file content was obtained (no workspace root for a relative
        // path, or the read/summary pipeline threw), so this reads as
        // `read-failed`; `content` stays last so a budget cut keeps the reason.
        return {
          mode: 'full',
          reason: 'read-failed',
          tokenCount: 0,
          originalTokenCount: 0,
          reductionPercentage: 0,
          content: `// Error generating structural summary: ${message}`,
        };
      }
    },

    optimize: async (
      query: string,
      maxTokens = 150000,
    ): Promise<OptimizedContextResult> => {
      // TASK_2026_200 task 3.5: `workspaceFolder` is now mandatory. Omitting it
      // used to fall through to `WorkspaceIndexerService`'s private
      // `getDefaultWorkspaceFolder()`, i.e. the raw process-global provider, so
      // this MCP tool indexed the IDE's folder instead of the calling session's
      // root even though the session-aware provider was sitting in `deps`.
      const index = await workspaceIndexer.indexWorkspace({
        workspaceFolder: workspaceProvider.getWorkspaceRoot(),
        estimateTokens: true,
        respectIgnoreFiles: true,
      });

      const result = await contextOptimizer.optimizeContext({
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
      return await tokenCounter.countTokens(text);
    },

    getRecommendedBudget: (
      projectType: 'monorepo' | 'library' | 'application' | 'unknown',
    ): number => {
      return contextOptimizer.getRecommendedBudget(projectType);
    },
  };
}

/**
 * Build project analysis namespace
 * Deep project analysis: monorepo detection, dependencies
 */
export function buildProjectNamespace(
  deps: AnalysisNamespaceDependencies,
): ProjectNamespace {
  const {
    monorepoDetector,
    dependencyAnalyzer,
    projectDetector,
    workspaceAnalyzer,
    workspaceProvider,
  } = deps;

  return {
    detectMonorepo: async (): Promise<MonorepoResult> => {
      const workspaceRoot = workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return {
          isMonorepo: false,
          type: '',
          workspaceFiles: [],
        };
      }

      const result = await monorepoDetector.detectMonorepo(workspaceRoot);
      return {
        isMonorepo: result.isMonorepo,
        type: result.type || '',
        workspaceFiles: result.workspaceFiles,
        packageCount: result.packageCount,
      };
    },

    detectType: async (): Promise<string> => {
      // Root resolved per call from the session-aware provider so this agrees
      // with `ptah_workspace_analyze` for the same session (criterion 2).
      const info = await workspaceAnalyzer.getCurrentWorkspaceInfo(
        workspaceProvider.getWorkspaceRoot(),
      );
      return info?.projectType || 'unknown';
    },

    analyzeDependencies: async (): Promise<DependencyResult[]> => {
      const workspaceRoot = workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return [];
      }

      const projectType =
        await projectDetector.detectProjectType(workspaceRoot);

      const analysis = await dependencyAnalyzer.analyzeDependencies(
        workspaceRoot,
        projectType,
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
export function buildRelevanceNamespace(
  deps: AnalysisNamespaceDependencies,
): RelevanceNamespace {
  const { relevanceScorer, workspaceIndexer, workspaceProvider } = deps;

  return {
    scoreFile: async (
      filePath: string,
      query: string,
    ): Promise<FileRelevanceResult> => {
      // See the note in `buildContextNamespace.optimize` — an explicit,
      // session-aware `workspaceFolder` is required (TASK_2026_200 task 3.5).
      const index = await workspaceIndexer.indexWorkspace({
        workspaceFolder: workspaceProvider.getWorkspaceRoot(),
        estimateTokens: false,
        respectIgnoreFiles: true,
      });

      const file = index.files.find(
        (f) => f.relativePath === filePath || f.path === filePath,
      );

      if (!file) {
        return {
          file: filePath,
          score: 0,
          reasons: ['File not found in workspace'],
        };
      }

      const result = relevanceScorer.scoreFile(file, query);
      return {
        file: file.relativePath,
        score: result.score,
        reasons: result.reasons,
      };
    },

    rankFiles: async (
      query: string,
      limit = 20,
    ): Promise<FileRelevanceResult[]> => {
      // See the note in `buildContextNamespace.optimize` — an explicit,
      // session-aware `workspaceFolder` is required (TASK_2026_200 task 3.5).
      const index = await workspaceIndexer.indexWorkspace({
        workspaceFolder: workspaceProvider.getWorkspaceRoot(),
        estimateTokens: false,
        respectIgnoreFiles: true,
      });

      const results = relevanceScorer.getTopFiles(index.files, query, limit);

      return results.map((r) => ({
        file: r.file.relativePath,
        score: r.score,
        reasons: r.reasons,
      }));
    },
  };
}

/** Join a workspace-relative path to its root; pass absolute paths through. */
function toAbsoluteWorkspacePath(workspaceRoot: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(workspaceRoot, file);
}

/**
 * Build dependency graph namespace
 * Import-based file dependency tracking and symbol indexing
 */
export function buildDependencyNamespace(
  deps: AnalysisNamespaceDependencies,
): DependenciesNamespace {
  const { dependencyGraph, workspaceProvider } = deps;

  const readSymbolEntries = (workspaceRoot?: string): SymbolIndexEntry[] => {
    try {
      const index = dependencyGraph.getSymbolIndex(workspaceRoot);
      const result: SymbolIndexEntry[] = [];
      for (const [file, exports] of index) {
        result.push({
          file,
          symbols: exportSymbolNames(exports),
        });
      }
      return result;
    } catch {
      // degradation-audit: optional-capability - this delegate only walks its
      // own Maps (dependencyGraph.getSymbolIndex) and cannot throw; the
      // empty-array fallback matches "no symbols" and guards a call this
      // wrapper cannot make fail.
      return [];
    }
  };

  function getSymbolIndex(workspaceRoot?: string): Promise<SymbolIndexEntry[]>;
  function getSymbolIndex(
    workspaceRoot: string | undefined,
    query: SymbolIndexQuery,
  ): Promise<SymbolIndexPage>;
  async function getSymbolIndex(
    workspaceRoot?: string,
    query?: SymbolIndexQuery,
  ): Promise<SymbolIndexEntry[] | SymbolIndexPage> {
    if (query === undefined) {
      // execute_code callers that pass only the root keep the unpaged array.
      return readSymbolEntries(workspaceRoot);
    }
    if (typeof query !== 'object' || query === null) {
      throw new RangeError('"query" must be an object.');
    }
    const parsed = parseSymbolIndexQuery(query);
    if (!parsed.ok) {
      throw new RangeError(parsed.error);
    }
    return pageSymbolIndex(
      readSymbolEntries(workspaceRoot),
      parsed.query,
      workspaceRoot ?? workspaceProvider.getWorkspaceRoot(),
    );
  }

  return {
    buildGraph: async (
      filePaths: string[],
      workspaceRoot: string,
      discoveredFiles?: number,
      options?: { yieldToForeground?: boolean; generation?: number },
    ) => {
      try {
        const graph = await dependencyGraph.buildGraph(
          // The graph reads real files and keys its nodes by ABSOLUTE path, but
          // every other path in this sandbox is workspace-relative — `ptah.files`
          // rejects absolute paths outright, so `ptah.search.findFiles()` (the
          // natural source for this argument) yields relative ones. Handing
          // those straight through resolved them against process.cwd, every read
          // failed, and the call returned a cheerful `0 nodes, 0 edges` instead
          // of an error. Resolve against the root the caller already passed.
          filePaths.map((file) => toAbsoluteWorkspacePath(workspaceRoot, file)),
          workspaceRoot,
          undefined,
          discoveredFiles,
          // Only a build nobody awaits yields to the governor; see the option.
          {
            yieldToForeground: options?.yieldToForeground === true,
            ...(options?.generation === undefined
              ? {}
              : { generation: options.generation }),
          },
        );
        let edgeCount = 0;
        for (const edgeSet of graph.edges.values()) {
          edgeCount += edgeSet.size;
        }
        return {
          nodeCount: graph.nodes.size,
          edgeCount,
          unresolvedCount: graph.unresolvedCount,
          builtAt: graph.builtAt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          nodeCount: 0,
          edgeCount: 0,
          unresolvedCount: 0,
          builtAt: 0,
          error: message,
        };
      }
    },

    reserveGraphBuild: (workspaceRoot: string) =>
      dependencyGraph.reserveBuild(workspaceRoot),

    getGraphBuildState: (workspaceRoot: string) =>
      dependencyGraph.getBuildState(workspaceRoot),

    getDependencies: async (
      filePath: string,
      depth?: number,
    ): Promise<string[]> => {
      try {
        const resolved = resolveWorkspaceFilePath(
          filePath.trim(),
          workspaceProvider,
        );
        return dependencyGraph.getDependencies(resolved, depth);
      } catch {
        return [];
      }
    },

    getDependents: async (filePath: string): Promise<string[]> => {
      try {
        const resolved = resolveWorkspaceFilePath(
          filePath.trim(),
          workspaceProvider,
        );
        return dependencyGraph.getDependents(resolved);
      } catch {
        return [];
      }
    },

    getSymbolIndex,

    isBuilt: async (workspaceRoot?: string) => {
      try {
        return dependencyGraph.isBuilt(workspaceRoot);
      } catch {
        // degradation-audit: optional-capability - dependencyGraph.isBuilt only
        // reads Map.has/size and cannot throw; the false fallback matches its
        // own "not built" meaning and guards a call this wrapper cannot make
        // fail.
        return false;
      }
    },

    getGraphCoverage: async (workspaceRoot?: string) =>
      dependencyGraph.getCoverage(workspaceRoot),

    // Resolved exactly as getDependencies/getDependents resolve their path, so
    // the service routes it to the graph that answers those calls.
    getGraphCoverageForFile: async (filePath: string) => {
      const trimmed = filePath.trim();
      // A relative path with no open workspace cannot be resolved; the
      // dependency calls answer [] for it, from no graph, so neither has coverage.
      if (
        !isAbsoluteFileArg(trimmed) &&
        !workspaceProvider.getWorkspaceRoot()
      ) {
        return undefined;
      }
      return dependencyGraph.getCoverageForFile(
        resolveWorkspaceFilePath(trimmed, workspaceProvider),
      );
    },
  };
}
