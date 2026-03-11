/**
 * Prescriptive Guidance Service
 *
 * Generates prioritized, actionable recommendations from quality assessment results.
 * Transforms anti-patterns into prescriptive guidance with token budget management.
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type {
  QualityAssessment,
  WorkspaceContext,
  PrescriptiveGuidance,
  Recommendation,
  AntiPattern,
  AntiPatternSeverity,
} from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { IPrescriptiveGuidanceService } from '../interfaces';

// ============================================
// Constants
// ============================================

/**
 * Severity weights for prioritization.
 * Higher weight = higher priority.
 */
const SEVERITY_WEIGHTS: Record<AntiPatternSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

/**
 * Estimated tokens per recommendation for budget calculation.
 * Accounts for category, issue, solution, and example files.
 */
const TOKENS_PER_RECOMMENDATION = 50;

/**
 * Default token budget for guidance generation.
 */
const DEFAULT_TOKEN_BUDGET = 500;

/**
 * Maximum number of example files per recommendation.
 */
const MAX_EXAMPLE_FILES = 5;

/**
 * Category display names for human-readable output.
 */
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript Type Safety',
  error: 'Error Handling',
  arch: 'Architecture',
  test: 'Testing',
};

// ============================================
// Internal Types
// ============================================

/**
 * Grouped anti-pattern data for recommendation generation.
 */
interface PatternGroup {
  /** Anti-pattern type */
  type: string;
  /** Category extracted from type (e.g., 'typescript' from 'typescript-explicit-any') */
  category: string;
  /** All patterns of this type */
  patterns: AntiPattern[];
  /** Total occurrences (sum of frequencies) */
  totalFrequency: number;
  /** Highest severity in group */
  maxSeverity: AntiPatternSeverity;
  /** Priority score (frequency * severity weight) */
  priorityScore: number;
}

// ============================================
// Service Implementation
// ============================================

/**
 * PrescriptiveGuidanceService
 *
 * Generates actionable recommendations from quality assessment results.
 * Prioritizes issues by frequency and severity, respects token budgets,
 * and includes example file references for each recommendation.
 *
 * Key responsibilities:
 * - Group anti-patterns by type
 * - Calculate priority scores (frequency * severity)
 * - Generate human-readable recommendations
 * - Manage token budget with truncation
 *
 * Design Pattern: Strategy Pattern (prioritization strategy)
 * SOLID: Single Responsibility (guidance generation only)
 *
 * @example
 * ```typescript
 * const service = container.resolve<PrescriptiveGuidanceService>(
 *   TOKENS.PRESCRIPTIVE_GUIDANCE_SERVICE
 * );
 *
 * const guidance = service.generateGuidance(assessment, context, 500);
 * console.log(guidance.summary);
 * guidance.recommendations.forEach(rec => {
 *   console.log(`[${rec.priority}] ${rec.issue}: ${rec.solution}`);
 * });
 * ```
 */
