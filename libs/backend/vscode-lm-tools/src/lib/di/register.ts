import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PtahAPIBuilder } from '../code-execution/ptah-api-builder.service';
import { CodeExecutionMCP } from '../code-execution/code-execution-mcp.service';
import { PermissionPromptService } from '../permission/permission-prompt.service';

/**
 * Register vscode-lm-tools services in DI container
 *
 * Services expose workspace-intelligence to Claude CLI via Code Execution MCP server.
 *
 * Registers:
 * - PtahAPIBuilder (singleton): Constructs Ptah API namespaces for code execution
 * - CodeExecutionMCP (singleton): MCP server with execute_code and approval_prompt tools
 * - PermissionPromptService (singleton): User permission prompts for tool execution
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for registration logging
 *
 * @example
 * ```typescript
 * import { registerVsCodeLmToolsServices } from '@ptah-extension/vscode-lm-tools';
 *
 * // In container.ts
 * registerVsCodeLmToolsServices(container, logger);
 *
 * // Resolve services
 * const mcpServer = container.resolve<CodeExecutionMCP>(TOKENS.CODE_EXECUTION_MCP);
 * ```
 */
export function registerVsCodeLmToolsServices(
  container: DependencyContainer,
  logger: Logger
): void {
  logger.info('[VS Code LM Tools] Registering services...');

  // Code Execution MCP services (expose workspace-intelligence to Claude CLI)
  container.registerSingleton(TOKENS.PTAH_API_BUILDER, PtahAPIBuilder);
  container.registerSingleton(TOKENS.CODE_EXECUTION_MCP, CodeExecutionMCP);

  // Permission Prompt Service (TASK_2025_026)
  container.registerSingleton(
    TOKENS.PERMISSION_PROMPT_SERVICE,
    PermissionPromptService
  );

  logger.info('[VS Code LM Tools] Services registered', {
    services: [
      'PTAH_API_BUILDER',
      'CODE_EXECUTION_MCP',
      'PERMISSION_PROMPT_SERVICE',
    ],
  });
}
