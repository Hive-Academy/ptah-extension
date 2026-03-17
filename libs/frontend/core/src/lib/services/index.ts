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

// Theme Service (TASK_2025_100)
export { ThemeService, type ThemeName } from './theme.service';

// Model & Autopilot State Services (TASK_2025_035)
export {
  ModelStateService,
  type ModelInfoWithSelection,
} from './model-state.service';
export { AutopilotStateService } from './autopilot-state.service';

// Auth State Service (TASK_2025_133)
export { AuthStateService } from './auth-state.service';

// LLM Provider State Service (TASK_2025_155)
export { LlmProviderStateService } from './llm-provider-state.service';

// Message Router (handler registration pattern)
export { type MessageHandler, MESSAGE_HANDLERS } from './message-router.types';
export {
  MessageRouterService,
  provideMessageRouter,
} from './message-router.service';

// RPC Services (Phase 2 - TASK_2025_021)
export {
  ClaudeRpcService,
  RpcResult,
  type RpcCallOptions,
} from './claude-rpc.service';

// Ptah CLI State Service (TASK_2025_167 -> TASK_2025_170)
export { PtahCliStateService } from './ptah-cli-state.service';

// Electron Layout Service (desktop 3-panel layout)
export {
  ElectronLayoutService,
  type WorkspaceFolder,
} from './electron-layout.service';

// Discovery Facades (Phase 2 - TASK_2025_019)
export {
  AgentDiscoveryFacade,
  type AgentSuggestion,
} from './agent-discovery.facade';
export {
  CommandDiscoveryFacade,
  type CommandSuggestion,
} from './command-discovery.facade';
