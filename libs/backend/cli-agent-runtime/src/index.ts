export * from './lib/cli-agents';
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
} from './lib/cli-agents/limits/plan-limit-owner-discovery.service';
export { CLI_AGENT_RUNTIME_TOKENS } from './lib/di/tokens';
export type { CliAgentRuntimeDIToken } from './lib/di/tokens';
export { registerCliAgentRuntimeServices } from './lib/di/register';

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
