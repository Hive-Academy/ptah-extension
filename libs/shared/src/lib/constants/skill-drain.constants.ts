/**
 * The three cron jobs that drain the skill-synthesis queue.
 *
 * Three tiers exist rather than one because the stages differ by cost, not by
 * kind: the frequent tier runs the cheap local stages, and each slower tier is
 * a SUPERSET of the cheaper one so an expensive stage is never stranded.
 *
 * The ids live here — in the one library both sides of the graph may import —
 * because three unrelated places need the same literal and none of them may
 * import the others:
 *
 *  - `thoth-runtime` / `cli-engine` upsert the jobs under these ids;
 *  - `rpc-handlers` reads each id's `job_runs` history to answer
 *    `skillSynthesis:queue`;
 *  - the Skills tab renders a run's tier label.
 *
 * A job id is a stable, human-readable handle (the same shape as the existing
 * `@ptah/daily-backup` job), NOT a ULID: `jobStore.upsert` is keyed on it, so
 * re-running host activation must produce the same id or every restart would
 * create a duplicate job.
 */

/** The drain tiers, cheapest cadence first. Matches `DrainTier` in `skill-synthesis`. */
export const SKILL_DRAIN_TIERS = ['frequent', 'nightly', 'weekly'] as const;

export type SkillDrainTier = (typeof SKILL_DRAIN_TIERS)[number];

/** Fixed `scheduled_jobs.id` per tier. Upserted, never generated. */
export const SKILL_DRAIN_JOB_IDS: Readonly<Record<SkillDrainTier, string>> = {
  frequent: '@ptah/skills-drain-frequent',
  nightly: '@ptah/skills-drain-nightly',
  weekly: '@ptah/skills-drain-weekly',
};

/**
 * Fixed handler names registered against `IHandlerRegistry` per tier.
 *
 * The `handler:` prefix is what routes a job to an in-process handler instead
 * of an SDK prompt, and it is exactly why `cron:create` refuses any RPC-supplied
 * prompt beginning with `handler:` — these jobs may only be created from inside
 * the host process.
 */
export const SKILL_DRAIN_HANDLER_NAMES: Readonly<
  Record<SkillDrainTier, string>
> = {
  frequent: 'skills:drain:frequent',
  nightly: 'skills:drain:nightly',
  weekly: 'skills:drain:weekly',
};

/** Reverse lookup used when rendering a run: job id → tier, or `null`. */
export function skillDrainTierForJobId(jobId: string): SkillDrainTier | null {
  for (const tier of SKILL_DRAIN_TIERS) {
    if (SKILL_DRAIN_JOB_IDS[tier] === jobId) return tier;
  }
  return null;
}
