import {
  AnalyticsRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

/** Host attention registrations exercised by the CLI composition smoke tests. */
export const EXPECTED_HOST_ATTENTION_TOKENS = {
  notifications: PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS,
  coordinator: SDK_TOKENS.HOST_ATTENTION_COORDINATOR,
} as const;

export const EXPECTED_RESOLVABLE = [
  AnalyticsRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
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