@injectable()
export class PrescriptiveGuidanceService
  implements IPrescriptiveGuidanceService
{
  /**
   * Creates a new PrescriptiveGuidanceService.
   *
   * @param logger - Logger for diagnostic output
   */
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('PrescriptiveGuidanceService initialized');
  }

  /**
   * Generate prescriptive guidance from a quality assessment.
   *
   * Creates prioritized recommendations based on:
   * - Pattern frequency (most common issues first)
   * - Severity weighting (errors > warnings > info)
   * - Example file references
   *
   * Respects token budget to fit within LLM context limits.
   *
   * @param assessment - Quality assessment results
   * @param context - Workspace context for framework-specific guidance
   * @param tokenBudget - Maximum tokens for guidance (default: 500)
   * @returns Prescriptive guidance with prioritized recommendations
   *
   * @example
   * ```typescript
   * const guidance = service.generateGuidance(assessment, context);
   * if (guidance.wasTruncated) {
   *   console.log('Some recommendations were omitted due to token limit');
   * }
   * ```
   */
  generateGuidance(
    assessment: QualityAssessment,
    context: WorkspaceContext,
    tokenBudget: number = DEFAULT_TOKEN_BUDGET
  ): PrescriptiveGuidance {
    this.logger.debug('Generating prescriptive guidance', {
      antiPatternCount: assessment.antiPatterns.length,
      qualityScore: assessment.score,
      tokenBudget,
      projectType: context.projectType,
    });

    // Handle clean codebase case
    if (assessment.antiPatterns.length === 0) {
      return this.generateCleanCodebaseGuidance(assessment, context);
    }

    // Group patterns by type and calculate priority
    const groups = this.groupAndPrioritizePatterns(assessment.antiPatterns);

    // Generate recommendations from groups
    const allRecommendations = this.generateRecommendations(groups);

    // Apply token budget truncation
    const { recommendations, wasTruncated, totalTokens } =
      this.applyTokenBudget(allRecommendations, tokenBudget);

    // Generate executive summary from top recommendations
    const summary = this.generateSummary(recommendations, assessment.score);

    const guidance: PrescriptiveGuidance = {
      summary,
      recommendations,
      totalTokens,
      wasTruncated,
    };

    this.logger.info('Prescriptive guidance generated', {
      recommendationCount: recommendations.length,
      wasTruncated,
      totalTokens,
    });

    return guidance;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Generates guidance for a clean codebase with no anti-patterns.
   *
   * @param assessment - Quality assessment with no anti-patterns
   * @param context - Workspace context
   * @returns Positive guidance with advanced recommendations
   */
  private generateCleanCodebaseGuidance(
    assessment: QualityAssessment,
    context: WorkspaceContext
  ): PrescriptiveGuidance {
    const advancedRecommendations: Recommendation[] = [];

    // Add framework-specific advanced recommendations
    if (context.framework) {
      advancedRecommendations.push({
        priority: 1,
        category: 'Best Practices',
        issue: 'Consider adopting advanced patterns',
        solution: `Your ${context.framework} codebase is clean. Consider implementing advanced patterns like lazy loading, state management optimization, or performance profiling.`,
      });
    }

    // Add testing recommendations if no test patterns detected
    if (
      !assessment.sampledFiles.some(
        (f) => f.includes('.spec.') || f.includes('.test.')
      )
    ) {
      advancedRecommendations.push({
        priority: 2,
        category: 'Testing',
        issue: 'Maintain test coverage',
        solution:
          'Continue writing comprehensive tests to maintain code quality. Consider property-based testing or mutation testing for critical paths.',
      });
    }

    // Add documentation recommendation
    advancedRecommendations.push({
      priority: 3,
      category: 'Documentation',
      issue: 'Keep documentation current',
      solution:
        'Maintain API documentation and architectural decision records (ADRs) to preserve institutional knowledge.',
    });

    const summary = `Excellent code quality (${assessment.score}/100). No significant anti-patterns detected. Focus on advanced optimizations and maintaining current standards.`;

    return {
      summary,
      recommendations: advancedRecommendations,
      totalTokens: this.estimateTokens(summary, advancedRecommendations),
      wasTruncated: false,
    };
  }

  /**
   * Groups anti-patterns by type and calculates priority scores.
   *
   * @param antiPatterns - Detected anti-patterns
   * @returns Sorted array of pattern groups (highest priority first)
   */
  private groupAndPrioritizePatterns(
    antiPatterns: AntiPattern[]
  ): PatternGroup[] {
    const groupMap = new Map<string, PatternGroup>();

    for (const pattern of antiPatterns) {
      const existing = groupMap.get(pattern.type);

      if (existing) {
        existing.patterns.push(pattern);
        existing.totalFrequency += pattern.frequency;

        // Update max severity if this pattern has higher severity
        if (
          SEVERITY_WEIGHTS[pattern.severity] >
          SEVERITY_WEIGHTS[existing.maxSeverity]
        ) {
          existing.maxSeverity = pattern.severity;
        }
      } else {
        // Extract category from type (e.g., 'typescript' from 'typescript-explicit-any')
        const category = pattern.type.split('-')[0];

        groupMap.set(pattern.type, {
          type: pattern.type,
          category,
          patterns: [pattern],
          totalFrequency: pattern.frequency,
          maxSeverity: pattern.severity,
          priorityScore: 0, // Will be calculated below
        });
      }
    }

    // Calculate priority scores and sort
    const groups = Array.from(groupMap.values());

    for (const group of groups) {
      group.priorityScore =
        group.totalFrequency * SEVERITY_WEIGHTS[group.maxSeverity];
    }

    // Sort by priority score (descending)
    groups.sort((a, b) => b.priorityScore - a.priorityScore);

    this.logger.debug('Patterns grouped and prioritized', {
      groupCount: groups.length,
      topGroup: groups[0]?.type,
      topPriorityScore: groups[0]?.priorityScore,
    });

    return groups;
  }

  /**
   * Generates recommendations from pattern groups.
   *
   * @param groups - Prioritized pattern groups
   * @returns Array of recommendations
   */
  private generateRecommendations(groups: PatternGroup[]): Recommendation[] {
    return groups.map((group, index) => {
      // Get the first pattern for message and suggestion
      const firstPattern = group.patterns[0];

      // Collect unique file paths for examples
      const exampleFiles = this.collectExampleFiles(group.patterns);

      // Get human-readable category name
      const categoryName =
        CATEGORY_DISPLAY_NAMES[group.category] ||
        this.titleCase(group.category);

      // Build issue description
      const issue = this.buildIssueDescription(group, firstPattern);

      return {
        priority: index + 1,
        category: categoryName,
        issue,
        solution: firstPattern.suggestion,
        exampleFiles: exampleFiles.length > 0 ? exampleFiles : undefined,
      };
    });
  }

  /**
   * Collects unique example files from patterns.
   *
   * @param patterns - Patterns to extract files from
   * @returns Array of unique file paths (max MAX_EXAMPLE_FILES)
   */
  private collectExampleFiles(patterns: AntiPattern[]): string[] {
    const files = new Set<string>();

    for (const pattern of patterns) {
      if (pattern.location.file) {
        files.add(pattern.location.file);

        if (files.size >= MAX_EXAMPLE_FILES) {
          break;
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Builds a human-readable issue description.
   *
   * @param group - Pattern group
   * @param firstPattern - First pattern in group (for message)
   * @returns Issue description string
   */
  private buildIssueDescription(
    group: PatternGroup,
    firstPattern: AntiPattern
  ): string {
    const occurrences = group.totalFrequency;
    const fileCount = new Set(group.patterns.map((p) => p.location.file)).size;

    // Extract core message without frequency info
    const baseMessage = firstPattern.message.split('(')[0].trim();

    if (occurrences === 1) {
      return baseMessage;
    }

    return `${baseMessage} (${occurrences} occurrences in ${fileCount} file${
      fileCount === 1 ? '' : 's'
    })`;
  }

  /**
   * Applies token budget to recommendations with truncation.
   *
   * @param recommendations - All generated recommendations
   * @param tokenBudget - Maximum tokens allowed
   * @returns Truncated recommendations with metadata
   */
  private applyTokenBudget(
    recommendations: Recommendation[],
    tokenBudget: number
  ): {
    recommendations: Recommendation[];
    wasTruncated: boolean;
    totalTokens: number;
  } {
    // Reserve tokens for summary (~100 tokens)
    const availableForRecommendations = tokenBudget - 100;

    // Calculate how many recommendations fit
    const maxRecommendations = Math.max(
      1, // Always include at least one recommendation
      Math.floor(availableForRecommendations / TOKENS_PER_RECOMMENDATION)
    );

    const wasTruncated = recommendations.length > maxRecommendations;
    const truncatedRecommendations = recommendations.slice(
      0,
      maxRecommendations
    );

    // Estimate total tokens
    const totalTokens = this.estimateTokens('', truncatedRecommendations) + 100;

    if (wasTruncated) {
      this.logger.debug('Recommendations truncated due to token budget', {
        original: recommendations.length,
        truncated: truncatedRecommendations.length,
        tokenBudget,
      });
    }

    return {
      recommendations: truncatedRecommendations,
      wasTruncated,
      totalTokens,
    };
  }

  /**
   * Generates an executive summary from top recommendations.
   *
   * @param recommendations - Prioritized recommendations
   * @param qualityScore - Overall quality score
   * @returns Summary string
   */
  private generateSummary(
    recommendations: Recommendation[],
    qualityScore: number
  ): string {
    if (recommendations.length === 0) {
      return `Code quality score: ${qualityScore}/100. No significant issues detected.`;
    }

    // Get quality level description
    let qualityLevel: string;
    if (qualityScore >= 80) {
      qualityLevel = 'good';
    } else if (qualityScore >= 60) {
      qualityLevel = 'acceptable';
    } else if (qualityScore >= 40) {
      qualityLevel = 'needs improvement';
    } else {
      qualityLevel = 'poor';
    }

    // Build summary from top 3 recommendations
    const topIssues = recommendations
      .slice(0, 3)
      .map((r) => r.category.toLowerCase())
      .filter((v, i, a) => a.indexOf(v) === i); // Unique categories

    const issueList = topIssues.join(', ');

    return `Code quality is ${qualityLevel} (${qualityScore}/100). Primary areas for improvement: ${issueList}. ${
      recommendations.length
    } recommendation${recommendations.length === 1 ? '' : 's'} generated.`;
  }

  /**
   * Estimates token count for guidance.
   *
   * @param summary - Summary text
   * @param recommendations - Recommendations array
   * @returns Estimated token count
   */
  private estimateTokens(
    summary: string,
    recommendations: Recommendation[]
  ): number {
    // Rough estimation: ~4 characters per token
    const summaryTokens = Math.ceil(summary.length / 4);
    const recommendationTokens =
      recommendations.length * TOKENS_PER_RECOMMENDATION;

    return summaryTokens + recommendationTokens;
  }

  /**
   * Converts a string to title case.
   *
   * @param str - String to convert
   * @returns Title-cased string
   */
  private titleCase(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
}
