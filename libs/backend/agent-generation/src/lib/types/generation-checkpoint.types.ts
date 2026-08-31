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

/**
 * Structural schema for {@link ProjectAnalysisResult}.
 *
 * A checkpoint manifest is read back from disk, so `analysisData` is untrusted
 * input. It is fed straight into template variables and the section prompt, and
 * an `z.unknown()` here would let arbitrary JSON reach that code typed as a
 * `ProjectAnalysisResult`.
 */
const ProjectAnalysisResultSchema: z.ZodType<ProjectAnalysisResult> = z.object({
  projectType: z.string(),
  projectTypeDescription: z.string().optional(),
  fileCount: z.number(),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  monorepoType: z.string().optional(),
  architecturePatterns: z.array(
    z.object({
      name: z.string(),
      confidence: z.number(),
      evidence: z.array(z.string()),
      description: z.string().optional(),
    }),
  ),
  keyFileLocations: z.object({
    entryPoints: z.array(z.string()),
    configs: z.array(z.string()),
    testDirectories: z.array(z.string()),
    apiRoutes: z.array(z.string()),
    components: z.array(z.string()),
    services: z.array(z.string()),
    models: z.array(z.string()).optional(),
    repositories: z.array(z.string()).optional(),
    utilities: z.array(z.string()).optional(),
  }),
  languageDistribution: z
    .array(
      z.object({
        language: z.string(),
        percentage: z.number(),
        fileCount: z.number(),
        linesOfCode: z.number().optional(),
      }),
    )
    .optional(),
  existingIssues: z.object({
    errorCount: z.number(),
    warningCount: z.number(),
    infoCount: z.number(),
    errorsByType: z.record(z.string(), z.number()),
    warningsByType: z.record(z.string(), z.number()),
    topErrors: z
      .array(
        z.object({
          message: z.string(),
          count: z.number(),
          source: z.string(),
        }),
      )
      .optional(),
  }),
  testCoverage: z.object({
    percentage: z.number(),
    hasTests: z.boolean(),
    testFramework: z.string().nullable().optional(),
    hasUnitTests: z.boolean(),
    hasIntegrationTests: z.boolean(),
    hasE2eTests: z.boolean(),
    testFileCount: z.number().optional(),
    sourceFileCount: z.number().optional(),
    testToSourceRatio: z.number().optional(),
  }),
  codeConventions: z
    .object({
      indentation: z.enum(['tabs', 'spaces']),
      indentSize: z.number(),
      quoteStyle: z.enum(['single', 'double']),
      semicolons: z.boolean(),
      trailingComma: z.enum(['none', 'es5', 'all']),
      namingConventions: z
        .object({
          files: z.string().optional(),
          classes: z.string().optional(),
          functions: z.string().optional(),
          variables: z.string().optional(),
          constants: z.string().optional(),
          interfaces: z.string().optional(),
          types: z.string().optional(),
        })
        .optional(),
      maxLineLength: z.number().optional(),
      usePrettier: z.boolean().optional(),
      useEslint: z.boolean().optional(),
      additionalTools: z.array(z.string()).optional(),
    })
    .optional(),
  qualityScore: z.number().optional(),
  qualityIssues: z
    .array(
      z.object({
        area: z.string(),
        severity: z.enum(['high', 'medium', 'low']),
        description: z.string(),
        recommendation: z.string(),
        affectedFiles: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  qualityStrengths: z.array(z.string()).optional(),
  qualityRecommendations: z
    .array(
      z.object({
        priority: z.number(),
        category: z.string(),
        issue: z.string(),
        solution: z.string(),
      }),
    )
    .optional(),
});

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
    analysisData: ProjectAnalysisResultSchema.optional(),
  }),
  agents: z.record(z.string(), GenerationAgentCheckpointSchema),
});
