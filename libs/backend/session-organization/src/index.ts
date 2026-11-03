/**
 * @ptah-extension/session-organization — public API.
 *
 * Owns the durable session organization data (priority, workflow status,
 * pin, worktree, lineage, task links and PR links) stored in the tables of
 * migration 0050 on the shared SQLite connection. Imported only by
 * `rpc-handlers` and the host composition roots.
 */

// DI tokens
export { SESSION_ORGANIZATION_TOKENS } from './lib/di/tokens';
export type { SessionOrganizationDIToken } from './lib/di/tokens';

// DI registration + host activation
export { registerSessionOrganizationServices } from './lib/di/register';
export { startSessionOrganization } from './lib/di/start';

// Capture service (host-wide lifecycle subscriptions)
export { SessionOrganizationCaptureService } from './lib/session-organization-capture.service';
export type {
  SessionOrganizationLifecycleSink,
  SessionOrganizationMetadataEvents,
  SessionOrganizationPostToolUseSource,
  SessionOrganizationSessionIdResolvedSource,
} from './lib/session-organization-capture.service';

// Automatic links (TASK_2026_854): reconcile, side tables, todo progress
export { SessionAutoLinkService } from './lib/session-auto-link.service';
export type {
  AutoLinkExpansionSource,
  AutoLinkFileSystem,
  AutoLinkMetadataReader,
  AutoLinkOrganizationService,
  AutoLinkOrganizationStore,
  AutoLinkPromptSource,
  AutoLinkSideTableReader,
  AutoLinkTaskIndexEvents,
} from './lib/session-auto-link.service';
export { SessionAutoLinkStore } from './lib/session-auto-link.store';
export type { SessionOrganizationSideTables } from './lib/session-organization-side-tables';
export { SessionTodoProgressService } from './lib/session-todo-progress.service';
export type {
  TodoProgressOrganizationService,
  TodoProgressStore,
} from './lib/session-todo-progress.service';
// Service (recorder port adapter + RPC query/mutation API)
export {
  SessionOrganizationInputError,
  SessionOrganizationService,
  toSessionOrganizationSummary,
} from './lib/session-organization.service';
export type {
  SessionOrganizationChange,
  SessionOrganizationMetadataReader,
  SessionPrLinkMutation,
  SessionTaskLinkMutation,
} from './lib/session-organization.service';

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
  StoredWorktreePeer,
  UnlinkTaskOptions,
} from './lib/session-organization.store';
