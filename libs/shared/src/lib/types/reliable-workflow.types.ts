/**
 * Reliable Workflow Types
 *
 * Type definitions for the generalized reliable generation pattern
 * extracted from Agent Generation's template + LLM + validation workflow.
 *
 * Unified Project Intelligence with Code Quality Assessment.
 *
 * @packageDocumentation
 */

// ============================================
// Validation Types
// ============================================

/**
 * Validation tier weights (must sum to 100)
 */
export interface ValidationWeights {
  /** Schema validation weight (structure, format) */
  schema: number;
  /** Safety validation weight (no malicious code, no secrets) */
  safety: number;
  /** Factual validation weight (file paths exist, frameworks match) */
  factual: number;
}

/**
 * Default validation weights (from Agent Generation)
 * Schema: 40 points (structure, markers, frontmatter)
 * Safety: 30 points (no malicious code, no sensitive data)
 * Factual: 30 points (file paths exist, frameworks match reality)
 */
export const DEFAULT_VALIDATION_WEIGHTS: ValidationWeights = {
  schema: 40,
  safety: 30,
  factual: 30,
};

/**
 * Validation issue from any tier
 */
export interface ValidationIssue {
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Human-readable message */
  message: string;
  /** Suggested fix */
  suggestion?: string;
  /** Validation tier that produced this issue */
  tier?: 'schema' | 'safety' | 'factual';
}

/**
 * Validation result with score and issues
 */
export interface ValidationResult {
  /** Whether content passed validation (score >= threshold) */
  isValid: boolean;
  /** Validation issues detected */
  issues: ValidationIssue[];
  /** Total score (0-100) */
  score: number;
  /** Score breakdown by tier */
  tierScores?: {
    schema: number;
    safety: number;
    factual: number;
  };
}

/**
 * Configuration for validation pipeline
 */
export interface ValidationConfig {
  /** Validation weights */
  weights: ValidationWeights;
  /** Minimum score threshold for acceptance */
  threshold: number;
  /** Maximum content length */
  maxContentLength?: number;
  /** Minimum content length */
  minContentLength?: number;
}

/**
 * Default validation configuration
 * Threshold: 70 points minimum for acceptance
 * Max content: 50,000 characters
 * Min content: 100 characters
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  weights: DEFAULT_VALIDATION_WEIGHTS,
  threshold: 70,
  maxContentLength: 50000,
  minContentLength: 100,
};

// ============================================
// Retry Types
// ============================================

/**
 * Configuration for retry logic
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base backoff time in milliseconds */
  backoffBaseMs: number;
  /** Exponential backoff factor */
  backoffFactor: number;
}

/**
 * Default retry configuration
 * Max retries: 2 attempts before fallback
 * Base backoff: 3 seconds
 * Factor: 2x exponential backoff
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  backoffBaseMs: 3000,
  backoffFactor: 2,
};

// ============================================
// Fallback Types
// ============================================

/**
 * Fallback levels in order of preference
 * Lower values indicate preferred fallback levels
 */
export enum FallbackLevel {
  /** Retry with simplified prompt */
  SimplifiedPrompt = 1,
  /** Use template with partial LLM customization */
  PartialTemplate = 2,
  /** Use template only (no LLM) */
  TemplateOnly = 3,
  /** Return minimal guidance */
  Minimal = 4,
}

/**
 * Result of a fallback attempt
 */
export interface FallbackResult<T> {
  /** Generated output */
  output: T;
  /** Fallback level used */
  level: FallbackLevel;
  /** Reason for fallback */
  reason: string;
}

// ============================================
// Reliable Generation Pipeline Types
// ============================================

/**
 * Configuration for the reliable generation pipeline
 */
export interface ReliableGenerationConfig<TContext = unknown> {
  /** Validation configuration */
  validation: ValidationConfig;
  /** Retry configuration */
  retry: RetryConfig;
  /** LLM model preference */
  model?: string;
  /** Temperature for LLM generation */
  temperature?: number;
  /** Maximum tokens for LLM response */
  maxTokens?: number;
  /** Context for validation (e.g., project info for factual checks) */
  validationContext?: TContext;
}

/**
 * Result of a reliable generation attempt
 */
export interface ReliableGenerationResult<TOutput> {
  /** Whether generation succeeded */
  success: boolean;
  /** Generated output (if successful) */
  output?: TOutput;
  /** Validation result (if validation was performed) */
  validationResult?: ValidationResult;
  /** Fallback result (if fallback was used) */
  fallbackResult?: FallbackResult<TOutput>;
  /** Number of attempts made */
  attempts: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Error message (if failed) */
  error?: string;
}
