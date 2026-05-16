/**
 * Setup Wizard analysis types — architecture patterns, key file locations,
 * language stats, diagnostics, test coverage estimate.
 */

// ============================================================================
// Architecture Pattern Types
// ============================================================================

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

// ============================================================================
// Key File Locations Types
// ============================================================================

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
  /** Application entry point files (main.ts, index.ts, app.ts). */
  entryPoints: string[];
  /** Configuration files (build configs, linter, tsconfig, etc.). */
  configs: string[];
  /** Test directories (__tests__, *.spec.ts, *.test.ts). */
  testDirectories: string[];
  /** API route definitions (controllers, route handlers). */
  apiRoutes: string[];
  /** UI component directories (components/, views/, pages/). */
  components: string[];
  /** Service layer directories (services/, providers/, use-cases/). */
  services: string[];
  /** Model/Entity directories (models/, entities/, dto/). */
  models?: string[];
  /** Repository/Data access directories (repositories/, data/, persistence/). */
  repositories?: string[];
  /** Utility/Helper directories (utils/, helpers/, common/). */
  utilities?: string[];
}

// ============================================================================
// Language Statistics Types
// ============================================================================

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
  /** Programming language name (e.g., 'TypeScript', 'JavaScript', 'Python'). */
  language: string;
  /** Percentage of codebase in this language (0-100). */
  percentage: number;
  /** Number of files in this language. */
  fileCount: number;
  /** Optional: Estimated lines of code. */
  linesOfCode?: number;
}

// ============================================================================
// Diagnostic Summary Types
// ============================================================================

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
 *   errorsByType: { 'typescript': 7, 'eslint': 5 },
 *   warningsByType: { 'eslint': 35, 'typescript': 8, 'stylelint': 2 }
 * };
 * ```
 */
export interface DiagnosticSummary {
  /** Total number of errors across all sources. */
  errorCount: number;
  /** Total number of warnings across all sources. */
  warningCount: number;
  /** Total number of informational messages. */
  infoCount: number;
  /** Error counts grouped by source/type (typescript, eslint, etc.). */
  errorsByType: Record<string, number>;
  /** Warning counts grouped by source/type (typescript, eslint, etc.). */
  warningsByType: Record<string, number>;
  /** Optional: Most common error messages for context. */
  topErrors?: Array<{
    message: string;
    count: number;
    source: string;
  }>;
}

// ============================================================================
// Test Coverage Types
// ============================================================================

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
  /** Whether any test files were detected. */
  hasTests: boolean;
  /** Detected test framework (jest, mocha, vitest, jasmine, pytest, etc.). */
  testFramework?: string | null;
  /** Whether unit tests were detected. */
  hasUnitTests: boolean;
  /** Whether integration tests were detected. */
  hasIntegrationTests: boolean;
  /** Whether end-to-end tests were detected. */
  hasE2eTests: boolean;
  /** Number of test files found. */
  testFileCount?: number;
  /** Number of source files (non-test). */
  sourceFileCount?: number;
  /** Ratio of test files to source files. */
  testToSourceRatio?: number;
}
