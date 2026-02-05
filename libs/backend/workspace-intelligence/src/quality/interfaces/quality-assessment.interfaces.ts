/**
 * Quality Assessment Service Interfaces
 *
 * Interface contracts for code quality assessment services.
 * These interfaces define the public API for quality analysis,
 * anti-pattern detection, project intelligence, and prescriptive guidance.
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import type {
  QualityAssessment,
  AntiPattern,
  SamplingConfig,
  WorkspaceContext,
  ProjectIntelligence,
  PrescriptiveGuidance,
} from '@ptah-extension/shared';
import type * as vscode from 'vscode';

// ============================================
// Supporting Types
// ============================================

/**
 * Represents a sampled source file with its content and metadata.
 * Used during quality assessment to analyze a representative subset of files.
 */
export interface SampledFile {
  /** Relative file path from workspace root */
  path: string;
  /** Full file content */
  content: string;
  /** Detected programming language (e.g., 'typescript', 'javascript') */
  language: string;
  /** Estimated token count for the file content */
  estimatedTokens: number;
}

// ============================================
// Service Interfaces
// ============================================

/**
 * Service for assessing code quality through intelligent file sampling
 * and anti-pattern detection.
 *
 * Responsibilities:
 * - Sample representative files from workspace
 * - Orchestrate anti-pattern detection across sampled files
 * - Calculate overall quality score
 * - Identify quality gaps and strengths
 */
export interface ICodeQualityAssessmentService {
  /**
   * Assess code quality for a workspace.
   *
   * Performs intelligent file sampling, runs anti-pattern detection,
   * and calculates a quality score with identified gaps and strengths.
   *
   * @param workspaceUri - Workspace root URI
   * @param config - Optional sampling configuration overrides
   * @returns Promise resolving to QualityAssessment with score, patterns, and gaps
   *
   * @example
   * ```typescript
   * const assessment = await service.assessQuality(workspaceUri);
   * console.log(`Quality Score: ${assessment.score}/100`);
   * console.log(`Anti-patterns: ${assessment.antiPatterns.length}`);
   * ```
   */
  assessQuality(
    workspaceUri: vscode.Uri,
    config?: Partial<SamplingConfig>
  ): Promise<QualityAssessment>;

  /**
   * Sample source files for analysis using intelligent selection.
   *
   * Selects a representative subset of files using:
   * - Entry points (main.ts, index.ts, app.ts)
   * - High-relevance files (services, components, controllers)
   * - Random sample for diversity
   *
   * @param workspaceUri - Workspace root URI
   * @param config - Sampling configuration
   * @returns Promise resolving to array of sampled files with content
   *
   * @example
   * ```typescript
   * const files = await service.sampleFiles(workspaceUri, DEFAULT_SAMPLING_CONFIG);
   * console.log(`Sampled ${files.length} files for analysis`);
   * ```
   */
  sampleFiles(
    workspaceUri: vscode.Uri,
    config: SamplingConfig
  ): Promise<SampledFile[]>;
}

/**
 * Service for detecting anti-patterns in source code using a rule engine.
 *
 * Responsibilities:
 * - Load and manage detection rules
 * - Execute pattern detection on file content
 * - Aggregate patterns across multiple files
 * - Calculate quality score from detected patterns
 */
export interface IAntiPatternDetectionService {
  /**
   * Detect anti-patterns in a single file's content.
   *
   * Runs all applicable rules for the file type and returns
   * detected anti-patterns with locations and suggestions.
   *
   * @param content - File content to analyze
   * @param filePath - Relative file path (used for extension detection and location)
   * @returns Array of detected anti-patterns
   *
   * @example
   * ```typescript
   * const patterns = service.detectPatterns(fileContent, 'src/user.service.ts');
   * patterns.forEach(p => console.log(`${p.type}: ${p.message}`));
   * ```
   */
  detectPatterns(content: string, filePath: string): AntiPattern[];

  /**
   * Detect anti-patterns across multiple files with frequency aggregation.
   *
   * Analyzes all provided files and aggregates patterns by type,
   * tracking frequency of each pattern type across the codebase.
   *
   * @param files - Array of sampled files to analyze
   * @returns Aggregated anti-patterns with frequency counts
   *
   * @example
   * ```typescript
   * const patterns = service.detectPatternsInFiles(sampledFiles);
   * const topIssue = patterns.sort((a, b) => b.frequency - a.frequency)[0];
   * console.log(`Most common: ${topIssue.type} (${topIssue.frequency} occurrences)`);
   * ```
   */
  detectPatternsInFiles(files: SampledFile[]): AntiPattern[];

