import { z } from 'zod';

const SkillsApiSkillSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  source: z.string(),
});

export const SkillsApiSearchResponseSchema = z.object({
  query: z.string().optional(),
  searchType: z.string().optional(),
  skills: z.array(SkillsApiSkillSchema),
  count: z.number().optional(),
  duration_ms: z.number().optional(),
});

export type SkillsApiSkill = z.infer<typeof SkillsApiSkillSchema>;
