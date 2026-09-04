/**
 * Zod schemas for {@link EnhancedPromptsRpcHandlers}.
 *
 * Every `enhancedPrompts:*` request is parsed here before the handler reaches
 * `EnhancedPromptsService`. The handler keeps its established contract of
 * answering with a structured `{ success: false, error }` (it never throws to
 * the RPC boundary), so a schema failure is turned into that shape by
 * `describeEnhancedPromptsParamsIssue`.
 *
 * `analysisDir` is only SHAPE-checked here. Canonicalizing it and confirming
 * it stays under the authorized workspace's `.ptah/analysis` root is done in
 * the handler through `AnalysisStorageService.resolveAuthorizedAnalysisDir`,
 * before it can reach the enhanced-prompt trace writer.
 */

import { z } from 'zod';
import { ProjectAnalysisResultSchema } from '@ptah-extension/agent-generation';

const workspacePath = z.string().min(1).max(4096);

const EnhancedPromptsConfigOptionsSchema = z.object({
  includeStyleGuidelines: z.boolean().optional(),
  includeTerminology: z.boolean().optional(),
  includeArchitecturePatterns: z.boolean().optional(),
  includeTestingGuidelines: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const EnhancedPromptsWorkspaceParamsSchema = z.object({ workspacePath });

export const EnhancedPromptsRunWizardParamsSchema = z.object({
  workspacePath,
  config: EnhancedPromptsConfigOptionsSchema.optional(),
  analysisData: ProjectAnalysisResultSchema.optional(),
  analysisDir: z.string().min(1).max(4096).optional(),
  model: z.string().min(1).max(200).optional(),
});

export const EnhancedPromptsSetEnabledParamsSchema = z.object({
  workspacePath,
  enabled: z.boolean(),
});

export const EnhancedPromptsRegenerateParamsSchema = z.object({
  workspacePath,
  force: z.boolean().optional(),
  config: EnhancedPromptsConfigOptionsSchema.optional(),
});

/**
 * Turn a schema failure into the user-facing message this handler has always
 * answered with. Field names are named only for the two fields callers have
 * historically got wrong; everything else is a generic rejection so no raw
 * Zod issue text crosses the boundary.
 */
export function describeEnhancedPromptsParamsIssue(error: z.ZodError): string {
  const firstPath = String(error.issues[0]?.path[0] ?? '');
  if (firstPath === 'workspacePath') return 'Workspace path is required';
  if (firstPath === 'enabled') return 'Enabled flag is required';
  if (firstPath === 'analysisData') return 'Invalid analysis data';
  return 'Invalid request parameters';
}
