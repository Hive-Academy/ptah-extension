import type { IJobStore } from '@ptah-extension/cron-scheduler';
import type { JobId } from '@ptah-extension/shared';

export const RETIRED_SKILL_PIPELINE_JOB_IDS = [
  '@ptah/skills-drain-frequent',
  '@ptah/skills-drain-nightly',
  '@ptah/skills-drain-weekly',
  '@ptah/skills-backlog-cleanup',
] as const;

/**
 * Disable retired jobs without deleting their cascading job_runs history. OP-1
 * must export that history first; migration 0057 removes the rows afterward.
 */
export function disableRetiredSkillPipelineJobs(
  jobStore: IJobStore,
): { disabled: number; failed: string[] } {
  let disabled = 0;
  const failed: string[] = [];
  for (const id of RETIRED_SKILL_PIPELINE_JOB_IDS) {
    try {
      const job = jobStore.get(id as JobId);
      if (job?.enabled) {
        jobStore.update(id as JobId, { enabled: false });
        disabled++;
      }
    } catch {
      failed.push(id);
    }
  }
  return { disabled, failed };
}
