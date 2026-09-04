/**
 * Zod schemas for {@link SetupRpcHandlers}.
 *
 * The `wizard:` query and analysis-resume DTOs are parsed here at the RPC
 * boundary. `wizard:recommend-agents` is the one method not covered: its input
 * is the raw analysis object, validated by `ProjectAnalysisZodSchema` from
 * `@ptah-extension/agent-generation` inside the handler.
 *
 * `workspacePath` stays optional everywhere it appears: the backend's own
 * active root is trusted, and a caller-supplied path is additionally checked
 * with `isAuthorizedWorkspace` in the handler.
 */

import { z } from 'zod';

const workspacePath = z.string().min(1).max(4096).optional();

export const WizardDeepAnalyzeParamsSchema = z.object({
  model: z.string().min(1).max(200).optional(),
  /** Continue the unfinished version-3 analysis run instead of starting anew. */
  resume: z.boolean().optional(),
  workspacePath,
});

/** `wizard:get-resumable-run` takes no parameters; unknown keys are dropped. */
export const WizardGetResumableRunParamsSchema = z.object({});

export const WizardListAnalysesParamsSchema = z.object({ workspacePath });

export const WizardLoadAnalysisParamsSchema = z.object({
  filename: z.string().min(1).max(255),
  workspacePath,
});

export const WizardInstallPackAgentsParamsSchema = z.object({
  source: z.string().min(1).max(2048),
  agentFiles: z.array(z.string().min(1).max(255)).min(1).max(200),
  workspacePath,
});
