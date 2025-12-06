/**
 * Ptah Tools Server - Custom tools for SDK integration
 *
 * Creates custom MCP tools using SDK's tool() function.
 * Tools are named: mcp__ptah__help, mcp__ptah__executeCode
 *
 * NOTE: Uses SDK's tool() function directly, NOT createSdkMcpServer()
 * which is for external MCP servers.
 */

import {
  ptahHelpToolDefinition,
  executePtahHelpTool,
} from './tools/ptah-help-tool';
import {
  ptahExecuteCodeToolDefinition,
  executePtahExecuteCodeTool,
} from './tools/ptah-execute-code-tool';

/**
 * Creates Ptah custom tools for SDK integration
 *
 * Tools will be registered with the SDK and automatically prefixed:
 * - ptah.help → mcp__ptah__help
 * - ptah.executeCode → mcp__ptah__executeCode
 *
 * @returns Object with tool definitions compatible with SDK mcpServers option
 */
export async function createPtahTools(): Promise<Record<string, any>> {
  // Dynamic import of tool() function (ESM in CommonJS)
  const { tool } = await import('@anthropic-ai/claude-agent-sdk');

  return {
    help: tool(
      ptahHelpToolDefinition.name,
      ptahHelpToolDefinition.description,
      ptahHelpToolDefinition.input_schema.shape, // Extract Zod shape for SDK
      executePtahHelpTool
    ),
    executeCode: tool(
      ptahExecuteCodeToolDefinition.name,
      ptahExecuteCodeToolDefinition.description,
      ptahExecuteCodeToolDefinition.input_schema.shape, // Extract Zod shape for SDK
      executePtahExecuteCodeTool
    ),
  };
}
