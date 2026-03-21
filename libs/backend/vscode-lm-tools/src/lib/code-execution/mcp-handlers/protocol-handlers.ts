/**
 * MCP Protocol Handlers
 *
 * Implements MCP JSON-RPC 2.0 protocol methods:
 * - initialize: Server capability negotiation
 * - tools/list: List available tools
 * - tools/call: Execute a tool
 */

import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
import type { CliType } from '@ptah-extension/shared';
import type { PermissionPromptService } from '../../permission/permission-prompt.service';
import type {
  PtahAPI,
  MCPRequest,
  MCPResponse,
  ExecuteCodeParams,
  ApprovalPromptParams,
} from '../types';
import {
  buildExecuteCodeTool,
  buildApprovalPromptTool,
  buildWorkspaceAnalyzeTool,
  buildSearchFilesTool,
  buildGetDiagnosticsTool,
  buildLspReferencesTool,
  buildLspDefinitionsTool,
  buildGetDirtyFilesTool,
  buildCountTokensTool,
  buildAgentSpawnTool,
  buildAgentStatusTool,
  buildAgentReadTool,
  buildAgentSteerTool,
  buildAgentListTool,
  buildAgentStopTool,
  buildWebSearchTool,
} from './tool-description.builder';
import { executeCode, serializeResult } from './code-execution.engine';
import { handleApprovalPrompt } from './approval-prompt.handler';
import {
  formatWorkspaceAnalysis,
  formatSearchFiles,
  formatDiagnostics,
  formatLspReferences,
  formatLspDefinitions,
  formatDirtyFiles,
  formatTokenCount,
  formatAgentSpawn,
  formatAgentStatus,
  formatAgentRead,
  formatAgentSteer,
  formatAgentStop,
  formatAgentList,
  formatWebSearch,
} from './mcp-response-formatter';

/**
 * Callback invoked when a tool execution completes (success or error).
 * Used to broadcast tool results to the frontend for live transcript display.
 */
export type ToolResultCallback = (
  toolCallId: string,
  content: string,
  isError: boolean
) => void;

/**
 * Dependencies for protocol handlers
 */
export interface ProtocolHandlerDependencies {
  ptahAPI: PtahAPI;
  permissionPromptService: PermissionPromptService;
  webviewManager: WebviewManager;
  logger: Logger;
  onToolResult?: ToolResultCallback;
}

/**
 * Handle MCP JSON-RPC 2.0 request
 * Routes to appropriate handler based on method
 */
export async function handleMCPRequest(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies
): Promise<MCPResponse> {
  const { logger } = deps;

  logger.info(`MCP Request: ${request.method}`, 'CodeExecutionMCP', {
    id: request.id,
  });

  try {
    switch (request.method) {
      case 'initialize':
        return handleInitialize(request, logger);

      case 'tools/list':
        return handleToolsList(request);

      case 'tools/call':
        return await handleToolsCall(request, deps);

      default:
        return createErrorResponse(
          request.id,
          -32601,
          `Method not found: ${request.method}`
        );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error(
      `MCP request failed: ${request.method}`,
      error instanceof Error ? error : new Error(String(error))
    );

    return createErrorResponse(request.id, -32603, errorMessage, errorStack);
  }
}

/**
 * Handle initialize request
 * Required by MCP protocol - must respond with server capabilities
 */
function handleInitialize(request: MCPRequest, logger: Logger): MCPResponse {
  logger.info('MCP initialize request received', 'CodeExecutionMCP', {
    clientInfo: request.params?.['clientInfo'],
  });

  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'ptah',
        version: '1.0.0',
      },
    },
  };
}

/**
 * Handle tools/list request
 * Returns all available tools: individual ptah_* tools, execute_code, and approval_prompt
 */
