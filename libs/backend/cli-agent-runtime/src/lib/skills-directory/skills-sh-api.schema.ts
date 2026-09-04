import { z } from 'zod';

/**
 * `description` is optional because the public `/api/search` endpoint does not
 * return one today (measured 2026-08-24). It is declared anyway so the day it
 * appears we use it instead of probing GitHub for the same string.
 */
const SkillsApiSkillSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  source: z.string(),
  description: z.string().optional(),
});

export const SkillsApiSearchResponseSchema = z.object({
  query: z.string().optional(),
  searchType: z.string().optional(),
  skills: z.array(SkillsApiSkillSchema),
  count: z.number().optional(),
  duration_ms: z.number().optional(),
});

export type SkillsApiSkill = z.infer<typeof SkillsApiSkillSchema>;
