export * from './lib/cli-agents';
export {
  classifyLaneFailureClass,
  type LaneFailureClassInput,
} from './lib/cli-agents/limits/lane-failure-class';
export { matchesAuthFailure } from './lib/cli-agents/limits/lane-auth-classifier';
export * from './lib/ptah-cli';
export * from './lib/mcp-directory';
export * from './lib/skills-directory';
export * from './lib/roles';
export * from './lib/session-children';
export {
  CapabilityToggleStore,
  CapabilityToggleStoreError,
  capabilityPolicyKey,
  capabilityWorkspaceKey,
  defaultCapabilityStoreDir,
} from './lib/capabilities/capability-toggle-store';
export {
  CapabilityResolverService,
  CapabilityRequestError,
  type CapabilityPluginSource,
  type CapabilityResolverDependencies,
} from './lib/capabilities/capability-resolver.service';
export type {
  McpDeclarationInventory,
  McpDeclarationSourceStatus,
} from './lib/mcp-directory/mcp-install.service';
// Plan limits (TASK_2026_596): lane lookup for the agent tools, owner
// discovery for the plan-limits RPC.
export {
  LaneLimitLookupService,
  type LaneLimitLookupOptions,
  type LaneLimitLookupRow,
  type LaneLimitLookupStatus,
  type LaneLimitResult,
} from './lib/cli-agents/limits/lane-limit-lookup.service';
export {
  PlanLimitOwnerDiscoveryService,
  type DiscoveredPlanOwner,
  type PlanOwnerDiscoveryRequest,
  type PlanOwnerOrigin,
  type SelectedProviderDiscovery,
} from './lib/cli-agents/limits/plan-limit-owner-discovery.service';
export { CLI_AGENT_RUNTIME_TOKENS } from './lib/di/tokens';
export type { CodexAdapterFactory } from './lib/cli-agents/cli-adapters/cli-adapter.interface';
export {
  CodexAppServerLaneAdapter,
  CodexLaneResumeIdentityError,
} from './lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter';
export { CODEX_LANE_DEFAULT_MODEL } from './lib/cli-agents/cli-adapters/codex/codex-app-server-lane-models';
export type {
  CodexLaneRuntimeProvider,
  CodexLaneProfileResolver,
  CodexLaneIdentityStore,
} from './lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter';
export type {
  CodexLaneBinary,
  CodexLaneBinaryProbe,
} from './lib/cli-agents/cli-adapters/codex/codex-app-server-lane-binary';
export type {
  CodexLaneCredentialProbe,
  CodexLaneCredentialStatus,
} from './lib/cli-agents/cli-adapters/codex/codex-app-server-lane-auth';
export type { CodexLaneProfileInput } from './lib/cli-agents/cli-adapters/codex/codex-lane-profile';
export { MCP_ATTACHMENT_TIMEOUT_MS } from './lib/cli-agents/mcp-attachment-probe.port';
export type { IMcpAttachmentProbe, McpAttachment } from './lib/cli-agents/mcp-attachment-probe.port';
export type { CliAgentRuntimeDIToken } from './lib/di/tokens';
// Certified lane persistence (TASK_2026_719 B17): bound only by a certifying host.
export { CLAUDE_LANE_ACCOUNT_PERSISTENCE } from './lib/di/tokens';
export type { ClaudeLaneAccountPersistence } from './lib/claude/claude-sdk-lane-runner';
export { registerCliAgentRuntimeServices } from './lib/di/register';
export { LaneAccountResumeError } from './lib/cli-agents/lane-resume-gate';

export {
  wireSdkCallbacks,
  type WireSdkCallbacksOptions,
  type WireSdkCallbacksContext,
  type SdkCallbackPlatform,
  type WorktreeCreatedData,
} from './lib/wiring/sdk-callbacks';
export {
  wireAgentEventListeners,
  persistCliSessionReference,
  type WireAgentEventListenersOptions,
  type WireAgentEventListenersContext,
  type AgentEventPlatform,
} from './lib/wiring/agent-events';
