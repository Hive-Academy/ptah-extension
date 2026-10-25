// Migration 0059 — attach SDK sessions to provider-account run bindings.
// Each provider/session pair identifies one run; each run attaches once.
// Text formats are validated at the write boundary, as in 0058.
// Every statement is idempotent; the runner owns BEGIN/COMMIT/ROLLBACK.
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `
CREATE TABLE IF NOT EXISTS provider_account_session_links (
  provider TEXT NOT NULL,
  sdk_session_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  attached_at INTEGER NOT NULL,
  PRIMARY KEY (provider, sdk_session_id),
  FOREIGN KEY (run_id) REFERENCES provider_account_run_bindings (run_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_account_session_links_run
  ON provider_account_session_links (run_id);
`;
