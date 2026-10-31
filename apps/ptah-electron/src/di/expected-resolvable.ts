import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  AnalyticsRpcHandlers,
  ConfigScopeRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
  FileViewRpcHandlers,
  FileEditRpcHandlers,
  GitWatchRpcHandlers,
  RecentWorkspacesService,
  DisplayWindowRpcHandlers,
} from '@ptah-extension/rpc-handlers';

export const EXPECTED_RESOLVABLE = [
  AnalyticsRpcHandlers,
  ConfigScopeRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
  FileViewRpcHandlers,
  FileEditRpcHandlers,
  // `git:watchRoots` (TASK_2026_855 D20); needs GIT_ROOT_WATCH_REGISTRY_TOKEN.
  GitWatchRpcHandlers,
  RecentWorkspacesService,
  DisplayWindowRpcHandlers,
] as const;

/**
 * Electron-only port bound in `phase-4-handlers.ts` (TASK_2026_855 D20).
 * Same symbol as `PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const GIT_ROOT_WATCH_REGISTRY_TOKEN = Symbol.for(
  'PlatformGitRootWatchRegistry',
);

/** Phase-2 singleton; kept separate from the handler-class census. */
export const HOST_ATTENTION_COORDINATOR_TOKEN = Symbol.for(
  'HostAttentionCoordinator',
);

/**
 * Optional port registered by `registerSharedRpcHandlers` (Batch 14).
 * Same symbol as `LANE_ROUTING_TOKENS.LANE_MODEL_LISTING`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const LANE_MODEL_LISTING_TOKEN = Symbol.for(
  'LaneRoutingLaneModelListing',
);

/**
 * Optional port registered by `registerSdkServices` (Batch 19).
 * Same symbol as `LANE_ROUTING_TOKENS.STRUCTURED_DECISION`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const STRUCTURED_DECISION_TOKEN = Symbol.for(
  'LaneRoutingStructuredDecision',
);

/**
 * Lib-owned config registered by `registerLaneRoutingServices` (Batch 30a).
 * Same symbol as `LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const DECISION_MODEL_CONFIG_TOKEN = Symbol.for(
  'LaneRoutingDecisionModelConfig',
);

/**
 * Lib-owned catalog registered by `registerLaneRoutingServices`
 * (TASK_2026_684 Batch 13). Same symbol as
 * `LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG`. Kept out of
 * `EXPECTED_RESOLVABLE` because that list is handler classes and the smoke
 * title reads `.name`.
 */
export const DECISION_MODEL_CATALOG_TOKEN = Symbol.for(
  'LaneRoutingDecisionModelCatalog',
);

/** SDK defaults before bootstrap installs the complete Electron binding. */
export const EXPECTED_NULL_RUNTIME_TOKENS = [
  SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
  SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
  SDK_TOKENS.RUNTIME_ADMISSION_PORT,
  SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS,
  SDK_TOKENS.NATIVE_SESSION_CONTROLS,
  SDK_TOKENS.LEGACY_SESSION_CONTROLS,
  SDK_TOKENS.SESSION_RUNTIME_ROUTER,
  SDK_TOKENS.CODEX_CHAT_ADAPTER,
  SDK_TOKENS.ROUTING_AGENT_ADAPTER,
] as const;

export const EXPECTED_RUNTIME_TOKENS = [
  ...EXPECTED_NULL_RUNTIME_TOKENS,
  SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
] as const;

export const ELECTRON_CODEX_BOUND_TOKENS = [
  SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
  SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
  SDK_TOKENS.RUNTIME_ADMISSION_PORT,
  SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
  SDK_TOKENS.NATIVE_SESSION_CONTROLS,
  SDK_TOKENS.LEGACY_SESSION_CONTROL_PORTS,
] as const;
