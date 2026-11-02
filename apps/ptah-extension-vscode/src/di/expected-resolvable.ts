import {
  AnalyticsRpcHandlers,
  ConfigScopeRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EditorRpcHandlers,
  DisplayWindowRpcHandlers,
  InstallScopeMigrationService,
  InstallScopeNoticeRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

/** Optional SDK ports resolve successfully to null on the legacy VS Code host. */
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

/** Symbols stay separate from the handler-class list, whose titles use `.name`. */
export const EXPECTED_RUNTIME_TOKENS = [
  ...EXPECTED_NULL_RUNTIME_TOKENS,
  SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
] as const;

/** Attention ports and ingress attached during phase 2. */
export const EXPECTED_ATTENTION_TOKENS = [
  PLATFORM_TOKENS.PTAH_VIEW_VISIBILITY,
  PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS,
  SDK_TOKENS.HOST_ATTENTION_COORDINATOR,
] as const;

export const EXPECTED_RESOLVABLE = [
  AnalyticsRpcHandlers,
  ConfigScopeRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  EditorRpcHandlers,
  DisplayWindowRpcHandlers,
  InstallScopeMigrationService,
  InstallScopeNoticeRpcHandlers,
] as const;

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
