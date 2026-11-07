// Migration 0071 — task-level lookup of unreconciled skill events.
// `reconcileTaskEvents` filters by `task_id` and `reconciled_at IS NULL` for
// every finished spec on each harvest; the `(skill_slug, task_id)` index cannot
// serve a task-leading lookup.
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `CREATE INDEX IF NOT EXISTS idx_skill_inv_events_task_unreconciled
  ON skill_invocation_events(task_id)
  WHERE reconciled_at IS NULL;`;
