/**
 * Analysis Namespace Builders
 *
 * Provides context optimization, project analysis, and file relevance scoring.
 * These namespaces leverage workspace-intelligence for intelligent file selection.
 */

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
} from '../types';

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
 * Build context optimization namespace
 * Manages token budgets and intelligent file selection
 */
export function buildContextNamespace(
  deps: AnalysisNamespaceDependencies
): ContextNamespace {
  const {
    contextOptimizer,
    tokenCounter,
    workspaceIndexer,
    contextEnrichment,
  } = deps;

  return {
    enrichFile: async (filePath: string, language?: string) => {
      try {
        // Cast language string to the internal SupportedLanguage type
        // Valid values: 'typescript' | 'javascript' | undefined
        const lang =
          language === 'typescript' || language === 'javascript'
            ? (language as 'typescript' | 'javascript')
            : undefined;
        return await contextEnrichment.generateStructuralSummary(
          filePath,
          lang
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `// Error generating structural summary: ${message}`,
          mode: 'full' as const,
          tokenCount: 0,
          originalTokenCount: 0,
          reductionPercentage: 0,
        };
      }
    },

    optimize: async (
      query: string,
      maxTokens = 150000
    ): Promise<OptimizedContextResult> => {
      const index = await workspaceIndexer.indexWorkspace({
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
      projectType: 'monorepo' | 'library' | 'application' | 'unknown'
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
  deps: AnalysisNamespaceDependencies
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
      const info = await workspaceAnalyzer.getCurrentWorkspaceInfo();
      return info?.projectType || 'unknown';
    },

    analyzeDependencies: async (): Promise<DependencyResult[]> => {
      const workspaceRoot = workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return [];
      }

      const projectType = await projectDetector.detectProjectType(
        workspaceRoot
      );

      const analysis = await dependencyAnalyzer.analyzeDependencies(
        workspaceRoot,
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
export function buildRelevanceNamespace(
  deps: AnalysisNamespaceDependencies
): RelevanceNamespace {
  const { relevanceScorer, workspaceIndexer } = deps;

  return {
    scoreFile: async (
      filePath: string,
      query: string
    ): Promise<FileRelevanceResult> => {
      const index = await workspaceIndexer.indexWorkspace({
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

      const result = relevanceScorer.scoreFile(file, query);
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
      const index = await workspaceIndexer.indexWorkspace({
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

/**
 * Build dependency graph namespace
 * Import-based file dependency tracking and symbol indexing
 * TASK_2025_182
 */
export function buildDependencyNamespace(
  deps: AnalysisNamespaceDependencies
): DependenciesNamespace {
  const { dependencyGraph } = deps;

  return {
    buildGraph: async (filePaths: string[], workspaceRoot: string) => {
      try {
        const graph = await dependencyGraph.buildGraph(
          filePaths,
          workspaceRoot
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

    getDependencies: async (
      filePath: string,
      depth?: number
    ): Promise<string[]> => {
      try {
        return dependencyGraph.getDependencies(filePath, depth);
      } catch {
        return [];
      }
    },

    getDependents: async (filePath: string): Promise<string[]> => {
      try {
        return dependencyGraph.getDependents(filePath);
      } catch {
        return [];
      }
    },

    getSymbolIndex: async () => {
      try {
        const index = dependencyGraph.getSymbolIndex();
        const result: Array<{ file: string; symbols: string[] }> = [];
        for (const [file, exports] of index) {
          result.push({
            file,
            symbols: exports.map((e) => e.name),
          });
        }
        return result;
      } catch {
        return [];
      }
    },

    isBuilt: async () => {
      try {
        return dependencyGraph.isBuilt();
      } catch {
        return false;
      }
    },
  };
}
