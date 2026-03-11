/**
 * Deep Analysis Type System for Agent Generation
 *
 * This module provides comprehensive types for deep project analysis used by
 * the MCP-powered setup wizard. These types enable intelligent agent recommendations
 * based on thorough project structure, architecture, and code health analysis.
 *
 * @module @ptah-extension/agent-generation/types
 */

import {
  ProjectType,
  Framework,
  MonorepoType,
} from '@ptah-extension/workspace-intelligence';

// Import quality assessment types for DeepProjectAnalysis extension (TASK_2025_141)
import type {
  QualityAssessment,
  QualityGap,
  PrescriptiveGuidance,
} from '@ptah-extension/shared';

// Re-export shared types for backward compatibility
// Consumers can import from either location
export type {
  ArchitecturePattern,
  ArchitecturePatternName,
  KeyFileLocations,
  LanguageStats,
  DiagnosticSummary,
  CodeConventions,
  NamingConventions,
  NamingConvention,
  TestCoverageEstimate,
  AgentRecommendation,
  AgentCategory,
  ProjectAnalysisResult,
  WizardMessageType,
  WizardMessage,
  ScanProgressPayload,
  AnalysisCompletePayload,
  AvailableAgentsPayload,
  GenerationProgressPayload,
  GenerationCompletePayload,
  WizardErrorPayload,
} from '@ptah-extension/shared';

// Import shared types for use in DeepProjectAnalysis
import type {
  ArchitecturePattern,
  KeyFileLocations,
  LanguageStats,
  DiagnosticSummary,
  CodeConventions,
  TestCoverageEstimate,
} from '@ptah-extension/shared';

/**
 * Deep project analysis result with comprehensive project insights.
 *
 * This interface captures all information needed for intelligent agent
 * recommendation and project-specific customization during setup wizard execution.
 *
 * Note: This interface uses workspace-intelligence enums (ProjectType, Framework, MonorepoType)
 * for internal use. For cross-boundary communication (RPC), use ProjectAnalysisResult from
 * @ptah-extension/shared which uses string types.
 *
 * @example
 * ```typescript
 * const analysis: DeepProjectAnalysis = {
 *   projectType: ProjectType.Node,
 *   frameworks: [Framework.Express, Framework.NestJS],
 *   monorepoType: MonorepoType.Nx,
 *   architecturePatterns: [{
 *     name: 'Layered',
 *     confidence: 85,
 *     evidence: ['services/', 'controllers/', 'repositories/']
 *   }],
 *   keyFileLocations: {
 *     entryPoints: ['src/main.ts'],
 *     configs: ['tsconfig.json', 'nx.json'],
 *     testDirectories: ['src/__tests__'],
 *     apiRoutes: ['src/routes/'],
 *     components: [],
 *     services: ['src/services/']
 *   },
 *   languageDistribution: [{
 *     language: 'TypeScript',
 *     percentage: 85,
 *     fileCount: 250
 *   }],
 *   existingIssues: {
 *     errorCount: 5,
 *     warningCount: 23,
 *     infoCount: 12,
 *     errorsByType: { 'typescript': 3, 'eslint': 2 },
 *     warningsByType: { 'eslint': 20, 'typescript': 3 }
 *   },
 *   codeConventions: {
 *     indentation: 'spaces',
 *     indentSize: 2,
 *     quoteStyle: 'single',
 *     semicolons: true,
 *     trailingComma: 'es5',
 *     namingConventions: {
 *       files: 'kebab-case',
 *       classes: 'PascalCase',
 *       functions: 'camelCase',
 *       variables: 'camelCase'
 *     }
 *   },
 *   testCoverage: {
 *     percentage: 72,
 *     hasTests: true,
 *     testFramework: 'jest',
 *     hasE2eTests: true,
 *     hasUnitTests: true,
 *     hasIntegrationTests: false
 *   }
 * };
 * ```
 */
export interface DeepProjectAnalysis {
  /**
   * Detected project type enum — best-effort mapping for infrastructure code
   * (framework detection, dependency parsing, context optimization).
   * NOT used for agent recommendations or template selection.
   */
  projectType: ProjectType;

  /**
   * Agent's original rich project type description (e.g., "React SPA with Supabase Backend",
   * "Angular Nx Monorepo with NestJS API"). Preserves the agent's intelligent analysis
   * without forcing it into a limited enum. This is what the frontend displays
   * and what agent recommendations should consider.
   */
  projectTypeDescription?: string;

  /**
   * Detected frameworks used in the project.
   * Used for specialized agent recommendations and LLM customization.
   *
   * Supports both known Framework enum values and dynamically discovered
   * frameworks (e.g., 'tailwindcss', 'redux', 'zustand') that the agent
   * discovers during analysis. Using string[] allows flexibility while
   * maintaining backward compatibility with Framework enum values.
   */
  frameworks: string[];

  /**
   * Monorepo type if the project is a monorepo.
   * Influences team-leader agent relevance and batching strategies.
   */
  monorepoType?: MonorepoType;

  /**
   * Detected architecture patterns with confidence scores.
   * Helps determine which architectural guidance to include in generated agents.
   */
  architecturePatterns: ArchitecturePattern[];

  /**
   * Key file locations organized by purpose.
   * Provides context for agent navigation and file discovery instructions.
   */
  keyFileLocations: KeyFileLocations;

  /**
   * Language distribution statistics.
   * Influences language-specific agent recommendations.
   */
  languageDistribution: LanguageStats[];

  /**
   * Summary of existing code issues from diagnostics.
   * High issue counts increase relevance of code reviewer agents.
   */
  existingIssues: DiagnosticSummary;

  /**
   * Detected code style conventions.
   * Used to customize generated agent instructions for consistency.
   */
  codeConventions: CodeConventions;

  /**
   * Estimated test coverage information.
   * Low coverage increases relevance of senior-tester agent.
   */
  testCoverage: TestCoverageEstimate;

  // ========================================
  // Quality Assessment Fields (TASK_2025_141)
  // All fields optional for backward compatibility
  // ========================================

  /**
   * Overall code quality score (0-100).
   * Derived from anti-pattern analysis across sampled files.
   * Higher scores indicate better code quality practices.
   *
   * @example
   * ```typescript
   * if (analysis.qualityScore !== undefined && analysis.qualityScore < 70) {
   *   // Increase relevance of code-reviewer agent
   * }
   * ```
   */
  qualityScore?: number;

  /**
   * Detected quality gaps from code analysis.
   * Represents missing best practices or areas needing improvement.
   * Used for targeted agent recommendations and guidance generation.
   */
  qualityGaps?: QualityGap[];

  /**
   * Generated prescriptive guidance based on quality assessment.
   * Contains prioritized recommendations with actionable solutions.
   * Token-budgeted to fit within LLM context limits.
   */
  prescriptiveGuidance?: PrescriptiveGuidance;

  /**
   * Full quality assessment data for advanced consumers.
   * Includes anti-patterns, strengths, and detailed scoring breakdown.
   * Use this for detailed quality reporting or custom analysis.
   *
   * @remarks
   * This field provides access to the complete assessment including:
   * - Detected anti-patterns with locations and suggestions
   * - Identified strengths (best practices followed)
   * - Sampled files used for analysis
   * - Analysis timing metadata
   */
  qualityAssessment?: QualityAssessment;
}
