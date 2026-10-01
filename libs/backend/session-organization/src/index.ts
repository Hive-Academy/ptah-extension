/**
 * @ptah-extension/session-organization — public API.
 *
 * Owns the durable session organization data (priority, workflow status,
 * pin, worktree, lineage, task links and PR links) stored in the tables of
 * migration 0050 on the shared SQLite connection. Imported only by
 * `rpc-handlers` and the host composition roots.
 */

// Store
export { SessionOrganizationStore } from './lib/session-organization.store';
export type {
  AgentStartedSessionInput,
  SessionOrganizationPatch,
  StoredOrganization,
  StoredPrLink,
  StoredPrLinkInput,
  StoredSessionTaskLink,
  StoredTaskLink,
  StoredTaskLinkInput,
} from './lib/session-organization.store';
