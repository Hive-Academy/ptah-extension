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

/**
 * Deep project analysis result with comprehensive project insights.
 *
 * This interface captures all information needed for intelligent agent
 * recommendation and project-specific customization during setup wizard execution.
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

/**
 * Architecture pattern detection result.
 *
 * Represents a detected architectural pattern with confidence score
 * and evidence from the codebase structure.
 *
 * @example
 * ```typescript
 * const dddPattern: ArchitecturePattern = {
 *   name: 'DDD',
 *   confidence: 78,
 *   evidence: [
 *     'libs/backend/claude-domain/src/entities/',
 *     'libs/backend/claude-domain/src/value-objects/',
 *     'libs/backend/claude-domain/src/aggregates/'
 *   ],
 *   description: 'Domain-Driven Design pattern detected with entities, value objects, and aggregate roots'
 * };
 * ```
 */
export interface ArchitecturePattern {
  /**
   * Pattern name identifier.
   * Common values: 'DDD', 'Layered', 'Microservices', 'Monolith', 'Hexagonal', 'CQRS', 'Event-Sourcing'
   */
  name: ArchitecturePatternName;

  /**
   * Confidence score (0-100) based on evidence strength.
   * - 90-100: Strong evidence, high confidence
   * - 70-89: Good evidence, likely correct
   * - 50-69: Some evidence, possible pattern
   * - <50: Weak evidence, uncertain
   */
  confidence: number;

  /**
   * File paths or folder names that indicate this pattern.
   * Used as evidence for the confidence score.
   */
  evidence: string[];

  /**
   * Optional human-readable description of the detected pattern.
   * Provides additional context for display in the wizard.
   */
  description?: string;
}

/**
 * Known architecture pattern names.
 * Extensible string literal union for pattern identification.
 */
export type ArchitecturePatternName =
  | 'DDD'
  | 'Layered'
  | 'Microservices'
  | 'Monolith'
  | 'Hexagonal'
  | 'CQRS'
  | 'Event-Sourcing'
  | 'Clean-Architecture'
  | 'MVC'
  | 'MVVM'
  | 'Component-Based'
  | 'Feature-Sliced'
  | string; // Allow custom patterns

/**
 * Key file locations organized by purpose.
 *
 * Provides a structured view of important files in the project
 * for agent context and file discovery instructions.
 *
 * @example
 * ```typescript
 * const locations: KeyFileLocations = {
 *   entryPoints: ['apps/api/src/main.ts', 'apps/web/src/main.ts'],
 *   configs: ['nx.json', 'tsconfig.base.json', 'jest.config.ts'],
 *   testDirectories: ['apps/api/src/__tests__', 'libs/shared/src/lib/__tests__'],
 *   apiRoutes: ['apps/api/src/routes/', 'apps/api/src/controllers/'],
 *   components: ['libs/ui/src/lib/components/'],
 *   services: ['libs/backend/src/lib/services/']
 * };
 * ```
 */
export interface KeyFileLocations {
  /**
   * Application entry point files.
   * Main files that bootstrap the application (main.ts, index.ts, app.ts).
   */
  entryPoints: string[];

  /**
   * Configuration files.
   * Build configs, linter configs, TypeScript configs, etc.
   */
  configs: string[];

  /**
   * Test directories.
   * Folders containing test files (__tests__, *.spec.ts, *.test.ts).
   */
  testDirectories: string[];

  /**
   * API route definitions.
   * Controllers, route handlers, API endpoint definitions.
   */
  apiRoutes: string[];

  /**
   * UI component directories.
   * Frontend component folders (components/, views/, pages/).
   */
  components: string[];

  /**
   * Service layer directories.
   * Business logic services (services/, providers/, use-cases/).
   */
  services: string[];

  /**
   * Model/Entity directories.
   * Data models, entities, DTOs (models/, entities/, dto/).
   */
  models?: string[];

  /**
   * Repository/Data access directories.
   * Database access layers (repositories/, data/, persistence/).
   */
  repositories?: string[];

  /**
   * Utility/Helper directories.
   * Shared utilities (utils/, helpers/, common/).
   */
  utilities?: string[];
}

/**
 * Language distribution statistics.
 *
 * Captures the programming language breakdown in the project
 * for language-specific agent recommendations.
 *
 * @example
 * ```typescript
 * const stats: LanguageStats = {
 *   language: 'TypeScript',
 *   percentage: 85.5,
 *   fileCount: 320,
 *   linesOfCode: 45000
 * };
 * ```
 */
export interface LanguageStats {
  /**
   * Programming language name.
   * Common values: 'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Rust'
   */
  language: string;

