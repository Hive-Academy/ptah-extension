/**
 * Project Intelligence Service
 *
 * Unified facade service that combines workspace context detection with
 * code quality assessment to provide comprehensive project intelligence.
 *
 * TASK_2025_141: Unified Project Intelligence with Code Quality Assessment
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import type {
  ProjectIntelligence,
  WorkspaceContext,
  QualityAssessment,
  PrescriptiveGuidance,
} from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { ProjectDetectorService } from '../../project-analysis/project-detector.service';
import { FrameworkDetectorService } from '../../project-analysis/framework-detector.service';
import { MonorepoDetectorService } from '../../project-analysis/monorepo-detector.service';
import { DependencyAnalyzerService } from '../../project-analysis/dependency-analyzer.service';
import type {
  IProjectIntelligenceService,
  ICodeQualityAssessmentService,
  IPrescriptiveGuidanceService,
} from '../interfaces';

// ============================================
// Constants
// ============================================

/**
 * Cache time-to-live in milliseconds (5 minutes).
 * After this period, cached intelligence is considered stale.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Default token budget for prescriptive guidance.
 */
const DEFAULT_GUIDANCE_TOKEN_BUDGET = 500;

// ============================================
// Internal Types
// ============================================

/**
 * Cache entry for project intelligence.
 */
interface CacheEntry {
  /** Cached project intelligence */
  intelligence: ProjectIntelligence;
  /** Timestamp when cache was created */
  timestamp: number;
}

// ============================================
// Service Implementation
// ============================================

/**
 * ProjectIntelligenceService
 *
 * Unified facade that orchestrates workspace analysis, quality assessment,
 * and prescriptive guidance generation into a single cohesive API.
 *
 * Key responsibilities:
 * - Coordinate between detection services and quality assessment
 * - Build comprehensive WorkspaceContext from multiple sources
 * - Cache intelligence with configurable TTL
 * - Provide cache invalidation for file change scenarios
 *
 * Design Pattern: Facade Pattern (unified API over multiple services)
 * SOLID: Single Responsibility (intelligence orchestration only)
 *
 * @example
 * ```typescript
 * const service = container.resolve<ProjectIntelligenceService>(
 *   TOKENS.PROJECT_INTELLIGENCE_SERVICE
 * );
 *
 * // Get full project intelligence
 * const intel = await service.getIntelligence(workspaceUri);
 * console.log(`Project: ${intel.workspaceContext.projectType}`);
 * console.log(`Quality: ${intel.qualityAssessment.score}/100`);
 * console.log(`Top issue: ${intel.prescriptiveGuidance.recommendations[0]?.issue}`);
 *
 * // Invalidate after file changes
 * service.invalidateCache(workspaceUri);
 * ```
 */
