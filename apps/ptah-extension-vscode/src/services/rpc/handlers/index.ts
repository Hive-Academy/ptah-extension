/**
 * RPC Handlers Index — exports all RPC handler classes for DI registration.
 */

// Shared handlers re-exported from @ptah-extension/rpc-handlers.
export {
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  LlmRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  WizardGenerationRpcHandlers,
  AuthRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  WebSearchRpcHandlers,
  HarnessRpcHandlers,
  McpDirectoryRpcHandlers,
} from '@ptah-extension/rpc-handlers';

// VS Code-specific handlers (stay local).
export { FileRpcHandlers } from './file-rpc.handlers';
export { EditorRpcHandlers } from './editor-rpc.handlers';
export { CommandRpcHandlers } from './command-rpc.handlers';
export { AgentRpcHandlers } from './agent-rpc.handlers';
export { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
