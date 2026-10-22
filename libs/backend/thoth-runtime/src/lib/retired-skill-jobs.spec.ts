import type { IJobStore, ScheduledJob } from '@ptah-extension/cron-scheduler';
import type { JobId } from '@ptah-extension/shared';
import {
  RETIRED_SKILL_PIPELINE_JOB_IDS,
  disableRetiredSkillPipelineJobs,
} from './retired-skill-jobs';

describe('disableRetiredSkillPipelineJobs', () => {
  it('disables enabled rows, skips missing and disabled rows, and preserves run history', () => {
    const [first, second, third, fourth] = RETIRED_SKILL_PIPELINE_JOB_IDS;
    const rows = new Map<JobId, ScheduledJob>([
      [first as JobId, { id: first as JobId, enabled: true } as ScheduledJob],
      [second as JobId, { id: second as JobId, enabled: false } as ScheduledJob],
      [fourth as JobId, { id: fourth as JobId, enabled: true } as ScheduledJob],
    ]);
    const store: IJobStore = {
      create: jest.fn(),
      get: jest.fn((id: JobId) => rows.get(id) ?? null),
      list: jest.fn(),
      update: jest.fn((id: JobId) => {
        if (id === first) throw new Error('database busy');
        const row = rows.get(id);
        if (!row) throw new Error('missing row');
        row.enabled = false;
        return row;
      }),
      delete: jest.fn(),
      upsert: jest.fn(),
    };

    expect(disableRetiredSkillPipelineJobs(store)).toEqual({
      disabled: 1,
      failed: [first],
    });
    expect(store.get).toHaveBeenCalledWith(third as JobId);
    expect(store.update).toHaveBeenCalledTimes(2);
    expect(store.update).toHaveBeenCalledWith(fourth as JobId, { enabled: false });
    expect(store.delete).not.toHaveBeenCalled();
  });
});
