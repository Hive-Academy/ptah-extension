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
import {
  FileDecisionEntrySchema,
  GenerationTargetChoiceSchema,
} from './wizard-generation-rpc.schema';

const workspacePath = z.string().min(1).max(4096).optional();

export const WizardDeepAnalyzeParamsSchema = z.object({
  model: z.string().min(1).max(200).optional(),
  /** Continue the unfinished version-4 analysis run instead of starting anew. */
  resume: z.boolean().optional(),
  workspacePath,
});

/** `wizard:get-resumable-run` takes no parameters; unknown keys are dropped. */
export const WizardGetResumableRunParamsSchema = z.object({});
/** `wizard:analysis-status` takes no parameters; unknown keys are dropped. */
export const WizardAnalysisStatusParamsSchema = z.object({});

export const WizardListAnalysesParamsSchema = z.object({ workspacePath });

export const WizardLoadAnalysisParamsSchema = z.object({
  filename: z.string().min(1).max(255),
  workspacePath,
});

/** Most pack files one plan or install may name. */
const MAX_PACK_FILES = 200;

const packSource = z.string().min(1).max(2048);
const packFileName = z.string().min(1).max(255);
const packAgentFiles = z.array(packFileName).min(1).max(MAX_PACK_FILES);

/** `wizard:plan-pack-install`: one file or the whole pack, and the target. */
export const WizardPlanPackInstallParamsSchema = z.object({
  source: packSource,
  agentFiles: packAgentFiles,
  target: GenerationTargetChoiceSchema.optional(),
});

/** Keep/replace per pack file name, with the revision the plan row carried. */
export const PackFileDecisionsSchema = z
  .record(packFileName, FileDecisionEntrySchema)
  .refine((decisions) => Object.keys(decisions).length <= MAX_PACK_FILES, {
    message: `At most ${MAX_PACK_FILES} file decisions are allowed.`,
  });

export const WizardInstallPackAgentsParamsSchema = z.object({
  source: packSource,
  agentFiles: packAgentFiles,
  workspacePath,
  /** Token from `wizard:plan-pack-install`; random, server-held. */
  planToken: z.string().uuid().optional(),
  decisions: PackFileDecisionsSchema.optional(),
  target: GenerationTargetChoiceSchema.optional(),
});
