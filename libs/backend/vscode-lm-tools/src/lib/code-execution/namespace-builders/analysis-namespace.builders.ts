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
  DEFAULT_WORKSPACE_EXCLUDES,
  EXTENSION_LANGUAGE_MAP,
  classifyFileForCoverage,
  languageForExtension,
  recognisedSourceExtensions,
  supportedLanguagesFor,
  type StructuralSummaryResult,
} from '@ptah-extension/workspace-intelligence';
import {
  IncompleteFileSearchError,
  withCoverageVerdict,
  type FileSearchFailures,
  type IFileSystemProvider,
  type IWorkspaceProvider,
  type LanguageCoverage,
  type UnsupportedLanguageAnswer,
} from '@ptah-extension/platform-core';
import {
  ContextNamespace,
  ProjectNamespace,
  RelevanceNamespace,
  DependenciesNamespace,
  OptimizedContextResult,
  MonorepoResult,
  DependencyResult,
  FileRelevanceResult,
  GraphFileCoverage,
  GraphQueryCoverage,
  GraphSourceDiscovery,
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
  /** Bounded source discovery for the dependency graph. */
  fileSystemProvider: IFileSystemProvider;
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
 * Vendored and generated trees graph discovery excludes inside its walk, on
 * top of `DEFAULT_WORKSPACE_EXCLUDES` (plan "Bounds", Discovery row), so a
 * large vendor tree can never use up the census limit before the project's
 * own code is reached. Excluded inside discovery, they are never observed:
 * the coverage reports `excluded: null`.
 */
export const GRAPH_VENDOR_EXCLUDES: readonly string[] = [
  '**/.venv/**',
  '**/venv/**',
  '**/site-packages/**',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/obj/**',
  '**/bin/**',
  '**/.gradle/**',
  '**/Pods/**',
];

/** Most files one graph discovery lists; past it the census is `truncated`. */
export const GRAPH_CENSUS_LIMIT = 50_000;

/**
 * `ts` → `[tT][sS]`: an extension pattern that matches every letter case.
 * The registry recognises extensions case-insensitively (`APP.TS` is
 * TypeScript, `analysis.R` is R), so discovery must too, or such files
 * vanish from a census that then reads complete (review r1 B1). Bracket
 * classes, not a provider option, so the VS Code, Electron and CLI globs all
 * honour it. Every other character is a one-character class too (`c++` →
 * `[cC][+][+]`): a bare `+` after a class is a glob operator to picomatch,
 * so `[cC]++` never matched `.c++` (review r2).
 */
function anyCaseExtensionPattern(extension: string): string {
  return [...extension]
    .map((char) =>
      char.toLowerCase() === char.toUpperCase()
        ? `[${char}]`
        : `[${char.toLowerCase()}${char.toUpperCase()}]`,
    )
    .join('');
}

/**
 * Every extension a language is recognised by, graph-capable or not, in any
 * letter case, so the graph's census counts the files it cannot analyse
 * (`unsupported`) as well as the ones it parses.
 */
const GRAPH_DISCOVERY_GLOB = `**/*.{${recognisedSourceExtensions()
  .map((extension) => anyCaseExtensionPattern(extension.slice(1)))
  .join(',')}}`;

/** Graph coverage when no graph answers: nothing is known, so never clean. */
function unknownGraphCoverage(): LanguageCoverage {
  return withCoverageVerdict({
    supportedLanguages: supportedLanguagesFor('graphEdges'),
    census: 'unknown',
    analyzed: null,
    unchecked: null,
    failed: null,
    unsupported: null,
    unrecognised: null,
    nonSource: null,
    excluded: null,
    omittedByCap: null,
  });
}

/**
 * The `unsupported-language` answer for a file the dependency graph cannot
 * hold, or `undefined` when its extension is graph-capable. Every other file
 * (another language, a recognition-only extension such as `.mjs`, non-source
 * or unrecognised) is never a graph node, so an empty list for it would read
 * as "nothing imports it".
 */
function unsupportedGraphLanguage(
  filePath: string,
): UnsupportedLanguageAnswer | undefined {
  const trimmed = filePath.trim();
  if (classifyFileForCoverage(trimmed, 'graphEdges') === 'eligible') {
    return undefined;
  }
  const extension = path.extname(trimmed).toLowerCase();
  const language =
    languageForExtension(extension) ??
    (extension === '' ? 'unknown' : extension);
  const supportedLanguages = supportedLanguagesFor('graphEdges');
  const subject =
    extension === ''
      ? 'Files without an extension'
      : language === extension
        ? `Files with extension "${extension}"`
        : `${language} files (${extension})`;
  return {
    status: 'unsupported-language',
    language,
    supportedLanguages,
    message:
      `${subject} are not part of the dependency graph on this host, so no dependents or dependencies were looked up. ` +
      `Graph languages: ${supportedLanguages.join(', ')}. ` +
      'Use Grep or ptah_search_files to find references to this file.',
  };
}

/**
 * Build dependency graph namespace
 * Import-based file dependency tracking and symbol indexing
 */
export function buildDependencyNamespace(
  deps: AnalysisNamespaceDependencies,
): DependenciesNamespace {
  const { dependencyGraph, workspaceProvider, fileSystemProvider } = deps;

  const readSymbolEntries = (workspaceRoot?: string): SymbolIndexEntry[] => {
    try {
      const index = dependencyGraph.getSymbolIndex(workspaceRoot);
      const result: SymbolIndexEntry[] = [];
      for (const [file, exports] of index) {
        const unextracted = dependencyGraph.getUnextractedExports(file);
        result.push({
          file,
          symbols: exportSymbolNames(exports),
          ...(unextracted === undefined
            ? {}
            : { unextractedExports: [...unextracted] }),
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
      // The prefix matched with the identity dependency queries use: a
      // junction root's real target (or its alias) finds the same entries.
      (prefix) => dependencyGraph.graphSpellingsOf(prefix),
    );
  }

  return {
    buildGraph: async (
      filePaths: string[],
      workspaceRoot: string,
      discoveredFiles?: number,
      options?: {
        yieldToForeground?: boolean;
        generation?: number;
        censusLimit?: number;
        censusUnknown?: boolean;
      },
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
            ...(options?.censusLimit === undefined
              ? {}
              : { censusLimit: options.censusLimit }),
            ...(options?.censusUnknown === true ? { censusUnknown: true } : {}),
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

    discoverSourceFiles: async (
      workspaceRoot: string,
      limit: number = GRAPH_CENSUS_LIMIT,
    ): Promise<GraphSourceDiscovery> => {
      if (!Number.isInteger(limit) || limit < 1 || limit > GRAPH_CENSUS_LIMIT) {
        throw new RangeError(
          `"limit" must be an integer from 1 to ${GRAPH_CENSUS_LIMIT}.`,
        );
      }
      // One past the limit: its presence alone says the census is truncated.
      let found: readonly string[];
      let unreadable: FileSearchFailures | undefined;
      try {
        found = await fileSystemProvider.findFiles(
          GRAPH_DISCOVERY_GLOB,
          [...DEFAULT_WORKSPACE_EXCLUDES, ...GRAPH_VENDOR_EXCLUDES],
          limit + 1,
          workspaceRoot,
        );
      } catch (error: unknown) {
        // degradation-audit: reported — part of the tree could not be read
        // (review r3 B1): keep what was found, and return the failures so
        // the graph built from it publishes an unknown census (never clean).
        // Any other failure propagates (the build reports `failed`).
        if (!(error instanceof IncompleteFileSearchError)) throw error;
        found = error.matches;
        unreadable = error.failures;
      }
      return {
        files: found
          .slice(0, limit)
          .map((file) => toAbsoluteWorkspacePath(workspaceRoot, file)),
        truncated: found.length > limit,
        limit,
        ...(unreadable === undefined
          ? {}
          : {
              unreadable: {
                paths: unreadable.total,
                byCode: { ...unreadable.byCode },
              },
            }),
      };
    },

    unsupportedGraphLanguage,

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

    getGraphCoverage: async (
      workspaceRoot?: string,
    ): Promise<GraphQueryCoverage> => {
      const report = dependencyGraph.getCoverageReport(workspaceRoot);
      return report
        ? { ...report.files, coverage: report.languages }
        : { coverage: unknownGraphCoverage() };
    },

    // Resolved exactly as getDependencies/getDependents resolve their path, so
    // the service routes it to the graph that answers those calls.
    getGraphCoverageForFile: async (
      filePath: string,
    ): Promise<GraphFileCoverage> => {
      const trimmed = filePath.trim();
      // A relative path with no open workspace cannot be resolved; the
      // dependency calls answer [] for it, from no graph, so nothing is known.
      if (
        !isAbsoluteFileArg(trimmed) &&
        !workspaceProvider.getWorkspaceRoot()
      ) {
        return { coverage: unknownGraphCoverage() };
      }
      const resolved = resolveWorkspaceFilePath(trimmed, workspaceProvider);
      // Both read the service synchronously, so they describe one graph.
      const report = dependencyGraph.getCoverageReportForFile(resolved);
      if (!report) {
        return { coverage: unknownGraphCoverage() };
      }
      const nodePath = dependencyGraph.resolveNodePath(resolved);
      return {
        ...report.files,
        coverage: report.languages,
        ...(nodePath === undefined ? {} : { nodePath }),
      };
    },
  };
}
