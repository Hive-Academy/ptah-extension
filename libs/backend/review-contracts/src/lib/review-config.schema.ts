import { z } from 'zod';

export const SeveritySchema = z.enum(['Critical', 'Major', 'Minor', 'Nitpick']);
export type Severity = z.infer<typeof SeveritySchema>;
export const LensSchema = z.enum([
  'correctness-lifecycle',
  'contracts-callers',
  'security-privacy',
  'host-di-config',
]);
export type Lens = z.infer<typeof LensSchema>;

const login = z
  .string()
  .trim()
  .min(1)
  .max(39)
  .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/);
const glob = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !/^[A-Za-z]:/.test(value),
    'Unsafe glob',
  );

export const RepoReviewConfigV1Schema = z
  .object({
    version: z.literal(1),
    include: z.array(glob).max(100).default(['**/*']),
    exclude: z.array(glob).max(100).default([]),
    pathInstructions: z
      .array(
        z
          .object({ glob, instruction: z.string().trim().min(1).max(4000) })
          .strict(),
      )
      .max(100)
      .default([]),
    lenses: z
      .object({
        'correctness-lifecycle': z.boolean(),
        'contracts-callers': z.boolean(),
        'security-privacy': z.boolean(),
        'host-di-config': z.boolean(),
      })
      .strict()
      .default({
        'correctness-lifecycle': true,
        'contracts-callers': true,
        'security-privacy': true,
        'host-di-config': true,
      }),
    minimumSeverity: SeveritySchema.default('Minor'),
    checks: z
      .object({ eslint: z.boolean(), degradationAudit: z.boolean() })
      .strict()
      .default({ eslint: true, degradationAudit: true }),
  })
  .strict();
export type RepoReviewConfigV1 = z.infer<typeof RepoReviewConfigV1Schema>;

export const RepositorySettingsSchema = z
  .object({
    owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
    name: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}$/)
      .refine((name) => name !== '.' && name !== '..'),
    enabled: z.boolean(),
    dryRun: z.boolean(),
    publicationPaused: z.boolean(),
  })
  .strict();
export type RepositorySettings = z.infer<typeof RepositorySettingsSchema>;

export const OperatorSettingsSchema = z
  .object({
    repositories: z
      .array(RepositorySettingsSchema)
      .max(100)
      .refine(
        (repos) =>
          new Set(
            repos.map((repo) => `${repo.owner}/${repo.name}`.toLowerCase()),
          ).size === repos.length,
        'Duplicate repository',
      ),
    maintainerLogins: z
      .array(login)
      .max(100)
      .refine(
        (values) =>
          new Set(values.map((value) => value.toLowerCase())).size ===
          values.length,
        'Duplicate maintainer login',
      ),
    pollMinutes: z.number().int().min(1).max(1440),
    globalPublicationPaused: z.boolean(),
    laneCapPerPr: z.number().int().min(1).max(6).default(6),
    confidenceFloor: z.number().min(0).max(1).default(0.8),
    maxNewInline: z.number().int().min(0).max(100).default(10),
    fallbackFamilies: z.array(z.string().trim().min(1).max(64)).max(12),
  })
  .strict();
export type OperatorSettings = z.infer<typeof OperatorSettingsSchema>;