function handleToolsList(request: MCPRequest): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      tools: [
        // Individual first-class tools (simple params, high discoverability)
        buildWorkspaceAnalyzeTool(),
        buildSearchFilesTool(),
        buildGetDiagnosticsTool(),
        buildLspReferencesTool(),
        buildLspDefinitionsTool(),
        buildGetDirtyFilesTool(),
        buildCountTokensTool(),
        // Agent orchestration tools (TASK_2025_157)
        buildAgentSpawnTool(),
        buildAgentStatusTool(),
        buildAgentReadTool(),
        buildAgentSteerTool(),
        buildAgentStopTool(),
        buildAgentListTool(),
        // Web search tool (TASK_2025_189)
        buildWebSearchTool(),
        // Power-user tools
        buildExecuteCodeTool(),
        buildApprovalPromptTool(),
      ],
    },
  };
}

/**
 * Handle tools/call request
 * Routes to individual ptah_* tools, execute_code, or approval_prompt
 */
async function handleToolsCall(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies
): Promise<MCPResponse> {
  const params = request.params as
    | { name: string; arguments?: Record<string, unknown> }
    | undefined;
  const { name, arguments: args } = params!;

  // Individual first-class tools — direct API calls, no sandbox
  const individualResult = await handleIndividualTool(
    name,
    args || {},
    request,
    deps
  );
  if (individualResult) return individualResult;

  if (name === 'execute_code') {
    return await handleExecuteCodeCall(
      request,
      args as unknown as ExecuteCodeParams,
      deps
    );
  }

  if (name === 'approval_prompt') {
    return await handleApprovalPrompt(
      request,
      args as unknown as ApprovalPromptParams,
      {
        permissionPromptService: deps.permissionPromptService,
        webviewManager: deps.webviewManager,
        logger: deps.logger,
      }
    );
  }

  return createErrorResponse(request.id, -32602, `Unknown tool: ${name}`);
}

/**
 * Handle individual ptah_* tool calls.
 * Returns MCPResponse if the tool name matches, null otherwise.
 * Each handler directly calls deps.ptahAPI — no sandbox, no code execution.
 */
