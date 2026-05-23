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
export { CodeExecutionMCP } from './lib/code-execution/mcp-http/http-mcp-server.service';
export type {
  PtahAPI,
  BrowserRecordStartResult,
  BrowserRecordStopResult,
} from './lib/code-execution/types';
export type { IIDECapabilities } from './lib/code-execution/namespace-builders/ide-namespace.builder';
export type { ToolResultCallback } from './lib/code-execution/mcp-core';
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
} from './lib/code-execution/services/web-search-provider.interface';
export type {
  IBrowserCapabilities,
  BrowserSessionOptions,
} from './lib/code-execution/namespace-builders/browser-namespace.builder';
export { ChromeLauncherBrowserCapabilities } from './lib/code-execution/services/chrome-launcher-browser-capabilities';
export { ScreenRecorderService } from './lib/code-execution/services/screen-recorder.service';
export { registerVsCodeLmToolsServices } from './lib/di';
