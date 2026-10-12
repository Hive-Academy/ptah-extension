/**
 * Seeded rows and the held-out question schedule of the retention suites
 * (benchmark-design.md 3.7, design :182). Pure and deterministic: every random
 * choice is a hash draw keyed on `(seed, row id, field)`, so the same inputs
 * always build the same rows, in any order and on any platform.
 *
 * Rows come from one of two sources:
 *   - the committed `gt-memory@v1` fixtures: each seeded fact (category other
 *     than `abstention`, whose statement is by definition never stored) is a
 *     `useful` row asked by its held-out question on a drawn day; each
 *     `distractor` record of `distractors.v1.jsonl` is a `disposable` row;
 *   - a plan-supplied rows file in {@link retentionSeedRowSchema} lines (the
 *     labelled local seed, design :182 "sediment rows labelled by the
 *     labeller").
 *
 * `last_used_at` age and `hits` are drawn from a usage distribution. The
 * default ({@link DEFAULT_USAGE_DISTRIBUTION}) is PROVISIONAL: a coarse shape
 * taken from the forensics M4 aggregates (archived rows average 0.15 hits,
 * active rows 2.42; `forensics.md:103`), not a histogram measured on the
 * snapshot. The local plan passes the measured histogram in `options.usage`.
 * Draws do not depend on the useful/disposable label unless the plan gives
 * the two labels different distributions, so the seed does not hand the
 * product the answer.
 *
 * Imports only Node, zod and type-only modules; the runner parent may load it.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { MemoryFactKind } from '../../baselines/retention-policies';
import type { Fact } from '../../ground-truth/label-schemas';

/** Row kinds of the seeded DB (design :182), in a fixed draw order. */
export const MEMORY_FACT_KINDS: readonly MemoryFactKind[] = [
  'fact',
  'preference',
  'event',
  'entity',
];

const nonEmpty = z.string().min(1);
const day = z.number().int().nonnegative();
const dayRange = z
  .tuple([day, day])
  .refine(([low, high]) => low <= high, 'a range is [low, high]');

/** One weighted bucket of the usage distribution. */
export const usageBucketSchema = z.strictObject({
  weight: z.number().finite().positive(),
  /** Days between the row's last use and simulated day 0, inclusive range. */
  lastUsedAgeDays: dayRange,
  /** `hits` at day 0, inclusive range. */
  hits: dayRange,
});
export const usageDistributionSchema = z.array(usageBucketSchema).min(1);
export type UsageDistribution = z.infer<typeof usageDistributionSchema>;

/** PROVISIONAL usage shape (see the module header); replace with the measured histogram. */
export const DEFAULT_USAGE_DISTRIBUTION: UsageDistribution = [
  { weight: 3, lastUsedAgeDays: [0, 6], hits: [0, 3] },
  { weight: 3, lastUsedAgeDays: [7, 29], hits: [0, 1] },
  { weight: 4, lastUsedAgeDays: [30, 89], hits: [0, 0] },
];

/** One seeded memory row with its label (design :182). */
export const retentionSeedRowSchema = z
  .strictObject({
    id: nonEmpty,
    kind: z.enum(['fact', 'preference', 'event', 'entity']),
    /** Unique per seed: the roster suite maps roster lines back to rows by it. */
    subject: nonEmpty,
    content: nonEmpty,
    useful: z.boolean(),
    /** Day of the held-out question that needs the row; `null` for disposable rows. */
    questionDay: day.nullable(),
    lastUsedAgeDays: day,
    hits: day,
    salience: z.number().finite().min(0).max(1),
  })
  .refine((row) => row.useful === (row.questionDay !== null), {
    message: 'a useful row has a question day and a disposable row has none',
    path: ['questionDay'],
  });
export type RetentionSeedRow = z.infer<typeof retentionSeedRowSchema>;

/** A `distractor` record of `distractors.v1.jsonl` (turn templates are skipped). */
export interface DistractorRecord {
  readonly id: string;
  readonly text: string;
}

export interface BuildRetentionSeedInput {
  readonly facts: readonly Fact[];
  readonly distractors: readonly DistractorRecord[];
  readonly seed: string;
  /** Last simulated day; question days are drawn in `1..days`. */
  readonly days: number;
  readonly usage: {
    readonly useful: UsageDistribution;
    readonly disposable: UsageDistribution;
  };
}

