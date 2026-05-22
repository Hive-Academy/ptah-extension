export const sql = `
CREATE TABLE IF NOT EXISTS boot_scan_state (
  pipeline TEXT NOT NULL,
  workspace_fingerprint TEXT NOT NULL,
  last_scanned_session_mtime INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pipeline, workspace_fingerprint)
);
`;
