/**
 * HTTP Server Handler
 *
 * Manages the HTTP server for MCP protocol communication.
 * Handles CORS, request parsing, and response formatting.
 * Uses platform-core interfaces for all configuration access.
 */

import * as http from 'http';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { MCPRequest, MCPResponse } from '../types';

/**
 * Configuration for the HTTP server
 */
export interface HttpServerConfig {
  port: number;
  logger: Logger;
  workspaceState: IStateStorage;
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
 * Get MCP server port from platform configuration.
 * Default: 51820 (chosen to avoid common port conflicts)
 *
 * @param workspaceProvider - Platform-agnostic configuration access
 * @returns Configured port number, defaulting to 51820
 */
export function getConfiguredPort(
  workspaceProvider: IWorkspaceProvider,
): number {
  return (
    workspaceProvider.getConfiguration<number>('ptah', 'mcpPort', 51820) ??
    51820
  );
}

/**
 * Try to listen on a specific port. Returns a promise that resolves with
 * the server+port on success, or rejects on error.
 */
function tryListen(
  server: http.Server,
  port: number,
  logger: Logger,
  workspaceState: IStateStorage,
): Promise<HttpServerResult> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('error', onError);
      reject(error);
    };
    server.on('error', onError);

    server.listen(port, 'localhost', () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const actualPort = address.port;
      workspaceState.update('ptah.mcp.port', actualPort);
      logger.info(
        `CodeExecutionMCP server started on http://localhost:${actualPort}`,
        'CodeExecutionMCP',
      );
      resolve({ server, port: actualPort });
    });
  });
}

/**
 * Start the HTTP MCP server.
 *
 * Tries the configured port first. If it fails (EACCES on Windows due to
 * Hyper-V port exclusions, or EADDRINUSE), retries with port 0 which lets
 * the OS assign a random available port.
 */
export async function startHttpServer(
  config: HttpServerConfig,
): Promise<HttpServerResult> {
  const { port: configuredPort, logger, workspaceState, onMCPRequest } = config;

  const server = http.createServer((req, res) => {
    handleHttpRequest(req, res, onMCPRequest);
  });

  try {
    return await tryListen(server, configuredPort, logger, workspaceState);
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException).code;
    if (errCode === 'EACCES' || errCode === 'EADDRINUSE') {
      logger.warn(
        `MCP port ${configuredPort} unavailable (${errCode}), retrying with OS-assigned port`,
      );
      return await tryListen(server, 0, logger, workspaceState);
    }
    throw error;
  }
}

/**
 * Stop the HTTP server and cleanup resources
 */
export async function stopHttpServer(
  server: http.Server | null,
  workspaceState: IStateStorage,
  logger: Logger,
): Promise<void> {
  if (!server) {
    return;
  }

  return new Promise((resolve) => {
    server.close(() => {
      logger.info('CodeExecutionMCP server stopped', 'CodeExecutionMCP');
      workspaceState.update('ptah.mcp.port', undefined);
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
  onMCPRequest: (request: MCPRequest) => Promise<MCPResponse>,
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

  // Handle health check (supports both /health and / root probe)
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
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
      const parsed = JSON.parse(body) as Record<string, unknown>;

      // JSON-RPC 2.0 notifications have no "id" field.
      // MCP clients (e.g. Gemini CLI) send "notifications/initialized" after
      // the initialize handshake. Per spec, notifications require no response,
      // but HTTP always needs one — return 204 No Content.
      if (!('id' in parsed) || parsed['id'] === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }

      const mcpRequest = parsed as unknown as MCPRequest;
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
