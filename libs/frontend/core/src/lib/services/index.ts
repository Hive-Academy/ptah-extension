// Core Services - Angular 20+ Signal-Based State Management
// Core Services - Foundation Layer (0 dependencies)
export * from './logging.service';
export {
  VSCodeService,
  provideVSCodeService,
  initializeVSCodeService,
  type WebviewConfig,
} from './vscode.service';
// DELETED: MessageHandlerService - redundant, components subscribe directly to VSCodeService

// Core Services - State Layer (depend on foundation)
export * from './app-state.service';
export * from './webview-navigation.service';

// RPC Services (Phase 2 - TASK_2025_021)
export {
  ClaudeRpcService,
  RpcResult,
  type RpcCallOptions,
} from './claude-rpc.service';

// File Services (Phase 2 - TASK_2025_021)
export { ClaudeFileService, type SessionFileInfo } from './claude-file.service';

// Discovery Facades (Phase 2 - TASK_2025_019)
export {
  AgentDiscoveryFacade,
  type AgentSuggestion,
} from './agent-discovery.facade';
export { MCPDiscoveryFacade, type MCPSuggestion } from './mcp-discovery.facade';
export {
  CommandDiscoveryFacade,
  type CommandSuggestion,
} from './command-discovery.facade';