async function handleIndividualTool(
  name: string,
  args: Record<string, unknown>,
  request: MCPRequest,
  deps: ProtocolHandlerDependencies
): Promise<MCPResponse | null> {
  const { ptahAPI, logger } = deps;

  try {
    switch (name) {
      case 'ptah_workspace_analyze': {
        const result = await ptahAPI.workspace.analyze();
        return createToolSuccessResponse(
          request,
          formatWorkspaceAnalysis(result),
          deps
        );
      }

      case 'ptah_search_files': {
        const { pattern, limit } = args as { pattern: string; limit?: number };
        const files = await ptahAPI.search.findFiles(pattern, limit ?? 50);
        return createToolSuccessResponse(
          request,
          formatSearchFiles(files),
          deps
        );
      }

      case 'ptah_get_diagnostics': {
        const { severity } = args as { severity?: 'error' | 'warning' | 'all' };
        let result;
        if (severity === 'error') {
          result = await ptahAPI.diagnostics.getErrors();
        } else if (severity === 'warning') {
          result = await ptahAPI.diagnostics.getWarnings();
        } else {
          result = await ptahAPI.diagnostics.getAll();
        }
        return createToolSuccessResponse(
          request,
          formatDiagnostics(result),
          deps
        );
      }

      case 'ptah_lsp_references': {
        const { file, line, col } = args as {
          file: string;
          line: number;
          col: number;
        };
        const refs = await ptahAPI.ide.lsp.getReferences(file, line, col);
        return createToolSuccessResponse(
          request,
          formatLspReferences(refs),
          deps
        );
      }

      case 'ptah_lsp_definitions': {
        const { file, line, col } = args as {
          file: string;
          line: number;
          col: number;
        };
        const defs = await ptahAPI.ide.lsp.getDefinition(file, line, col);
        return createToolSuccessResponse(
          request,
          formatLspDefinitions(defs),
          deps
        );
      }

      case 'ptah_get_dirty_files': {
        const dirtyFiles = await ptahAPI.ide.editor.getDirtyFiles();
        return createToolSuccessResponse(
          request,
          formatDirtyFiles(dirtyFiles),
          deps
        );
      }

      case 'ptah_count_tokens': {
        const { file } = args as { file: string };
        const fileContent = await ptahAPI.files.read(file);
        const tokenCount = await ptahAPI.context.countTokens(fileContent);
        return createToolSuccessResponse(
          request,
          formatTokenCount({ file, tokens: tokenCount }),
          deps
        );
      }

      // Agent orchestration tools (TASK_2025_157)
      case 'ptah_agent_spawn': {
        const MAX_TASK_LENGTH = 100 * 1024; // 100KB

        const {
          cli,
          ptahCliId,
          workingDirectory,
          timeout,
          files,
          taskFolder,
          model,
          resume_session_id,
        } = args as {
          task: string;
          cli?: string;
          ptahCliId?: string;
          workingDirectory?: string;
          timeout?: number;
          files?: string[];
          taskFolder?: string;
          model?: string;
          resume_session_id?: string;
        };

        // Validate task parameter: must be a non-empty string within size limits
        const task = (args as Record<string, unknown>)?.['task'];
        if (!task || typeof task !== 'string') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: "task" parameter is required and must be a string.',
                },
              ],
              isError: true,
            },
          };
        }
        if (task.length > MAX_TASK_LENGTH) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: "task" exceeds maximum length of ${MAX_TASK_LENGTH} bytes.`,
                },
              ],
              isError: true,
            },
          };
        }

        logger.info('[MCP] ptah_agent_spawn invoked', 'CodeExecutionMCP', {
          cli: cli ?? (ptahCliId ? 'ptah-cli' : 'auto-detect'),
          ptahCliId,
          model: model ?? 'default',
          task: task.substring(0, 100) + (task.length > 100 ? '...' : ''),
          timeout,
          files: files?.length ?? 0,
          taskFolder,
          resumeSessionId: resume_session_id,
        });

        const result = await ptahAPI.agent.spawn({
          task,
          cli: cli as CliType | undefined,
          ptahCliId,
          workingDirectory,
          timeout,
          files,
          taskFolder,
          model,
          resumeSessionId: resume_session_id,
          // parentSessionId is injected by buildAgentNamespace, not by MCP args
        });

        logger.info('[MCP] ptah_agent_spawn result', 'CodeExecutionMCP', {
          agentId: result.agentId,
          cli: result.cli,
          status: result.status,
          cliSessionId: result.cliSessionId,
        });

        return createToolSuccessResponse(
          request,
          formatAgentSpawn(result),
          deps
        );
      }

      case 'ptah_agent_status': {
        const { agentId } = args as { agentId?: string };
        const result = await ptahAPI.agent.status(agentId);
        return createToolSuccessResponse(
          request,
          formatAgentStatus(result),
          deps
        );
      }

      case 'ptah_agent_read': {
        const { agentId, tail } = args as {
          agentId: string;
          tail?: number;
        };
        const result = await ptahAPI.agent.read(agentId, tail);
        return createToolSuccessResponse(
          request,
          formatAgentRead(result),
          deps
        );
      }

      case 'ptah_agent_steer': {
        const { agentId, instruction } = args as {
          agentId: string;
          instruction: string;
        };
        await ptahAPI.agent.steer(agentId, instruction);
        return createToolSuccessResponse(
          request,
          formatAgentSteer({ agentId, steered: true }),
          deps
        );
      }

      case 'ptah_agent_stop': {
        const { agentId } = args as { agentId: string };
        const result = await ptahAPI.agent.stop(agentId);
        return createToolSuccessResponse(
          request,
          formatAgentStop(result),
          deps
        );
      }

      case 'ptah_agent_list': {
        logger.info('[MCP] ptah_agent_list called', 'CodeExecutionMCP');
        const agents = await ptahAPI.agent.list();
        return createToolSuccessResponse(
          request,
          formatAgentList(agents),
          deps
        );
      }

      case 'ptah_web_search': {
        const { query, timeout } = args as { query: string; timeout?: number };
        if (!deps.ptahAPI.webSearch) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text' as const,
                  text: 'Web search service not available.',
                },
              ],
              isError: true,
            },
          };
        }
        const result = await deps.ptahAPI.webSearch.search(query, timeout);
        return createToolSuccessResponse(
          request,
          formatWebSearch(result),
          deps
        );
      }

      default:
        return null;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    logger.error(
      `Individual tool ${name} failed: ${errorMessage}`,
      error instanceof Error ? error : new Error(String(error))
    );

    deps.onToolResult?.(request.id.toString(), errorMessage, true);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          { type: 'text', text: `Tool ${name} failed: ${errorMessage}` },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Create a successful tool response with callback notification
 */
function createToolSuccessResponse(
  request: MCPRequest,
  text: string,
  deps: ProtocolHandlerDependencies
): MCPResponse {
  deps.onToolResult?.(request.id.toString(), text, false);
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [{ type: 'text', text }],
    },
  };
}

/**
 * Handle execute_code tool call
 *
 * Per MCP spec, tool execution errors are returned as successful responses
 * with isError: true content, not as JSON-RPC error objects.
 */
async function handleExecuteCodeCall(
  request: MCPRequest,
  params: ExecuteCodeParams,
  deps: ProtocolHandlerDependencies
): Promise<MCPResponse> {
  const { code, timeout = 15000 } = params;
  const { ptahAPI, logger } = deps;

  // Validate timeout (cap at 30000ms)
  const actualTimeout = Math.min(timeout, 30000);

  try {
    const result = await executeCode(code, actualTimeout, { ptahAPI, logger });
    const textResult = serializeResult(result);

    // Notify callback for live transcript streaming
    deps.onToolResult?.(request.id.toString(), textResult, false);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: textResult,
          },
        ],
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Log full stack trace server-side for debugging
    if (error instanceof Error && error.stack) {
      logger.error('Code execution failed', error);
    }

    // Build agent-friendly error message with recovery hints
    const agentMessage = buildAgentFriendlyError(errorMessage);

    // Notify callback for live transcript streaming
    deps.onToolResult?.(request.id.toString(), agentMessage, true);

    // Per MCP spec: return tool errors as successful response with isError flag
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: agentMessage,
          },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Build agent-friendly error message with recovery hints.
 * Removes raw stack traces and adds actionable guidance.
 *
 * The runtime proxy now includes available methods directly in TypeError messages,
 * so "is not available" errors from the proxy are already actionable.
 */
function buildAgentFriendlyError(errorMessage: string): string {
  if (errorMessage.includes('Execution timeout')) {
    return `${errorMessage}. Try breaking the operation into smaller steps or increasing the timeout parameter.`;
  }

  // File not found errors - guide to use search/discovery first
  if (errorMessage.includes('File not found:')) {
    const filePath = errorMessage.split('File not found:')[1]?.trim() || '';
    return `File not found: ${filePath}

