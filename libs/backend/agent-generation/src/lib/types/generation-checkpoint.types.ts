/**
 * Durable generation checkpoint contracts.
 *
 * These structures are persisted beside multi-phase analysis output so a
 * generation run can be safely resumed after a host restart.
 */

import { z } from 'zod';
import type { ProjectAnalysisResult } from '@ptah-extension/shared';

/** Durable status for one selected agent's generation work. */
export interface GenerationAgentCheckpoint {
  agentId: string;
  filePath: string;
  status: 'pending' | 'running' | 'written' | 'unchanged' | 'failed';
  rejectedSections: number;
  tailoredSections: number;
  error?: string;
}

/** Workspace-local checkpoint manifest for an in-progress generation run. */
export interface GenerationCheckpointManifest {
  version: 1;
  runId: string;
  analysisRunId?: string;
  analysisDirectory?: string;
  createdAt: string;
  updatedAt: string;
  lifecycle: 'running' | 'paused' | 'completed' | 'timed-out' | 'failed';
  outputDirectory: string;
  selectedAgentIds: string[];
  input: {
    threshold?: number;
    variableOverrides?: Record<string, string>;
    model?: string;
    analysisData?: ProjectAnalysisResult;
  };
  agents: Record<string, GenerationAgentCheckpoint>;
}

const GenerationAgentCheckpointSchema = z.object({
  agentId: z.string(),
  filePath: z.string(),
  status: z.enum(['pending', 'running', 'written', 'unchanged', 'failed']),
  rejectedSections: z.number(),
  tailoredSections: z.number(),
  error: z.string().optional(),
});

/** Validates a persisted generation checkpoint before a run is resumed. */
export const GenerationCheckpointManifestSchema = z.object({
  version: z.literal(1),
  runId: z.string(),
  analysisRunId: z.string().optional(),
  analysisDirectory: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lifecycle: z.enum(['running', 'paused', 'completed', 'timed-out', 'failed']),
  outputDirectory: z.string(),
  selectedAgentIds: z.array(z.string()),
  input: z.object({
    threshold: z.number().optional(),
    variableOverrides: z.record(z.string(), z.string()).optional(),
    model: z.string().optional(),
    analysisData: z.unknown().optional(),
  }),
  agents: z.record(z.string(), GenerationAgentCheckpointSchema),
});
