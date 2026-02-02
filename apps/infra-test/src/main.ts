/**
 * Standalone MCP Server for Testing
 *
 * This is a standalone MCP server that bundles the Ptah MCP server
 * for testing with MCP Inspector and Claude Code integration.
 *
 * Transport: STDIO (standard input/output for MCP Inspector compatibility)
 * Protocol: JSON-RPC 2.0
 *
 * Usage:
 *   npx @modelcontextprotocol/inspector node dist/apps/infra-test/main.js
 *   Or configure in .mcp.json for Claude Code integration
 */

import * as readline from 'readline';
import {
  buildExecuteCodeTool,
  buildApprovalPromptTool,
} from './tools/tool-descriptions';
import { executeCode, serializeResult } from './tools/code-execution';
import { createMockPtahAPI } from './mocks/ptah-api.mock';
import type { MCPRequest, MCPResponse, PtahAPI } from './types';

// Initialize mock Ptah API
const ptahAPI: PtahAPI = createMockPtahAPI();

/**
 * Main entry point - start stdio MCP server
 */
async function main(): Promise<void> {
  log('Ptah MCP Test Server starting...');
  log('Transport: STDIO');
  log('Protocol: JSON-RPC 2.0');

  // Set up readline for stdio communication
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Process each line as a JSON-RPC request
  rl.on('line', async (line: string) => {
    try {
      const request = JSON.parse(line) as MCPRequest;
      const response = await handleMCPRequest(request);
      sendResponse(response);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${errorMessage}`,
        },
      });
    }
  });

  rl.on('close', () => {
    log('Connection closed');
    process.exit(0);
  });

  log('Ready for connections');
}

/**
 * Handle MCP JSON-RPC 2.0 request
 */
async function handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
  log(`Request: ${request.method} (id: ${request.id})`);

  try {
    switch (request.method) {
      case 'initialize':
        return handleInitialize(request);

      case 'notifications/initialized':
        // Client notification - no response needed
        return { jsonrpc: '2.0', id: request.id, result: {} };

      case 'tools/list':
        return handleToolsList(request);

      case 'tools/call':
        return await handleToolsCall(request);

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
    return createErrorResponse(request.id, -32603, errorMessage);
  }
}

/**
 * Handle initialize request
 */
function handleInitialize(request: MCPRequest): MCPResponse {
  log('Initialize request received');

  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'ptah-test',
        version: '1.0.0',
      },
    },
  };
}

/**
 * Handle tools/list request
 */
function handleToolsList(request: MCPRequest): MCPResponse {
  const tools = [buildExecuteCodeTool(), buildApprovalPromptTool()];

  log(`Listing ${tools.length} tools`);

  return {
    jsonrpc: '2.0',
    id: request.id,
    result: { tools },
  };
}

/**
 * Handle tools/call request
 */
async function handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
  const { name, arguments: args } = request.params || {};

  log(`Tool call: ${name}`);

  if (name === 'execute_code') {
    return await handleExecuteCode(
      request,
      args as { code: string; timeout?: number }
    );
  }

  if (name === 'approval_prompt') {
    return handleApprovalPrompt(
      request,
      args as { tool_name: string; input: unknown; tool_use_id?: string }
    );
  }

  return createErrorResponse(request.id, -32602, `Unknown tool: ${name}`);
}

/**
 * Handle execute_code tool
 */
async function handleExecuteCode(
  request: MCPRequest,
  params: { code: string; timeout?: number }
): Promise<MCPResponse> {
  const { code, timeout = 5000 } = params || {};

  if (!code) {
    return createErrorResponse(
      request.id,
      -32602,
      'Missing required parameter: code'
    );
  }

  const actualTimeout = Math.min(timeout, 30000);

  try {
    const result = await executeCode(code, actualTimeout, ptahAPI);
    const textResult = serializeResult(result);

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

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Handle approval_prompt tool (mock implementation)
 */
function handleApprovalPrompt(
  request: MCPRequest,
  params: { tool_name: string; input: unknown; tool_use_id?: string }
): MCPResponse {
  const { tool_name, input } = params || {};

  log(`Approval prompt for tool: ${tool_name}`);

  // In standalone mode, auto-approve everything
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            approved: true,
            tool_name,
            input,
            message: 'Auto-approved in test mode',
          }),
        },
      ],
    },
  };
}

/**
 * Create JSON-RPC error response
 */
function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string
): MCPResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

/**
 * Send response to stdout (MCP stdio transport)
 */
function sendResponse(response: MCPResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

/**
 * Log to stderr (doesn't interfere with stdio transport)
 */
function log(message: string): void {
  process.stderr.write(`[ptah-test] ${message}\n`);
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
