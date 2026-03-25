/**
 * Context Size Optimizer Service
 *
 * Manages token budgets and selects optimal file sets for AI agent integration.
 * Ensures context stays within LLM limits while maximizing relevance.
 * Supports structural mode that uses .d.ts-style summaries for lower-priority
 * files to reduce token usage while preserving API surface information.
 *
 * @module libs/backend/workspace-intelligence/context-analysis
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { IndexedFile } from '../types/workspace.types';
import { FileRelevanceScorerService } from './file-relevance-scorer.service';
import { TokenCounterService } from '../services/token-counter.service';
import { ContextEnrichmentService } from './context-enrichment.service';
import { EXTENSION_LANGUAGE_MAP } from '../ast/tree-sitter.config';
import { SupportedLanguage } from '../ast/ast.types';
import type { SymbolIndex } from '../ast/dependency-graph.service';

/**
 * Mode assigned to each file in the optimized context.
 * - 'full': Complete file content included
 * - 'structural': .d.ts-style summary included
 * - 'dependency': Included as a dependency of another file
 */
export type FileContextMode = 'full' | 'structural' | 'dependency';

/**
 * Minimal interface for DependencyGraphService to avoid import dependency
 * on a service that may not be registered yet (created in Batch 3).
 */
interface DependencyGraphInterface {
  getDependencies(filePath: string, depth?: number): string[];
  isBuilt(): boolean;
  getSymbolIndex(): SymbolIndex;
}

/**
 * Optimization request with budget constraints
 */
export interface ContextOptimizationRequest {
  /**
   * All indexed workspace files
   */
  readonly files: IndexedFile[];

  /**
   * User's query/task description
   */
  readonly query: string;

  /**
   * Maximum tokens allowed for Claude CLI (default: 200,000)
   */
  readonly maxTokens?: number;

  /**
   * Reserve tokens for response (default: 50,000)
   */
  readonly responseReserve?: number;

  /**
   * Context optimization mode.
   * - 'full': Include complete file content for all selected files (default)
   * - 'structural': Top 20% by relevance get full content, remaining 80% get
   *   .d.ts-style structural summaries to reduce token usage
   */
  readonly mode?: 'full' | 'structural';
}

/**
 * Optimized context result
 */
export interface OptimizedContext {
  /**
   * Selected files within token budget
   */
  readonly selectedFiles: IndexedFile[];

  /**
   * Excluded files (over budget)
   */
  readonly excludedFiles: IndexedFile[];

  /**
   * Total tokens in selected files
   */
  readonly totalTokens: number;

  /**
   * Available tokens remaining
   */
  readonly tokensRemaining: number;

  /**
   * Optimization statistics
   */
  readonly stats: ContextOptimizationStats;

  /**
   * Map of file path to context mode, populated in structural optimization mode.
   * Indicates whether each selected file was included as full content,
   * structural summary, or dependency.
   */
  readonly fileContextModes?: Map<string, FileContextMode>;

  /**
   * Map of file path to overridden content (e.g., structural summaries).
   * Downstream consumers should check `contentOverrides.get(filePath)` before
   * reading from disk to use the summary content instead of the original file.
   */
  readonly contentOverrides?: Map<string, string>;
}

/**
 * Optimization statistics
 */
export interface ContextOptimizationStats {
  /**
   * Total files processed
   */
  readonly totalFiles: number;

  /**
   * Files selected
   */
  readonly selectedFiles: number;

  /**
   * Files excluded
   */
  readonly excludedFiles: number;

  /**
   * Token reduction percentage
   */
  readonly reductionPercentage: number;

  /**
   * Average relevance score of selected files
   */
  readonly averageRelevance: number;
}

/**
 * Context Size Optimizer Service
 *
 * Intelligently selects files within token budget using relevance scoring.
 */
@injectable()
export class ContextSizeOptimizerService {
  /**
   * Optional DependencyGraphService reference.
   * Not constructor-injected because it is registered in Batch 3 (after this service).
   * When DependencyGraphService is available, it will be set via setDependencyGraph().
   */
  private dependencyGraph: DependencyGraphInterface | null = null;

