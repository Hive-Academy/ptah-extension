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
  AntiPatternType,
  QualityHistoryEntry,
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

// ============================================
// File Hash Cache Service Interface (Phase F - TASK_2025_144)
// ============================================

/**
 * Cache entry for storing file analysis state.
 * Tracks content hash, analysis timestamp, and detected patterns per file.
 */
export interface FileHashCacheEntry {
  /** SHA-256 content hash (16-char hex prefix) */
  hash: string;
  /** Timestamp of when this entry was last analyzed */
  analysisTimestamp: number;
  /** Timestamp of when this entry was last accessed (for LRU eviction) */
  lastAccessTimestamp: number;
  /** Anti-patterns detected in this file */
  patterns: AntiPattern[];
}

/**
 * Service for caching file content hashes and per-file analysis results.
 *
 * Enables incremental analysis by detecting which files have changed
 * since the last analysis run. Uses SHA-256 content hashing with
 * LRU eviction (max 10,000 entries) and 30-minute TTL.
 *
 * Responsibilities:
 * - Compute and store SHA-256 content hashes per file
 * - Detect file changes via hash comparison
 * - Cache per-file anti-pattern detection results
 * - Provide cache statistics for performance monitoring
 */
export interface IFileHashCacheService {
  /**
   * Get the cached hash for a file path.
   *
   * @param filePath - Relative file path from workspace root
   * @returns The cached hash string, or undefined if not cached
   */
  getHash(filePath: string): string | undefined;

  /**
   * Set the hash for a file path.
   *
   * @param filePath - Relative file path from workspace root
   * @param hash - SHA-256 hash string
   */
  setHash(filePath: string, hash: string): void;

  /**
   * Check if a file's content has changed since last cached hash.
   * Computes a fresh hash from content and compares to cached.
   * Also returns true if the cached entry has expired (TTL exceeded).
   *
   * @param filePath - Relative file path from workspace root
   * @param content - Current file content
   * @returns True if the file has changed or is not cached
   */
  hasChanged(filePath: string, content: string): boolean;

  /**
   * Update the cached hash for a file after fresh analysis.
   * Computes hash from content and stores it with current timestamp.
   *
   * @param filePath - Relative file path from workspace root
   * @param content - Current file content
   */
  updateHash(filePath: string, content: string): void;

  /**
   * Get cached anti-pattern results for a file.
   * Returns undefined if not cached or cache entry has expired.
   *
   * @param filePath - Relative file path from workspace root
   * @returns Cached anti-patterns, or undefined if not available
   */
  getCachedPatterns(filePath: string): AntiPattern[] | undefined;

  /**
   * Store anti-pattern results for a file in the cache.
   *
   * @param filePath - Relative file path from workspace root
   * @param patterns - Detected anti-patterns for this file
   */
  setCachedPatterns(filePath: string, patterns: AntiPattern[]): void;

  /**
   * Get all file paths that have cached entries.
   *
   * @returns Array of file paths with valid (non-expired) cache entries
   */
  getCachedFiles(): string[];

  /**
   * Clear all cached entries.
   * Called on full re-analysis or cache invalidation.
   */
  clearCache(): void;

  /**
   * Get cache statistics for monitoring and diagnostics.
   *
   * @returns Object with total cached entries and cache hit rate
   */
  getStats(): { totalCached: number; cacheHitRate: number };
}

// ============================================
// Quality History Service Interface (Phase G - TASK_2025_144)
// ============================================

/**
 * Service for storing quality assessment snapshots for historical tracking.
 *
 * Persists compact assessment snapshots via VS Code globalState.
 * Maintains a rolling window of entries (max 100) with oldest-first eviction.
 *
 * Responsibilities:
 * - Record new assessment snapshots
 * - Retrieve history entries (newest first)
 * - Manage storage limits and eviction
 */
export interface IQualityHistoryService {
  /**
   * Record a new assessment snapshot in history.
   *
   * Creates a compact QualityHistoryEntry from the assessment
   * and persists it to globalState. Evicts oldest entries if
   * the maximum entry count is exceeded.
   *
   * @param assessment - Quality assessment to record
   */
  recordAssessment(assessment: QualityAssessment): Promise<void>;

  /**
   * Get history entries ordered newest first.
   *
   * @param limit - Maximum number of entries to return (default: 30)
   * @returns Array of history entries, newest first
   */
  getHistory(limit?: number): QualityHistoryEntry[];

  /**
   * Clear all history entries.
   *
   * Removes all stored history from globalState.
   */
  clearHistory(): Promise<void>;
}

// ============================================
// Quality Export Service Interface (Phase G - TASK_2025_144)
// ============================================

/**
 * Service for generating quality reports in multiple formats.
 *
 * Transforms ProjectIntelligence data into human-readable or
 * machine-parseable report formats for export.
 *
 * Responsibilities:
 * - Generate Markdown reports with summary, tables, and recommendations
 * - Generate JSON exports (full ProjectIntelligence serialization)
 * - Generate CSV exports with flat anti-pattern rows
 */
export interface IQualityExportService {
  /**
   * Export assessment as a formatted Markdown report.
   *
   * Generates a comprehensive report including:
   * - Header with project metadata and score
   * - Anti-patterns table (type, severity, location, frequency)
   * - Quality gaps table (area, priority, description, recommendation)
   * - Strengths list
   * - Prioritized recommendations
   *
   * @param intelligence - Full project intelligence data
   * @returns Markdown-formatted report string
   */
  exportMarkdown(intelligence: ProjectIntelligence): string;

  /**
   * Export assessment as formatted JSON.
   *
   * Serializes the full ProjectIntelligence object with
   * 2-space indentation for readability.
   *
   * @param intelligence - Full project intelligence data
   * @returns JSON-formatted string
   */
  exportJson(intelligence: ProjectIntelligence): string;

  /**
   * Export anti-patterns as CSV rows.
   *
   * Generates a CSV file with one row per anti-pattern:
   * type, severity, file, line, column, frequency, message, suggestion
   *
   * Handles proper CSV escaping for fields containing commas or quotes.
   *
   * @param intelligence - Full project intelligence data
   * @returns CSV-formatted string with header row
   */
  exportCsv(intelligence: ProjectIntelligence): string;
}
