export * from './logging.service';
export * from './attention.types';
export { NotificationService, attentionRequestKey, attentionConditionKey, ATTENTION_RECENT_LIMIT, ATTENTION_SOUND_BURST_MS, ATTENTION_SOUND_COOLDOWN_MS } from './notification.service';
export {
  VSCodeService,
  provideVSCodeService,
  type WebviewConfig,
} from './vscode.service';
export * from './app-state.service';
export {
  ThemeService,
  type ThemeName,
  type ThemeInfo,
  DAISYUI_THEMES,
} from './theme.service';
export { ModelStateService } from './model-state.service';
export { PluginCatalogService } from './plugin-catalog.service';
export { WorkspaceScopeService } from './workspace-scope.service';
export {
  AutopilotStateService,
  type AutopilotTabState,
} from './autopilot-state.service';
export { EffortStateService } from './effort-state.service';
export { AuthStateService } from './auth-state.service';
export { LlmProviderStateService } from './llm-provider-state.service';
export { type MessageHandler, MESSAGE_HANDLERS } from './message-router.types';
export {
  MessageRouterService,
  provideMessageRouter,
} from './message-router.service';
export {
  ClaudeRpcService,
  RpcResult,
  type RpcCallOptions,
} from './claude-rpc.service';
export { rpcCall, getRpcClient, type RpcCallResult } from './rpc-call.util';
export { PtahCliStateService } from './ptah-cli-state.service';
export { ElectronLayoutService } from './electron-layout.service';
export type { WorkspaceFolder } from './electron-layout-persisted-state';
export {
  AgentDiscoveryFacade,
  type AgentSuggestion,
} from './agent-discovery.facade';
export {
  CommandDiscoveryFacade,
  type CommandSuggestion,
} from './command-discovery.facade';
export { pickerWorkspaceScope } from './picker-workspace-scope.util';
export { defaultSessionName } from './default-session-name.util';
export { setIfChanged } from './idempotent-setters';
export {
  scheduleMacrotask,
  yieldToMacrotask,
  type MacrotaskHandle,
} from './macrotask-scheduler';
export {
  BootStatusService,
  type HostBootStep,
  type HostBootStepState,
} from './boot-status.service';
export {
  BackOfficeActivityService,
  ACTIVITY_RING_CAPACITY,
  ACTIVITY_COALESCE_WINDOW_MS,
  ACTIVITY_IDLE_AFTER_MS,
  type ActivityItem,
} from './back-office-activity.service';
export {
  CLAUDE_CODE_SIGN_IN_COMMAND,
  CLAUDE_CODE_NPM_INSTALL_COMMAND,
  CLAUDE_CODE_SETUP_DOCS_URL,
  CLAUDE_CODE_INSTALL_COMMANDS,
  type ClaudeCodeInstallTab,
  type ClaudeCodeInstallCommand,
} from './claude-code-commands';
