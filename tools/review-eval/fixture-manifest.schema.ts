import { z } from 'zod';

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const source = z.object({ url: z.string().url(), fetchedAt: z.string().datetime(), sha256: digest });
const pending = z.object({ status: z.literal('pending'), reason: z.string().min(1) });
const verifiedSha = z.object({ status: z.literal('ready'), value: sha, source });
export const fixtureHeadSchema = z.discriminatedUnion('status', [pending, verifiedSha]);
const verifiedRoot = z.object({
  status: z.literal('ready'),
  slot: z.number().int().positive(),
  id: z.number().int().positive(),
  category: z.string().min(1),
  severity: z.enum(['Minor', 'Major']),
  evidence: z.string().min(1),
  source,
});
const pendingRoot = pending.extend({ slot: z.number().int().positive(), id: z.number().int().positive().optional() });
export const fixtureRootSchema = z.discriminatedUnion('status', [verifiedRoot, pendingRoot]);
export const fixturePrSchema = z.object({
  repo: z.literal('Hive-Academy/PtahCode'),
  number: z.number().int().positive(),
  expectedRoots: z.number().int().positive(),
  head: fixtureHeadSchema,
  base: fixtureHeadSchema,
  snapshot: z.discriminatedUnion('status', [pending, z.object({ status: z.literal('ready'), sha256: digest, reachableCommitsSha256: digest })]),
  roots: z.array(fixtureRootSchema),
}).superRefine((pr, ctx) => {
  if (pr.roots.length !== pr.expectedRoots) ctx.addIssue({ code: 'custom', message: 'root slots must match expectedRoots' });
  if (new Set(pr.roots.map(root => root.slot)).size !== pr.roots.length) ctx.addIssue({ code: 'custom', message: 'duplicate root slot' });
});

export const fixtureManifestSchema = z.object({
  schemaVersion: z.literal(1),
  adjudicationVersion: z.string().min(1),
  source: z.object({ url: z.string().url(), fetchedAt: z.string().datetime().optional(), sha256: digest.optional(), status: z.enum(['pending', 'ready']) }),
  expectedRoots: z.literal(108),
  expectedMajors: z.literal(31),
  prs: z.array(fixturePrSchema).length(15),
}).superRefine((manifest, ctx) => {
  if (manifest.prs.reduce((sum, pr) => sum + pr.expectedRoots, 0) !== 108) ctx.addIssue({ code: 'custom', message: 'expected root denominator must be 108' });
  if (new Set(manifest.prs.map(pr => pr.number)).size !== 15) ctx.addIssue({ code: 'custom', message: 'duplicate PR' });
  const ids = manifest.prs.flatMap(pr => pr.roots.flatMap(root => root.id === undefined ? [] : [root.id]));
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'duplicate root ID' });
  if (manifest.source.status === 'ready' && (!manifest.source.fetchedAt || !manifest.source.sha256)) ctx.addIssue({ code: 'custom', message: 'ready source requires timestamp and checksum' });
});

export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;
export type FixturePr = FixtureManifest['prs'][number];
export function parseFixtureManifest(input: unknown): FixtureManifest { return fixtureManifestSchema.parse(input); }
export function requireReadyFixture(input: unknown): FixtureManifest {
  const manifest = parseFixtureManifest(input);
  if (manifest.source.status !== 'ready' || manifest.prs.some(pr => pr.head.status !== 'ready' || pr.base.status !== 'ready' || pr.roots.some(root => root.status !== 'ready'))) throw new Error('Fixture has pending evidence');
  if (manifest.prs.flatMap(pr => pr.roots).filter(root => root.status === 'ready' && root.severity === 'Major').length !== 31) throw new Error('Major denominator differs from 31');
  return manifest;
}
