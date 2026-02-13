/**
 * Setup Wizard Shared Types
 *
 * Types shared between frontend and backend for the setup wizard.
 * These types define the contract for RPC communication and data structures
 * used during the agent generation workflow.
 *
 * @module @ptah-extension/shared/types
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

// ============================================================================
// Code Conventions Types
// ============================================================================

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

  /**
   * Whether any test files were detected.
   */
  hasTests: boolean;

  /**
   * Detected test framework.
   * Common: 'jest', 'mocha', 'vitest', 'jasmine', 'karma', 'pytest', 'junit'
   */
  testFramework?: string | null;

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

// ============================================================================
// Agent Recommendation Types
// ============================================================================

/**
 * Agent category for grouping and display.
 */
export type AgentCategory =
  | 'planning'
  | 'development'
  | 'qa'
  | 'specialist'
  | 'creative';

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

// ============================================================================
// Project Analysis Result Types
// ============================================================================

/**
 * Project analysis result for RPC communication.
 * Simplified version using string types for cross-boundary safety.
 *
 * This interface is used for communication between frontend and backend,
 * avoiding dependencies on workspace-intelligence enums.
 *
 * @example
 * ```typescript
 * const result: ProjectAnalysisResult = {
 *   projectType: 'Node.js',
 *   fileCount: 250,
 *   languages: ['TypeScript', 'JavaScript'],
 *   frameworks: ['NestJS', 'Angular'],
 *   monorepoType: 'Nx',
 *   architecturePatterns: [{ name: 'Layered', confidence: 85, evidence: [] }],
 *   keyFileLocations: { entryPoints: [], configs: [], ... },
 *   existingIssues: { errorCount: 5, warningCount: 20, ... },
 *   testCoverage: { percentage: 72, hasTests: true, ... }
 * };
 * ```
 */
export interface ProjectAnalysisResult {
  /**
   * Project type enum value as string (e.g., 'angular', 'node', 'react').
   * Best-effort mapping for infrastructure code compatibility.
   */
  projectType: string;

  /**
   * Agent's rich project type description (e.g., "React SPA with Supabase Backend",
   * "Angular Nx Monorepo with NestJS API"). Preserves the agent's intelligent analysis.
   * This is what the frontend should display to users.
   */
  projectTypeDescription?: string;

  /**
   * Total file count in the project.
   */
  fileCount: number;

  /**
   * Programming languages detected (as strings).
   */
  languages: string[];

  /**
   * Frameworks detected (as strings).
   */
  frameworks: string[];

  /**
   * Monorepo type if applicable (e.g., 'Nx', 'Lerna', 'Turborepo').
   */
  monorepoType?: string;

  /**
   * Architecture patterns with confidence scores.
   */
  architecturePatterns: ArchitecturePattern[];

  /**
   * Key file locations organized by purpose.
   */
  keyFileLocations: KeyFileLocations;

  /**
   * Language distribution statistics.
   */
  languageDistribution?: LanguageStats[];

  /**
   * Code health issues summary.
   */
  existingIssues: DiagnosticSummary;

  /**
   * Test coverage estimate.
   */
  testCoverage: TestCoverageEstimate;

  /**
   * Code conventions detected.
   */
  codeConventions?: CodeConventions;

  // ========================================
  // Quality Assessment Fields (TASK_2025_151)
  // All fields optional for backward compatibility
  // ========================================

  /**
   * Overall code quality score (0-100).
   * Assessed by the agentic analysis based on codebase exploration.
   */
  qualityScore?: number;

  /**
   * Quality issues found during analysis.
   * Anti-patterns, missing best practices, and code smells.
   */
  qualityIssues?: Array<{
    area: string;
    severity: 'high' | 'medium' | 'low';
    description: string;
    recommendation: string;
    affectedFiles?: string[];
  }>;

  /**
   * Identified strengths — best practices the codebase follows well.
   */
  qualityStrengths?: string[];

  /**
   * Prioritized quality improvement recommendations.
   */
  qualityRecommendations?: Array<{
    priority: number;
    category: string;
    issue: string;
    solution: string;
  }>;
}

// ============================================================================
// Wizard Message Types
// ============================================================================

/**
 * Wizard message types for type-safe message handling.
 * Used by the discriminated union for exhaustive switch checking.
 */
