/**
 * HTTP Server Handler
 *
 * Manages the HTTP server for MCP protocol communication.
 * Handles CORS, request parsing, and response formatting.
 */

import * as http from 'http';
import * as vscode from 'vscode';
import type { Logger } from '@ptah-extension/vscode-core';
import type { MCPRequest, MCPResponse } from '../types';

/**
 * Configuration for the HTTP server
 */
export interface HttpServerConfig {
  port: number;
  logger: Logger;
  extensionContext: vscode.ExtensionContext;
  onMCPRequest: (request: MCPRequest) => Promise<MCPResponse>;
}

/**
 * Result of starting the HTTP server
 */
export interface HttpServerResult {
  server: http.Server;
  port: number;
}

/**
 * Get MCP server port from VS Code configuration
 * Default: 51820 (chosen to avoid common port conflicts)
 */
export function getConfiguredPort(): number {
  return vscode.workspace
    .getConfiguration('ptah')
    .get<number>('mcpPort', 51820);
}

/**
 * Start the HTTP MCP server
 */
export async function startHttpServer(
  config: HttpServerConfig
): Promise<HttpServerResult> {
  const {
    port: configuredPort,
    logger,
    extensionContext,
    onMCPRequest,
  } = config;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleHttpRequest(req, res, onMCPRequest);
    });

    server.listen(configuredPort, 'localhost', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const port = address.port;

      // Store port in workspace state for Claude CLI discovery
      extensionContext.workspaceState.update('ptah.mcp.port', port);

      logger.info(
        `CodeExecutionMCP server started on http://localhost:${port}`,
        'CodeExecutionMCP'
      );

      resolve({ server, port });
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      handleServerError(error, configuredPort, logger, reject);
    });
  });
}

/**
 * Stop the HTTP server and cleanup resources
 */
export async function stopHttpServer(
  server: http.Server | null,
  extensionContext: vscode.ExtensionContext,
  logger: Logger
): Promise<void> {
  if (!server) {
    return;
  }

  return new Promise((resolve) => {
    server.close(() => {
      logger.info('CodeExecutionMCP server stopped', 'CodeExecutionMCP');
      extensionContext.workspaceState.update('ptah.mcp.port', undefined);
      resolve();
    });
  });
}

/** Maximum request body size (1MB) to prevent resource exhaustion */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * Handle incoming HTTP request with CORS support
 */
async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onMCPRequest: (request: MCPRequest) => Promise<MCPResponse>
): Promise<void> {
  // CORS headers for localhost
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Only accept POST requests for MCP protocol
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Parse request body with size limit
  let body = '';
  let bodySize = 0;

  req.on('data', (chunk) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_SIZE) {
      req.destroy();
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32600,
          message: `Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`,
        },
      };
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errorResponse));
      return;
    }
    body += chunk.toString();
  });

  req.on('end', async () => {
    if (bodySize > MAX_BODY_SIZE) return; // Already handled above

    try {
      const mcpRequest: MCPRequest = JSON.parse(body);
      const mcpResponse = await onMCPRequest(mcpRequest);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mcpResponse));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32700,
          message: 'Parse error',
          data: errorMessage,
        },
      };

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errorResponse));
    }
  });
}

/**
 * Handle server startup errors with user-friendly messages
 */
function handleServerError(
  error: NodeJS.ErrnoException,
  configuredPort: number,
  logger: Logger,
  reject: (error: Error) => void
): void {
  if (error.code === 'EADDRINUSE') {
    const errorMsg = `Failed to start MCP server on port ${configuredPort}. Port is already in use. Please change 'ptah.mcpPort' setting to use a different port.`;
    logger.error(errorMsg, error);

    // Show user-friendly notification
    vscode.window.showErrorMessage(errorMsg);

    reject(new Error(errorMsg));
  } else {
    logger.error('CodeExecutionMCP server error', error);
    reject(error);
  }
}
