// Migration 0062 — the owning host process of a provider-account operation.
//
// A sign-in, sign-out or status operation holds its route until the host
// completes it. A host that crashes first leaves the operation row behind, and
// a sign-in or sign-out leaves its profile in state 'pending'; nothing ever
// cleared either. Recording the owning host's pid and machine digest, in the
// shape of the run leases (0061), lets a later process prove the host gone and
// reclaim the row. `child_pid` is the sign-in console the operation spawned,
// recorded once it exists: the console can outlive a crashed host (Windows
// does not end a process tree with its parent), so host death alone proves
// nothing once it was recorded, as for a run's Claude child (0061).
// `prior_state` is the profile state the operation replaced with 'pending', so
// reclaim can put it back.
//
// All four columns are NULL on rows written before this migration. Ownership
// of those rows cannot be proved, so they are never reclaimed automatically.
// `prior_state` is also NULL on status and ambient operations, which never set
// 'pending'. Text enums are validated at the write boundary, as in 0058.
//
// BARE `ALTER`s, as in 0055, 0060 and 0061: the runner applies each version
// exactly once and owns BEGIN/COMMIT/ROLLBACK.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE provider_account_operations ADD COLUMN host_pid INTEGER CHECK (host_pid IS NULL OR host_pid > 0);
ALTER TABLE provider_account_operations ADD COLUMN host_machine TEXT CHECK (host_machine IS NULL OR length(host_machine) = 64);
ALTER TABLE provider_account_operations ADD COLUMN child_pid INTEGER CHECK (child_pid IS NULL OR child_pid > 0);
ALTER TABLE provider_account_operations ADD COLUMN prior_state TEXT CHECK (prior_state IS NULL OR prior_state <> 'pending');
`;