export type WizardMessageType =
  | 'setup-wizard:scan-progress'
  | 'setup-wizard:analysis-stream'
  | 'setup-wizard:analysis-complete'
  | 'setup-wizard:available-agents'
  | 'setup-wizard:generation-progress'
  | 'setup-wizard:generation-complete'
  | 'setup-wizard:generation-stream'
  | 'setup-wizard:enhance-stream'
  | 'setup-wizard:error';

// ============================================================================
// Wizard Message Payload Types
// ============================================================================

/**
 * Analysis phase identifiers for agentic workspace analysis.
 * Used by the frontend to display phase stepper progress.
 */
export type AnalysisPhase = 'discovery' | 'architecture' | 'health' | 'quality';

/**
 * Payload for scan progress updates.
 * Sent during workspace scanning phase.
 *
 * Extended with agentic analysis fields (currentPhase, phaseLabel,
 * agentReasoning, completedPhases) that are populated when using
 * the Claude Agent SDK-based analysis path.
 */
export interface ScanProgressPayload {
  /** Number of files scanned so far */
  filesScanned: number;
  /** Total number of files to scan */
  totalFiles: number;
  /** Detected technologies/frameworks so far */
  detections: string[];
  /** Current analysis phase (agentic analysis only) */
  currentPhase?: AnalysisPhase;
  /** Human-readable label for the current phase (agentic analysis only) */
  phaseLabel?: string;
  /** Agent reasoning/activity description (agentic analysis only) */
  agentReasoning?: string;
  /** List of completed phase identifiers (agentic analysis only) */
  completedPhases?: AnalysisPhase[];
}

/**
 * Payload for streaming analysis messages to the frontend transcript.
 * Sent from AgenticAnalysisService during SDK stream processing.
 */
export interface AnalysisStreamPayload {
  /** Message type discriminator */
  kind:
    | 'text'
    | 'tool_start'
    | 'tool_input'
    | 'tool_result'
    | 'thinking'
    | 'error'
    | 'status';
  /** Text content (text output, thinking preview, error message, or status) */
  content: string;
  /** Tool name (for tool_start, tool_input, tool_result) */
  toolName?: string;
  /** Tool call ID (for correlating tool_start with tool_result) */
  toolCallId?: string;
  /** Whether this is an error result (for tool_result) */
  isError?: boolean;
  /** Timestamp */
  timestamp: number;
}

/**
 * Payload for streaming generation events to the frontend transcript.
 * Extends AnalysisStreamPayload with an optional agent identifier
 * to distinguish which agent template is being processed.
 *
 * Used by ContentGenerationService during SDK stream processing
 * and broadcast via 'setup-wizard:generation-stream' messages.
 */
export interface GenerationStreamPayload extends AnalysisStreamPayload {
  /** Which agent template is currently being processed */
  agentId?: string;
}

/**
 * Payload for analysis completion.
 * Sent when workspace analysis is complete.
 */
export interface AnalysisCompletePayload {
  /** Project context extracted from analysis */
  projectContext: {
    /** Project type (e.g., 'Angular', 'Node.js') */
    type: string;
    /** Detected tech stack */
    techStack: string[];
    /** Detected architecture pattern */
    architecture?: string;
    /** Whether this is a monorepo */
    isMonorepo: boolean;
    /** Monorepo type if applicable */
    monorepoType?: string;
    /** Number of packages in monorepo */
    packageCount?: number;
  };
}

/**
 * Payload for available agents list.
 * Sent after agent recommendations are calculated.
 */
export interface AvailableAgentsPayload {
  /** List of available agents with selection state */
  agents: Array<{
    /** Agent identifier */
    id: string;
    /** Agent display name */
    name: string;
    /** Whether agent is selected */
    selected: boolean;
    /** Relevance score (0-100) */
    score: number;
    /** Reason for recommendation */
    reason: string;
    /** Whether agent should be auto-included */
    autoInclude: boolean;
  }>;
}

/**
 * Payload for generation progress updates.
 * Sent during agent generation phase.
 */
