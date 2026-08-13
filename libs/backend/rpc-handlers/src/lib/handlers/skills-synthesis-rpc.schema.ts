/**
 * Zod schemas for Skill Synthesis RPC handlers.
 *
 * All numeric fields use `z.coerce.number()` so that string-serialized
 * values from HTML form inputs (which arrive as strings over the RPC bridge)
 * are coerced to numbers before validation.
 */
import { z } from 'zod';

/**
 * A croner-compatible 5- or 6-field expression.
 *
 * Deliberately shape-only: croner is the authority on whether an expression is
 * schedulable, and it produces a far better diagnostic than a regex can. What
 * this guards is the boundary concern Zod exists for — that the value is a
 * non-empty string of the right arity, so a `null`, a number, or an empty
 * string never reaches `jobStore.upsert` and disarms a tier silently.
 */
const CronExprSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((expr) => {
    const fields = expr.split(/\s+/);
    return fields.length === 5 || fields.length === 6;
  }, 'cron expression must have 5 or 6 fields');

export const SkillSynthesisSettingsSchema = z.object({
  enabled: z.boolean(),
  successesToPromote: z.coerce.number().int().min(1).max(100),
  dedupCosineThreshold: z.coerce.number().min(0).max(1),
  maxActiveSkills: z.coerce.number().int().min(1).max(1000),
  candidatesDir: z.string(),
  eligibilityMinTurns: z.coerce.number().int().min(1).max(100),
  evictionDecayRate: z.coerce.number().min(0).max(1),
  generalizationContextThreshold: z.coerce.number().int().min(1).max(100),
  dedupClusterThreshold: z.coerce.number().min(0).max(1),
  prefilterMinEdits: z.coerce.number().int().min(0).max(100),
  prefilterMinChars: z.coerce.number().int().min(0).max(100000),
  prefilterMinToolUses: z.coerce.number().int().min(0).max(100),
  judgeEnabled: z.boolean(),
  minJudgeScore: z.coerce.number().min(0).max(10),
  judgeModel: z.string(),
  maxPinnedSkills: z.coerce.number().int().min(0).max(1000),
  curatorEnabled: z.boolean(),
  curatorIntervalHours: z.coerce.number().int().min(1).max(8760),
  suggestionMinClusterSize: z.coerce.number().int().min(2).max(100),
  suggestionMaxCandidates: z.coerce.number().int().min(1).max(5000),

  // TASK_2026_180 Phase 0 — the queued drain.
  //
  // The keys are DOTTED on purpose. `registerGetSettings` reads
  // `skillSynthesis.${schemaKey}` and `registerUpdateSettings` writes the same
  // path, so declaring the key here is the whole of the work: the schema-driven
  // loop picks it up with no handler change. Renaming `'drain.cronExpr'` to
  // `drainCronExpr` would read and write a settings path no host stores.
  //
  // Bounds are behavioural, not cosmetic:
  //  - `maxItemsPerRun` caps how much work one tick can take; unbounded, a
  //    single tick could hold the SQLite write lock for minutes.
  //  - `foregroundBackoffMs` accepts `0`, which DISABLES the foreground gate.
  //    That is a supported setting, so the floor is 0 and not a minimum delay.
  //  - `maxTokensPerDay` accepts `0`, which means UNLIMITED (not "spend
  //    nothing" — `skillSynthesis.enabled` is how you stop the drain).
  //  - `staleClaimTtlMs` has a 60s floor because a TTL below the longest stage
  //    reaps live work; the drain warns about the same condition at run time
  //    (`assertStaleClaimTtl`), and this floor keeps the absurd cases out.
  'drain.cronExpr': CronExprSchema,
  'drain.nightlyCronExpr': CronExprSchema,
  'drain.weeklyCronExpr': CronExprSchema,
  'drain.maxItemsPerRun': z.coerce.number().int().min(1).max(100),
  'drain.perWorkspaceBatch': z.coerce.number().int().min(1).max(100),
  'drain.foregroundBackoffMs': z.coerce.number().int().min(0).max(86_400_000),
  'drain.pauseOnBattery': z.boolean(),
  'drain.maxAttempts': z.coerce.number().int().min(1).max(50),
  'drain.staleClaimTtlMs': z.coerce.number().int().min(60_000).max(86_400_000),
  'budget.maxTokensPerDay': z.coerce.number().int().min(0).max(1_000_000_000),
  // Key ships in commit C0 so the Electron tray (commit C5) is purely additive.
  trayKeepalive: z.boolean(),
});

export type SkillSynthesisSettingsInput = z.infer<
  typeof SkillSynthesisSettingsSchema
>;