  /**
   * Calculate a quality score from detected anti-patterns.
   *
   * Score starts at 100 and deducts based on:
   * - Severity: error (-10), warning (-5), info (-2)
   * - Frequency: capped at 3x deduction per pattern type
   * - Minimum score: 0
   *
   * @param antiPatterns - Detected anti-patterns
   * @param fileCount - Number of files analyzed (for normalization)
   * @returns Quality score between 0 and 100
   *
   * @example
   * ```typescript
   * const score = service.calculateScore(patterns, 15);
   * if (score < 60) {
   *   console.log('Code quality needs improvement');
   * }
   * ```
   */
  calculateScore(antiPatterns: AntiPattern[], fileCount: number): number;
}

/**
 * Unified facade service for project intelligence.
 *
 * Combines workspace context detection with quality assessment
 * to provide comprehensive project intelligence. Includes caching
 * with configurable TTL and invalidation.
 *
 * Responsibilities:
 * - Orchestrate workspace analysis and quality assessment
 * - Combine results into unified ProjectIntelligence
 * - Manage in-memory caching with TTL
 * - Provide cache invalidation API
 */
export interface IProjectIntelligenceService {
  /**
   * Get complete project intelligence for a workspace.
   *
   * Combines:
   * - Workspace context (project type, frameworks, dependencies)
   * - Quality assessment (score, anti-patterns, gaps)
   * - Prescriptive guidance (recommendations)
   *
   * Results are cached for 5 minutes by default.
   *
   * @param workspaceUri - Workspace root URI
   * @returns Promise resolving to unified ProjectIntelligence
   *
   * @example
   * ```typescript
   * const intel = await service.getIntelligence(workspaceUri);
   * console.log(`Project: ${intel.workspaceContext.projectType}`);
   * console.log(`Quality: ${intel.qualityAssessment.score}/100`);
   * console.log(`Top recommendation: ${intel.prescriptiveGuidance.recommendations[0]?.issue}`);
   * ```
   */
  getIntelligence(workspaceUri: vscode.Uri): Promise<ProjectIntelligence>;

  /**
   * Get workspace context only (no quality assessment).
   *
   * Faster than getIntelligence when only project metadata is needed.
   * Does not trigger quality assessment or prescriptive guidance generation.
   *
   * @param workspaceUri - Workspace root URI
   * @returns Promise resolving to WorkspaceContext
   *
   * @example
   * ```typescript
   * const context = await service.getWorkspaceContext(workspaceUri);
   * if (context.isMonorepo) {
   *   console.log(`Monorepo type: ${context.monorepoType}`);
   * }
   * ```
   */
  getWorkspaceContext(workspaceUri: vscode.Uri): Promise<WorkspaceContext>;

  /**
   * Invalidate cached intelligence for a workspace.
   *
   * Call this when workspace files have changed significantly
   * (e.g., source file modifications, dependency updates).
   *
   * @param workspaceUri - Workspace root URI to invalidate
   *
   * @example
   * ```typescript
   * // After file changes detected
   * service.invalidateCache(workspaceUri);
   *
   * // Next getIntelligence call will recompute
   * const freshIntel = await service.getIntelligence(workspaceUri);
   * ```
   */
  invalidateCache(workspaceUri: vscode.Uri): void;
}

/**
 * Service for generating prescriptive guidance from quality assessment.
 *
 * Transforms quality assessment data into actionable recommendations
 * prioritized by frequency, severity, and fix complexity.
 *
 * Responsibilities:
 * - Prioritize issues by impact and frequency
 * - Generate actionable recommendations
 * - Respect token budgets for LLM context
 * - Provide example files for each recommendation
 */
export interface IPrescriptiveGuidanceService {
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
   * const guidance = service.generateGuidance(assessment, context, 500);
   * console.log(guidance.summary);
   * guidance.recommendations.forEach(rec => {
   *   console.log(`[${rec.priority}] ${rec.issue}: ${rec.solution}`);
   * });
   * ```
   */
  generateGuidance(
    assessment: QualityAssessment,
    context: WorkspaceContext,
    tokenBudget?: number
  ): PrescriptiveGuidance;
}
