/**
 * MCP Protocol Handlers
 *
 * Implements MCP JSON-RPC 2.0 protocol methods:
 * - initialize: Server capability negotiation
 * - tools/list: List available tools
 * - tools/call: Execute a tool
 */

import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
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
} from './tool-description.builder';
import { executeCode, serializeResult } from './code-execution.engine';
import { handleApprovalPrompt } from './approval-prompt.handler';

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
    clientInfo: request.params?.clientInfo,
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
 * Returns available tools: execute_code and approval_prompt
 */
function handleToolsList(request: MCPRequest): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      tools: [buildExecuteCodeTool(), buildApprovalPromptTool()],
    },
  };
}

/**
 * Handle tools/call request
 * Routes to execute_code or approval_prompt handlers
 */
async function handleToolsCall(
  request: MCPRequest,
  deps: ProtocolHandlerDependencies
): Promise<MCPResponse> {
  const { name, arguments: args } = request.params;

  if (name === 'execute_code') {
    return await handleExecuteCodeCall(
      request,
      args as ExecuteCodeParams,
      deps
    );
  }

  if (name === 'approval_prompt') {
    return await handleApprovalPrompt(request, args as ApprovalPromptParams, {
      permissionPromptService: deps.permissionPromptService,
      webviewManager: deps.webviewManager,
      logger: deps.logger,
    });
  }

  return createErrorResponse(request.id, -32602, `Unknown tool: ${name}`);
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
 */
function buildAgentFriendlyError(errorMessage: string): string {
  if (errorMessage.includes('Execution timeout')) {
    return `${errorMessage}. Try breaking the operation into smaller steps or increasing the timeout parameter.`;
  }
  if (
    errorMessage.includes('is not a function') ||
    errorMessage.includes('is not defined')
  ) {
    return `${errorMessage}. Check the method signature with ptah.help() — the API may have changed.`;
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
