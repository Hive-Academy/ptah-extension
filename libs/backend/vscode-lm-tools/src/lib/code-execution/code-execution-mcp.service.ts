/**
 * Code Execution MCP Server
 *
 * HTTP MCP server providing "execute_code" tool for Claude CLI.
 * Implements JSON-RPC 2.0 protocol over HTTP transport.
 * Executes TypeScript code with AsyncFunction and timeout protection.
 *
 * Pattern: Injectable service with HTTP server lifecycle (lm-tools-registration.service.ts:25-69)
 */

import * as http from 'http';
import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { PtahAPIBuilder } from './ptah-api-builder.service';

// TEMPORARY: Token will be registered in Batch 3, Task 3.1
const PTAH_API_BUILDER = Symbol.for('PtahAPIBuilder');
import {
  PtahAPI,
  MCPRequest,
  MCPResponse,
  MCPError,
  MCPToolDefinition,
  ExecuteCodeParams,
} from './types';

@injectable()
export class CodeExecutionMCP implements vscode.Disposable {
  private server: http.Server | null = null;
  private port: number | null = null;
  private ptahAPI: PtahAPI;

  constructor(
    @inject(PTAH_API_BUILDER)
    private readonly apiBuilder: PtahAPIBuilder,

    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,

    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext
  ) {
    // Build ptah API once at construction (reused for all executions)
    this.ptahAPI = this.apiBuilder.buildAPI();
  }

  /**
   * Start HTTP MCP server on random localhost port
   * Stores port in workspace state for Claude CLI discovery
   */
  async start(): Promise<number> {
    if (this.server) {
      this.logger.warn('CodeExecutionMCP already started', 'CodeExecutionMCP');
      return this.port!;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Listen on random port (0 = OS assigns available port)
      this.server.listen(0, 'localhost', () => {
        const address = this.server!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }

        this.port = address.port;

        // Store port in workspace state for Claude CLI discovery
        this.context.workspaceState.update('ptah.mcp.port', this.port);

        this.logger.info(
          `CodeExecutionMCP server started on http://localhost:${this.port}`,
          'CodeExecutionMCP'
        );

        resolve(this.port);
      });

      this.server.on('error', (error) => {
        this.logger.error('CodeExecutionMCP server error', error);
        reject(error);
      });
    });
  }

  /**
   * Stop MCP server and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.logger.info('CodeExecutionMCP server stopped', 'CodeExecutionMCP');
        this.server = null;
        this.port = null;
        this.context.workspaceState.update('ptah.mcp.port', undefined);
        resolve();
      });
    });
  }

  /**
   * Get current server port (for testing)
   */
  getPort(): number | null {
    return this.port;
  }

  /**
   * Handle HTTP request with CORS support and MCP JSON-RPC 2.0 protocol
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
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
      res.end(JSON.stringify({ status: 'ok', port: this.port }));
      return;
    }

    // Only accept POST requests for MCP protocol
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Parse request body
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const mcpRequest: MCPRequest = JSON.parse(body);
        const mcpResponse = await this.handleMCPRequest(mcpRequest);

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
   * Handle MCP JSON-RPC 2.0 request
   * Supports: tools/list, tools/call
   */
  private async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
    this.logger.info(`MCP Request: ${request.method}`, 'CodeExecutionMCP', {
      id: request.id,
    });

    try {
      switch (request.method) {
        case 'tools/list':
          return this.handleToolsList(request);

        case 'tools/call':
          return await this.handleToolsCall(request);

        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `MCP request failed: ${request.method}`,
        error instanceof Error ? error : new Error(String(error))
      );

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: errorMessage,
          data: errorStack,
        },
      };
    }
  }

  /**
   * Handle tools/list request
   * Returns single tool: execute_code
   */
  private handleToolsList(request: MCPRequest): MCPResponse {
    const toolDefinition: MCPToolDefinition = {
      name: 'execute_code',
      description:
        'Execute TypeScript/JavaScript code with access to Ptah extension APIs. ' +
        'Available namespaces: workspace, search, symbols, diagnostics, git, ai, files, commands. ' +
        'The code has access to a global "ptah" object with all these namespaces.',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'TypeScript/JavaScript code to execute. Has access to "ptah" global object. ' +
              'Example: const info = await ptah.workspace.analyze(); return info;',
          },
          timeout: {
            type: 'number',
            description:
              'Execution timeout in milliseconds (default: 5000, max: 30000)',
            default: 5000,
          },
        },
        required: ['code'],
      },
    };

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [toolDefinition],
      },
    };
  }

  /**
   * Handle tools/call request
   * Executes code with AsyncFunction and timeout protection
   */
  private async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params;

    if (name !== 'execute_code') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32602,
          message: `Unknown tool: ${name}`,
        },
      };
    }

    const params = args as ExecuteCodeParams;
    const { code, timeout = 5000 } = params;

    // Validate timeout (cap at 30000ms)
    const actualTimeout = Math.min(timeout, 30000);

    try {
      const result = await this.executeCode(code, actualTimeout);

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: `Code execution failed: ${errorMessage}`,
          data: errorStack,
        },
      };
    }
  }

  /**
   * Execute TypeScript code with AsyncFunction (no VM2)
   * Timeout protection via Promise.race()
   *
   * Security: Extension Host provides sandbox, we trust our own code
   * Performance: Direct execution (no VM2 overhead)
   */
  private async executeCode(code: string, timeout: number): Promise<any> {
    this.logger.info(
      `Executing code (timeout: ${timeout}ms)`,
      'CodeExecutionMCP',
      {
        codePreview: code.substring(0, 100),
      }
    );

    // Create async function with ptah API in scope
    // AsyncFunction constructor pattern: new AsyncFunction('argName', 'functionBody')
     
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;
    const asyncFunction = new AsyncFunction(
      'ptah',
      `
      'use strict';
      ${code}
    `
    ) as (ptah: PtahAPI) => Promise<any>;

    // Execute with timeout protection
    const executionPromise = asyncFunction(this.ptahAPI);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Execution timeout (${timeout}ms)`)),
        timeout
      );
    });

    try {
      const result = await Promise.race([executionPromise, timeoutPromise]);

      this.logger.info('Code execution successful', 'CodeExecutionMCP', {
        resultType: typeof result,
      });

      return result;
    } catch (error) {
      this.logger.error(
        'Code execution failed',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Dispose of server resources
   */
  dispose(): void {
    this.stop();
  }
}
