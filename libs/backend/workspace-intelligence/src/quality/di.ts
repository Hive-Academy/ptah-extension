/**
 * Quality Services DI Registration
 *
 * TASK_2025_141 Batch 6: Register all quality assessment services in DI container.
 *
 * Pattern: Follow workspace-intelligence/src/di/register.ts for consistency.
 * Services use @injectable() decorators for auto-wiring.
 *
 * DEPENDENCY ORDER:
 * Tier 1: AntiPatternDetectionService (no quality service dependencies)
 * Tier 2: CodeQualityAssessmentService (depends on AntiPatternDetectionService)
 * Tier 3: PrescriptiveGuidanceService (no quality service dependencies)
 * Tier 4: ProjectIntelligenceService (depends on CodeQualityAssessment, PrescriptiveGuidance)
 */

import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';

// Import quality assessment services
import { AntiPatternDetectionService } from './services/anti-pattern-detection.service';
import { FileHashCacheService } from './services/file-hash-cache.service';
import { CodeQualityAssessmentService } from './services/code-quality-assessment.service';
import { PrescriptiveGuidanceService } from './services/prescriptive-guidance.service';
import { ProjectIntelligenceService } from './services/project-intelligence.service';

/**
 * Register quality assessment services in DI container.
 *
 * This function registers all services required for code quality assessment:
 * - AntiPatternDetectionService: Rule-based anti-pattern detection
 * - CodeQualityAssessmentService: File sampling and quality scoring
 * - PrescriptiveGuidanceService: Recommendation generation
 * - ProjectIntelligenceService: Unified facade for project intelligence
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for registration logging
 */
export function registerQualityServices(
  container: DependencyContainer,
  logger: Logger
): void {
  logger.info('[Quality Services] Registering quality assessment services...');

  // ============================================================
  // Tier 1: Base detection service (no quality service dependencies)
  // ============================================================
  container.registerSingleton(
    TOKENS.ANTI_PATTERN_DETECTION_SERVICE,
    AntiPatternDetectionService
  );

  // ============================================================
  // Tier 1.5: File hash cache service (TASK_2025_144 Phase F)
  // ============================================================
  container.registerSingleton(
    TOKENS.FILE_HASH_CACHE_SERVICE,
    FileHashCacheService
  );

  // ============================================================
  // Tier 2: Quality assessment service (depends on anti-pattern detection, file hash cache)
  // ============================================================
  container.registerSingleton(
    TOKENS.CODE_QUALITY_ASSESSMENT_SERVICE,
    CodeQualityAssessmentService
  );

  // ============================================================
  // Tier 3: Guidance generation service (no quality service dependencies)
  // ============================================================
  container.registerSingleton(
    TOKENS.PRESCRIPTIVE_GUIDANCE_SERVICE,
    PrescriptiveGuidanceService
  );

  // ============================================================
  // Tier 4: Unified facade (depends on quality assessment and guidance)
  // ============================================================
  container.registerSingleton(
    TOKENS.PROJECT_INTELLIGENCE_SERVICE,
    ProjectIntelligenceService
  );

  logger.info('[Quality Services] Quality assessment services registered', {
    services: [
      'ANTI_PATTERN_DETECTION_SERVICE',
      'FILE_HASH_CACHE_SERVICE',
      'CODE_QUALITY_ASSESSMENT_SERVICE',
      'PRESCRIPTIVE_GUIDANCE_SERVICE',
      'PROJECT_INTELLIGENCE_SERVICE',
    ],
  });
}
