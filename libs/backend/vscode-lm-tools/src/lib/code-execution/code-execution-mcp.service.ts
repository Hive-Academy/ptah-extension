/**
 * Code Execution MCP Server
 *
 * HTTP MCP server providing "execute_code" and "approval_prompt" tools for Claude CLI.
 * Implements JSON-RPC 2.0 protocol over HTTP transport.
 *
 * This is a thin orchestrator that delegates to specialized handlers:
 * - http-server.handler: HTTP server lifecycle and request handling
 * - protocol-handlers: MCP JSON-RPC protocol implementation
 * - code-execution.engine: TypeScript code execution with timeout
 * - approval-prompt.handler: User permission flow via webview
 * - tool-description.builder: Tool definitions and descriptions
 *
 * Pattern: Injectable service with HTTP server lifecycle
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { WebviewManager } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IStateStorage,
  IDisposable,
} from '@ptah-extension/platform-core';
import { PtahAPIBuilder } from './ptah-api-builder.service';
import { PermissionPromptService } from '../permission/permission-prompt.service';
import { PtahAPI } from './types';
import {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
  handleMCPRequest,
  type ToolResultCallback,
} from './mcp-handlers';

@injectable()
export class CodeExecutionMCP implements IDisposable {
  private server: http.Server | null = null;
  private port: number | null = null;
  private ptahAPI: PtahAPI;
  private toolResultCallback: ToolResultCallback | undefined;
  private registeredInMcpJson = false;

  constructor(
    @inject(TOKENS.PTAH_API_BUILDER)
    private readonly apiBuilder: PtahAPIBuilder,

    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,

    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)
    private readonly workspaceState: IStateStorage,

    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,

    @inject(TOKENS.PERMISSION_PROMPT_SERVICE)
    private readonly permissionPromptService: PermissionPromptService,

    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
  ) {
    // Build ptah API once at construction (reused for all executions)
    this.ptahAPI = this.apiBuilder.build();
  }

  /**
   * Start HTTP MCP server on configured localhost port (default: 51820)
   * Stores port in workspace state for Claude CLI discovery
   */
  async start(): Promise<number> {
    if (this.server) {
      this.logger.warn('CodeExecutionMCP already started', 'CodeExecutionMCP');
      return this.port as number;
    }

    const configuredPort = getConfiguredPort(this.workspaceProvider);

    const result = await startHttpServer({
      port: configuredPort,
      logger: this.logger,
      workspaceState: this.workspaceState,
      onMCPRequest: (request) =>
        handleMCPRequest(request, {
          ptahAPI: this.ptahAPI,
          permissionPromptService: this.permissionPromptService,
          webviewManager: this.webviewManager,
          logger: this.logger,
          onToolResult: this.toolResultCallback,
        }),
    });

    this.server = result.server;
    this.port = result.port;

    return this.port;
  }

  /**
   * Register the Ptah MCP server in the workspace's .mcp.json for subagent discovery.
   * Call this ONLY after confirming premium status — free/community users must not
   * have Ptah MCP tools injected into their subagents.
   *
   * Idempotent: safe to call multiple times (registers only once).
   */
  ensureRegisteredForSubagents(): void {
    if (this.registeredInMcpJson || !this.port) return;
    this.registerInMcpJson(this.port);
    this.registeredInMcpJson = true;
  }

  /**
   * Stop MCP server and clean up resources
   */
  async stop(): Promise<void> {
    this.unregisterFromMcpJson();
    await stopHttpServer(this.server, this.workspaceState, this.logger);
    this.server = null;
    this.port = null;
  }

  /**
   * Get current server port (for testing)
   */
  getPort(): number | null {
    return this.port;
  }

  /**
   * Set callback for tool result notifications.
   * Used by agentic analysis to stream tool results to the frontend.
   */
  setToolResultCallback(callback: ToolResultCallback): void {
    this.toolResultCallback = callback;
  }

  /**
   * Clear the tool result callback.
   */
  clearToolResultCallback(): void {
    this.toolResultCallback = undefined;
  }

  /**
   * Dispose of server resources
   */
  dispose(): void {
    this.stop();
  }

  /**
   * Register the Ptah MCP server in the workspace's .mcp.json file.
   * This enables subagents (separate processes spawned by the Task tool)
   * to discover and connect to the Ptah MCP server automatically.
   *
   * Without this, only the parent SDK session has access to Ptah tools via
   * the programmatic `Options.mcpServers` config — subagents get nothing.
   */
  private registerInMcpJson(port: number): void {
    const mcpJsonPath = this.getMcpJsonPath();
    if (!mcpJsonPath) return;

    try {
      let config: Record<string, unknown> = {};
      if (fs.existsSync(mcpJsonPath)) {
        const content = fs.readFileSync(mcpJsonPath, 'utf-8');
        config = JSON.parse(content);
      }

      const servers = (config['mcpServers'] as Record<string, unknown>) || {};
      servers['ptah'] = {
        type: 'http',
        url: `http://localhost:${port}`,
      };
      config['mcpServers'] = servers;

      fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
      this.logger.info(
        `[CodeExecutionMCP] Registered ptah in ${mcpJsonPath} (port ${port})`,
        'CodeExecutionMCP',
      );
    } catch (error) {
      this.logger.warn(
        `[CodeExecutionMCP] Failed to register in .mcp.json: ${
          error instanceof Error ? error.message : error
        }`,
        'CodeExecutionMCP',
      );
    }
  }

  /**
   * Remove the Ptah MCP server entry from .mcp.json on shutdown.
   * Prevents stale entries pointing to a dead server.
   */
  private unregisterFromMcpJson(): void {
    const mcpJsonPath = this.getMcpJsonPath();
    if (!mcpJsonPath) return;

    try {
      if (!fs.existsSync(mcpJsonPath)) return;

      const content = fs.readFileSync(mcpJsonPath, 'utf-8');
      const config = JSON.parse(content) as Record<string, unknown>;
      const servers = (config['mcpServers'] as Record<string, unknown>) || {};

      if (!('ptah' in servers)) return;

      delete servers['ptah'];
      config['mcpServers'] = servers;

      fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
      this.logger.info(
        '[CodeExecutionMCP] Unregistered ptah from .mcp.json',
        'CodeExecutionMCP',
      );
    } catch (error) {
      this.logger.warn(
        `[CodeExecutionMCP] Failed to unregister from .mcp.json: ${
          error instanceof Error ? error.message : error
        }`,
        'CodeExecutionMCP',
      );
    }
  }

  /**
   * Get the path to .mcp.json in the first workspace folder.
   */
  private getMcpJsonPath(): string | null {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) return null;
    return path.join(workspaceRoot, '.mcp.json');
  }
}