  /**
   * Percentage of codebase in this language (0-100).
   * Based on file count or lines of code.
   */
  percentage: number;

  /**
   * Number of files in this language.
   */
  fileCount: number;

  /**
   * Optional: Estimated lines of code.
   * May not be available if not computed during analysis.
   */
  linesOfCode?: number;
}

/**
 * Summary of existing code issues from VS Code diagnostics.
 *
 * Aggregates error, warning, and info counts from all sources
 * (TypeScript, ESLint, Stylelint, etc.) to assess code health.
 *
 * @example
 * ```typescript
 * const summary: DiagnosticSummary = {
 *   errorCount: 12,
 *   warningCount: 45,
 *   infoCount: 8,
 *   errorsByType: {
 *     'typescript': 7,
 *     'eslint': 5
 *   },
 *   warningsByType: {
 *     'eslint': 35,
 *     'typescript': 8,
 *     'stylelint': 2
 *   }
 * };
 * ```
 */
export interface DiagnosticSummary {
  /**
   * Total number of errors across all sources.
   * Critical issues that should be addressed.
   */
  errorCount: number;

  /**
   * Total number of warnings across all sources.
   * Issues that should be reviewed.
   */
  warningCount: number;

  /**
   * Total number of informational messages.
   * Non-critical hints and suggestions.
   */
  infoCount: number;

  /**
   * Error counts grouped by source/type.
   * Keys are diagnostic source identifiers (typescript, eslint, etc.)
   */
  errorsByType: Record<string, number>;

  /**
   * Warning counts grouped by source/type.
   * Keys are diagnostic source identifiers (typescript, eslint, etc.)
   */
  warningsByType: Record<string, number>;

  /**
   * Optional: Most common error messages for context.
   * Helps understand prevalent issues in the codebase.
   */
  topErrors?: Array<{
    message: string;
    count: number;
    source: string;
  }>;
}

/**
 * Code style conventions detected from project files.
 *
 * Extended version of CodeConventions with additional naming convention
 * detection for comprehensive style guidance.
 *
 * @example
 * ```typescript
 * const conventions: CodeConventions = {
 *   indentation: 'spaces',
 *   indentSize: 2,
 *   quoteStyle: 'single',
 *   semicolons: true,
 *   trailingComma: 'es5',
 *   namingConventions: {
 *     files: 'kebab-case',
 *     classes: 'PascalCase',
 *     functions: 'camelCase',
 *     variables: 'camelCase',
 *     constants: 'SCREAMING_SNAKE_CASE'
 *   },
 *   maxLineLength: 100,
 *   usePrettier: true,
 *   useEslint: true
 * };
 * ```
 */
export interface CodeConventions {
  /**
   * Indentation style: tabs or spaces.
   */
  indentation: 'tabs' | 'spaces';

  /**
   * Number of spaces per indentation level (if using spaces).
   * Common values: 2, 4.
   */
  indentSize: number;

  /**
   * Quote style preference: single or double quotes.
   */
  quoteStyle: 'single' | 'double';

  /**
   * Whether to use semicolons at end of statements.
   */
  semicolons: boolean;

  /**
   * Trailing comma style in multi-line structures.
   * - 'none': No trailing commas
   * - 'es5': Trailing commas in ES5-compatible positions (arrays, objects)
   * - 'all': Trailing commas everywhere possible (including function parameters)
   */
  trailingComma: 'none' | 'es5' | 'all';

  /**
   * Naming conventions for different code elements.
   * Detected from existing code patterns.
   */
  namingConventions?: NamingConventions;

  /**
   * Maximum line length preference.
   * Detected from Prettier/ESLint config or code analysis.
   */
  maxLineLength?: number;

  /**
   * Whether the project uses Prettier.
   */
  usePrettier?: boolean;

  /**
   * Whether the project uses ESLint.
   */
  useEslint?: boolean;

  /**
   * Additional style tools detected.
   * e.g., 'stylelint', 'biome', 'rome'
   */
  additionalTools?: string[];
}

/**
 * Naming convention patterns for code elements.
 *
 * @example
 * ```typescript
 * const naming: NamingConventions = {
 *   files: 'kebab-case',
 *   classes: 'PascalCase',
 *   functions: 'camelCase',
 *   variables: 'camelCase',
 *   constants: 'SCREAMING_SNAKE_CASE',
 *   interfaces: 'PascalCase',
 *   types: 'PascalCase'
 * };
 * ```
 */
export interface NamingConventions {
  /**
   * File naming convention.
   * Common: 'kebab-case', 'camelCase', 'PascalCase', 'snake_case'
   */
  files?: NamingConvention;

  /**
   * Class naming convention.
   * Usually 'PascalCase'.
   */
  classes?: NamingConvention;

