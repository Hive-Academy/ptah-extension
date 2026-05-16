// Core Services - Signal-Based State Management
// Core Services - Foundation Layer (0 dependencies)
export * from './logging.service';
export {
  VSCodeService,
  provideVSCodeService,
  type WebviewConfig,
} from './vscode.service';

// Core Services - State Layer (depend on foundation)
export * from './app-state.service';
export * from './webview-navigation.service';

// Theme Service
export {
  ThemeService,
  type ThemeName,
  type ThemeInfo,
  DAISYUI_THEMES,
} from './theme.service';

// Model & Autopilot State Services
export { ModelStateService } from './model-state.service';
export { AutopilotStateService } from './autopilot-state.service';

// Effort State Service (reasoning effort persistence)
export { EffortStateService } from './effort-state.service';

// Auth State Service
export { AuthStateService } from './auth-state.service';

// LLM Provider State Service
export { LlmProviderStateService } from './llm-provider-state.service';

// Message Router (handler registration pattern)
export { type MessageHandler, MESSAGE_HANDLERS } from './message-router.types';
export {
  MessageRouterService,
  provideMessageRouter,
} from './message-router.service';

// RPC Services
export {
  ClaudeRpcService,
  RpcResult,
  type RpcCallOptions,
} from './claude-rpc.service';

// RPC Util — function-based RPC client with ready-gate.
export { rpcCall, getRpcClient, type RpcCallResult } from './rpc-call.util';

// Ptah CLI State Service
export { PtahCliStateService } from './ptah-cli-state.service';

// Electron Layout Service (desktop 3-panel layout)
export {
  ElectronLayoutService,
  type WorkspaceFolder,
} from './electron-layout.service';

// Discovery Facades
export {
  AgentDiscoveryFacade,
  type AgentSuggestion,
} from './agent-discovery.facade';
export {
  CommandDiscoveryFacade,
  type CommandSuggestion,
} from './command-discovery.facade';

// Push-event utilities
// Note: createPushEventSubscriber was removed — it depended on a non-existent
// `vscode.messages$` Observable. The actual codebase uses the MessageHandler
// pattern via MESSAGE_HANDLERS (see message-router.types.ts). Future
// push-event helpers will be designed against that real API.
export { setIfChanged } from './idempotent-setters';
