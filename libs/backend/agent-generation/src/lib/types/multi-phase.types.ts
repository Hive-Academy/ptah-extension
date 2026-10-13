/**
 * Multi-Phase Analysis Type System
 *
 * Defines the types for the multi-phase workspace analysis pipeline.
 * The pipeline runs 4 sequential LLM phases (project profile, architecture
 * assessment, quality audit, elevation plan).
 *
 * @module @ptah-extension/agent-generation/types/multi-phase
 */

import { z } from 'zod';
import type {
  MultiPhaseManifestV4 as SharedMultiPhaseManifestV4,
  PhaseResultV4 as SharedPhaseResultV4,
} from '@ptah-extension/shared';

/**
 * Identifier for each phase in the multi-phase analysis pipeline.
 */
export type MultiPhaseId =
  | 'project-profile'
  | 'architecture-assessment'
  | 'quality-audit'
  | 'elevation-plan';

/** Lifecycle status for an individual multi-phase analysis step. */
export type AnalysisPhaseStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Result of a single phase execution.
 * Recorded in the manifest to track which phases completed successfully.
 */
export interface PhaseResult {
  /** Current or terminal status of the phase. */
  status: AnalysisPhaseStatus;
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
export interface MultiPhaseManifestV3 {
  /** Schema version. Version 2 manifests are deliberately not resumable. */
  version: 3;
  /** Logical ID retained when a run is resumed. */
  runId: string;
  /** URL-safe slug derived from project description */
  slug: string;
  /** ISO 8601 timestamp of when the analysis was started */
  analyzedAt: string;
  /** ISO 8601 timestamp of the most recent durable checkpoint. */
  updatedAt: string;
  /** Durable lifecycle for the complete analysis run. */
  lifecycle: 'running' | 'paused' | 'completed' | 'failed';
  /** Model used for LLM phases (e.g., 'claude-sonnet-4-5-20250929') */
  model: string;
  /** Total pipeline duration in milliseconds */
  totalDurationMs: number;
  /** Per-phase execution results */
  phases: Record<MultiPhaseId, PhaseResult>;
}

/** A phase checkpoint with the SDK identity and verified input/output bytes. */
export interface PhaseResultV4 extends SharedPhaseResultV4, PhaseResult {}

/** The durable v4 manifest, assignable to the shared RPC response member. */
export interface MultiPhaseManifestV4 extends Omit<
  SharedMultiPhaseManifestV4,
  'phases'
> {
  phases: Record<MultiPhaseId, PhaseResultV4>;
}

export type MultiPhaseManifest = MultiPhaseManifestV3 | MultiPhaseManifestV4;

const MultiPhaseIdSchema = z.enum([
  'project-profile',
  'architecture-assessment',
  'quality-audit',
  'elevation-plan',
]);

const PhaseResultSchema = z
  .object({
    status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
    file: z.string(),
    durationMs: z.number(),
    error: z.string().optional(),
  })
  .refine(
    (phase) =>
      phase.status !== 'failed' ||
      (phase.error !== undefined && phase.error.trim().length > 0),
    { message: 'Failed phases require a non-empty error message.' },
  );

/** Validates the version-3 analysis manifest at its file-system boundary. */
export const MultiPhaseManifestV3Schema = z.object({
  version: z.literal(3),
  runId: z.string(),
  slug: z.string(),
  analyzedAt: z.string(),
  updatedAt: z.string(),
  lifecycle: z.enum(['running', 'paused', 'completed', 'failed']),
  model: z.string(),
  totalDurationMs: z.number(),
  phases: z.record(MultiPhaseIdSchema, PhaseResultSchema),
});

/** Kept for existing v3 writer and consumer imports during the read-path migration. */
export const MultiPhaseManifestSchema = MultiPhaseManifestV3Schema;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const PhaseResultV4Schema = z
  .strictObject({
    status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
    file: z.string(),
    durationMs: z.number(),
    attempt: z.number().int().nonnegative(),
    sessionId: z.string().trim().min(1).nullable(),
    input: z
      .strictObject({
        workspaceSha256: Sha256Schema,
        promptSha256: Sha256Schema,
        priorPhaseSha256: Sha256Schema.nullable(),
        model: z.string(),
      })
      .nullable(),
    verification: z.strictObject({
      status: z.enum(['pending', 'verified', 'failed']),
      outputSha256: Sha256Schema.nullable(),
      checkedAt: z.string().nullable(),
    }),
    error: z.string().optional(),
  })
  .superRefine((phase, context) => {
    if (
      phase.status === 'completed' &&
      (phase.sessionId === null ||
        phase.input === null ||
        phase.verification.status !== 'verified' ||
        phase.verification.outputSha256 === null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Completed phases require a session, input and verified output hash.',
      });
    }
    if (phase.status === 'failed' && !phase.error?.trim()) {
      context.addIssue({
        code: 'custom',
        message: 'Failed phases require a non-empty error message.',
      });
    }
  });

export const MultiPhaseManifestV4Schema = z.strictObject({
  version: z.literal(4),
  runId: z.string(),
  slug: z.string(),
  analyzedAt: z.string(),
  updatedAt: z.string(),
  lifecycle: z.enum(['running', 'paused', 'completed', 'failed']),
  model: z.string(),
  totalDurationMs: z.number(),
  workspaceFingerprint: z.strictObject({
    algorithm: z.literal('sha256-v1'),
    digest: Sha256Schema,
    capturedAt: z.string(),
  }),
  phases: z.record(MultiPhaseIdSchema, PhaseResultV4Schema),
});

/**
 * Options for configuring a multi-phase analysis run.
 */
export interface MultiPhaseAnalysisOptions {
  /** Total pipeline timeout in milliseconds (default: 3600000 = 1 hour) */
  timeout?: number;
  /** LLM model to use for phases 1-4 */
  model?: string;
  /** Whether the MCP server is running (required for file access in phases 2-4) */
  mcpServerRunning?: boolean;
  /** Port the MCP server is listening on */
  mcpPort?: number;
  /** Absolute paths to plugin directories (for SDK queries) */
  pluginPaths?: string[];
  /** Continue an unfinished version-3 manifest instead of starting a new run. */
  resume?: boolean;
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
] as const;