SOLUTION: Don't guess file paths. Use discovery methods first:
1. Use ptah.search.findFiles('**/*.ts') to find files by pattern
2. Use ptah.files.list('directory') to list directory contents
3. Use ptah.workspace.analyze() to understand project structure

Example:
  const tsFiles = await ptah.search.findFiles('**/*.ts', 100);
  const packageFiles = tsFiles.filter(f => f.includes('package'));`;
  }

  // Directory not found errors
  if (errorMessage.includes('Directory not found:')) {
    return `${errorMessage}

SOLUTION: Use ptah.workspace.analyze() to see project structure, then ptah.files.list() to explore directories.`;
  }

  // Proxy-generated errors already include available methods — pass through with minimal wrapping
  if (errorMessage.includes('is not available. Available')) {
    return `API Error: ${errorMessage}`;
  }
  if (errorMessage.includes('namespace does not exist. Available')) {
    return `API Error: ${errorMessage}`;
  }

  if (
    errorMessage.includes('is not a function') ||
    errorMessage.includes('is not defined')
  ) {
    return `${errorMessage}. Use ptah.help('namespace') to see available methods. Common mistakes: ptah.files is read-only (no write/delete), use ptah.project.detectMonorepo() not getMonorepoInfo().`;
  }
  if (errorMessage.includes('Cannot read properties of')) {
    return `${errorMessage}. A method returned null/undefined. Use optional chaining (?.) or check the return value before accessing properties.`;
  }
  return `Code execution failed: ${errorMessage}. Try wrapping in try-catch for more details.`;
}

/**
 * Create a JSON-RPC error response
 */
function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: string
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data && { data }),
    },
  };
}
