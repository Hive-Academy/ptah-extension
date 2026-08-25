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
  IMcpServerStatus,
} from '@ptah-extension/platform-core';
import {
  PtahAPIBuilder,
  IDE_CAPABILITIES_TOKEN,
} from '../ptah-api-builder.service';
import { type IIDECapabilities } from '../namespace-builders';
import { PermissionPromptService } from '../../permission/permission-prompt.service';
import { PtahAPI } from '../types';
import { handleMCPRequest, type ToolResultCallback } from '../mcp-core';
import { withMcpConfigLock } from '@ptah-extension/harness-sync';
import {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
} from './http-server.handler';

@injectable()
export class CodeExecutionMCP implements IDisposable, IMcpServerStatus {
  private server: http.Server | null = null;
  private port: number | null = null;
  private ptahAPI: PtahAPI;
  private toolResultCallback: ToolResultCallback | undefined;

  /**
   * The `.mcp.json` path we actually wrote a `ptah` entry into, or `null` when
   * we currently own no entry anywhere.
   *
   * This replaces a `registeredInMcpJson` boolean, which was wrong twice over:
   * it made registration one-shot (so the SECOND workspace of a session never
   * got an entry and subagents spawned there could not discover this server),
   * and it left `unregisterFromMcpJson` with no record of WHERE it had written
   * — so it re-resolved the CURRENT workspace root and stranded a dead-port
   * entry in the repository it had actually touched.
   */
  private registeredMcpJsonPath: string | null = null;

  /** The port recorded in `registeredMcpJsonPath`, for re-write on port change. */
  private registeredPort: number | null = null;

  private readonly workspaceFoldersSubscription: IDisposable;

  private readonly hasIDECapabilities: boolean;
  private readonly hasSqliteLayer: boolean;

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

    @inject(TOKENS.WEBVIEW_MANAGER, { isOptional: true })
    private readonly webviewManager: WebviewManager | undefined,