export const UpdateSkillSynthesisSettingsParamsSchema = z.object({
  settings: SkillSynthesisSettingsSchema.partial(),
});

export type UpdateSkillSynthesisSettingsParams = z.infer<
  typeof UpdateSkillSynthesisSettingsParamsSchema
>;

export const PinSkillParamsSchema = z.object({
  id: z.string().min(1),
});

export type PinSkillParams = z.infer<typeof PinSkillParamsSchema>;

export const UnpinSkillParamsSchema = z.object({
  id: z.string().min(1),
});

export type UnpinSkillParams = z.infer<typeof UnpinSkillParamsSchema>;

export const RunCuratorParamsSchema = z.object({});

export type RunCuratorParams = z.infer<typeof RunCuratorParamsSchema>;

export const SkillDiagnosticsParamsSchema = z.object({
  workspaceRoot: z.string().min(1).nullable().optional(),
  eventLimit: z.number().int().positive().max(200).optional(),
});

export const SkillAnalyzeNowParamsSchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .refine((v) => v !== 'manual', {
      message: 'reserved sessionId',
    }),
  workspaceRoot: z.string().min(1),
  force: z.boolean().optional(),
});

export const SkillTriggersSchema = z.object({
  sessionEnd: z.boolean(),
  idleMs: z
    .number()
    .int()
    .nonnegative()
    .refine((v) => v === 0 || v >= 5000, {
      message: 'idleMs must be 0 or >= 5000',
    }),
  bootScan: z.boolean(),
  subagentStop: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  postToolUse: z
    .object({
      enabled: z.boolean(),
      minEditCount: z.number().int().min(1).max(20),
    })
    .optional(),
  turnComplete: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  maxAnalyzesPerHour: z.number().int().min(0).max(1000).optional(),
});

export const SkillSetTriggersParamsSchema = z.object({
  triggers: SkillTriggersSchema.partial(),
});

export const SkillGetTriggersParamsSchema = z.object({}).strict().optional();

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

export const SkillEnhanceNowParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
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

export const SkillKeepCloneParamsSchema = z.object({
  kind: SkillCloneKindSchema,
  slug: SlugSchema,
});

export const SkillInvocationStatsParamsSchema = z.object({
  slug: SlugSchema,
});

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

const SuggestionStatusSchema = z.enum(['pending', 'accepted', 'dismissed']);

export const SkillListSuggestionsParamsSchema = z
  .object({
    status: SuggestionStatusSchema.optional(),
  })
  .optional();

export const SkillAcceptSuggestionParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export const SkillDismissSuggestionParamsSchema = z.object({
  id: z.string().min(1).max(64),
  reason: z.string().max(500).optional(),
});

export const SkillGetSuggestionParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export const SkillUpdateSuggestionParamsSchema = z.object({
  id: z.string().min(1).max(64),
  // No newlines: the name becomes the SKILL.md frontmatter `name:` line.
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\r\n]+$/, 'name must be a single line')
    .optional(),
  description: z.string().min(1).max(4000).optional(),
  body: z.string().min(1).max(100000).optional(),
});

export const RejectBulkParamsSchema = z.object({
  ids: z.array(z.string()).min(1),
  reason: z.string().optional(),
});

export type RejectBulkParams = z.infer<typeof RejectBulkParamsSchema>;

export const PromoteBulkParamsSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export type PromoteBulkParams = z.infer<typeof PromoteBulkParamsSchema>;

export const RejectByPatternParamsSchema = z.object({
  pattern: z.string().min(1),
  reason: z.string().optional(),
});

export type RejectByPatternParams = z.infer<typeof RejectByPatternParamsSchema>;

/**
 * Params for `skillSynthesis:queue` — the Activity surface's read of the drain.
 *
 * Both limits are bounded rather than merely positive: the queue table grows
 * one row per (session, stage) and the caller is a renderer that only ever
 * paints a short list, so an unbounded `limit` would be a way to ask the host
 * to serialize the entire table over the RPC bridge.
 *
 * `.optional()` on the object, not just the fields: the Skills tab calls this
 * with no params at all on first paint.
 */
export const SkillQueueParamsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    runLimit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .optional();

export type SkillQueueParams = z.infer<typeof SkillQueueParamsSchema>;

export const ListSpecsParamsSchema = z.object({}).strict().optional();

export const HarvestSpecsParamsSchema = z.object({}).strict().optional();

export const ClearStaleSpecsParamsSchema = z.object({
  retentionDays: z.coerce.number().int().min(0).max(3650).optional(),
  mode: z.enum(['archive', 'delete']).optional(),
});

export type ClearStaleSpecsParams = z.infer<typeof ClearStaleSpecsParamsSchema>;
