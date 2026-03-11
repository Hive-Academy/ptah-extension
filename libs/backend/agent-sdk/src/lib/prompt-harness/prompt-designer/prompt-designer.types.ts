/**
 * Prompt Designer Types
 *
 * TASK_2025_137 Batch 2: Type definitions for the intelligent prompt generation system.
 * TASK_2025_141 Batch 9: Extended with quality guidance types for code quality assessment.
 *
 * The Prompt Designer Agent analyzes workspaces and generates project-specific
 * guidance that is appended to PTAH_CORE_SYSTEM_PROMPT.
 */

import { z } from 'zod';
import type {
  QualityAssessment,
  PrescriptiveGuidance,
} from '@ptah-extension/shared';

/**
 * Input for the Prompt Designer Agent
 */
export interface PromptDesignerInput {
  /** Path to the workspace being analyzed */
  workspacePath: string;

  /** Project type detected by workspace-intelligence */
  projectType: string;

  /** Framework detected (if any) */
  framework?: string;

  /** Whether this is a monorepo */
  isMonorepo: boolean;

  /** Monorepo type (Nx, Lerna, etc.) */
  monorepoType?: string;

  /** Production dependencies */
  dependencies: string[];

  /** Development dependencies */
  devDependencies: string[];

  /** Sample file paths for context */
  sampleFilePaths?: string[];

  /** Detected languages (e.g. ['TypeScript', 'JavaScript', 'CSS']) */
  languages?: string[];

  /** Optional token budget for generated content */
  tokenBudget?: number;

  /**
   * Pre-computed quality assessment from ProjectIntelligenceService.
   * If provided, the agent will use this instead of fetching quality data.
   * @since TASK_2025_141
   */
  qualityAssessment?: QualityAssessment;

  /**
   * Pre-computed prescriptive guidance from ProjectIntelligenceService.
   * If provided, the agent will use this instead of generating guidance.
   * @since TASK_2025_141
   */
  prescriptiveGuidance?: PrescriptiveGuidance;

  /**
   * Whether to include quality guidance in the generated output.
   * When true (default), quality assessment will be fetched if not provided.
   * @default true
   * @since TASK_2025_141
   */
  includeQualityGuidance?: boolean;

  /**
   * Additional analysis context from multi-phase analysis.
   * When present, includes quality audit findings and elevation plan priorities
   * for richer prompt generation.
   * @since TASK_2025_154
   */
  additionalContext?: string;
}

/**
 * Output from the Prompt Designer Agent
 *
 * Each section is kept under a token budget to ensure the total
 * generated prompt doesn't overwhelm the context window.
 */
export interface PromptDesignerOutput {
  /** Brief project description and key technologies */
  projectContext: string;

  /** Framework-specific patterns and best practices */
  frameworkGuidelines: string;

  /** SOLID principles, naming conventions, error handling */
  codingStandards: string;

  /** Library boundaries, dependency rules, import patterns */
  architectureNotes: string;

  /**
   * Quality-specific guidance based on detected anti-patterns and code issues.
   * Generated from quality assessment when available.
   * @since TASK_2025_141
   */
  qualityGuidance?: string;

  /**
   * Quality score from code quality assessment (0-100).
   * Lower scores indicate more detected anti-patterns.
   * @since TASK_2025_141
   */
  qualityScore?: number;

  /**
   * Full quality assessment data for advanced use cases.
   * Contains detailed anti-pattern information and recommendations.
   * @since TASK_2025_141
   */
  qualityAssessment?: QualityAssessment;

  /** Whether template-based fallback guidance was used instead of LLM-generated guidance */
  usedFallback?: boolean;

  /** Reason for fallback (e.g., 'LLM service not available', error message) */
  fallbackReason?: string;

  /** When this guidance was generated */
  generatedAt: number;

  /** Total tokens across all sections */
  totalTokens: number;

  /** Breakdown of tokens per section */
  tokenBreakdown: {
    projectContext: number;
    frameworkGuidelines: number;
    codingStandards: number;
    architectureNotes: number;
    /**
     * Token count for quality guidance section.
     * @since TASK_2025_141
     */
    qualityGuidance?: number;
  };
}

/**
 * Zod schema for validating LLM response structure
 *
 * Used with getStructuredCompletion for type-safe generation.
 */
export const PromptDesignerResponseSchema = z.object({
  projectContext: z
    .string()
    .describe(
      'Brief description of what this project is and its key technologies (under 400 tokens)'
    ),

  frameworkGuidelines: z
    .string()
    .describe(
      'Specific patterns and best practices for the detected frameworks (under 500 tokens)'
    ),

  codingStandards: z
    .string()
    .describe(
      'SOLID principles, naming conventions, error handling derived from the project (under 400 tokens)'
    ),

  architectureNotes: z
    .string()
    .describe(
      'Library boundaries, dependency rules, import patterns, key abstractions (under 400 tokens)'
    ),

  /**
   * Quality-specific guidance based on detected code issues.
   * @since TASK_2025_141
   */
  qualityGuidance: z
    .string()
    .optional()
    .describe(
      'Quality-specific guidance based on detected code issues such as anti-patterns, missing error handling, or architecture violations (under 300 tokens)'
    ),
});

export type PromptDesignerResponse = z.infer<
  typeof PromptDesignerResponseSchema
>;

/**
 * Generation status for UI feedback
 */
export type PromptGenerationStatus =
  | 'idle'
  | 'analyzing'
  | 'generating'
  | 'complete'
  | 'error'
  | 'fallback';

/**
 * Event emitted during prompt generation for progress tracking
 */
export interface PromptGenerationProgress {
  status: PromptGenerationStatus;
  message: string;
  progress?: number; // 0-100
  error?: string;
}

/**
 * Configuration for the Prompt Designer Agent
 */
export interface PromptDesignerConfig {
  /** Maximum tokens for the entire generated prompt (default: 1600) */
  maxTotalTokens: number;

  /** Maximum tokens per section (default: 400) */
  maxSectionTokens: number;

  /** Temperature for LLM generation (default: 0.3 for consistency) */
  temperature: number;

  /** Whether to include sample code snippets in analysis */
  includeCodeSamples: boolean;

  /** Maximum number of sample files to analyze */
  maxSampleFiles: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_PROMPT_DESIGNER_CONFIG: PromptDesignerConfig = {
  maxTotalTokens: 1600,
  maxSectionTokens: 400,
  temperature: 0.3,
  includeCodeSamples: true,
  maxSampleFiles: 5,
};

/**
 * Cached prompt generation result
 */
export interface CachedPromptDesign {
  /** The generated output */
  output: PromptDesignerOutput;

  /** Hash of the input used to generate this */
  inputHash: string;

  /** When this was cached */
  cachedAt: number;

  /** How long this cache entry is valid (ms) */
  ttl: number;
}
