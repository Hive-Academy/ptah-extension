/**
 * Multi-Phase Analysis Type System
 *
 * Defines the types for the multi-phase workspace analysis pipeline.
 * The pipeline runs 4 sequential LLM phases (project profile, architecture
 * assessment, quality audit, elevation plan) followed by 1 deterministic
 * synthesis phase that combines outputs into role-specific agent context.
 *
 * @module @ptah-extension/agent-generation/types/multi-phase
 */

/**
 * Identifier for each phase in the multi-phase analysis pipeline.
 */
export type MultiPhaseId =
  | 'project-profile'
  | 'architecture-assessment'
  | 'quality-audit'
  | 'elevation-plan'
  | 'agent-context';

/**
 * Result of a single phase execution.
 * Recorded in the manifest to track which phases completed successfully.
 */
export interface PhaseResult {
  /** Whether the phase completed, failed, or was skipped (e.g., due to cancellation) */
  status: 'completed' | 'failed' | 'skipped';
  /** Output filename within the slug directory (e.g., '01-project-profile.md') */
  file: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error message when status is 'failed' */
  error?: string;
}

/**
 * Manifest stored as manifest.json in each multi-phase analysis slug directory.
 * Tracks metadata and per-phase results for the entire pipeline run.
 */
export interface MultiPhaseManifest {
  /** Schema version - always 2 for multi-phase format (v1 is legacy single-file JSON) */
  version: 2;
  /** URL-safe slug derived from project description */
  slug: string;
  /** ISO 8601 timestamp of when the analysis was started */
  analyzedAt: string;
  /** Model used for LLM phases (e.g., 'claude-sonnet-4-5-20250929') */
  model: string;
  /** Total pipeline duration in milliseconds */
  totalDurationMs: number;
  /** Per-phase execution results */
  phases: Record<MultiPhaseId, PhaseResult>;
}

/**
 * Options for configuring a multi-phase analysis run.
 */
export interface MultiPhaseAnalysisOptions {
  /** Total pipeline timeout in milliseconds (default: 3600000 = 1 hour) */
  timeout?: number;
  /** LLM model to use for phases 1-4 */
  model?: string;
  /** Whether the user has a premium license (required for multi-phase) */
  isPremium?: boolean;
  /** Whether the MCP server is running (required for file access in phases 2-4) */
  mcpServerRunning?: boolean;
  /** Port the MCP server is listening on */
  mcpPort?: number;
}

/**
 * Static configuration for each phase in the pipeline.
 * Defines the output filename, display label, and phase identifier.
 */
export const PHASE_CONFIGS = [
  {
    id: 'project-profile' as const,
    file: '01-project-profile.md',
    label: 'Discovering project profile...',
  },
  {
    id: 'architecture-assessment' as const,
    file: '02-architecture-assessment.md',
    label: 'Assessing architecture...',
  },
  {
    id: 'quality-audit' as const,
    file: '03-quality-audit.md',
    label: 'Auditing code quality...',
  },
  {
    id: 'elevation-plan' as const,
    file: '04-elevation-plan.md',
    label: 'Creating elevation plan...',
  },
  {
    id: 'agent-context' as const,
    file: '05-agent-context.md',
    label: 'Synthesizing agent context...',
  },
] as const;
