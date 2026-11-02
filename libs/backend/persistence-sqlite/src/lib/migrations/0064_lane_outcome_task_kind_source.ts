// Migration 0064 — record task-kind provenance for lane outcomes.
// Existing rows remain NULL because historical provenance cannot be inferred.
// The migration runner applies this bare ALTER exactly once in its transaction.
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `
ALTER TABLE lane_outcome_records ADD COLUMN task_kind_source TEXT;
`;
