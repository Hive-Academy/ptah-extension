// Migration 0060 — auth epoch, route revision and state on provider-account
// run leases; a recorded identity reference on profiles (TASK_2026_719).
//
// A lease now carries the epoch and route revision it was admitted at, so
// `release`/`retain` can check them before the run binding exists. Legacy rows
// are backfilled from a CONSISTENT run binding: same run, provider, profile and
// route fingerprint (the same four-column predicate in every subquery). The old
// atomic `admit` stored the profile epoch on both the lease reservation and the
// binding, and that epoch could not change while the lease existed, so the
// binding is the only trustworthy source.
//
// Rows that the old `admit` could not have written are QUARANTINED, never
// deleted, cleared or guessed (decision D-N): a named lease without a
// consistent binding, and an ambient lease (profile NULL) that has a binding.
// A quarantined row still blocks auth operations on its route; recovery is a
// manual support step. An unbound ambient lease keeps 0/0 `live`.
//
// `identity_ref` stays NULL: it cannot be derived from the DB and is recorded
// by the next status check.
//
// BARE `ALTER`s, as in 0055: SQLite has no `ADD COLUMN IF NOT EXISTS`, and the
// runner's `schema_migrations` bookkeeping applies each version exactly once.
// The defaults are constants, so the NOT NULL columns are valid on existing
// rows. The runner owns BEGIN/COMMIT/ROLLBACK.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE provider_account_run_leases ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK (auth_epoch >= 0);
ALTER TABLE provider_account_run_leases ADD COLUMN route_revision INTEGER NOT NULL DEFAULT 0 CHECK (route_revision >= 0);
ALTER TABLE provider_account_run_leases ADD COLUMN lease_state TEXT NOT NULL DEFAULT 'live' CHECK (lease_state IN ('live','quarantined'));
ALTER TABLE provider_account_profiles ADD COLUMN identity_ref TEXT;
UPDATE provider_account_run_leases
SET
  auth_epoch = (
    SELECT b.auth_epoch FROM provider_account_run_bindings b
    WHERE b.run_id = provider_account_run_leases.run_id
      AND b.provider = provider_account_run_leases.provider
      AND b.profile_id = provider_account_run_leases.profile_id
      AND b.route_fingerprint = provider_account_run_leases.route_fingerprint
  ),
  route_revision = (
    SELECT b.route_revision FROM provider_account_run_bindings b
    WHERE b.run_id = provider_account_run_leases.run_id
      AND b.provider = provider_account_run_leases.provider
      AND b.profile_id = provider_account_run_leases.profile_id
      AND b.route_fingerprint = provider_account_run_leases.route_fingerprint
  )
WHERE EXISTS (
  SELECT 1 FROM provider_account_run_bindings b
  WHERE b.run_id = provider_account_run_leases.run_id
    AND b.provider = provider_account_run_leases.provider
    AND b.profile_id = provider_account_run_leases.profile_id
    AND b.route_fingerprint = provider_account_run_leases.route_fingerprint
);
UPDATE provider_account_run_leases
SET lease_state = 'quarantined'
WHERE (
  profile_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM provider_account_run_bindings b
    WHERE b.run_id = provider_account_run_leases.run_id
      AND b.provider = provider_account_run_leases.provider
      AND b.profile_id = provider_account_run_leases.profile_id
      AND b.route_fingerprint = provider_account_run_leases.route_fingerprint
  )
) OR (
  profile_id IS NULL
  AND EXISTS (
    SELECT 1 FROM provider_account_run_bindings b
    WHERE b.run_id = provider_account_run_leases.run_id
  )
);
`;
