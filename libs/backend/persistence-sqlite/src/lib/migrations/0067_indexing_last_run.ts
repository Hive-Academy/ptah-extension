// Migration 0067 — persist the last indexing run summary.
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `ALTER TABLE indexing_state ADD COLUMN last_run_json TEXT;`;
