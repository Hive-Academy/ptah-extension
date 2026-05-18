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
