// Adds reconciliation columns to skill_invocation_events so the spec harvester
// can flip an optimistically-recorded subagent run's success to the true verdict
// read from .ptah/specs (tasks.md status + review reports). reconciled_at is the
// idempotency guard; verdict_source records which spec supplied the verdict.
export const sql = `
ALTER TABLE skill_invocation_events ADD COLUMN reconciled_at INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN verdict_source TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_reconcile
  ON skill_invocation_events(skill_slug, source, reconciled_at);
`;
