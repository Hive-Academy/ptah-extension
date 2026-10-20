/**
 * Zod schemas for Skill Synthesis RPC handlers.
 *
 * All numeric fields use `z.coerce.number()` so that string-serialized
 * values from HTML form inputs (which arrive as strings over the RPC bridge)
 * are coerced to numbers before validation.
 */
import { z } from 'zod';
import {
  AGENT_MODEL_PROVIDERS,
  AGENT_MODEL_WILDCARD,
} from '@ptah-extension/shared';

const SkillCloneKindSchema = z.enum(['skill', 'agent', 'command']);

const SlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'invalid slug')
  .refine(
    (s) => !s.includes('..') && !s.includes('/') && !s.includes('\\'),
    'invalid slug',
  );

const HistoryTsSchema = z
  .string()
  .regex(/^\d+(-\d+)?$/, 'invalid history timestamp');

export const SkillListClonesParamsSchema = z.object({}).strict().optional();

export const SkillGetCloneParamsSchema = z.object({
  slug: SlugSchema,
  kind: SkillCloneKindSchema,
});

/**
 * Opaque handle minted by `SkillEnhancerService.generateProposal`
 * (`crypto.randomUUID`). Shape-checked here so a malformed id is rejected at
 * the boundary rather than reaching the proposal cache.
 */
const ProposalIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'invalid proposalId',
  );

export const SkillPreviewEnhancementParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
});

export const SkillApplyProposalParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
  proposalId: ProposalIdSchema,
});

/**
 * `ts` is constrained to the exact snapshot-directory format produced by
 * `UserLayerMirrorService.makeUniqueHistoryDir` (`Date.now()` optionally
 * suffixed with a collision counter). Anything else — separators, dots,
 * traversal — is rejected before any path is built.
 */
export const SkillGetHistoryBodyParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
  ts: HistoryTsSchema,
});

export const SkillRevertEnhancementParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
  historyTs: HistoryTsSchema,
});

export const SkillRebaseCloneParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
});

/**
 * ~1 MiB, counted in UTF-16 code units — `z.string().max` counts units, not
 * bytes. The largest body this surface has ever carried is ~16 KB, so the cap
 * exists to stop an absurd payload reaching the filesystem, not to constrain
 * real content.
 */
const MAX_CLONE_BODY_CHARS = 1_048_576;

/**
 * The FIRST gate on `skillSynthesis:saveCloneBody`. It runs before any path is
 * joined and before `assertUnderUserLayer`, which is the second gate.
 *
 * The non-empty rule is deliberate: an empty body would be reconciled outward
 * as an empty skill in every harness directory. Emptying a clone is not a
 * capability this surface offers, so it is a rejected input rather than a
 * silent one.
 *
 * `.min(1)` alone is not that rule — a single space satisfies it, and a body of
 * `'   '` is exactly the effectively-empty skill the check exists to stop. The
 * `.refine` tests the TRIMMED length while the value the schema RETURNS is the
 * original, untrimmed body: leading and trailing whitespace inside a real body
 * (a trailing newline, most commonly) is the author's, and the write path must
 * not silently reshape what the user typed.
 */
export const SkillSaveCloneBodyParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
  body: z
    .string()
    .min(1)
    .max(MAX_CLONE_BODY_CHARS)
    .refine((b) => b.trim().length > 0, 'body must not be blank'),
  expectedSourceHash: z
    .string()
    // formatSourceHash(body) in platform-core produces this exact shape.
    .regex(/^sha256:[0-9a-f]{64}$/)
    .optional(),
  origin: z.literal('enhancement').optional(),
});

export const SkillKeepCloneParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
});

export const SkillInvocationStatsParamsSchema = z.object({
  slug: SlugSchema,
  kind: SkillCloneKindSchema.optional().default('skill'),
});

/** The quarantine listing reads the open workspace; it takes no input. */
export const SkillListQuarantinedAgentsParamsSchema = z
  .object({})
  .strict()
  .optional();

/**
 * The slug becomes a path segment under `{ws}/.claude/agents`, so the shared
 * `SlugSchema` (no `..`, no separators) is the first gate; the restore itself
 * re-checks it before any path join.
 */
export const SkillRestoreQuarantinedAgentParamsSchema = z
  .object({ slug: SlugSchema })
  .strict();

/**
 * A workspace path sent back by the model editor. Blank is rejected here so a
 * missing workspace can never reach a settings write (machine-scope writes do
 * not need the path, so the handler would otherwise not notice its absence).
 */
const AgentModelWorkspaceRootSchema = z
  .string()
  .max(4096)
  .refine((root) => root.trim().length > 0, 'workspaceRoot is required');

export const SkillGetAgentModelsParamsSchema = z
  .object({ workspaceRoot: AgentModelWorkspaceRootSchema.optional() })
  .strict()
  .optional();

/**
 * `slug` is an agent slug (same rule as every other slug here) or `'*'`, the
 * entry that applies to every agent without its own value. `value` is only
 * length-capped: whether it is a usable model id is the shared classifier's
 * decision in the handler, which can name the reason.
 */
export const SkillSetAgentModelParamsSchema = z
  .object({
    workspaceRoot: AgentModelWorkspaceRootSchema,
    slug: z.union([z.literal(AGENT_MODEL_WILDCARD), SlugSchema]),
    provider: z.enum(AGENT_MODEL_PROVIDERS),
    scope: z.enum(['machine', 'workspace']),
    value: z.string().max(256).nullable(),
    confirmUnlisted: z.boolean().optional(),
  })
  .strict();

export const getScorecardsParamsSchema = z.object({
  slugs: z.array(z.string().min(1).max(200)).max(500),
});

export type GetScorecardsParams = z.infer<typeof getScorecardsParamsSchema>;

export const getScorecardDetailParamsSchema = z.object({
  slug: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(100).optional(),
});

export type GetScorecardDetailParams = z.infer<
  typeof getScorecardDetailParamsSchema
>;

export const ListSpecsParamsSchema = z.object({}).strict().optional();

export const HarvestSpecsParamsSchema = z.object({}).strict().optional();

export const ClearStaleSpecsParamsSchema = z.object({
  retentionDays: z.coerce.number().int().min(0).max(3650).optional(),
  mode: z.enum(['archive', 'delete']).optional(),
});

export type ClearStaleSpecsParams = z.infer<typeof ClearStaleSpecsParamsSchema>;