  /**
   * Function naming convention.
   * Usually 'camelCase'.
   */
  functions?: NamingConvention;

  /**
   * Variable naming convention.
   * Usually 'camelCase'.
   */
  variables?: NamingConvention;

  /**
   * Constant naming convention.
   * Common: 'SCREAMING_SNAKE_CASE', 'camelCase'.
   */
  constants?: NamingConvention;

  /**
   * Interface naming convention.
   * Common: 'PascalCase', 'IPascalCase' (with I prefix).
   */
  interfaces?: NamingConvention;

  /**
   * Type alias naming convention.
   * Usually 'PascalCase'.
   */
  types?: NamingConvention;
}

/**
 * Naming convention pattern type.
 */
export type NamingConvention =
  | 'camelCase'
  | 'PascalCase'
  | 'snake_case'
  | 'SCREAMING_SNAKE_CASE'
  | 'kebab-case'
  | string; // Allow custom conventions

/**
 * Estimated test coverage information.
 *
 * Provides an estimate of test coverage based on file analysis
 * rather than actual coverage reports (which may not be available).
 *
 * @example
 * ```typescript
 * const coverage: TestCoverageEstimate = {
 *   percentage: 68,
 *   hasTests: true,
 *   testFramework: 'jest',
 *   hasUnitTests: true,
 *   hasIntegrationTests: true,
 *   hasE2eTests: false,
 *   testFileCount: 45,
 *   sourceFileCount: 180,
 *   testToSourceRatio: 0.25
 * };
 * ```
 */
export interface TestCoverageEstimate {
  /**
   * Estimated test coverage percentage (0-100).
   * Based on test file to source file ratio and heuristics.
   * Note: This is an estimate, not actual coverage data.
   */
  percentage: number;

  /**
   * Whether any test files were detected.
   */
  hasTests: boolean;

  /**
   * Detected test framework.
   * Common: 'jest', 'mocha', 'vitest', 'jasmine', 'karma', 'pytest', 'junit'
   */
  testFramework?: string;

  /**
   * Whether unit tests were detected.
   * Files matching *.spec.ts, *.test.ts, __tests__/*.ts patterns.
   */
  hasUnitTests: boolean;

  /**
   * Whether integration tests were detected.
   * Files in integration/, e2e/, or matching *.integration.* patterns.
   */
  hasIntegrationTests: boolean;

  /**
   * Whether end-to-end tests were detected.
   * Files in e2e/, cypress/, playwright/ directories.
   */
  hasE2eTests: boolean;

  /**
   * Number of test files found.
   */
  testFileCount?: number;

  /**
   * Number of source files (non-test).
   */
  sourceFileCount?: number;

  /**
   * Ratio of test files to source files.
   * Higher ratio suggests better coverage.
   */
  testToSourceRatio?: number;
}

/**
 * Agent recommendation based on deep project analysis.
 *
 * Provides a scored recommendation for each agent based on
 * how well it matches the project's characteristics.
 *
 * @example
 * ```typescript
 * const recommendation: AgentRecommendation = {
 *   agentId: 'backend-developer',
 *   agentName: 'Backend Developer',
 *   relevanceScore: 92,
 *   matchedCriteria: [
 *     'NestJS framework detected',
 *     'TypeORM entities found',
 *     'REST API routes detected'
 *   ],
 *   category: 'development',
 *   recommended: true,
 *   description: 'Implements APIs, database logic, and server-side code',
 *   icon: 'server'
 * };
 * ```
 */
export interface AgentRecommendation {
  /**
   * Unique agent identifier (kebab-case).
   * Matches template file name without extension.
   */
  agentId: string;

  /**
   * Human-readable agent name.
   * Used for display in the wizard UI.
   */
  agentName: string;

  /**
   * Relevance score (0-100) based on project analysis.
   * Higher scores indicate better fit for the project.
   */
  relevanceScore: number;

  /**
   * List of criteria that contributed to the score.
   * Explains why this agent is recommended.
   */
  matchedCriteria: string[];

  /**
   * Agent category for grouping in UI.
   * Categories: 'planning', 'development', 'qa', 'specialist', 'creative'
   */
  category: AgentCategory;

  /**
   * Whether this agent is recommended (score >= 75).
   * Recommended agents are highlighted in the UI.
   */
  recommended: boolean;

  /**
   * Optional: Agent description for display.
   */
  description?: string;

  /**
   * Optional: Icon identifier for UI display.
   */
  icon?: string;
}

/**
 * Agent category for grouping and display.
 */
export type AgentCategory =
  | 'planning'
  | 'development'
  | 'qa'
  | 'specialist'
  | 'creative';