/** A uniform draw in [0, 1) from `sha256(seed, id, field)`. */
export function hashDraw(seed: string, id: string, field: string): number {
  const digest = createHash('sha256')
    .update(`${seed}\u0000${id}\u0000${field}`, 'utf8')
    .digest('hex');
  // 48 bits keep the value an exact double.
  return Number.parseInt(digest.slice(0, 12), 16) / 2 ** 48;
}

function drawInt(
  seed: string,
  id: string,
  field: string,
  [low, high]: readonly [number, number],
): number {
  return low + Math.floor(hashDraw(seed, id, field) * (high - low + 1));
}

function drawBucket(
  seed: string,
  id: string,
  distribution: UsageDistribution,
): UsageDistribution[number] {
  const total = distribution.reduce((sum, bucket) => sum + bucket.weight, 0);
  let point = hashDraw(seed, id, 'usage-bucket') * total;
  for (const bucket of distribution) {
    if (point < bucket.weight) return bucket;
    point -= bucket.weight;
  }
  return distribution[distribution.length - 1];
}

/** The fact kind a seeded fact is stored as: tags and category decide it. */
export function factKindOf(fact: Fact): MemoryFactKind {
  if (fact.scenarioTags.some((tag) => tag.includes('preference'))) {
    return 'preference';
  }
  if (fact.category === 'temporal') return 'event';
  return 'fact';
}

function subjectOf(id: string, text: string): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  return `${id} ${words.slice(0, 6).join(' ')}`;
}

function usageOf(
  seed: string,
  id: string,
  distribution: UsageDistribution,
): Pick<RetentionSeedRow, 'lastUsedAgeDays' | 'hits' | 'salience'> {
  const bucket = drawBucket(seed, id, distribution);
  return {
    lastUsedAgeDays: drawInt(seed, id, 'age', bucket.lastUsedAgeDays),
    hits: drawInt(seed, id, 'hits', bucket.hits),
    // The extractor's salience hint range; two decimals keep it readable.
    salience:
      Math.round((0.3 + 0.6 * hashDraw(seed, id, 'salience')) * 100) / 100,
  };
}

function byId<T extends { readonly id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Seed rows from the committed fixtures, in id order. */
export function buildRetentionSeed(
  input: BuildRetentionSeedInput,
): RetentionSeedRow[] {
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new RangeError(`days must be a positive integer, got ${input.days}`);
  }
  const useful = [...input.facts]
    .filter((fact) => fact.category !== 'abstention')
    .sort(byId)
    .map((fact): RetentionSeedRow => ({
      id: fact.id,
      kind: factKindOf(fact),
      subject: subjectOf(fact.id, fact.statement),
      content: fact.statement,
      useful: true,
      questionDay: drawInt(input.seed, fact.id, 'question-day', [
        1,
        input.days,
      ]),
      ...usageOf(input.seed, fact.id, input.usage.useful),
    }));
  const disposable = [...input.distractors]
    .sort(byId)
    .map((record): RetentionSeedRow => ({
      id: record.id,
      kind: MEMORY_FACT_KINDS[
        Math.floor(
          hashDraw(input.seed, record.id, 'kind') * MEMORY_FACT_KINDS.length,
        )
      ],
      subject: subjectOf(record.id, record.text),
      content: record.text,
      useful: false,
      questionDay: null,
      ...usageOf(input.seed, record.id, input.usage.disposable),
    }));
  return checkSeed([...useful, ...disposable], input.days);
}

/**
 * Refuse a seed the suites cannot score: repeated ids or subjects (the roster
 * maps lines back by subject) or a question day after the last simulated day.
 */
export function checkSeed(
  rows: readonly RetentionSeedRow[],
  days: number,
): RetentionSeedRow[] {
  const ids = new Set<string>();
  const subjects = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`seed row ${row.id} repeats`);
    if (subjects.has(row.subject)) {
      throw new Error(`seed row ${row.id} repeats subject "${row.subject}"`);
    }
    if (row.questionDay !== null && row.questionDay > days) {
      throw new Error(
        `seed row ${row.id} asks on day ${row.questionDay}, after the last simulated day ${days}`,
      );
    }
    ids.add(row.id);
    subjects.add(row.subject);
  }
  return [...rows];
}
