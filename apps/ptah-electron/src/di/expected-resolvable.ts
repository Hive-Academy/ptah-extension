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
  RecentWorkspacesService,
} from '@ptah-extension/rpc-handlers';
import { CHAT_TOKENS } from '@ptah-extension/rpc-handlers';
import { LANE_ROUTING_TOKENS } from '@ptah-extension/lane-routing';
import { LANE_OUTCOME_TOKENS } from '@ptah-extension/lane-outcomes';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

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
  RecentWorkspacesService,
] as const;

/** Lib-owned tokens composed by Electron in addition to handler classes. */
export const EXPECTED_RESOLVABLE_TOKENS = [
  ['HOST_ROUTING_COORDINATOR', CHAT_TOKENS.HOST_ROUTING_COORDINATOR],
  ['HOST_ROUTING_SETTING', LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING],
  ['LANE_TASK_KIND_CLASSIFIER', LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER],
  ['OUTCOME_TASK_KIND_CLASSIFIER', LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER],
  ['SDK_NEXT_TURN_REMINDER_QUEUE', SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE],
] as const;

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
