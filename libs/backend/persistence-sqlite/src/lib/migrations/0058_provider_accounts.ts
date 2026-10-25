// Migration 0058 — provider-account metadata and route reservations.
// Profiles are retained as tombstones (removed_at), including their unique
// physical route, so old run bindings cannot be reassigned to a new account.
// Selections and exclusive operations are changed transactionally by the store.
// Run bindings are snapshots; leases also cover ambient routes (no profile).
// No credentials, raw identities, auth payloads or credential data migration.
// Text enums and opaque ID formats are validated at the write boundary, as in
// 0054. Every statement is idempotent; the runner owns BEGIN/COMMIT/ROLLBACK.
// SECURITY: SQL MUST stay static. No template interpolation.
export const sql = `
CREATE TABLE IF NOT EXISTS provider_account_profiles (
  profile_id TEXT NOT NULL PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  canonical_route TEXT NOT NULL UNIQUE,
  route_fingerprint TEXT NOT NULL UNIQUE,
  physical_identity TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  route_revision INTEGER NOT NULL DEFAULT 0 CHECK (route_revision >= 0),
  auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0),
  state TEXT NOT NULL DEFAULT 'not-signed-in',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER,
  UNIQUE (profile_id, provider),
  UNIQUE (profile_id, provider, route_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_provider_account_profiles_provider_removed
  ON provider_account_profiles (provider, removed_at);
CREATE TABLE IF NOT EXISTS provider_account_selections (
  workspace_root TEXT NOT NULL,
  provider TEXT NOT NULL,
  scope TEXT NOT NULL,
  profile_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_root, provider, scope),
  FOREIGN KEY (profile_id, provider)
    REFERENCES provider_account_profiles (profile_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_provider_account_selections_profile
  ON provider_account_selections (profile_id);
CREATE TABLE IF NOT EXISTS provider_account_operations (
  operation_id TEXT NOT NULL PRIMARY KEY,
  route_fingerprint TEXT NOT NULL UNIQUE,
  profile_id TEXT,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  auth_epoch INTEGER NOT NULL CHECK (auth_epoch >= 0),
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id, provider, route_fingerprint)
    REFERENCES provider_account_profiles (profile_id, provider, route_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_provider_account_operations_profile
  ON provider_account_operations (profile_id);
CREATE TABLE IF NOT EXISTS provider_account_run_bindings (
  run_id TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  route_revision INTEGER NOT NULL CHECK (route_revision >= 0),
  route_fingerprint TEXT NOT NULL,
  auth_epoch INTEGER NOT NULL CHECK (auth_epoch >= 0),
  identity_kind TEXT NOT NULL,
  owner_key_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id, provider, route_fingerprint)
    REFERENCES provider_account_profiles (profile_id, provider, route_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_provider_account_run_bindings_profile
  ON provider_account_run_bindings (profile_id);
CREATE TABLE IF NOT EXISTS provider_account_run_leases (
  lease_id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  profile_id TEXT,
  route_fingerprint TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  FOREIGN KEY (profile_id, provider, route_fingerprint)
    REFERENCES provider_account_profiles (profile_id, provider, route_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_provider_account_run_leases_route
  ON provider_account_run_leases (route_fingerprint);
CREATE INDEX IF NOT EXISTS idx_provider_account_run_leases_profile
  ON provider_account_run_leases (profile_id);
`;
