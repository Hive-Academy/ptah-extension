/**
 * VS Code Language Model Tools Library
 *
 * Provides Code Execution MCP server for Ptah API integration.
 */
export {
  PtahAPIBuilder,
  IDE_CAPABILITIES_TOKEN,
  BROWSER_CAPABILITIES_TOKEN,
} from './lib/code-execution/ptah-api-builder.service';
export {
  CodeExecutionMCP,
  type McpRegistrationFailure,
  type McpSubagentRegistration,
} from './lib/code-execution/mcp-http/http-mcp-server.service';
export { McpCallerWorkspaceResolver } from './lib/code-execution/mcp-caller-workspace-resolver';
export {
  DiagnosticsCacheInvalidator,
  DIAGNOSTICS_CACHE_INVALIDATOR,
  type DiagnosticsInvalidationPayload,
  type DiagnosticsInvalidationSource,
} from './lib/diagnostics/diagnostics-cache-invalidator.service';
export type {
  PtahAPI,
  BrowserRecordStartResult,
  BrowserRecordStopResult,
  Location,
  HoverInfo,
  SignatureHelp,
  ActiveEditorInfo,
  CodeAction,
  VisibleRange,
} from './lib/code-execution/types';
export type { IIDECapabilities } from './lib/code-execution/namespace-builders/ide-namespace.builder';
export type {
  ToolResultCallback,
  MCPRequest,
  MCPResponse,
  MCPError,
  MCPNotification,
  MCPToolDefinition,
} from './lib/code-execution/mcp-core';
export {
  StdioTransport,
  StdioMcpServerService,
  createStdioMcpServer,
  MCP_PROTOCOL_VERSION,
  MCP_MVP_TOOL_NAMES,
  buildMcpMvpTools,
  registerMcpStdioServices,
  STDIO_MCP_SERVER_TOKEN,
  AgentToolDispatcher,
  type McpStdioNotifier,
  type StdioMcpServerConfig,
  type StdioMcpServerInfo,
  type McpMvpToolName,
  type ISessionSubmitHandler,
  type SessionSubmitCancellation,
} from './lib/code-execution/mcp-stdio';
export {
  PTAH_SYSTEM_PROMPT,
  PTAH_SYSTEM_PROMPT_TOKENS,
  buildPlatformSystemPrompt,
} from './lib/code-execution/ptah-system-prompt.constant';
export { PermissionPromptService } from './lib/permission/permission-prompt.service';
export {
  TavilySearchProvider,
  SerperSearchProvider,
  ExaSearchProvider,
} from './lib/code-execution/services/providers';
export type {
  WebSearchProviderType,
  IWebSearchProvider,
  WebSearchFailureReason,
  WebSearchProviderOutcome,
  WebSearchAttributedResultItem,
} from './lib/code-execution/services/web-search-provider.interface';
export type {
  IBrowserCapabilities,
  BrowserSessionOptions,
} from './lib/code-execution/namespace-builders/browser-namespace.builder';
export { ChromeLauncherBrowserCapabilities } from './lib/code-execution/services/chrome-launcher-browser-capabilities';
export { ScreenRecorderService } from './lib/code-execution/services/screen-recorder.service';
export { registerVsCodeLmToolsServices } from './lib/di';

// Surface delivery and state tokens
export {
  createDashboardBroadcast,
  type DashboardSurfaceHost,
  type DashboardPushType,
} from './lib/code-execution/namespace-builders/dashboard-namespace.builder';
export { VSCODE_LM_TOOLS_TOKENS } from './lib/di';
export {
  SurfaceStateService,
  type SurfacePushHostProvider,
  type SurfaceAgentUpdateResult,
  type SurfaceMutationOutcome,
  type SurfaceSubmitBegin,
  type SurfaceSubmitTicket,
  type SurfaceSubmitDispatchOutcome,
  type SurfaceChangeRequest,
  type SurfaceSelectRequest,
  type SurfaceSubmitRequest,
  type SurfaceOperationStatusResult,
  type SurfaceActionResolution,
  type SurfaceStoreReadResult,
  type SurfaceAgentReadResult,
} from './lib/surface';
// TASK_2026_538 Batch 14 revision 1: the real MCP entry points for the
// surface tools, so a host-composition test can drive the actual namespace
// and tool-call mapping instead of calling SurfaceStateService directly.
// Only PtahAPIBuilder and the MCP dispatcher construct these in production;
// exporting them does not add a second entry point for the contract itself
// (that stays behind `@ptah-extension/shared/mcp-apps-contracts`).
export {
  buildSurfaceNamespace,
  type SurfaceNamespace,
  type SurfaceCaller,
  type SurfaceUpdateOutcome,
  type SurfaceGetStateOutcome,
} from './lib/code-execution/namespace-builders/surface-namespace.builder';
export {
  handleSurfaceToolCall,
  type SurfaceToolReply,
  type SurfaceToolName,
} from './lib/code-execution/mcp-core/surface-tool-handlers';
export {
  SURFACE_UPDATE_TOOL_NAME,
  SURFACE_GET_STATE_TOOL_NAME,
} from './lib/code-execution/mcp-core/surface-tools';