  constructor(
    @inject(TOKENS.FILE_RELEVANCE_SCORER)
    private readonly relevanceScorer: FileRelevanceScorerService,
    @inject(TOKENS.TOKEN_COUNTER_SERVICE)
    private readonly tokenCounter: TokenCounterService,
    @inject(TOKENS.CONTEXT_ENRICHMENT_SERVICE)
    private readonly enrichmentService: ContextEnrichmentService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Set the optional DependencyGraphService reference.
   * Called during DI registration when DependencyGraphService becomes available.
   *
   * @param graph - DependencyGraphService instance (or null to clear)
   */
  setDependencyGraph(graph: DependencyGraphInterface | null): void {
    this.dependencyGraph = graph;
  }

  /**
   * Optimize context for Claude CLI integration
   *
   * @param request - Optimization parameters with files and budget
   * @returns Optimized context within token limits
   */
  async optimizeContext(
    request: ContextOptimizationRequest
  ): Promise<OptimizedContext> {
    if (request.mode === 'structural') {
      return this.optimizeContextStructural(request);
    }

    // Full mode (default): identical to original behavior
    const maxTokens = request.maxTokens ?? 200_000;
    const responseReserve = request.responseReserve ?? 50_000;
    const availableTokens = maxTokens - responseReserve;

    // Rank files by relevance, passing symbol index when dependency graph is available
    const symbolIndex = this.dependencyGraph?.isBuilt()
      ? this.dependencyGraph.getSymbolIndex()
      : undefined;
    const rankedFiles = this.relevanceScorer.rankFiles(
      request.files,
      request.query,
      symbolIndex
    );

    // Select files within budget using greedy algorithm
    const selectedFiles: IndexedFile[] = [];
    const excludedFiles: IndexedFile[] = [];
    let currentTokens = 0;

    for (const [file] of rankedFiles) {
      const fileTokens = file.estimatedTokens;

      if (currentTokens + fileTokens <= availableTokens) {
        selectedFiles.push(file);
        currentTokens += fileTokens;
      } else {
        excludedFiles.push(file);
      }
    }

    // Calculate statistics
    const totalFiles = request.files.length;
    const totalTokensBeforeOptimization = request.files.reduce(
      (sum, f) => sum + f.estimatedTokens,
      0
    );

    const relevanceScores = Array.from(rankedFiles.values());
    const selectedRelevanceScores = relevanceScores.slice(
      0,
      selectedFiles.length
    );
    const averageRelevance =
      selectedRelevanceScores.length > 0
        ? selectedRelevanceScores.reduce((sum, score) => sum + score, 0) /
          selectedRelevanceScores.length
        : 0;

    const reductionPercentage =
      totalTokensBeforeOptimization > 0
        ? ((totalTokensBeforeOptimization - currentTokens) /
            totalTokensBeforeOptimization) *
          100
        : 0;

    const stats: ContextOptimizationStats = {
      totalFiles,
      selectedFiles: selectedFiles.length,
      excludedFiles: excludedFiles.length,
      reductionPercentage,
      averageRelevance,
    };

    return {
      selectedFiles,
      excludedFiles,
      totalTokens: currentTokens,
      tokensRemaining: availableTokens - currentTokens,
      stats,
    };
  }

  /**
   * Structural optimization mode.
   *
   * Splits ranked files into two tiers:
   * - Top 20% by relevance: included with full content
   * - Remaining 80%: included as .d.ts-style structural summaries
   *
   * This allows more files to fit within the token budget while preserving
   * complete context for the most relevant files and API surface information
   * for the rest.
   *
   * @param request - Optimization parameters with files and budget
   * @returns Optimized context with fileContextModes map
   */
  private async optimizeContextStructural(
    request: ContextOptimizationRequest
  ): Promise<OptimizedContext> {
    const maxTokens = request.maxTokens ?? 200_000;
    const responseReserve = request.responseReserve ?? 50_000;
    const availableTokens = maxTokens - responseReserve;

    // Rank files by relevance, passing symbol index when dependency graph is available
    const symbolIndex = this.dependencyGraph?.isBuilt()
      ? this.dependencyGraph.getSymbolIndex()
      : undefined;
    const rankedFiles = this.relevanceScorer.rankFiles(
      request.files,
      request.query,
      symbolIndex
    );

    const rankedEntries = Array.from(rankedFiles.entries());
    const totalRanked = rankedEntries.length;

    // Split: top 20% get full content, remaining 80% get structural summaries
    const fullContentCount = Math.max(1, Math.ceil(totalRanked * 0.2));

    const selectedFiles: IndexedFile[] = [];
    const excludedFiles: IndexedFile[] = [];
    const fileContextModes = new Map<string, FileContextMode>();
    const contentOverrides = new Map<string, string>();
    let currentTokens = 0;

    // Phase 1: Add top 20% files with full content
    for (let i = 0; i < fullContentCount && i < totalRanked; i++) {
      const [file] = rankedEntries[i];
      const fileTokens = file.estimatedTokens;

      if (currentTokens + fileTokens <= availableTokens) {
        selectedFiles.push(file);
        currentTokens += fileTokens;
        fileContextModes.set(file.path, 'full');
      } else {
        excludedFiles.push(file);
      }
    }

    // Phase 2: Add remaining 80% as structural summaries
    for (let i = fullContentCount; i < totalRanked; i++) {
      const [file] = rankedEntries[i];
      const language = this.detectLanguage(file.path);

      try {
        const summary = await this.enrichmentService.generateStructuralSummary(
          file.path,
          language
        );

        const summaryTokens = summary.tokenCount;

        if (currentTokens + summaryTokens <= availableTokens) {
          // Update the file's estimated tokens to reflect the summary size
          // so downstream consumers know the actual token cost
          const summaryFile: IndexedFile = {
            ...file,
            estimatedTokens: summaryTokens,
          };
          selectedFiles.push(summaryFile);
          currentTokens += summaryTokens;

          const mode = summary.mode === 'structural' ? 'structural' : 'full';
          fileContextModes.set(file.path, mode);

          // Store structural summary content so downstream consumers
          // can use it instead of reading the original file from disk
          if (mode === 'structural') {
            contentOverrides.set(file.path, summary.content);
          }
        } else {
          excludedFiles.push(file);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `ContextSizeOptimizer.optimizeContextStructural() - Failed to generate structural summary for ${file.path}: ${errorMessage}. Falling back to full content.`
        );

        // Fallback: try to include with full content
        const fileTokens = file.estimatedTokens;
        if (currentTokens + fileTokens <= availableTokens) {
          selectedFiles.push(file);
          currentTokens += fileTokens;
          fileContextModes.set(file.path, 'full');
        } else {
          excludedFiles.push(file);
        }
      }
    }

    // Calculate statistics
    const totalFiles = request.files.length;
    const totalTokensBeforeOptimization = request.files.reduce(
      (sum, f) => sum + f.estimatedTokens,
      0
    );

    // Look up the actual relevance score for each selected file from the
    // ranked map, rather than slicing the scores array by index (which can
    // mismatch when files are excluded in Phase 1 or fallback in Phase 2).
    const selectedRelevanceScores = selectedFiles.map((f) => {
      // Find the original file entry in rankedFiles (keyed by IndexedFile ref)
      for (const [rankedFile, score] of rankedFiles) {
        if (rankedFile.path === f.path) {
          return score;
        }
      }
      return 0;
    });
    const averageRelevance =
      selectedRelevanceScores.length > 0
        ? selectedRelevanceScores.reduce((sum, score) => sum + score, 0) /
          selectedRelevanceScores.length
        : 0;

    const reductionPercentage =
      totalTokensBeforeOptimization > 0
        ? ((totalTokensBeforeOptimization - currentTokens) /
            totalTokensBeforeOptimization) *
          100
        : 0;

    const stats: ContextOptimizationStats = {
      totalFiles,
      selectedFiles: selectedFiles.length,
      excludedFiles: excludedFiles.length,
      reductionPercentage,
      averageRelevance,
    };

    this.logger.debug(
      `ContextSizeOptimizer.optimizeContextStructural() - Selected ${selectedFiles.length}/${totalFiles} files ` +
        `(${fileContextModes.size} with modes: ` +
        `${
          Array.from(fileContextModes.values()).filter((m) => m === 'full')
            .length
        } full, ` +
        `${
          Array.from(fileContextModes.values()).filter(
            (m) => m === 'structural'
          ).length
        } structural), ` +
        `${currentTokens}/${availableTokens} tokens used`
    );

    return {
      selectedFiles,
      excludedFiles,
      totalTokens: currentTokens,
      tokensRemaining: availableTokens - currentTokens,
      stats,
      fileContextModes,
      contentOverrides,
    };
  }

  /**
   * Detect the supported language for a file based on its extension.
   *
   * @param filePath - Absolute file path
   * @returns SupportedLanguage or undefined if not recognized
   */
  private detectLanguage(filePath: string): SupportedLanguage | undefined {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const lastDot = normalizedPath.lastIndexOf('.');
    if (lastDot === -1) {
      return undefined;
    }
    const extension = normalizedPath.slice(lastDot).toLowerCase();
    return EXTENSION_LANGUAGE_MAP[extension] as SupportedLanguage | undefined;
  }

  /**
   * Estimate optimization outcome without performing it
   *
   * Useful for UI preview/transparency
   *
   * @param request - Optimization parameters
   * @returns Estimated statistics
   */
  async estimateOptimization(
    request: ContextOptimizationRequest
  ): Promise<ContextOptimizationStats> {
    const result = await this.optimizeContext(request);
    return result.stats;
  }

  /**
   * Get recommended token budget for a project type
   *
   * @param projectType - Type of project (monorepo, library, app, etc.)
   * @returns Recommended max tokens
   */
  getRecommendedBudget(
    projectType: 'monorepo' | 'library' | 'application' | 'unknown'
  ): number {
    switch (projectType) {
      case 'monorepo':
        // Monorepos: use full Claude budget (large codebases)
        return 200_000;
      case 'library':
        // Libraries: moderate budget (focused codebase)
        return 150_000;
      case 'application':
        // Applications: standard budget
        return 175_000;
      case 'unknown':
      default:
        // Conservative default
        return 150_000;
    }
  }

  /**
   * Calculate recommended response reserve based on query complexity
   *
   * @param query - User query
   * @returns Recommended response reserve tokens
   */
  async getRecommendedResponseReserve(query: string): Promise<number> {
    // Ensure token counter is available (we don't use the count, just validate service works)
    await this.tokenCounter.countTokens(query);

    // Reserve more tokens for complex queries (code generation, refactoring)
    if (
      query.includes('generate') ||
      query.includes('create') ||
      query.includes('refactor') ||
      query.includes('implement')
    ) {
      return 75_000; // Complex response expected
    }

    // Standard reserve for explanations/questions
    if (
      query.includes('how') ||
      query.includes('what') ||
      query.includes('why')
    ) {
      return 50_000; // Moderate response expected
    }

    // Minimal reserve for simple queries
    return 30_000; // Short response expected
  }

  /**
   * Optimize with adaptive budgeting based on query
   *
   * Automatically determines optimal token allocation
   *
   * @param files - All workspace files
   * @param query - User query
   * @returns Optimized context
   */
  async optimizeWithAdaptiveBudget(
    files: IndexedFile[],
    query: string
  ): Promise<OptimizedContext> {
    // Determine project type (simplified - could use MonorepoDetector)
    const projectType: 'monorepo' | 'library' | 'application' | 'unknown' =
      files.length > 500 ? 'monorepo' : 'application';

    const maxTokens = this.getRecommendedBudget(projectType);
    const responseReserve = await this.getRecommendedResponseReserve(query);

    return this.optimizeContext({
      files,
      query,
      maxTokens,
      responseReserve,
    });
  }
}
