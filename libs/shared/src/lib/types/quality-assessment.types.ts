/**
 * Quality Assessment Types
 *
 * Type definitions for code quality assessment, anti-pattern detection,
 * and prescriptive guidance generation.
 *
 * Unified Project Intelligence with Code Quality Assessment.
 *
 * @packageDocumentation
 */

/**
 * Categories of anti-patterns detected by the quality assessment system.
 * Organized by domain: TypeScript, Error Handling, Architecture, Testing,
 * Angular, NestJS, React
 */
export type AntiPatternType =
  | 'typescript-explicit-any'
  | 'typescript-implicit-any'
  | 'typescript-ts-ignore'
  | 'typescript-non-null-assertion'
  | 'error-empty-catch'
  | 'error-console-only-catch'
  | 'error-unhandled-promise'
  | 'error-missing-try-catch'
  | 'arch-file-too-large'
  | 'arch-function-too-large'
  | 'arch-too-many-imports'
  | 'arch-circular-dependency'
  | 'test-missing-spec'
  | 'test-no-assertions'
  | 'test-all-skipped'
  | 'angular-improper-change-detection'
  | 'angular-subscription-leak'
  | 'angular-circular-dependency'
  | 'angular-large-component'
  | 'angular-missing-trackby'
  | 'nestjs-missing-decorator'
  | 'nestjs-controller-logic'
  | 'nestjs-unsafe-repository'
  | 'nestjs-missing-guard'
  | 'nestjs-circular-module'
  | 'react-missing-key'
  | 'react-direct-state-mutation'
  | 'react-useeffect-dependencies'
  | 'react-large-component'
  | 'react-inline-function-prop';

/**
 * Severity levels for detected anti-patterns
 */
export type AntiPatternSeverity = 'error' | 'warning' | 'info';

/**
 * Location of an anti-pattern in the codebase
 */
export interface CodeLocation {
  /** Relative file path from workspace root */
  file: string;
  /** Line number (1-indexed) */
  line?: number;
  /** Column number (1-indexed) */
  column?: number;
}

/**
 * A detected anti-pattern with location and suggestion
 */
export interface AntiPattern {
  /** Type of anti-pattern detected */
  type: AntiPatternType;
  /** Severity level */
  severity: AntiPatternSeverity;
  /** Location in codebase */
  location: CodeLocation;
  /** Human-readable description */
  message: string;
  /** Recommended fix */
  suggestion: string;
  /** Number of occurrences (for aggregated patterns) */
  frequency: number;
}

/**
 * Priority levels for quality gaps
 */
export type QualityGapPriority = 'high' | 'medium' | 'low';

/**
 * A missing best practice or quality gap
 */
export interface QualityGap {
  /** Area of the gap (e.g., 'TypeScript', 'Testing', 'Architecture') */
  area: string;
  /** Priority for addressing */
  priority: QualityGapPriority;
  /** Description of what's missing */
  description: string;
  /** Recommended action */
  recommendation: string;
}

/**
 * Comprehensive quality assessment result
 */
export interface QualityAssessment {
  /** Overall quality score (0-100) */
  score: number;
  /** Detected anti-patterns */
  antiPatterns: AntiPattern[];
  /** Identified quality gaps */
  gaps: QualityGap[];
  /** Detected strengths (best practices followed) */
  strengths: string[];
  /** Files that were sampled for analysis */
  sampledFiles: string[];
  /** Timestamp of analysis */
  analysisTimestamp: number;
  /** Duration of analysis in milliseconds */
  analysisDurationMs: number;
  /** Statistics from incremental analysis */
  incrementalStats?: {
    /** Number of files retrieved from cache */
    cachedFiles: number;
    /** Number of files analyzed fresh */
    freshFiles: number;
    /** Cache hit rate (0-1) */
    cacheHitRate: number;
  };
}

/**
 * A single recommendation with priority
 */
export interface Recommendation {
  /** Priority ranking (lower = higher priority) */
  priority: number;
  /** Category (e.g., 'TypeScript', 'Architecture') */
  category: string;
  /** Issue description */
  issue: string;
  /** Recommended solution */
  solution: string;
  /** Example files where issue was found (up to 5) */
  exampleFiles?: string[];
}

/**
 * Generated prescriptive guidance based on quality assessment
 */
export interface PrescriptiveGuidance {
  /** Executive summary of recommendations */
  summary: string;
  /** Prioritized list of recommendations */
  recommendations: Recommendation[];
  /** Total tokens consumed by guidance */
  totalTokens: number;
  /** Whether guidance was truncated due to token budget */
  wasTruncated: boolean;
}

/**
 * Unified project intelligence combining workspace context and quality assessment
 */
export interface ProjectIntelligence {
  /** Workspace detection results (project type, frameworks, dependencies) */
  workspaceContext: WorkspaceContext;
  /** Code quality assessment */
  qualityAssessment: QualityAssessment;
  /** Generated prescriptive guidance */
  prescriptiveGuidance: PrescriptiveGuidance;
  /** Timestamp of intelligence generation */
  timestamp: number;
}

/**
 * Workspace context from existing detection services
 * Mirrors detection results from workspace-intelligence library
 */
export interface WorkspaceContext {
  /** Detected project type */
  projectType: string;
  /** Detected framework */
  framework?: string;
  /** Whether workspace is a monorepo */
  isMonorepo: boolean;
  /** Monorepo type if applicable */
  monorepoType?: string;
  /** Production dependencies */
  dependencies: string[];
  /** Development dependencies */
  devDependencies: string[];
  /** Primary programming languages */
  languages: string[];
  /** Detected architecture patterns */
  architecturePatterns: string[];
}

/**
 * A single quality assessment snapshot for historical tracking.
 *
 * Compact representation of a quality assessment at a point in time.
 * Stored in VS Code globalState for persistence across sessions.
 * Contains only aggregated data (no full anti-pattern details) to
 * keep storage compact (~200 bytes per entry).
 */
export interface QualityHistoryEntry {
  /** Assessment timestamp (epoch ms) */
  timestamp: number;
  /** Quality score at that time (0-100) */
  score: number;
  /** Number of anti-patterns detected */
  patternCount: number;
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Anti-pattern counts by category prefix (e.g., 'typescript': 3, 'angular': 2) */
  categoryCounts: Record<string, number>;
}

/**
 * Configuration for intelligent file sampling
 */
export interface SamplingConfig {
  /** Maximum number of files to sample */
  maxFiles: number;
  /** Number of entry point files to include */
  entryPointCount: number;
  /** Number of high-relevance files to include */
  highRelevanceCount: number;
  /** Number of random files to include for diversity */
  randomCount: number;
  /** File patterns to prioritize (e.g., 'service', 'component') */
  priorityPatterns: string[];
  /** File patterns to exclude */
  excludePatterns: string[];
}

/**
 * Default sampling configuration
 * Balanced selection: entry points + high relevance + random diversity
 */
export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
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
