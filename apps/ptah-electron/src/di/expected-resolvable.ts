import {
  ConfigScopeRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
  FileViewRpcHandlers,
  FileEditRpcHandlers,
} from '@ptah-extension/rpc-handlers';

export const EXPECTED_RESOLVABLE = [
  ConfigScopeRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
  FileViewRpcHandlers,
  FileEditRpcHandlers,
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
