// Core Services - Angular 20+ Signal-Based State Management
// Core Services - Foundation Layer (0 dependencies)
export * from './logging.service';
export {
  VSCodeService,
  provideVSCodeService,
  type WebviewConfig,
} from './vscode.service';
// DELETED: MessageHandlerService - redundant, components subscribe directly to VSCodeService

// Core Services - State Layer (depend on foundation)
export * from './app-state.service';
export * from './webview-navigation.service';

// Theme Service (TASK_2025_100)
export {
  ThemeService,
  type ThemeName,
  type ThemeInfo,
  DAISYUI_THEMES,
} from './theme.service';

// Model & Autopilot State Services (TASK_2025_035)
export { ModelStateService } from './model-state.service';
export { AutopilotStateService } from './autopilot-state.service';

// Effort State Service (reasoning effort persistence)
export { EffortStateService } from './effort-state.service';

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

// RPC Util — function-based RPC client with ready-gate (Wave E1, TASK_2026_103).
// Promoted from the editor library; the editor-bespoke client was deleted.
export { rpcCall, getRpcClient, type RpcCallResult } from './rpc-call.util';

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

// Push-event utilities (TASK_2026_115)
// Note: createPushEventSubscriber was removed — it depended on a non-existent
// `vscode.messages$` Observable. The actual codebase uses the MessageHandler
// pattern via MESSAGE_HANDLERS (see message-router.types.ts). Future
// push-event helpers will be designed against that real API.
export { setIfChanged } from './idempotent-setters';
