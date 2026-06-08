/**
 * Zod schemas for Skill Synthesis RPC handlers.
 *
 * All numeric fields use `z.coerce.number()` so that string-serialized
 * values from HTML form inputs (which arrive as strings over the RPC bridge)
 * are coerced to numbers before validation.
 */
import { z } from 'zod';

export const SkillSynthesisSettingsSchema = z.object({
  enabled: z.boolean(),
  successesToPromote: z.coerce.number().int().min(1).max(100),
  dedupCosineThreshold: z.coerce.number().min(0).max(1),
  maxActiveSkills: z.coerce.number().int().min(1).max(1000),
  candidatesDir: z.string(),
  eligibilityMinTurns: z.coerce.number().int().min(1).max(100),
  evictionDecayRate: z.coerce.number().min(0).max(1),
  generalizationContextThreshold: z.coerce.number().int().min(1).max(100),
  minTrajectoryFidelityRatio: z.coerce.number().min(0).max(1),
  dedupClusterThreshold: z.coerce.number().min(0).max(1),
  minAbstractionEditDistance: z.coerce.number().min(0).max(1),
  judgeEnabled: z.boolean(),
  minJudgeScore: z.coerce.number().min(0).max(10),
  judgeModel: z.string(),
  maxPinnedSkills: z.coerce.number().int().min(0).max(1000),
  curatorEnabled: z.boolean(),
  curatorIntervalHours: z.coerce.number().int().min(1).max(8760),
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
  slug: SlugSchema,
});

export const SkillRevertEnhancementParamsSchema = z.object({
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
