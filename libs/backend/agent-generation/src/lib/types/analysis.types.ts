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
   * Detected project type from workspace analysis.
   * Primary factor in template selection and agent recommendations.
   */
  projectType: ProjectType;

  /**
   * Detected frameworks used in the project.
   * Used for specialized agent recommendations and LLM customization.
   */
  frameworks: Framework[];

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
}
