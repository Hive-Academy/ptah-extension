/**
 * Code Quality Assessment Service
 *
 * Service for assessing code quality through intelligent file sampling
 * and anti-pattern detection. Orchestrates the quality assessment pipeline.
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type {
  QualityAssessment,
  QualityGap,
  QualityGapPriority,
  SamplingConfig,
  AntiPattern,
} from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { WorkspaceIndexerService } from '../../file-indexing/workspace-indexer.service';
import { FileSystemService } from '../../services/file-system.service';
import { FileRelevanceScorerService } from '../../context-analysis/file-relevance-scorer.service';
import { IndexedFile } from '../../types/workspace.types';
import type {
  ICodeQualityAssessmentService,
  IAntiPatternDetectionService,
  IFileHashCacheService,
  SampledFile,
} from '../interfaces';
import { AntiPatternDetectionService } from './anti-pattern-detection.service';

// ============================================
// Constants
// ============================================

/**
 * Source file extensions to include in quality assessment.
 * These are the primary programming language files we analyze.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Entry point file patterns for intelligent sampling.
 * These files are prioritized as they often define application structure.
 */
const ENTRY_POINT_PATTERNS = [
  'main.ts',
  'index.ts',
  'app.ts',
  'main.tsx',
  'index.tsx',
  'app.tsx',
];

/**
 * Test file patterns to exclude from analysis.
 */
const TEST_FILE_PATTERNS = ['.spec.', '.test.', '__tests__', '__mocks__'];

/**
 * Declaration file patterns to exclude.
 */
const DECLARATION_FILE_PATTERNS = ['.d.ts'];

/**
 * Default sampling configuration.
 * Aligned with DEFAULT_SAMPLING_CONFIG from shared types.
 */
const DEFAULT_CONFIG: SamplingConfig = {
  maxFiles: 15,
  entryPointCount: 3,
  highRelevanceCount: 8,
  randomCount: 4,
  priorityPatterns: [
    'service',
    'component',
    'controller',
    'repository',
    'model',
  ],
  excludePatterns: ['*.spec.ts', '*.test.ts', '*.d.ts', 'index.ts'],
};

/**
 * Category mapping for gap identification from anti-pattern types.
 */
const CATEGORY_FROM_TYPE: Record<string, string> = {
  typescript: 'TypeScript Type Safety',
  error: 'Error Handling',
  arch: 'Architecture',
  test: 'Testing',
  angular: 'Angular Best Practices',
  nestjs: 'NestJS Best Practices',
  react: 'React Best Practices',
};

/**
 * Default strengths when certain patterns are absent.
 */
const DEFAULT_STRENGTHS: Record<string, string> = {
  typescript: 'Minimal explicit any usage - good type coverage',
  error: 'Proper error handling patterns observed',
  arch: 'Reasonable file sizes and module organization',
  test: 'Test files follow good practices',
  angular: 'Angular components follow best practices',
  nestjs: 'NestJS services follow proper patterns',
  react: 'React components follow best practices',
};

// ============================================
// Service Implementation
// ============================================

/**
 * CodeQualityAssessmentService
 *
 * Implements intelligent file sampling and quality assessment orchestration.
 * This service coordinates between:
 * - WorkspaceIndexerService: File discovery and indexing
 * - FileRelevanceScorerService: File prioritization
 * - AntiPatternDetectionService: Pattern detection
 *
 * Key responsibilities:
 * - Sample representative files from workspace
 * - Read file contents for analysis
 * - Orchestrate anti-pattern detection
 * - Calculate quality score and identify gaps
 *
 * Design Pattern: Facade Pattern (orchestrates multiple services)
 * SOLID: Single Responsibility (quality assessment orchestration only)
 *
 * @example
 * ```typescript
 * const service = container.resolve<CodeQualityAssessmentService>(
 *   TOKENS.CODE_QUALITY_ASSESSMENT_SERVICE
 * );
 *
 * const assessment = await service.assessQuality(workspacePath);
 * console.log(`Quality Score: ${assessment.score}/100`);
 * console.log(`Issues: ${assessment.antiPatterns.length} pattern types`);
 * ```
 */
