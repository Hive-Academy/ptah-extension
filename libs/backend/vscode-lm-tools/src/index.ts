/**
 * VS Code Language Model Tools Library
 *
 * Provides Code Execution MCP server for Ptah API integration.
 */

// Code Execution MCP exports
export {
  PtahAPIBuilder,
  IDE_CAPABILITIES_TOKEN,
} from './lib/code-execution/ptah-api-builder.service';
export { CodeExecutionMCP } from './lib/code-execution/code-execution-mcp.service';
export type { PtahAPI } from './lib/code-execution/types';

// IDE capabilities exports (TASK_2025_226 - platform decoupling)
export type { IIDECapabilities } from './lib/code-execution/namespace-builders/ide-namespace.builder';
export { VscodeIDECapabilities } from './lib/code-execution/namespace-builders/ide-capabilities.vscode';
export type { ToolResultCallback } from './lib/code-execution/mcp-handlers';

// System Prompt exports (TASK_2025_039 Phase 9)
export {
  PTAH_SYSTEM_PROMPT,
  PTAH_SYSTEM_PROMPT_TOKENS,
} from './lib/code-execution/ptah-system-prompt.constant';

// Permission Prompt Service exports (TASK_2025_026)
export { PermissionPromptService } from './lib/permission/permission-prompt.service';

// DI registration exports (TASK_2025_071 Batch 2A)
export { registerVsCodeLmToolsServices } from './lib/di';
