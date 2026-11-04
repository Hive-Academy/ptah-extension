// Migration 0066 — additive publication and finding identity evidence.
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `
ALTER TABLE review_findings ADD COLUMN symbol_id TEXT;
ALTER TABLE review_findings ADD COLUMN failure_mode TEXT;
ALTER TABLE review_findings ADD COLUMN affected_behavior TEXT;
ALTER TABLE review_findings ADD COLUMN addressed_at INTEGER;
ALTER TABLE review_findings ADD COLUMN reopened_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_review_findings_identity
  ON review_findings (repo_id, pr_number, path, symbol_id, category, status);

ALTER TABLE review_identity_matches ADD COLUMN source_head_sha TEXT;
ALTER TABLE review_identity_matches ADD COLUMN lens_family TEXT;
ALTER TABLE review_identity_matches ADD COLUMN suppression_reason TEXT;

ALTER TABLE review_finding_events ADD COLUMN evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json));
ALTER TABLE review_finding_events ADD COLUMN source_head_sha TEXT;

ALTER TABLE review_publications ADD COLUMN finding_id TEXT REFERENCES review_findings(finding_id);
ALTER TABLE review_publications ADD COLUMN last_reconciled_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_review_publications_finding_kind
  ON review_publications (finding_id, kind) WHERE finding_id IS NOT NULL AND kind = 'follow_up';
`;
