/**
 * Anti-Pattern Detection Service
 *
 * Service for detecting anti-patterns in source code using a rule engine.
 * Provides pattern detection, aggregation, and quality scoring capabilities.
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type {
  AntiPattern,
  AntiPatternSeverity,
  AntiPatternType,
} from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { IAntiPatternDetectionService, SampledFile } from '../interfaces';
import { RuleRegistry, getFileExtension } from '../rules';

// ============================================
// Severity Weights for Score Calculation
// ============================================

/**
 * Score deductions by severity level.
 * These values represent how much each severity level impacts the quality score.
 */
const SEVERITY_DEDUCTIONS: Record<AntiPatternSeverity, number> = {
  error: 10,
  warning: 5,
  info: 2,
};

/**
 * Maximum number of times a single pattern type can contribute to score deduction.
 * This prevents a single widespread pattern from completely dominating the score.
 */
const MAX_FREQUENCY_MULTIPLIER = 3;

// ============================================
// Internal Types
// ============================================

/**
 * Internal tracking structure for pattern aggregation
 */
interface PatternAggregation {
  /** First occurrence of this pattern type */
  pattern: AntiPattern;
  /** Total count of occurrences */
  count: number;
  /** Files where this pattern was found */
  files: Set<string>;
}

// ============================================
// Service Implementation
// ============================================

/**
 * AntiPatternDetectionService
 *
 * Implements rule-based anti-pattern detection for source code analysis.
 * Uses the RuleRegistry to manage detection rules and provides:
 *
 * - Single file pattern detection
 * - Multi-file pattern aggregation with frequency tracking
 * - Quality score calculation based on detected patterns
 *
 * Design Pattern: Strategy Pattern (rules are pluggable strategies)
 * SOLID: Single Responsibility (only handles pattern detection and scoring)
 *
 * @example
 * ```typescript
 * const service = container.resolve<AntiPatternDetectionService>(
 *   TOKENS.ANTI_PATTERN_DETECTION_SERVICE
 * );
 *
 * // Detect patterns in single file
 * const patterns = service.detectPatterns(fileContent, 'src/user.service.ts');
 *
 * // Detect across multiple files
 * const aggregated = service.detectPatternsInFiles(sampledFiles);
 *
 * // Calculate quality score
 * const score = service.calculateScore(aggregated, sampledFiles.length);
 * ```
 */