    @inject(IDE_CAPABILITIES_TOKEN, { isOptional: true })
    ideCapabilities: IIDECapabilities | undefined,
  ) {
    this.hasIDECapabilities = ideCapabilities !== undefined;
    this.hasSqliteLayer = this.apiBuilder.hasSymbolAndMemoryLayer();
    this.ptahAPI = this.apiBuilder.build();
    // The event has nowhere to return a promise to, so this one call site is
    // genuinely fire-and-forget. Nothing waits on the re-point: it only moves
    // an entry that is already correct for the workspace being left.
    this.workspaceFoldersSubscription =
      this.workspaceProvider.onDidChangeWorkspaceFolders(() => {
        void this.syncMcpJsonRegistration().catch((error: unknown) => {
          this.logger.warn(
            `[CodeExecutionMCP] Failed to re-point .mcp.json after a workspace change: ${
              error instanceof Error ? error.message : error
            }`,
            'CodeExecutionMCP',
          );
        });
      });
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
          hasIDECapabilities: this.hasIDECapabilities,
          hasSqliteLayer: this.hasSqliteLayer,
          disabledMcpNamespaces:
            this.workspaceProvider.getConfiguration<string[]>(
              'ptah',
              'agentOrchestration.disabledMcpNamespaces',
              [],
            ) ?? [],
        }),
    });

    this.server = result.server;
    this.port = result.port;

    return this.port;
  }

  /**
   * Register the Ptah MCP server in the workspace's .mcp.json for subagent discovery.
   * Callers gate this on the MCP server actually being up (`mcpServerRunning`) —
   * Ptah's local features, including MCP tool access, are available to everyone.
   *
   * Idempotent per (path, port): repeated calls against the same workspace and
   * the same port write nothing. A call after the workspace root changed moves
   * the entry — the old file's `ptah` key is removed before the new file gets
   * one, so exactly one repository on disk ever advertises this server.
   *
   * **Await it before spawning anything that reads `.mcp.json`.** It became
   * async in TASK_2026_318 because the write now takes the config-file lock,
   * and the callers that start a session immediately afterwards
   * (`ChatSessionService`, `ChatPtahCliService`, `GatewayChatBridge`) depend on
   * the entry being on disk before the subagent looks for it. Fire-and-forget
   * here is a race, not an optimisation.
   */
  async ensureRegisteredForSubagents(): Promise<void> {
    if (!this.port) return;

    const target = this.getMcpJsonPath();
    if (!target) return;
    if (
      this.registeredMcpJsonPath === target &&
      this.registeredPort === this.port
    ) {
      return;
    }

    if (this.registeredMcpJsonPath && this.registeredMcpJsonPath !== target) {
      await this.unregisterFromMcpJson();
    }
    await this.registerInMcpJson(target, this.port);
  }

  /**
   * Re-point the `.mcp.json` entry after the workspace folders changed.
   *
   * Only runs when we already own an entry: a host that never called
   * `ensureRegisteredForSubagents` must not start touching the user's disk
   * just because they opened a folder (the Bug #9 rule that
   * `unregisterFromMcpJson` also enforces).
   *
   * Going to ZERO folders is a real case — `getMcpJsonPath()` returns null and
   * we unregister without re-registering, which is what stops a dead-port entry
   * outliving the workspace it was written into.
   */
  private async syncMcpJsonRegistration(): Promise<void> {
    if (this.registeredMcpJsonPath === null) return;

    const target = this.getMcpJsonPath();
    if (target === this.registeredMcpJsonPath) return;

    await this.unregisterFromMcpJson();
    if (target && this.port) {
      await this.registerInMcpJson(target, this.port);
    }
  }

  /**
   * Stop MCP server and clean up resources
   */
  async stop(): Promise<void> {
    await this.unregisterFromMcpJson();
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
   * Dispose of server resources (IDisposable contract — synchronous).
   *
   * Prefer disposeAsync() when the caller can await cleanup. This sync form
   * kicks off stop() and surfaces any teardown error to the logger instead
   * of silently swallowing it (which is what happened when dispose() simply
   * called this.stop() without handling the returned promise).
   */
  dispose(): void {
    this.disposeAsync().catch((error) => {
      this.logger.error(
        '[CodeExecutionMCP] Error during dispose',
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  }

  /**
   * Async dispose — await this when the caller can wait for HTTP server
   * shutdown to complete before proceeding (e.g., during app quit).
   */
  async disposeAsync(): Promise<void> {
    this.workspaceFoldersSubscription.dispose();
    await this.stop();
  }

  /**
   * Register the Ptah MCP server in the workspace's .mcp.json file.
   * This enables subagents (separate processes spawned by the Task tool)
   * to discover and connect to the Ptah MCP server automatically.
   *
   * Without this, only the parent SDK session has access to Ptah tools via
   * the programmatic `Options.mcpServers` config — subagents get nothing.
   */
  private async registerInMcpJson(
    mcpJsonPath: string,
    port: number,
  ): Promise<void> {
    try {
      // `harness-sync` also writes this file (it is the `claude` target's MCP
      // facet), so the read-modify-write below runs inside that lib's
      // config-file lock (TASK_2026_318). Atomicity is NOT the same problem:
      // a temp+rename guarantees no reader sees half a file and guarantees
      // nothing about two writers that each READ, each edit their own key and
      // each write their own copy back — the second write wins whole and the
      // first key is gone, silently.
      //
      // This is the same borrow `AntigravityCliAdapter` makes on
      // `~/.gemini/config/mcp_config.json`: the MECHANISM comes from
      // `harness-sync`, the POLICY stays here. Recording an intent for the
      // reconciler to write instead would be wrong — `ptah` is an ephemeral
      // per-session localhost port, and the reconciler's desired state is the
      // user's DURABLE `~/.ptah/mcp-installed.json`, which it fans out to every
      // detected CLI.
      await withMcpConfigLock(mcpJsonPath, async () => {
        // Read-merge-write, deliberately. `.mcp.json` is a USER-OWNED file that
        // may hold hand-authored servers; only the `ptah` key is ours to touch
        // and a blocking writeFileSync over it has no undo.
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
      });
      this.registeredMcpJsonPath = mcpJsonPath;
      this.registeredPort = port;
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
   * Remove the Ptah MCP server entry from the `.mcp.json` we actually wrote.
   * Prevents stale entries pointing to a dead server.
   *
   * Targets `registeredMcpJsonPath`, NOT `getMcpJsonPath()`. Re-resolving the
   * current workspace root here was the second half of the A3 defect: after a
   * workspace switch (or after the last folder was removed) it either edited
   * the wrong repository or gave up entirely, leaving the written entry behind.
   */
  private async unregisterFromMcpJson(): Promise<void> {
    const mcpJsonPath = this.registeredMcpJsonPath;
    if (!mcpJsonPath) return;

    try {
      // Under the same lock as registration, and for the same reason — see
      // `registerInMcpJson`. The whole read/check/delete/write is one critical
      // section: deciding `ptah` is present and then removing it are two halves
      // of one decision, and a reconcile landing between them would be written
      // over by the copy read before it.
      const removed = await withMcpConfigLock(mcpJsonPath, async () => {
        if (!fs.existsSync(mcpJsonPath)) return false;

        const content = fs.readFileSync(mcpJsonPath, 'utf-8');
        const config = JSON.parse(content) as Record<string, unknown>;
        const servers = (config['mcpServers'] as Record<string, unknown>) || {};

        if (!('ptah' in servers)) return false;

        // Same read-merge-write contract as registration: every other key in
        // the user's file — their own servers included — is written back
        // untouched.
        delete servers['ptah'];
        config['mcpServers'] = servers;

        fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
        return true;
      });

      this.clearRegistration();
      if (removed) {
        this.logger.info(
          `[CodeExecutionMCP] Unregistered ptah from ${mcpJsonPath}`,
          'CodeExecutionMCP',
        );
      }
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
   * Forget the entry we own. Called only once the `ptah` key is provably gone
   * from disk (removed, or the file/key was already absent). A write failure
   * deliberately leaves the record intact so a later `stop()` retries.
   */
  private clearRegistration(): void {
    this.registeredMcpJsonPath = null;
    this.registeredPort = null;
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
