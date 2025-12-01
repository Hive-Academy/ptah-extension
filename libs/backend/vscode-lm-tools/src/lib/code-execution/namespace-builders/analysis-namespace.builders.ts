/**
 * Analysis Namespace Builders
 *
 * Provides context optimization, project analysis, and file relevance scoring.
 * These namespaces leverage workspace-intelligence for intelligent file selection.
 */

import * as vscode from 'vscode';
import {
  ContextSizeOptimizerService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FileRelevanceScorerService,
  TokenCounterService,
  WorkspaceIndexerService,
  ProjectDetectorService,
  WorkspaceAnalyzerService,
} from '@ptah-extension/workspace-intelligence';
import {
  ContextNamespace,
  ProjectNamespace,
  RelevanceNamespace,
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
}

/**
 * Build context optimization namespace
 * Manages token budgets and intelligent file selection
 */
export function buildContextNamespace(
  deps: AnalysisNamespaceDependencies
): ContextNamespace {
  const { contextOptimizer, tokenCounter, workspaceIndexer } = deps;

  return {
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
  } = deps;

  return {
    detectMonorepo: async (): Promise<MonorepoResult> => {
      const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceUri) {
        return {
          isMonorepo: false,
          type: '',
          workspaceFiles: [],
        };
      }

      const result = await monorepoDetector.detectMonorepo(workspaceUri);
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
      const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!workspaceUri) {
        return [];
      }

      const projectType = await projectDetector.detectProjectType(workspaceUri);

      const analysis = await dependencyAnalyzer.analyzeDependencies(
        workspaceUri,
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
