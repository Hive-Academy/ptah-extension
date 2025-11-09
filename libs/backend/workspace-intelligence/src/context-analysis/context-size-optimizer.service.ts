/**
 * Context Size Optimizer Service
 *
 * Manages token budgets and selects optimal file sets for Claude Code CLI integration.
 * Ensures context stays within LLM limits while maximizing relevance.
 *
 * @module libs/backend/workspace-intelligence/context-analysis
 */

import { injectable } from 'tsyringe';
import { IndexedFile } from '../types/workspace.types';
import { FileRelevanceScorerService } from './file-relevance-scorer.service';
import { TokenCounterService } from '../services/token-counter.service';

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
  constructor(
    private readonly relevanceScorer: FileRelevanceScorerService,
    private readonly tokenCounter: TokenCounterService
  ) {}

  /**
   * Optimize context for Claude CLI integration
   *
   * @param request - Optimization parameters with files and budget
   * @returns Optimized context within token limits
   */
  async optimizeContext(
    request: ContextOptimizationRequest
  ): Promise<OptimizedContext> {
    const maxTokens = request.maxTokens ?? 200_000;
    const responseReserve = request.responseReserve ?? 50_000;
    const availableTokens = maxTokens - responseReserve;

    // Rank files by relevance
    const rankedFiles = this.relevanceScorer.rankFiles(
      request.files,
      request.query
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
