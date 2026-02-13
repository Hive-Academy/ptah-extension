/**
 * VS Code Language Model Tools Library
 *
 * Provides Code Execution MCP server for Ptah API integration.
 */

// Code Execution MCP exports
export { PtahAPIBuilder } from './lib/code-execution/ptah-api-builder.service';
export { CodeExecutionMCP } from './lib/code-execution/code-execution-mcp.service';
export type { PtahAPI } from './lib/code-execution/types';
export type { ToolResultCallback } from './lib/code-execution/mcp-handlers';

// System Prompt exports (TASK_2025_039 Phase 9)
export { PTAH_SYSTEM_PROMPT } from './lib/code-execution/ptah-system-prompt.constant';

// Permission Prompt Service exports (TASK_2025_026)
export { PermissionPromptService } from './lib/permission/permission-prompt.service';

// DI registration exports (TASK_2025_071 Batch 2A)
export { registerVsCodeLmToolsServices } from './lib/di';