@injectable()
export class AntiPatternDetectionService
  implements IAntiPatternDetectionService
{
  /** Rule registry for managing detection rules */
  private readonly ruleRegistry: RuleRegistry;

  /**
   * Creates a new AntiPatternDetectionService.
   *
   * @param logger - Logger for diagnostic output
   */
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.ruleRegistry = new RuleRegistry();
    this.logger.debug('AntiPatternDetectionService initialized', {
      ruleCount: this.ruleRegistry.getRules().length,
    });
  }

  /**
   * Detect anti-patterns in a single file's content.
   *
   * Runs all applicable rules for the file type (based on extension)
   * and returns detected anti-patterns with locations and suggestions.
   *
   * @param content - File content to analyze
   * @param filePath - Relative file path (used for extension detection and location reporting)
   * @returns Array of detected anti-patterns with suggestions
   *
   * @example
   * ```typescript
   * const patterns = service.detectPatterns(
   *   'const user: any = fetchUser();',
   *   'src/user.service.ts'
   * );
   * // Returns: [{ type: 'typescript-explicit-any', severity: 'warning', ... }]
   * ```
   */
  detectPatterns(content: string, filePath: string): AntiPattern[] {
    const extension = getFileExtension(filePath);

    if (!extension) {
      this.logger.debug(
        'No file extension detected, skipping pattern detection',
        {
          filePath,
        }
      );
      return [];
    }

    // Get rules applicable to this file extension
    const applicableRules = this.ruleRegistry.getRulesForExtension(extension);

    if (applicableRules.length === 0) {
      this.logger.debug('No rules applicable for file extension', {
        filePath,
        extension,
      });
      return [];
    }

    const detectedPatterns: AntiPattern[] = [];

    // Run each applicable rule
    for (const rule of applicableRules) {
      try {
        const matches = rule.detect(content, filePath);

        for (const match of matches) {
          // Get the effective severity (may be overridden in configuration)
          const effectiveSeverity =
            (this.ruleRegistry.getEffectiveSeverity(
              rule.id
            ) as AntiPatternSeverity) || rule.severity;

          // Get suggestion from rule
          const suggestion = rule.getSuggestion(match);

          // Build AntiPattern from match
          const antiPattern: AntiPattern = {
            type: match.type,
            severity: effectiveSeverity,
            location: match.location,
            message: this.buildMessage(rule.name, match.matchedText),
            suggestion,
            frequency: 1, // Single occurrence for single-file detection
          };

          detectedPatterns.push(antiPattern);
        }
      } catch (error) {
        // Log rule execution errors but continue with other rules
        this.logger.warn('Rule execution failed', {
          ruleId: rule.id,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.debug('Pattern detection complete', {
      filePath,
      rulesApplied: applicableRules.length,
      patternsFound: detectedPatterns.length,
    });

    return detectedPatterns;
  }

  /**
   * Detect anti-patterns across multiple files with frequency aggregation.
   *
   * Analyzes all provided files and aggregates patterns by type,
   * tracking the frequency of each pattern type across the codebase.
   * Returns deduplicated patterns with accurate frequency counts.
   *
   * @param files - Array of sampled files to analyze
   * @returns Aggregated anti-patterns with frequency counts
   *
   * @example
   * ```typescript
   * const patterns = service.detectPatternsInFiles(sampledFiles);
   * const mostCommon = patterns.sort((a, b) => b.frequency - a.frequency)[0];
   * console.log(`Most common: ${mostCommon.type} (${mostCommon.frequency} occurrences)`);
   * ```
   */
  detectPatternsInFiles(files: SampledFile[]): AntiPattern[] {
    if (files.length === 0) {
      this.logger.debug('No files provided for pattern detection');
      return [];
    }

    // Aggregation map: pattern type -> aggregation data
    const aggregations = new Map<AntiPatternType, PatternAggregation>();

    // Process each file
    for (const file of files) {
      try {
        const patterns = this.detectPatterns(file.content, file.path);

        for (const pattern of patterns) {
          const existing = aggregations.get(pattern.type);

          if (existing) {
            // Increment count and track file
            existing.count++;
            existing.files.add(pattern.location.file);
          } else {
            // First occurrence of this pattern type
            aggregations.set(pattern.type, {
              pattern,
              count: 1,
              files: new Set([pattern.location.file]),
            });
          }
        }
      } catch (error) {
        // Log file processing errors but continue with other files
        this.logger.warn('File processing failed during pattern detection', {
          filePath: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Convert aggregations to AntiPattern array with frequency
    const aggregatedPatterns: AntiPattern[] = [];

    for (const [, aggregation] of aggregations) {
      const { pattern, count, files: affectedFiles } = aggregation;

      // Update frequency to actual count
      const aggregatedPattern: AntiPattern = {
        ...pattern,
        frequency: count,
        // Update message to reflect aggregation
        message: this.buildAggregatedMessage(
          pattern.message,
          count,
          affectedFiles.size
        ),
      };

      aggregatedPatterns.push(aggregatedPattern);
    }

    // Sort by frequency (descending) then by severity
    aggregatedPatterns.sort((a, b) => {
      // First by frequency
      if (b.frequency !== a.frequency) {
        return b.frequency - a.frequency;
      }
      // Then by severity weight
      return SEVERITY_DEDUCTIONS[b.severity] - SEVERITY_DEDUCTIONS[a.severity];
    });

    this.logger.debug('Multi-file pattern detection complete', {
      filesAnalyzed: files.length,
      uniquePatternTypes: aggregatedPatterns.length,
      totalOccurrences: aggregatedPatterns.reduce(
        (sum, p) => sum + p.frequency,
        0
      ),
    });

    return aggregatedPatterns;
  }

  /**
   * Calculate a quality score from detected anti-patterns.
   *
   * Score starts at 100 and deducts based on:
   * - Severity: error (-10), warning (-5), info (-2) per occurrence
   * - Frequency: capped at 3x deduction per pattern type to prevent
   *   a single widespread pattern from dominating the score
   *
   * @param antiPatterns - Detected anti-patterns (should be aggregated)
   * @param fileCount - Number of files analyzed (for logging/context)
   * @returns Quality score between 0 and 100
   *
   * @example
   * ```typescript
   * const score = service.calculateScore(patterns, 15);
   * if (score < 60) {
   *   console.log('Code quality needs significant improvement');
   * } else if (score < 80) {
   *   console.log('Code quality is acceptable but has room for improvement');
   * } else {
   *   console.log('Code quality is good');
   * }
   * ```
   */
  calculateScore(antiPatterns: AntiPattern[], fileCount: number): number {
    // Start with perfect score
    let score = 100;

    // No patterns = perfect score
    if (antiPatterns.length === 0) {
      this.logger.debug('No anti-patterns detected, returning perfect score', {
        fileCount,
      });
      return score;
    }

    // Calculate deductions for each pattern type
    for (const pattern of antiPatterns) {
      const baseDeduction = SEVERITY_DEDUCTIONS[pattern.severity];

      // Cap frequency impact to prevent single pattern dominance
      const effectiveFrequency = Math.min(
        pattern.frequency,
        MAX_FREQUENCY_MULTIPLIER
      );

      const totalDeduction = baseDeduction * effectiveFrequency;

      score -= totalDeduction;

      this.logger.debug('Score deduction applied', {
        patternType: pattern.type,
        severity: pattern.severity,
        frequency: pattern.frequency,
        effectiveFrequency,
        deduction: totalDeduction,
      });
    }

    // Ensure score stays within 0-100 bounds
    const finalScore = Math.max(0, Math.min(100, score));

    this.logger.info('Quality score calculated', {
      fileCount,
      patternCount: antiPatterns.length,
      totalOccurrences: antiPatterns.reduce((sum, p) => sum + p.frequency, 0),
      finalScore,
    });

    return finalScore;
  }

  // ============================================
  // Async Detection Methods (Phase F - TASK_2025_144)
  // ============================================

  /**
   * Detect anti-patterns in a single file's content using parallel rule execution.
   *
   * Runs all applicable rules concurrently using Promise.allSettled for fault isolation.
   * A failing rule logs a warning but does not block other rules from executing.
   *
   * @param content - File content to analyze
   * @param filePath - Relative file path (used for extension detection and location)
   * @returns Promise resolving to array of detected anti-patterns
   *
   * @example
   * ```typescript
   * const patterns = await service.detectPatternsAsync(
   *   fileContent, 'src/user.service.ts'
   * );
   * ```
   */
  async detectPatternsAsync(
    content: string,
    filePath: string
  ): Promise<AntiPattern[]> {
    const extension = getFileExtension(filePath);

    if (!extension) {
      this.logger.debug(
        'No file extension detected, skipping async pattern detection',
        { filePath }
      );
      return [];
    }

    const applicableRules = this.ruleRegistry.getRulesForExtension(extension);

    if (applicableRules.length === 0) {
      this.logger.debug('No rules applicable for file extension (async)', {
        filePath,
        extension,
      });
      return [];
    }

    // Run all rules in parallel with fault isolation
    const results = await Promise.allSettled(
      applicableRules.map((rule) =>
        Promise.resolve().then(() => ({
          rule,
          matches: rule.detect(content, filePath),
        }))
      )
    );

    const detectedPatterns: AntiPattern[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { rule, matches } = result.value;

        for (const match of matches) {
          const effectiveSeverity =
            (this.ruleRegistry.getEffectiveSeverity(
              rule.id
            ) as AntiPatternSeverity) || rule.severity;

          const suggestion = rule.getSuggestion(match);

          detectedPatterns.push({
            type: match.type,
            severity: effectiveSeverity,
            location: match.location,
            message: this.buildMessage(rule.name, match.matchedText),
            suggestion,
            frequency: 1,
          });
        }
      } else {
        this.logger.warn('Async rule execution failed', {
          ruleId: applicableRules[index].id,
          filePath,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });

    this.logger.debug('Async pattern detection complete', {
      filePath,
      rulesApplied: applicableRules.length,
      patternsFound: detectedPatterns.length,
    });

    return detectedPatterns;
  }

  /**
   * Detect anti-patterns across multiple files in parallel batches.
   *
   * Processes files in batches of 5, running async detection per file.
   * Aggregates patterns by type with frequency tracking, same as
   * the synchronous detectPatternsInFiles method.
   *
   * @param files - Array of sampled files to analyze
   * @returns Promise resolving to aggregated anti-patterns with frequency counts
   *
   * @example
   * ```typescript
   * const patterns = await service.detectPatternsInFilesAsync(sampledFiles);
   * ```
   */
  async detectPatternsInFilesAsync(
    files: SampledFile[]
  ): Promise<AntiPattern[]> {
    if (files.length === 0) {
      this.logger.debug('No files provided for async pattern detection');
      return [];
    }

    const BATCH_SIZE = 5;
    const aggregations = new Map<AntiPatternType, PatternAggregation>();

    // Process files in batches
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map((file) => this.detectPatternsAsync(file.content, file.path))
      );

      // Merge batch results into aggregations
      batchResults.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') {
          for (const pattern of result.value) {
            const existing = aggregations.get(pattern.type);

            if (existing) {
              existing.count++;
              existing.files.add(pattern.location.file);
            } else {
              aggregations.set(pattern.type, {
                pattern,
                count: 1,
                files: new Set([pattern.location.file]),
              });
            }
          }
        } else {
          const failedFile = batch[batchIndex];
          this.logger.warn(
            'Async file processing failed during pattern detection',
            {
              filePath: failedFile.path,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            }
          );
        }
      });
    }

    // Convert aggregations to AntiPattern array with frequency
    const aggregatedPatterns: AntiPattern[] = [];

    for (const [, aggregation] of aggregations) {
      const { pattern, count, files: affectedFiles } = aggregation;

      aggregatedPatterns.push({
        ...pattern,
        frequency: count,
        message: this.buildAggregatedMessage(
          pattern.message,
          count,
          affectedFiles.size
        ),
      });
    }

    // Sort by frequency (descending) then by severity
    aggregatedPatterns.sort((a, b) => {
      if (b.frequency !== a.frequency) {
        return b.frequency - a.frequency;
      }
      return SEVERITY_DEDUCTIONS[b.severity] - SEVERITY_DEDUCTIONS[a.severity];
    });

    this.logger.debug('Async multi-file pattern detection complete', {
      filesAnalyzed: files.length,
      uniquePatternTypes: aggregatedPatterns.length,
      totalOccurrences: aggregatedPatterns.reduce(
        (sum, p) => sum + p.frequency,
        0
      ),
    });

    return aggregatedPatterns;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Builds a human-readable message for a single pattern occurrence.
   *
   * @param ruleName - Name of the rule that detected the pattern
   * @param matchedText - Optional matched text for context
   * @returns Formatted message string
   */
  private buildMessage(ruleName: string, matchedText?: string): string {
    if (matchedText && matchedText.length > 0) {
      // Truncate long matched text
      const truncated =
        matchedText.length > 50
          ? `${matchedText.substring(0, 47)}...`
          : matchedText;
      return `${ruleName}: "${truncated}"`;
    }
    return ruleName;
  }

  /**
   * Builds an aggregated message that includes occurrence counts.
   *
   * @param baseMessage - Original message from first occurrence
   * @param count - Total number of occurrences
   * @param fileCount - Number of files affected
   * @returns Formatted aggregated message
   */
  private buildAggregatedMessage(
    baseMessage: string,
    count: number,
    fileCount: number
  ): string {
    if (count === 1) {
      return baseMessage;
    }

    const fileText = fileCount === 1 ? '1 file' : `${fileCount} files`;
    return `${baseMessage} (${count} occurrences in ${fileText})`;
  }
}
