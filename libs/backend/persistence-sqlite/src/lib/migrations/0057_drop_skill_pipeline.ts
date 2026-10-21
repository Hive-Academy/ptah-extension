import { PIPELINE_JOB_IDS } from '../skill-pipeline-archive';

// The archive and deletion must use the same approved IDs. They are bundled
// constants, never database or user input.
const jobIds = PIPELINE_JOB_IDS.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');

export const sql = [
  'DELETE FROM job_runs WHERE job_id IN (' + jobIds + ');',
  'DELETE FROM scheduled_jobs WHERE id IN (' + jobIds + ');',
  'DROP TABLE skill_invocations;',
  'DROP TABLE skill_candidates;',
  'DROP TABLE skill_suggestions;',
  'DROP TABLE skill_synthesis_queue;',
  'DROP TABLE skill_synthesis_budget;',
  'DROP TABLE skill_synthesis_workspace_cursor;',
].join('\n');

// sqlite-vec is optional. The runner applies this in the same transaction when
// available, or records it for later catch-up after the relational drop.
export const vecSql = `
DROP TABLE IF EXISTS skill_candidates_vec;
`;
