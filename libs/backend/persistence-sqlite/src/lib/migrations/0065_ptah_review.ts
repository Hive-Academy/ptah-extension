// Migration 0065 — durable, forward-only Ptah review state.
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `
CREATE TABLE IF NOT EXISTS review_repositories (
  repo_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  mode TEXT NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run', 'live')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  last_poll_at INTEGER,
  poll_status TEXT,
  poll_error TEXT,
  config_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_repositories_identity
  ON review_repositories (lower(owner), lower(name));

CREATE TABLE IF NOT EXISTS review_heads (
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  head_sha TEXT NOT NULL CHECK (length(head_sha) = 40),
  state TEXT NOT NULL CHECK (state IN ('active', 'superseded')),
  draft INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1)),
  trust_reason TEXT,
  discovered_at INTEGER NOT NULL,
  superseded_at INTEGER,
  PRIMARY KEY (repo_id, pr_number, head_sha),
  FOREIGN KEY (repo_id) REFERENCES review_repositories(repo_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_heads_one_active_pr
  ON review_heads (repo_id, pr_number) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS review_attempts (
  attempt_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 0),
  trigger TEXT NOT NULL CHECK (trigger IN ('automatic', 'manual')),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  deadline_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  config_snapshot_hash TEXT,
  UNIQUE (repo_id, pr_number, head_sha, attempt_number),
  FOREIGN KEY (repo_id, pr_number, head_sha)
    REFERENCES review_heads(repo_id, pr_number, head_sha) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_review_attempts_claim
  ON review_attempts (state, queued_at);
CREATE INDEX IF NOT EXISTS idx_review_attempts_lease
  ON review_attempts (lease_expires_at) WHERE state = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_attempts_one_running_pr
  ON review_attempts (repo_id, pr_number) WHERE state = 'running';

CREATE TABLE IF NOT EXISTS review_stages (
  attempt_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'interrupted', 'skipped')),
  started_at INTEGER,
  ended_at INTEGER,
  family TEXT,
  scope TEXT,
  outcome TEXT,
  error_summary TEXT,
  artifact_hash TEXT,
  artifact_path TEXT,
  PRIMARY KEY (attempt_id, stage, ordinal),
  FOREIGN KEY (attempt_id) REFERENCES review_attempts(attempt_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_findings (
  finding_id TEXT PRIMARY KEY
    CHECK (length(finding_id) = 26 AND finding_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  path TEXT NOT NULL,
  symbol TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  first_head_sha TEXT NOT NULL,
  last_head_sha TEXT NOT NULL,
  current_anchor TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (repo_id, pr_number, first_head_sha)
    REFERENCES review_heads(repo_id, pr_number, head_sha) ON DELETE RESTRICT,
  FOREIGN KEY (repo_id, pr_number, last_head_sha)
    REFERENCES review_heads(repo_id, pr_number, head_sha) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_review_findings_shortlist
  ON review_findings (repo_id, pr_number, path, symbol, category);

CREATE TABLE IF NOT EXISTS review_finding_events (
  event_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('accepted', 'rejected', 'addressed', 'reopened', 'disputed')),
  created_at INTEGER NOT NULL,
  UNIQUE (attempt_id, finding_id, kind),
  FOREIGN KEY (attempt_id) REFERENCES review_attempts(attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (finding_id) REFERENCES review_findings(finding_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_review_finding_events_finding
  ON review_finding_events (finding_id, created_at);

CREATE TABLE IF NOT EXISTS review_identity_matches (
  attempt_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  prior_finding_id TEXT,
  relation TEXT NOT NULL CHECK (relation IN ('same', 'distinct', 'uncertain')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  evidence_hash TEXT NOT NULL,
  verifier_family TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, candidate_id),
  FOREIGN KEY (attempt_id) REFERENCES review_attempts(attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (prior_finding_id) REFERENCES review_findings(finding_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_review_identity_matches_prior
  ON review_identity_matches (prior_finding_id);

CREATE TABLE IF NOT EXISTS review_publications (
  publication_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('walkthrough', 'review', 'follow_up')),
  publication_key TEXT NOT NULL,
  github_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('planned', 'inflight', 'confirmed', 'unknown')),
  request_hash TEXT NOT NULL,
  marker TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (repo_id, pr_number, head_sha, kind, publication_key),
  FOREIGN KEY (repo_id, pr_number, head_sha)
    REFERENCES review_heads(repo_id, pr_number, head_sha) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id) REFERENCES review_attempts(attempt_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_review_publications_reconcile
  ON review_publications (state, updated_at);

CREATE TABLE IF NOT EXISTS review_poll_state (
  repo_id TEXT PRIMARY KEY,
  last_success_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT,
  etag TEXT,
  conditional_metadata TEXT,
  FOREIGN KEY (repo_id) REFERENCES review_repositories(repo_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS review_artifacts (
  artifact_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  validated_at INTEGER NOT NULL,
  retain_until INTEGER,
  UNIQUE (attempt_id, path),
  FOREIGN KEY (attempt_id, stage, ordinal)
    REFERENCES review_stages(attempt_id, stage, ordinal) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_review_artifacts_retention
  ON review_artifacts (retain_until);
`;
