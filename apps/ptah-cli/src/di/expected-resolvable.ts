import {
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
} from '@ptah-extension/rpc-handlers';

export const EXPECTED_RESOLVABLE = [
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
