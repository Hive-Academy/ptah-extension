/**
 * Prompt Designer Types
 *
 * TASK_2025_137 Batch 2: Type definitions for the intelligent prompt generation system.
 *
 * The Prompt Designer Agent analyzes workspaces and generates project-specific
 * guidance that is appended to PTAH_CORE_SYSTEM_PROMPT.
 */

import { z } from 'zod';

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

  /** Optional token budget for generated content */
  tokenBudget?: number;
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
  | 'error';

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
