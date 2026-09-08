import type { DrainTier } from '@ptah-extension/skill-synthesis';

/** One row of {@link SKILL_DRAIN_JOBS}. */
export interface SkillDrainJobSpec {
  readonly tier: DrainTier;
  readonly jobId: string;
  readonly name: string;
  readonly handlerName: string;
  readonly cronExprKey: string;
  readonly defaultCronExpr: string;
}

/**
 * The three skill-synthesis drain tiers, as cron jobs — the ONE table, read by
 * every host.
 *
 * This is data, not lifecycle. `libs/backend/cli-engine` keeps its own
 * `activateThoth`/`disposeThoth` tier model and registers these jobs its own
 * way (no activity emitter, logger instead of `console`); converging the two
 * lifecycles is still a separate task. What is NOT separate is the table: it
 * was copied verbatim into both hosts with a comment asking the next reader to
 * "keep the two tables in step by hand", and a job id or a cron-expression key
 * that drifts between hosts is a job the user configured in one host and
 * cannot configure in the other.
 *
 * The block the table sits in is the SEAM. `libs/backend/skill-synthesis` must
 * never import `cron-scheduler` (global invariant 8), so a host that registers
 * these jobs is the only place the two meet — which is why
 * `SkillDrainService.drain()` takes `onBattery` as a parameter instead of
 * injecting `IPowerMonitor`, and why this file imports neither.
 *
 * Each tier is a superset of the cheaper one (`DRAIN_TIER_STAGES`), so an item
 * the frequent tick may not run is picked up nightly, and anything nightly may
 * not run is picked up weekly. Nothing is stranded by tier alone.
 *
 * The cron expressions are user-overridable settings, not constants; the
 * fallbacks below mirror `FILE_BASED_SETTINGS_DEFAULTS` in `platform-core`
 * because `getConfiguration` needs a value at the call site anyway.
 */
export const SKILL_DRAIN_JOBS: readonly SkillDrainJobSpec[] = [
  {
    tier: 'frequent',
    jobId: '@ptah/skills-drain-frequent',
    name: 'Skill Synthesis Drain (frequent)',
    handlerName: 'skills:drain:frequent',
    cronExprKey: 'skillSynthesis.drain.cronExpr',
    defaultCronExpr: '*/15 * * * *',
  },
  {
    tier: 'nightly',
    jobId: '@ptah/skills-drain-nightly',
    name: 'Skill Synthesis Drain (nightly)',
    handlerName: 'skills:drain:nightly',
    cronExprKey: 'skillSynthesis.drain.nightlyCronExpr',
    defaultCronExpr: '0 3 * * *',
  },
  {
    tier: 'weekly',
    jobId: '@ptah/skills-drain-weekly',
    name: 'Skill Synthesis Drain (weekly)',
    handlerName: 'skills:drain:weekly',
    cronExprKey: 'skillSynthesis.drain.weeklyCronExpr',
    defaultCronExpr: '0 4 * * 0',
  },
];