@injectable()
export class ProjectIntelligenceService implements IProjectIntelligenceService {
  /**
   * In-memory cache for project intelligence.
   * Key: workspace path (string)
   * Value: CacheEntry with intelligence and timestamp
   */
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Creates a new ProjectIntelligenceService.
   *
   * @param logger - Logger for diagnostic output
   * @param projectDetector - Service for project type detection
   * @param frameworkDetector - Service for framework detection
   * @param monorepoDetector - Service for monorepo detection
   * @param dependencyAnalyzer - Service for dependency analysis
   * @param qualityAssessment - Service for code quality assessment
   * @param guidanceService - Service for prescriptive guidance generation
   */
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.PROJECT_DETECTOR_SERVICE)
    private readonly projectDetector: ProjectDetectorService,
    @inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE)
    private readonly frameworkDetector: FrameworkDetectorService,
    @inject(TOKENS.MONOREPO_DETECTOR_SERVICE)
    private readonly monorepoDetector: MonorepoDetectorService,
    @inject(TOKENS.DEPENDENCY_ANALYZER_SERVICE)
    private readonly dependencyAnalyzer: DependencyAnalyzerService,
    @inject(TOKENS.CODE_QUALITY_ASSESSMENT_SERVICE)
    private readonly qualityAssessment: ICodeQualityAssessmentService,
    @inject(TOKENS.PRESCRIPTIVE_GUIDANCE_SERVICE)
    private readonly guidanceService: IPrescriptiveGuidanceService
  ) {
    this.logger.debug('ProjectIntelligenceService initialized');
  }

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
   * if (intel.qualityAssessment.score < 60) {
   *   console.log('Quality issues detected:');
   *   intel.prescriptiveGuidance.recommendations.forEach(rec => {
   *     console.log(`- ${rec.issue}`);
   *   });
   * }
   * ```
   */
  async getIntelligence(
    workspaceUri: vscode.Uri
  ): Promise<ProjectIntelligence> {
    const cacheKey = workspaceUri.fsPath;
    const startTime = Date.now();

    this.logger.debug('Getting project intelligence', {
      workspacePath: cacheKey,
    });

    // Check cache first
    const cached = this.getCachedIntelligence(cacheKey);
    if (cached) {
      this.logger.debug('Returning cached project intelligence', {
        workspacePath: cacheKey,
        cacheAge: Date.now() - cached.timestamp,
      });
      return cached.intelligence;
    }

    // Build fresh intelligence
    try {
      // Get workspace context from detection services
      const workspaceContext = await this.getWorkspaceContext(workspaceUri);

      // Perform quality assessment
      const qualityAssessment = await this.qualityAssessment.assessQuality(
        workspaceUri
      );

      // Generate prescriptive guidance
      const prescriptiveGuidance = this.guidanceService.generateGuidance(
        qualityAssessment,
        workspaceContext,
        DEFAULT_GUIDANCE_TOKEN_BUDGET
      );

      // Build unified intelligence
      const intelligence: ProjectIntelligence = {
        workspaceContext,
        qualityAssessment,
        prescriptiveGuidance,
        timestamp: Date.now(),
      };

      // Cache the result
      this.cache.set(cacheKey, {
        intelligence,
        timestamp: Date.now(),
      });

      const durationMs = Date.now() - startTime;
      this.logger.info('Project intelligence generated', {
        workspacePath: cacheKey,
        projectType: workspaceContext.projectType,
        qualityScore: qualityAssessment.score,
        recommendationCount: prescriptiveGuidance.recommendations.length,
        durationMs,
      });

      return intelligence;
    } catch (error) {
      this.logger.error('Failed to generate project intelligence', {
        workspacePath: cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return a minimal intelligence object on error
      return this.createMinimalIntelligence(workspaceUri);
    }
  }

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
   * console.log(`Project: ${context.projectType}`);
   * if (context.isMonorepo) {
   *   console.log(`Monorepo type: ${context.monorepoType}`);
   * }
   * ```
   */
  async getWorkspaceContext(
    workspaceUri: vscode.Uri
  ): Promise<WorkspaceContext> {
    this.logger.debug('Building workspace context', {
      workspacePath: workspaceUri.fsPath,
    });

    try {
      // Detect project type
      const projectType = await this.projectDetector.detectProjectType(
        workspaceUri
      );

      // Detect framework based on project type
      const projectTypesMap = new Map<vscode.Uri, typeof projectType>();
      projectTypesMap.set(workspaceUri, projectType);
      const frameworksMap = await this.frameworkDetector.detectFrameworks(
        projectTypesMap
      );
      const framework = frameworksMap.get(workspaceUri);

      // Detect monorepo
      const monorepoResult = await this.monorepoDetector.detectMonorepo(
        workspaceUri
      );

      // Analyze dependencies (requires project type)
      const dependencyResult =
        await this.dependencyAnalyzer.analyzeDependencies(
          workspaceUri,
          projectType
        );

      // Detect languages from project type
      const languages = this.detectLanguages(projectType);

      // Detect architecture patterns from project structure
      const architecturePatterns = this.detectArchitecturePatterns(
        projectType,
        framework,
        monorepoResult.isMonorepo
      );

      const context: WorkspaceContext = {
        projectType: String(projectType),
        framework: framework ? String(framework) : undefined,
        isMonorepo: monorepoResult.isMonorepo,
        monorepoType: monorepoResult.isMonorepo
          ? String(monorepoResult.type)
          : undefined,
        dependencies: dependencyResult.dependencies.map((d) => d.name),
        devDependencies: dependencyResult.devDependencies.map((d) => d.name),
        languages,
        architecturePatterns,
      };

      this.logger.debug('Workspace context built', {
        projectType: context.projectType,
        framework: context.framework,
        isMonorepo: context.isMonorepo,
        dependencyCount: context.dependencies.length,
      });

      return context;
    } catch (error) {
      this.logger.error('Failed to build workspace context', {
        workspacePath: workspaceUri.fsPath,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return minimal context on error
      return this.createMinimalContext();
    }
  }

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
   * // After detecting file changes
   * service.invalidateCache(workspaceUri);
   *
   * // Next getIntelligence call will recompute
   * const freshIntel = await service.getIntelligence(workspaceUri);
   * ```
   */
  invalidateCache(workspaceUri: vscode.Uri): void {
    const cacheKey = workspaceUri.fsPath;
    const hadCache = this.cache.has(cacheKey);

    this.cache.delete(cacheKey);

    if (hadCache) {
      this.logger.debug('Cache invalidated for workspace', {
        workspacePath: cacheKey,
      });
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Gets cached intelligence if valid (within TTL).
   *
   * @param cacheKey - Cache key (workspace path)
   * @returns Cache entry if valid, undefined if stale or missing
   */
  private getCachedIntelligence(cacheKey: string): CacheEntry | undefined {
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return undefined;
    }

    const age = Date.now() - entry.timestamp;
    if (age > CACHE_TTL_MS) {
      // Cache is stale, remove it
      this.cache.delete(cacheKey);
      this.logger.debug('Cache expired', {
        workspacePath: cacheKey,
        ageMs: age,
        ttlMs: CACHE_TTL_MS,
      });
      return undefined;
    }

    return entry;
  }

  /**
   * Detects primary programming languages from project type.
   *
   * @param projectType - Detected project type
   * @returns Array of language names
   */
  private detectLanguages(projectType: string): string[] {
    const languageMap: Record<string, string[]> = {
      node: ['JavaScript', 'TypeScript'],
      react: ['JavaScript', 'TypeScript', 'JSX', 'TSX'],
      vue: ['JavaScript', 'TypeScript', 'Vue'],
      angular: ['TypeScript'],
      nextjs: ['JavaScript', 'TypeScript', 'JSX', 'TSX'],
      python: ['Python'],
      java: ['Java'],
      rust: ['Rust'],
      go: ['Go'],
      dotnet: ['C#', 'F#'],
      php: ['PHP'],
      ruby: ['Ruby'],
    };

    const languages = languageMap[projectType.toLowerCase()];
    return languages || ['Unknown'];
  }

  /**
   * Detects architecture patterns from project characteristics.
   *
   * @param projectType - Detected project type
   * @param framework - Detected framework (if any)
   * @param isMonorepo - Whether workspace is a monorepo
   * @returns Array of detected architecture patterns
   */
  private detectArchitecturePatterns(
    projectType: string,
    framework: string | undefined,
    isMonorepo: boolean
  ): string[] {
    const patterns: string[] = [];

    // Add monorepo pattern
    if (isMonorepo) {
      patterns.push('Monorepo');
    }

    // Framework-specific patterns
    if (framework) {
      const frameworkLower = framework.toLowerCase();

      if (frameworkLower === 'angular') {
        patterns.push('Component-Based', 'Dependency Injection', 'MVC');
      } else if (frameworkLower === 'react' || frameworkLower === 'vue') {
        patterns.push('Component-Based', 'Unidirectional Data Flow');
      } else if (frameworkLower === 'nextjs' || frameworkLower === 'nuxt') {
        patterns.push('Component-Based', 'File-Based Routing', 'SSR/SSG');
      } else if (frameworkLower === 'express' || frameworkLower === 'fastify') {
        patterns.push('Middleware', 'REST API');
      } else if (frameworkLower === 'nestjs') {
        patterns.push('Dependency Injection', 'Modular', 'REST API');
      } else if (frameworkLower === 'django' || frameworkLower === 'rails') {
        patterns.push('MVC', 'ORM', 'Convention over Configuration');
      }
    }

    // Project type specific patterns
    const projectTypeLower = projectType.toLowerCase();
    if (projectTypeLower === 'node' && !framework) {
      patterns.push('Modular');
    }

    // Deduplicate
    return [...new Set(patterns)];
  }

  /**
   * Creates minimal intelligence object for error scenarios.
   *
   * @param workspaceUri - Workspace root URI
   * @returns Minimal ProjectIntelligence
   */
  private createMinimalIntelligence(
    workspaceUri: vscode.Uri
  ): ProjectIntelligence {
    const minimalContext = this.createMinimalContext();
    const minimalAssessment = this.createMinimalAssessment();
    const minimalGuidance = this.createMinimalGuidance();

    return {
      workspaceContext: minimalContext,
      qualityAssessment: minimalAssessment,
      prescriptiveGuidance: minimalGuidance,
      timestamp: Date.now(),
    };
  }

  /**
   * Creates minimal context for error scenarios.
   *
   * @returns Minimal WorkspaceContext
   */
  private createMinimalContext(): WorkspaceContext {
    return {
      projectType: 'unknown',
      isMonorepo: false,
      dependencies: [],
      devDependencies: [],
      languages: ['Unknown'],
      architecturePatterns: [],
    };
  }

  /**
   * Creates minimal assessment for error scenarios.
   *
   * @returns Minimal QualityAssessment
   */
  private createMinimalAssessment(): QualityAssessment {
    return {
      score: 50, // Neutral score
      antiPatterns: [],
      gaps: [
        {
          area: 'Analysis',
          priority: 'low',
          description: 'Unable to complete analysis',
          recommendation: 'Check workspace structure and try again',
        },
      ],
      strengths: [],
      sampledFiles: [],
      analysisTimestamp: Date.now(),
      analysisDurationMs: 0,
    };
  }

  /**
   * Creates minimal guidance for error scenarios.
   *
   * @returns Minimal PrescriptiveGuidance
   */
  private createMinimalGuidance(): PrescriptiveGuidance {
    return {
      summary:
        'Unable to generate guidance. Please verify workspace structure.',
      recommendations: [],
      totalTokens: 50,
      wasTruncated: false,
    };
  }
}
