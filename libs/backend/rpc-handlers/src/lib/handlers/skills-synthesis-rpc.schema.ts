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
