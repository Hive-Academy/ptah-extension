// Migration 0061 — the owning host process of a provider-account run lease.
//
// A lease is released only after its run's child close is proved. A host that
// quits or crashes before that proof leaves the lease live, and a live lease
// keeps sign-in and sign-out of its route busy. Recording the owning host's
// pid and a digest of its machine, and the pid of the run's current Claude
// child once it spawned, lets a later process prove both are gone (no process
// with either pid on the same machine) and reclaim the lease. The child can
// outlive a crashed host, so host death alone is not enough once it spawned.
//
// All three columns are NULL on rows written before this migration. Ownership of
// those rows cannot be proved, so they are never reclaimed automatically;
// recovery stays a manual support step, as for quarantined rows (0060).
//
// BARE `ALTER`s, as in 0055 and 0060: the runner applies each version exactly
// once and owns BEGIN/COMMIT/ROLLBACK.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE provider_account_run_leases ADD COLUMN host_pid INTEGER CHECK (host_pid IS NULL OR host_pid > 0);
ALTER TABLE provider_account_run_leases ADD COLUMN host_machine TEXT CHECK (host_machine IS NULL OR length(host_machine) = 64);
ALTER TABLE provider_account_run_leases ADD COLUMN child_pid INTEGER CHECK (child_pid IS NULL OR child_pid > 0);
`;
