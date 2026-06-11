import { z } from 'zod';

export const SECRET_KEY = 'skillsSh.apiKey';

const SkillsApiSkillSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  source: z.string(),
  installs: z.number(),
  sourceType: z.string(),
  installUrl: z.string().nullable().optional(),
  url: z.string(),
  isDuplicate: z.boolean().optional(),
  installsYesterday: z.number().optional(),
  change: z.number().optional(),
});

export const SkillsApiSearchResponseSchema = z.object({
  data: z.array(SkillsApiSkillSchema),
  query: z.string().optional(),
  searchType: z.string().optional(),
  count: z.number().optional(),
  durationMs: z.number().optional(),
});

export const SkillsApiLeaderboardResponseSchema = z.object({
  data: z.array(SkillsApiSkillSchema),
  pagination: z
    .object({
      page: z.number(),
      perPage: z.number(),
      total: z.number(),
      hasMore: z.boolean(),
    })
    .optional(),
});

export const SkillsApiCuratedResponseSchema = z.object({
  data: z.array(
    z.object({
      owner: z.string(),
      totalInstalls: z.number().optional(),
      featuredRepo: z.string().optional(),
      featuredSkill: z.string().optional(),
      skills: z.array(SkillsApiSkillSchema),
    }),
  ),
  totalOwners: z.number().optional(),
  totalSkills: z.number().optional(),
  generatedAt: z.string().optional(),
});

export type SkillsApiSkill = z.infer<typeof SkillsApiSkillSchema>;
