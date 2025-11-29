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
import type { WebviewManager } from '@ptah-extension/vscode-core';
import type { PermissionResponse } from '@ptah-extension/shared';
import { PtahAPIBuilder } from './ptah-api-builder.service';
import { PermissionPromptService } from '../permission/permission-prompt.service';
import {
  PtahAPI,
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
  ExecuteCodeParams,
  ApprovalPromptParams,
} from './types';

@injectable()
export class CodeExecutionMCP implements vscode.Disposable {
  private server: http.Server | null = null;
  private port: number | null = null;
  private ptahAPI: PtahAPI;

  constructor(
    @inject(TOKENS.PTAH_API_BUILDER)
    private readonly apiBuilder: PtahAPIBuilder,

    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,

    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,

    @inject(TOKENS.PERMISSION_PROMPT_SERVICE)
    private readonly permissionPromptService: PermissionPromptService,

    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager
  ) {
    // Build ptah API once at construction (reused for all executions)
    this.ptahAPI = this.apiBuilder.buildAPI();
  }

  /**
   * Start HTTP MCP server on configured localhost port (default: 51820)
   * Stores port in workspace state for Claude CLI discovery
   */
  async start(): Promise<number> {
    if (this.server) {
      this.logger.warn('CodeExecutionMCP already started', 'CodeExecutionMCP');
      return this.port!;
    }

    // Get configured port (default: 51820)
    const configuredPort = this.getConfiguredPort();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Listen on configured port instead of random port
      this.server.listen(configuredPort, 'localhost', () => {
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

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        // Enhanced error handling for port conflicts
        if (error.code === 'EADDRINUSE') {
          const errorMsg = `Failed to start MCP server on port ${configuredPort}. Port is already in use. Please change 'ptah.mcpPort' setting to use a different port.`;
          this.logger.error(errorMsg, error);

          // Show user-friendly notification
          vscode.window.showErrorMessage(errorMsg);

          reject(new Error(errorMsg));
        } else {
          this.logger.error('CodeExecutionMCP server error', error);
          reject(error);
        }
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
   * Get MCP server port from VS Code configuration
   * Default: 51820 (chosen to avoid common port conflicts)
   */
  private getConfiguredPort(): number {
    return vscode.workspace
      .getConfiguration('ptah')
      .get<number>('mcpPort', 51820);
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
   * Supports: initialize, tools/list, tools/call
   */
  private async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
    this.logger.info(`MCP Request: ${request.method}`, 'CodeExecutionMCP', {
      id: request.id,
    });

    try {
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);

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
   * Handle initialize request
   * Required by MCP protocol - must respond with server capabilities
   */
  private handleInitialize(request: MCPRequest): MCPResponse {
    this.logger.info('MCP initialize request received', 'CodeExecutionMCP', {
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
   * Returns two tools: execute_code and approval_prompt
   */
  private handleToolsList(request: MCPRequest): MCPResponse {
    const toolDefinition: MCPToolDefinition = {
      name: 'execute_code',
      description: this.buildToolDescription(),
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'TypeScript/JavaScript code to execute. Has access to "ptah" global object with 11 namespaces. ' +
              'All methods are async. Code is auto-wrapped for execution - all patterns work:\n' +
              '• Simple: `await ptah.workspace.getInfo()` or `ptah.workspace.getInfo()`\n' +
              '• With variables: `const info = await ptah.workspace.getInfo(); return info;`\n' +
              '• IIFE (any style): `(async () => { return await ptah.git.getStatus(); })()`\n' +
              '• Direct return: `return "hello"`\n' +
              'Results are automatically extracted from Promises. No special syntax required.',
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
        tools: [toolDefinition, this.getApprovalPromptTool()],
      },
    };
  }

  /**
   * Build comprehensive tool description with full API reference
   * This helps Claude understand all available capabilities
   */
  private buildToolDescription(): string {
    return `Execute TypeScript/JavaScript code with access to VS Code extension APIs via the global "ptah" object.

## Available Namespaces (11 total)

### ptah.workspace - Workspace Analysis
- analyze(): Promise<{info, structure}> - Full workspace analysis
- getInfo(): Promise<WorkspaceInfo> - Project metadata
- getProjectType(): Promise<string> - Detected type (React, Angular, Node, etc.)
- getFrameworks(): Promise<string[]> - Detected frameworks

### ptah.search - File Discovery
- findFiles(pattern: string, limit?: number): Promise<FileInfo[]> - Glob pattern search
- getRelevantFiles(query: string, maxFiles?: number): Promise<FileInfo[]> - Semantic file search

### ptah.symbols - Code Symbol Search
- find(name: string, type?: string): Promise<SymbolInfo[]> - Find symbols (class, function, method, interface, variable)

### ptah.diagnostics - Errors & Warnings
- getErrors(): Promise<DiagnosticInfo[]> - All error-level diagnostics
- getWarnings(): Promise<DiagnosticInfo[]> - All warning-level diagnostics
- getAll(): Promise<DiagnosticInfo[]> - All diagnostics with severity

### ptah.git - Repository Status
- getStatus(): Promise<{branch, modified, staged, untracked}> - Git working tree status

### ptah.ai - VS Code Language Model API
- chat(message: string, model?: string): Promise<string> - Send message to VS Code LM
- selectModel(family?: string): Promise<ModelInfo[]> - List available models

### ptah.files - File Operations
- read(path: string): Promise<string> - Read file contents as UTF-8
- list(directory: string): Promise<{name, type}[]> - List directory contents

### ptah.commands - VS Code Commands
- execute(commandId: string, ...args): Promise<any> - Execute VS Code command
- list(): Promise<string[]> - List ptah.* commands

### ptah.context - Token Budget Management (NEW)
- optimize(query: string, maxTokens?: number): Promise<OptimizedContext> - Select files within token budget
- countTokens(text: string): Promise<number> - Count tokens in text
- getRecommendedBudget(projectType): number - Get recommended budget for project type

### ptah.project - Project Analysis (NEW)
- detectMonorepo(): Promise<{isMonorepo, type, workspaceFiles, packageCount}> - Detect monorepo tool
- detectType(): Promise<string> - Detect project type
- analyzeDependencies(): Promise<{name, version, isDev}[]> - Analyze package dependencies

### ptah.relevance - File Ranking (NEW)
- scoreFile(filePath: string, query: string): Promise<{file, score, reasons}> - Score single file relevance
- rankFiles(query: string, limit?: number): Promise<{file, score, reasons}[]> - Rank files by relevance

## Usage Examples

\`\`\`typescript
// Get workspace overview
const {info, structure} = await ptah.workspace.analyze();
return {projectType: info.projectType, frameworks: info.frameworks};

// Find authentication-related files with relevance scores
const files = await ptah.relevance.rankFiles('authentication handler', 10);
return files.map(f => ({file: f.file, score: f.score, why: f.reasons}));

// Optimize context for a task within token budget
const optimized = await ptah.context.optimize('implement user auth', 100000);
return {selected: optimized.selectedFiles.length, tokens: optimized.totalTokens};

// Check for TypeScript errors
const errors = await ptah.diagnostics.getErrors();
return errors.filter(e => e.file.endsWith('.ts'));

// Detect monorepo structure
const mono = await ptah.project.detectMonorepo();
if (mono.isMonorepo) return {type: mono.type, packages: mono.packageCount};

// Read and analyze a specific file
const content = await ptah.files.read('/path/to/file.ts');
return {lines: content.split('\\n').length, chars: content.length};
\`\`\``;
  }

  /**
   * Get approval_prompt tool definition
   * Allows Claude CLI to request user permission via VS Code UI
   */
  private getApprovalPromptTool(): MCPToolDefinition {
    return {
      name: 'approval_prompt',
      description:
        'Request user permission to execute a tool via VS Code dialog. ' +
        'Called by Claude CLI when permission is needed for tool execution. ' +
        'Returns approval decision with optional updated input parameters.',
      inputSchema: {
        type: 'object',
        properties: {
          tool_name: {
            type: 'string',
            description: 'Name of the tool requesting permission',
          },
          input: {
            type: 'object',
            description: 'Input parameters for the tool',
          },
          tool_use_id: {
            type: 'string',
            description: 'Unique tool use request ID',
          },
        },
        required: ['tool_name', 'input'],
      },
    };
  }

  /**
   * Handle tools/call request
   * Routes to execute_code or approval_prompt handlers
   */
  private async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params;

    if (name === 'execute_code') {
      return await this.handleExecuteCode(request, args as ExecuteCodeParams);
    }

    if (name === 'approval_prompt') {
      return await this.handleApprovalPrompt(
        request,
        args as ApprovalPromptParams
      );
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32602,
        message: `Unknown tool: ${name}`,
      },
    };
  }

  /**
   * Handle execute_code tool call
   * Executes TypeScript code with AsyncFunction and timeout protection
   */
  private async handleExecuteCode(
    request: MCPRequest,
    params: ExecuteCodeParams
  ): Promise<MCPResponse> {
    const { code, timeout = 5000 } = params;

    // Validate timeout (cap at 30000ms)
    const actualTimeout = Math.min(timeout, 30000);

    try {
      const result = await this.executeCode(code, actualTimeout);

      // Safely serialize result - handle undefined, null, and circular references
      let textResult: string;
      if (result === undefined) {
        textResult = 'undefined';
      } else if (result === null) {
        textResult = 'null';
      } else if (typeof result === 'string') {
        textResult = result;
      } else {
        try {
          textResult = JSON.stringify(result, null, 2);
        } catch (serializeError) {
          // Handle circular references or other serialization errors
          textResult = String(result);
        }
      }

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
   * Handle approval_prompt tool call
   * Requests user permission via VS Code webview UI
   *
   * Flow:
   * 1. Create permission request
   * 2. Send to webview for user interaction
   * 3. Wait for response via Promise-based resolver
   * 4. Format MCP response per Claude CLI expectations
   */
  private async handleApprovalPrompt(
    request: MCPRequest,
    params: ApprovalPromptParams
  ): Promise<MCPResponse> {
    this.logger.debug('Handling approval_prompt', { params });

    // 1. Create permission request
    const permissionRequest =
      this.permissionPromptService.createRequest(params);

    // 2. Create Promise that will be resolved when user responds
    const responsePromise = new Promise<PermissionResponse>((resolve) => {
      this.permissionPromptService.setPendingResolver(
        permissionRequest.id,
        resolve,
        permissionRequest
      );
    });

    // 3. Send to webview via WebviewManager
    // The webview is registered as 'ptah.main' in angular-webview.provider.ts
    await this.webviewManager.sendMessage(
      'ptah.main',
      'permission:request',
      permissionRequest
    );

    // 4. Wait for user response (or timeout)
    const response = await responsePromise;

    // 5. Format MCP response based on user decision
    if (response.decision === 'allow' || response.decision === 'always_allow') {
      this.logger.info('Permission granted', {
        id: response.id,
        decision: response.decision,
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                behavior: 'allow',
                updatedInput: params.input,
              }),
            },
          ],
        },
      };
    } else {
      this.logger.info('Permission denied', {
        id: response.id,
        reason: response.reason,
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                behavior: 'deny',
                message: response.reason || 'User denied permission',
              }),
            },
          ],
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
    //
    // SMART CODE WRAPPING: We analyze the code to determine the best execution strategy.
    //
    // Supported patterns (all work automatically):
    // 1. Simple expressions: `ptah.workspace.getInfo()` -> auto-wrapped with return
    // 2. Direct returns: `return "hello"` -> used as-is
    // 3. IIFE with async function: `(async function() {...})()` -> result awaited
    // 4. IIFE with arrow function: `(async () => {...})()` -> result awaited
    // 5. Multi-statement with variables: `const x = 1; return x;` -> wrapped in async IIFE
    // 6. Async method calls: `await ptah.workspace.getInfo()` -> executed in async context

    const AsyncFunction = Object.getPrototypeOf(
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async function () {}
    ).constructor;

    const wrappedCode = this.wrapCodeForExecution(code);

    this.logger.debug('Wrapped code for execution', 'CodeExecutionMCP', {
      original: code.substring(0, 100),
      wrapped: wrappedCode.substring(0, 150),
    });

    const asyncFunction = new AsyncFunction(
      'ptah',
      `
      'use strict';
      ${wrappedCode}
    `
    ) as (ptah: PtahAPI) => Promise<any>;

    // Execute with timeout protection
    let executionPromise = asyncFunction(this.ptahAPI);

    // Handle nested Promises (from IIFEs that return Promises)
    // Keep unwrapping until we get a non-Promise value
    executionPromise = executionPromise.then(async (result: any) => {
      // Unwrap up to 3 levels of Promise nesting (safety limit)
      let unwrapped = result;
      for (
        let i = 0;
        i < 3 && unwrapped && typeof unwrapped.then === 'function';
        i++
      ) {
        unwrapped = await unwrapped;
      }
      return unwrapped;
    });
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
   * Smart code wrapping for execution
   *
   * Analyzes the code pattern and wraps it appropriately:
   * - Simple expressions -> add `return`
   * - Already has return -> use as-is
   * - IIFE expressions -> add `return` to capture result
   * - Multi-statement code -> wrap in async IIFE
   * - Variable declarations at top level -> wrap in async IIFE
   */
  private wrapCodeForExecution(code: string): string {
    const trimmed = code.trim();

    // Pattern 1: Already starts with 'return' - use as-is
    if (/^return\s/.test(trimmed)) {
      return code;
    }

    // Pattern 2: IIFE pattern (async function or arrow function)
    // Matches: (async function() {...})() or (async () => {...})() or (() => {...})()
    const iifePattern =
      /^\((?:async\s+)?(?:function\s*\(|(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>)/;
    if (iifePattern.test(trimmed)) {
      // It's an IIFE - add return to capture the Promise result
      return `return ${code}`;
    }

    // Pattern 3: Starts with variable declaration (const, let, var)
    // These need to be wrapped in an IIFE to work
    if (/^(const|let|var)\s/.test(trimmed)) {
      // Check if there's a return statement somewhere
      if (/\breturn\b/.test(trimmed)) {
        // Has return - wrap in async IIFE
        return `return (async function() { ${code} })()`;
      } else {
        // No return - try to detect last expression and return it
        // Split by semicolon and return the last non-empty statement
        const statements = trimmed
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s);
        if (statements.length > 0) {
          const lastStatement = statements[statements.length - 1];
          // Check if last statement is a variable reference or expression
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(lastStatement)) {
            // Last statement is just a variable name - return it
            return `return (async function() { ${trimmed}; return ${lastStatement}; })()`;
          }
        }
        // Just wrap it and hope for the best
        return `return (async function() { ${code} })()`;
      }
    }

    // Pattern 4: Contains 'await' at the start - it's an async expression
    if (/^await\s/.test(trimmed)) {
      return `return ${code}`;
    }

    // Pattern 5: Multiple statements (contains semicolon not at end)
    // Check if it's multi-statement code
    const withoutStrings = trimmed.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ''); // Remove string literals
    if (withoutStrings.includes(';') && !withoutStrings.endsWith(';')) {
      // Multiple statements without trailing semicolon - wrap in IIFE
      return `return (async function() { ${code} })()`;
    }
    if ((withoutStrings.match(/;/g) || []).length > 1) {
      // More than one semicolon - definitely multi-statement
      return `return (async function() { ${code} })()`;
    }

    // Pattern 6: Simple expression - just add return
    // This handles: ptah.workspace.getInfo(), "hello", 42, etc.
    return `return ${code}`;
  }

  /**
   * Dispose of server resources
   */
  dispose(): void {
    this.stop();
  }
}
