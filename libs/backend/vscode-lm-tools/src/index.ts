/**
 * VS Code Language Model Tools Library
 *
 * Provides Code Execution MCP server for Ptah API integration.
 */

// Code Execution MCP exports
export {
  PtahAPIBuilder,
  IDE_CAPABILITIES_TOKEN,
  BROWSER_CAPABILITIES_TOKEN,
} from './lib/code-execution/ptah-api-builder.service';
export { CodeExecutionMCP } from './lib/code-execution/code-execution-mcp.service';
export type {
  PtahAPI,
  BrowserRecordStartResult,
  BrowserRecordStopResult,
} from './lib/code-execution/types';

// IDE capabilities exports
export type { IIDECapabilities } from './lib/code-execution/namespace-builders/ide-namespace.builder';
// NOTE: VscodeIDECapabilities is exported from '@ptah-extension/vscode-lm-tools/vscode'
// subpath to prevent the Electron bundler from resolving the vscode-importing file.
export type { ToolResultCallback } from './lib/code-execution/mcp-handlers';

// System Prompt exports
export {
  PTAH_SYSTEM_PROMPT,
  PTAH_SYSTEM_PROMPT_TOKENS,
  buildPlatformSystemPrompt,
} from './lib/code-execution/ptah-system-prompt.constant';

// Permission Prompt Service exports
export { PermissionPromptService } from './lib/permission/permission-prompt.service';

// Web Search Provider exports
export {
  TavilySearchProvider,
  SerperSearchProvider,
  ExaSearchProvider,
} from './lib/code-execution/services/providers';
export type {
  WebSearchProviderType,
  IWebSearchProvider,
} from './lib/code-execution/services/web-search-provider.interface';

// Browser capabilities exports
export type {
  IBrowserCapabilities,
  BrowserSessionOptions,
} from './lib/code-execution/namespace-builders/browser-namespace.builder';
export { ChromeLauncherBrowserCapabilities } from './lib/code-execution/services/chrome-launcher-browser-capabilities';

// Screen Recorder Service export
export { ScreenRecorderService } from './lib/code-execution/services/screen-recorder.service';

// DI registration exports
export { registerVsCodeLmToolsServices } from './lib/di';