@injectable()
export class CodeQualityAssessmentService implements ICodeQualityAssessmentService {
  /**
   * Creates a new CodeQualityAssessmentService.
   *
   * @param logger - Logger for diagnostic output
   * @param indexer - Service for workspace file indexing
   * @param fileSystem - Service for file content reading
   * @param relevanceScorer - Service for file relevance scoring
   * @param antiPatternDetector - Service for pattern detection
   * @param fileHashCache - Service for file content hash caching (Phase F - TASK_2025_144)
   */
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService,
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.FILE_RELEVANCE_SCORER)
    private readonly relevanceScorer: FileRelevanceScorerService,
    @inject(TOKENS.ANTI_PATTERN_DETECTION_SERVICE)
    private readonly antiPatternDetector: IAntiPatternDetectionService,
    @inject(TOKENS.FILE_HASH_CACHE_SERVICE)
    private readonly fileHashCache: IFileHashCacheService,
  ) {
    this.logger.debug('CodeQualityAssessmentService initialized');
  }

  /**
   * Assess code quality for a workspace.
   *
   * Performs intelligent file sampling, runs anti-pattern detection,
   * and calculates a quality score with identified gaps and strengths.
   *
   * @param workspacePath - Workspace root URI
   * @param config - Optional sampling configuration overrides
   * @returns QualityAssessment with score, patterns, gaps, and strengths
   *
   * @example
   * ```typescript
   * const assessment = await service.assessQuality(workspacePath, {
   *   maxFiles: 20,
   *   entryPointCount: 5,
   * });
   *
   * if (assessment.score < 60) {
   *   console.log('Significant quality issues detected');
   *   assessment.gaps.forEach(gap => {
   *     console.log(`[${gap.priority}] ${gap.area}: ${gap.description}`);
   *   });
   * }
   * ```
   */
  async assessQuality(
    workspacePath: string,
    config?: Partial<SamplingConfig>,
  ): Promise<QualityAssessment> {
    const startTime = Date.now();

    // Merge configuration with defaults
    const mergedConfig: SamplingConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.logger.info('Starting quality assessment', {
      workspacePath: workspacePath,
      config: mergedConfig,
    });

    // Sample files for analysis
    const sampledFiles = await this.sampleFiles(workspacePath, mergedConfig);

    // Handle empty workspace case
    if (sampledFiles.length === 0) {
      this.logger.info('No source files found for analysis', {
        workspacePath: workspacePath,
      });

      return this.createNeutralAssessment(startTime);
    }

    // Detect anti-patterns across sampled files
    // TASK_2025_291 B2: detectPatternsInFiles is now async because some rules
    // (e.g. `functionTooLargeRule`) rely on tree-sitter AST analysis.
    const antiPatterns =
      await this.antiPatternDetector.detectPatternsInFiles(sampledFiles);

    // Calculate quality score
    const score = this.antiPatternDetector.calculateScore(
      antiPatterns,
      sampledFiles.length,
    );

    // Identify quality gaps from patterns
    const gaps = this.identifyGaps(antiPatterns);

    // Identify strengths (categories with no/few issues)
    const strengths = this.identifyStrengths(antiPatterns);

    // Build assessment result
    const assessment: QualityAssessment = {
      score,
      antiPatterns,
      gaps,
      strengths,
      sampledFiles: sampledFiles.map((f) => f.path),
      analysisTimestamp: Date.now(),
      analysisDurationMs: Date.now() - startTime,
    };

    this.logger.info('Quality assessment complete', {
      score,
      patternCount: antiPatterns.length,
      gapCount: gaps.length,
      strengthCount: strengths.length,
      filesAnalyzed: sampledFiles.length,
      durationMs: assessment.analysisDurationMs,
    });

    return assessment;
  }

  /**
   * Sample source files for analysis using intelligent selection.
   *
   * Selection strategy:
   * 1. Entry points (main.ts, index.ts, app.ts) - up to entryPointCount
   * 2. High-relevance files (services, components) - up to highRelevanceCount
   * 3. Random sample for diversity - up to randomCount
   *
   * Filtering:
   * - Only source files (.ts, .tsx, .js, .jsx)
   * - Excludes test files (.spec, .test)
   * - Excludes declaration files (.d.ts)
   *
   * @param workspacePath - Workspace root URI
   * @param config - Sampling configuration
   * @returns Array of sampled files with content
   *
   * @example
   * ```typescript
   * const files = await service.sampleFiles(workspacePath, {
   *   maxFiles: 15,
   *   entryPointCount: 3,
   *   highRelevanceCount: 8,
   *   randomCount: 4,
   * });
   * console.log(`Sampled ${files.length} files for analysis`);
   * ```
   */
  async sampleFiles(
    workspacePath: string,
    config: SamplingConfig,
  ): Promise<SampledFile[]> {
    this.logger.debug('Starting file sampling', {
      workspacePath: workspacePath,
      config,
    });

    // Index workspace with token estimation
    const index = await this.indexer.indexWorkspace({
      workspaceFolder: workspacePath,
      estimateTokens: true,
      respectIgnoreFiles: true,
    });

    // Filter to source files only
    const sourceFiles = index.files.filter((file) => this.isSourceFile(file));

    if (sourceFiles.length === 0) {
      this.logger.debug('No source files found in workspace');
      return [];
    }

    this.logger.debug('Source files found', {
      total: index.files.length,
      sourceFiles: sourceFiles.length,
    });

    // Select files using intelligent sampling
    const selectedFiles = this.selectFilesIntelligently(sourceFiles, config);

    // Read file contents
    const sampledFiles: SampledFile[] = [];

    for (const file of selectedFiles) {
      try {
        const content = await this.fileSystem.readFile(file.path);

        sampledFiles.push({
          path: file.relativePath,
          content,
          language: file.language || 'unknown',
          estimatedTokens: file.estimatedTokens,
        });
      } catch (error) {
        // Skip files that fail to read
        this.logger.warn('Failed to read file for sampling', {
          filePath: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.debug('File sampling complete', {
      requested: selectedFiles.length,
      sampled: sampledFiles.length,
    });

    return sampledFiles;
  }

  // ============================================
  // Incremental Analysis (Phase F - TASK_2025_144)
  // ============================================

  /**
   * Assess code quality with incremental analysis using file hash caching.
   *
   * Uses FileHashCacheService to detect which files have changed since the
   * last analysis. Unchanged files retrieve cached pattern results; changed
   * files are analyzed fresh using async parallel detection. Returns a full
   * QualityAssessment with incremental statistics.
   *
   * @param workspacePath - Workspace root URI
   * @param config - Optional sampling configuration overrides
   * @returns QualityAssessment with incrementalStats populated
   *
   * @example
   * ```typescript
   * const assessment = await service.assessQualityIncremental(workspacePath);
   * console.log(`Cache hit rate: ${assessment.incrementalStats?.cacheHitRate}`);
   * ```
   */
  async assessQualityIncremental(
    workspacePath: string,
    config?: Partial<SamplingConfig>,
  ): Promise<QualityAssessment> {
    const startTime = Date.now();

    // Merge config with defaults, applying adaptive sample size
    const mergedConfig: SamplingConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.logger.info('Starting incremental quality assessment', {
      workspacePath: workspacePath,
      config: mergedConfig,
    });

    // Sample files for analysis
    const sampledFiles = await this.sampleFiles(workspacePath, mergedConfig);

    if (sampledFiles.length === 0) {
      this.logger.info('No source files found for incremental analysis', {
        workspacePath: workspacePath,
      });
      return this.createNeutralAssessment(startTime);
    }

    // Separate files into cached (unchanged) and fresh (changed)
    const cachedPatterns: AntiPattern[] = [];
    const freshFiles: SampledFile[] = [];
    let cachedFileCount = 0;

    for (const file of sampledFiles) {
      if (this.fileHashCache.hasChanged(file.path, file.content)) {
        freshFiles.push(file);
      } else {
        const cached = this.fileHashCache.getCachedPatterns(file.path);
        if (cached && cached.length > 0) {
          cachedPatterns.push(...cached);
        }
        cachedFileCount++;
      }
    }

    this.logger.debug('Incremental analysis file split', {
      total: sampledFiles.length,
      cached: cachedFileCount,
      fresh: freshFiles.length,
    });

    // Analyze fresh files individually (not aggregated) so we can cache per-file
    const freshPatterns: AntiPattern[] = [];
    if (freshFiles.length > 0) {
      // Use the concrete AntiPatternDetectionService for async methods
      const asyncDetector = this
        .antiPatternDetector as AntiPatternDetectionService;
      const hasAsync = typeof asyncDetector.detectPatternsAsync === 'function';

      for (const file of freshFiles) {
        let filePatterns: AntiPattern[];

        if (hasAsync) {
          filePatterns = await asyncDetector.detectPatternsAsync(
            file.content,
            file.path,
          );
        } else {
          // TASK_2025_291 B2: detectPatterns is now async.
          filePatterns = await this.antiPatternDetector.detectPatterns(
            file.content,
            file.path,
          );
        }

        // Cache per-file patterns before aggregation
        this.fileHashCache.updateHash(file.path, file.content);
        this.fileHashCache.setCachedPatterns(file.path, filePatterns);

        freshPatterns.push(...filePatterns);
      }
    }

    // Merge cached and fresh patterns, re-aggregate
    const allPatterns = [...cachedPatterns, ...freshPatterns];

    // Calculate quality score from merged patterns
    const score = this.antiPatternDetector.calculateScore(
      allPatterns,
      sampledFiles.length,
    );

    // Identify gaps and strengths
    const gaps = this.identifyGaps(allPatterns);
    const strengths = this.identifyStrengths(allPatterns);

    // Calculate cache hit rate
    const cacheHitRate =
      sampledFiles.length > 0 ? cachedFileCount / sampledFiles.length : 0;

    const assessment: QualityAssessment = {
      score,
      antiPatterns: allPatterns,
      gaps,
      strengths,
      sampledFiles: sampledFiles.map((f) => f.path),
      analysisTimestamp: Date.now(),
      analysisDurationMs: Date.now() - startTime,
      incrementalStats: {
        cachedFiles: cachedFileCount,
        freshFiles: freshFiles.length,
        cacheHitRate,
      },
    };

    this.logger.info('Incremental quality assessment complete', {
      score,
      patternCount: allPatterns.length,
      cachedFiles: cachedFileCount,
      freshFiles: freshFiles.length,
      cacheHitRate: cacheHitRate.toFixed(2),
      durationMs: assessment.analysisDurationMs,
    });

    return assessment;
  }

  /**
   * Calculate adaptive sample size based on total file count.
   *
   * Scales sampling dynamically:
   * - Small projects (<= 50 files): sample up to 15
   * - Medium projects (<= 200 files): sample 20
   * - Large projects (<= 1000 files): sample 30
   * - Very large projects (<= 5000 files): sample 40
   * - Massive projects (> 5000 files): sample 50
   *
   * @param totalFiles - Total number of source files in the workspace
   * @returns Recommended sample size
   */
  calculateAdaptiveSampleSize(totalFiles: number): number {
    if (totalFiles <= 50) return Math.min(totalFiles, 15);
    if (totalFiles <= 200) return 20;
    if (totalFiles <= 1000) return 30;
    if (totalFiles <= 5000) return 40;
    return 50;
  }

  /**
   * Get framework-aware priority file patterns for intelligent sampling.
   *
   * Returns file name patterns that should be prioritized during sampling
   * based on the detected framework. Framework-specific files are most
   * likely to contain framework-specific anti-patterns.
   *
   * @param framework - Detected framework name (e.g., 'angular', 'react', 'nestjs')
   * @returns Array of priority file name patterns
   */
  getFrameworkPriorityPatterns(framework: string | undefined): string[] {
    switch (framework?.toLowerCase()) {
      case 'angular':
        return [
          'component',
          'service',
          'module',
          'guard',
          'interceptor',
          'pipe',
          'directive',
        ];
      case 'react':
        return ['component', 'hook', 'context', 'provider', 'reducer', 'store'];
      case 'nestjs':
        return [
          'controller',
          'service',
          'module',
          'guard',
          'middleware',
          'interceptor',
          'repository',
        ];
      default:
        return ['service', 'component', 'controller', 'repository', 'model'];
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Checks if a file is a source file eligible for quality analysis.
   *
   * @param file - Indexed file to check
   * @returns True if file should be analyzed
   */
  private isSourceFile(file: IndexedFile): boolean {
    // Check extension
    const hasSourceExtension = SOURCE_EXTENSIONS.some((ext) =>
      file.relativePath.toLowerCase().endsWith(ext),
    );

    if (!hasSourceExtension) {
      return false;
    }

    // Exclude test files
    const isTestFile = TEST_FILE_PATTERNS.some((pattern) =>
      file.relativePath.toLowerCase().includes(pattern),
    );

    if (isTestFile) {
      return false;
    }

    // Exclude declaration files
    const isDeclarationFile = DECLARATION_FILE_PATTERNS.some((pattern) =>
      file.relativePath.toLowerCase().includes(pattern),
    );

    if (isDeclarationFile) {
      return false;
    }

    return true;
  }

  /**
   * Selects files intelligently based on sampling configuration.
   *
   * @param files - Available source files
   * @param config - Sampling configuration
   * @returns Selected files for analysis
   */
  private selectFilesIntelligently(
    files: IndexedFile[],
    config: SamplingConfig,
  ): IndexedFile[] {
    const selected = new Set<IndexedFile>();

    // 1. Select entry points first
    const entryPoints = files.filter((file) =>
      ENTRY_POINT_PATTERNS.some((pattern) =>
        file.relativePath.toLowerCase().endsWith(pattern),
      ),
    );

    for (const file of entryPoints.slice(0, config.entryPointCount)) {
      selected.add(file);
    }

    this.logger.debug('Entry points selected', {
      found: entryPoints.length,
      selected: Math.min(entryPoints.length, config.entryPointCount),
    });

    // 2. Select high-relevance files (using priority patterns as query)
    const remainingFiles = files.filter((file) => !selected.has(file));
    const priorityQuery = config.priorityPatterns.join(' ');

    const rankedFiles = this.relevanceScorer.getTopFiles(
      remainingFiles,
      priorityQuery,
      config.highRelevanceCount + config.randomCount, // Get more to allow for random selection
    );

    // Add high-relevance files
    let highRelevanceAdded = 0;
    for (const result of rankedFiles) {
      if (highRelevanceAdded >= config.highRelevanceCount) {
        break;
      }
      if (!selected.has(result.file)) {
        selected.add(result.file);
        highRelevanceAdded++;
      }
    }

    this.logger.debug('High-relevance files selected', {
      ranked: rankedFiles.length,
      added: highRelevanceAdded,
    });

    // 3. Random selection for diversity
    const stillRemaining = files.filter((file) => !selected.has(file));

    if (stillRemaining.length > 0 && config.randomCount > 0) {
      // Fisher-Yates shuffle for random selection
      const shuffled = [...stillRemaining];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const randomCount = Math.min(config.randomCount, shuffled.length);
      for (let i = 0; i < randomCount; i++) {
        selected.add(shuffled[i]);
      }

      this.logger.debug('Random files selected', {
        available: stillRemaining.length,
        added: randomCount,
      });
    }

    // Limit to maxFiles
    const result = Array.from(selected).slice(0, config.maxFiles);

    this.logger.debug('File selection complete', {
      totalSelected: result.length,
      maxFiles: config.maxFiles,
    });

    return result;
  }

  /**
   * Identifies quality gaps from detected anti-patterns.
   *
   * @param antiPatterns - Detected anti-patterns
   * @returns Array of quality gaps
   */
  private identifyGaps(antiPatterns: AntiPattern[]): QualityGap[] {
    // Group patterns by category
    const categoryOccurrences = new Map<string, number>();

    for (const pattern of antiPatterns) {
      // Extract category from pattern type (e.g., 'typescript' from 'typescript-explicit-any')
      const category = pattern.type.split('-')[0];
      const current = categoryOccurrences.get(category) || 0;
      categoryOccurrences.set(category, current + pattern.frequency);
    }

    // Create gaps for categories with issues
    const gaps: QualityGap[] = [];

    for (const [category, occurrences] of categoryOccurrences) {
      const priority = this.determineGapPriority(occurrences, antiPatterns);
      const categoryName = CATEGORY_FROM_TYPE[category] || category;

      // Find the most frequent pattern in this category for description
      const categoryPatterns = antiPatterns.filter((p) =>
        p.type.startsWith(category),
      );
      const topPattern = categoryPatterns.sort(
        (a, b) => b.frequency - a.frequency,
      )[0];

      gaps.push({
        area: categoryName,
        priority,
        description: `${occurrences} ${category} anti-pattern${
          occurrences === 1 ? '' : 's'
        } detected`,
        recommendation:
          topPattern?.suggestion || `Review and fix ${category} issues`,
      });
    }

    // Sort by priority (high first)
    const priorityOrder: Record<QualityGapPriority, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };

    gaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return gaps;
  }

  /**
   * Determines gap priority based on occurrence count and severity.
   *
   * @param occurrences - Total occurrences in category
   * @param patterns - All anti-patterns
   * @returns Priority level
   */
  private determineGapPriority(
    occurrences: number,
    patterns: AntiPattern[],
  ): QualityGapPriority {
    // Check for any error-severity patterns
    const hasErrors = patterns.some((p) => p.severity === 'error');

    if (hasErrors || occurrences >= 10) {
      return 'high';
    } else if (occurrences >= 5) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Identifies strengths (categories with few or no issues).
   *
   * @param antiPatterns - Detected anti-patterns
   * @returns Array of strength descriptions
   */
  private identifyStrengths(antiPatterns: AntiPattern[]): string[] {
    const strengths: string[] = [];

    // Get categories with issues
    const categoriesWithIssues = new Set(
      antiPatterns.map((p) => p.type.split('-')[0]),
    );

    // Add strengths for categories without issues
    for (const [category, strength] of Object.entries(DEFAULT_STRENGTHS)) {
      if (!categoriesWithIssues.has(category)) {
        strengths.push(strength);
      }
    }

    // If very few patterns overall, add general strength
    if (antiPatterns.length <= 2) {
      strengths.push('Overall clean codebase with minimal anti-patterns');
    }

    return strengths;
  }

  /**
   * Creates a neutral assessment for empty workspaces.
   *
   * @param startTime - Assessment start timestamp
   * @returns Neutral QualityAssessment
   */
  private createNeutralAssessment(startTime: number): QualityAssessment {
    return {
      score: 50, // Neutral score for empty/no-source workspaces
      antiPatterns: [],
      gaps: [
        {
          area: 'Analysis',
          priority: 'low',
          description: 'No source files found for analysis',
          recommendation:
            'Ensure workspace contains TypeScript or JavaScript source files',
        },
      ],
      strengths: [],
      sampledFiles: [],
      analysisTimestamp: Date.now(),
      analysisDurationMs: Date.now() - startTime,
    };
  }
}