export interface GenerationProgressPayload {
  /** Current generation progress */
  progress: {
    /** Current phase of generation */
    phase:
      | 'analysis'
      | 'selection'
      | 'customization'
      | 'rendering'
      | 'complete';
    /** Percentage complete (0-100) */
    percentComplete: number;
    /** Files scanned (during analysis phase) */
    filesScanned?: number;
    /** Total files to scan */
    totalFiles?: number;
    /** Currently generating agent */
    currentAgent?: string;
  };
}

/**
 * Payload for generation completion.
 * Sent when agent generation is finished.
 */
export interface GenerationCompletePayload {
  /** Whether generation was successful */
  success: boolean;
  /** Number of agents generated */
  generatedCount: number;
  /** Generation duration in milliseconds */
  duration?: number;
  /** Error messages if any */
  errors?: string[];
  /** Warning messages from Phase 3 customization failures */
  warnings?: string[];
  /** Whether enhanced prompts were used during generation */
  enhancedPromptsUsed?: boolean;
}

/**
 * Payload for error messages.
 * Sent when an error occurs during wizard flow.
 */
export interface WizardErrorPayload {
  /** Error message */
  message: string;
  /** Additional error details */
  details?: string;
  /** Error type: 'error' for real errors, 'fallback-warning' for degraded-mode warnings */
  type?: 'error' | 'fallback-warning';
}

// ============================================================================
// Wizard Message Discriminated Union
// ============================================================================

/**
 * Discriminated union for wizard messages.
 * Enables exhaustive type checking in message handlers.
 *
 * @example
 * ```typescript
 * function handleMessage(message: WizardMessage): void {
 *   switch (message.type) {
 *     case 'setup-wizard:scan-progress':
 *       console.log(`Scanned ${message.payload.filesScanned} files`);
 *       break;
 *     case 'setup-wizard:analysis-complete':
 *       console.log(`Project type: ${message.payload.projectContext.type}`);
 *       break;
 *     // ... handle all message types
 *     default:
 *       // TypeScript ensures this is unreachable if all cases handled
 *       const _exhaustive: never = message;
 *   }
 * }
 * ```
 */
export type WizardMessage =
  | { type: 'setup-wizard:scan-progress'; payload: ScanProgressPayload }
  | { type: 'setup-wizard:analysis-stream'; payload: AnalysisStreamPayload }
  | { type: 'setup-wizard:analysis-complete'; payload: AnalysisCompletePayload }
  | { type: 'setup-wizard:available-agents'; payload: AvailableAgentsPayload }
  | {
      type: 'setup-wizard:generation-progress';
      payload: GenerationProgressPayload;
    }
  | {
      type: 'setup-wizard:generation-complete';
      payload: GenerationCompletePayload;
    }
  | { type: 'setup-wizard:generation-stream'; payload: GenerationStreamPayload }
  | { type: 'setup-wizard:enhance-stream'; payload: AnalysisStreamPayload }
  | { type: 'setup-wizard:error'; payload: WizardErrorPayload };

// ============================================================================
// Saved Analysis Types (Persistent Analysis History)
// ============================================================================

/**
 * Metadata for a saved analysis (lightweight, for listing).
 * Contains only the fields needed to display analysis cards
 * without loading the full analysis data.
 */
export interface SavedAnalysisMetadata {
  /** Filename in .claude/analysis/ directory */
  filename: string;
  /** ISO 8601 timestamp of when the analysis was saved */
  savedAt: string;
  /** Human-readable project type description */
  projectType: string;
  /** Number of files detected during analysis */
  fileCount: number;
  /** Overall code quality score (0-100), if available */
  qualityScore?: number;
  /** Whether agentic or fallback analysis was used */
  analysisMethod: 'agentic' | 'fallback';
  /** Number of agent recommendations saved */
  agentCount: number;
}

/**
 * Full saved analysis file structure.
 * Stored as JSON in .claude/analysis/*.json files.
 */
export interface SavedAnalysisFile {
  /** Schema version for forward compatibility */
  version: 1;
  /** ISO 8601 timestamp of when the analysis was saved */
  savedAt: string;
  /** Whether agentic or fallback analysis was used */
  analysisMethod: 'agentic' | 'fallback';
  /** Full project analysis result */
  analysis: ProjectAnalysisResult;
  /** Agent recommendations with scores */
  recommendations: AgentRecommendation[];
}
