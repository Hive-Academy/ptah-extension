/**
 * Zod schemas for {@link WizardGenerationRpcHandlers}.
 *
 * Every `wizard:submit-selection` / `wizard:cancel` / `wizard:retry-item`
 * request is parsed here before the handler touches the orchestrator or the
 * generation checkpoint. Agent identifiers become checkpoint record keys and
 * `<outputDirectory>/<agentId>.md` file names, so they are restricted to one
 * safe path token.
 *
 * `analysisData` is validated against the SAME structural schema the on-disk
 * checkpoint uses (`ProjectAnalysisResultSchema`), so a value accepted here is
 * a value the checkpoint can be resumed from. A malformed value is dropped
 * (`.catch(undefined)`) rather than failing the whole request: generation is
 * fully specified by `analysisDir` alone, and the CLI's `setup` command still
 * sends the multi-phase RESPONSE in this field (a Batch 6 clean-up). Dropping
 * it makes the orchestrator analyze the workspace itself instead of treating
 * an unrelated object as a `ProjectAnalysisResult`.
 */

import { z } from 'zod';
import { ProjectAnalysisResultSchema } from '@ptah-extension/agent-generation';

/** One agent id: a file-name-safe token, never a path. */
export const WizardAgentIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Agent id must be a single file-name-safe token.',
  )
  .refine((id) => id !== '.' && id !== '..' && !id.includes('..'), {
    message: 'Agent id must not contain path traversal.',
  });

export const WizardSubmitSelectionParamsSchema = z.object({
  /** Empty or absent is allowed only together with `resume: true`. */
  selectedAgentIds: z.array(WizardAgentIdSchema).max(200).optional(),
  threshold: z.number().min(0).max(100).optional(),
  variableOverrides: z.record(z.string().min(1), z.string()).optional(),
  analysisData: ProjectAnalysisResultSchema.optional().catch(undefined),
  model: z.string().min(1).max(200).optional(),
  analysisDir: z.string().min(1).max(4096).optional(),
  resume: z.boolean().optional(),
});
export type WizardSubmitSelectionParsedParams = z.infer<
  typeof WizardSubmitSelectionParamsSchema
>;

export const WizardCancelParamsSchema = z.object({
  saveProgress: z.boolean().optional(),
});

export const WizardRetryItemParamsSchema = z.object({
  itemId: WizardAgentIdSchema,
});

/**
 * Render the first Zod issue as `path: message`.
 *
 * The handler returns this string to the webview, so it names the offending
 * field without echoing the value the caller sent.
 */
export function formatIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid parameters.';
  const path = issue.path.map(String).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
