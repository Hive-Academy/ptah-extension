import {
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
} from '@ptah-extension/rpc-handlers';

export const EXPECTED_RESOLVABLE = [
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
  EditorRpcHandlers,
  ElectronFileOpenRpcHandlers,
] as const;
