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
import {
  isFileLockTimeoutError,
  withMcpConfigLock,
} from '@ptah-extension/harness-sync';
import {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
} from './http-server.handler';

/** Why the `ptah` entry is not on disk. */
export type McpRegistrationFailure =
  /** The HTTP server is not running, or is being torn down. */
  | 'not-started'
  /** No workspace folder is open, so there is no `.mcp.json` to write. */
  | 'no-workspace'
  /**
   * Another process held the config-file lock past its deadline, so the write
   * was REFUSED rather than performed unlocked (TASK_2026_332). Distinct from
   * `write-failed` because it is transient by construction and a retry a moment
   * later is expected to succeed.
   */
  | 'lock-timeout'
  /** The read-modify-write itself failed (permissions, unparseable JSON, …). */
  | 'write-failed';

/**
 * The outcome of {@link CodeExecutionMCP.ensureRegisteredForSubagents}.
 *
 * **`registered: false` is a normal, expected answer and callers must read it.**
 * Every caller already threads an `mcpServerRunning` boolean into the session it
 * is about to start; that boolean is only honest if it is ANDed with this one.
 * Reporting "the server is up" while the entry a subagent reads is absent means
 * the subagent spawns believing it has Ptah tools and silently has none.
 */
export interface McpSubagentRegistration {
  /** True only when a `ptah` entry is on disk for the CURRENT workspace. */
  registered: boolean;
  /** Present exactly when `registered` is false. */
  reason?: McpRegistrationFailure;
}

const REGISTERED: McpSubagentRegistration = { registered: true };

function notRegistered(
  reason: McpRegistrationFailure,
): McpSubagentRegistration {
  return { registered: false, reason };
}

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

  /**
   * The tail of the re-pointing queue. Every `.mcp.json` OWNERSHIP mutation
   * this service performs joins it, so no two of them can interleave.
   *
   * `withMcpConfigLock` cannot do this job and adding a second lock would not
   * either: it is keyed per FILE, and the racing mutations here target
   * DIFFERENT files. Two concrete failures it cannot see (TASK_2026_332):
   *
   *  a. The user switches workspace A -> B -> C quickly. Both re-points read
   *     `registeredMcpJsonPath` as A — the first has not finished updating it
   *     when the second starts — and then write B and C independently. B is
   *     left with a live `ptah` entry pointing at a server that no longer
   *     serves B, and nothing ever removes it.
   *  b. `stop()` arrives right after a switch. The stop unregisters A while the
   *     outstanding event writes B, so B ends up advertising a dead port.
   *
   * So the queue is over the OPERATION, not the file, and it has two rules:
   *
   *  - **Serialized.** A job reads `registeredMcpJsonPath` only after every
   *    previously queued job has finished updating it. That alone kills the
   *    stale-read half of (a).
   *  - **Latest wins.** Each re-point captures {@link repointGeneration} and is
   *    dropped before it touches disk if a newer request has superseded it, so
   *    the intermediate workspace in (a) is never written at all. `stop()`
   *    bumps the generation as well, which is what cancels (b).
   */
  private mcpOpQueue: Promise<void> = Promise.resolve();

  /** Monotonic request counter; only the newest re-point is allowed to run. */
  private repointGeneration = 0;

  /**
   * True between `stop()` and the next `start()`. Re-points enqueued in that
   * window are dropped rather than superseded: the generation guard covers work
   * queued BEFORE the stop, and this covers a folder event that fires while the
   * stop is still draining.
   */
  private stopped = false;

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
    // The event has nowhere to return a promise to, so this call site stays
    // fire-and-forget — but it is no longer UNORDERED. `queueRepoint` puts it
    // behind every other `.mcp.json` mutation and lets a later change, or a
    // `stop()`, supersede it before it writes. See `mcpOpQueue`.
    this.workspaceFoldersSubscription =
      this.workspaceProvider.onDidChangeWorkspaceFolders(() => {
        void this.queueRepoint();
      });
  }

  /**
   * Run `job` after every `.mcp.json` mutation already queued on this instance.
   *
   * Mirrors `harness-sync`'s `serializeByKey`: the chain is kept alive past a
   * rejection so one failed mutation cannot poison the next one. The jobs here
   * already catch and log their own failures; the chain must not depend on that
   * staying true.
   */
  private enqueueMcpOp<T>(job: () => Promise<T>): Promise<T> {
    const run = this.mcpOpQueue.then(job, job);
    this.mcpOpQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Enqueue a re-point for the workspace as it stands when the job actually
   * RUNS, and drop the job if a newer request has landed in the meantime.
   */
  private queueRepoint(): Promise<void> {
    const generation = ++this.repointGeneration;
    return this.enqueueMcpOp(async () => {
      // Superseded while queued — a later workspace change, or a `stop()`, has
      // already asked for a different final state. Writing the intermediate one
      // here is exactly the entry that gets stranded.
      if (this.stopped || generation !== this.repointGeneration) return;
      try {
        await this.syncMcpJsonRegistration();
      } catch (error: unknown) {
        this.logger.warn(
          `[CodeExecutionMCP] Failed to re-point .mcp.json after a workspace change: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'CodeExecutionMCP',
        );
      }
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

    // A restart re-arms re-pointing that `stop()` disabled.
    this.stopped = false;

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
   *
   * It joins the same queue as the workspace-change re-points (see
   * `mcpOpQueue`), so an explicit registration and a folder event cannot both
   * capture the same "from" root and then write two different files. The
   * returned promise still resolves only once THIS call's write has landed.
   *
   * **It resolves with an outcome instead of rejecting, and the outcome is not
   * optional to read** (TASK_2026_332). It used to resolve with `undefined`
   * whatever happened, because both mutation helpers swallowed every failure
   * into a warn — so a lock timeout, which means the entry was deliberately NOT
   * written, was indistinguishable from success at every call site. A rejection
   * was rejected as the shape because three of the five callers have no local
   * catch and would abort a whole chat session over a two-second contention on
   * a config file; `mcpServerRunning: false` is the honest degraded mode the SDK
   * path already supports. AND this result into the `mcpServerRunning` you pass
   * to the session.
   */
  async ensureRegisteredForSubagents(): Promise<McpSubagentRegistration> {
    return this.enqueueMcpOp(() => this.ensureRegisteredNow());
  }

  /** The body of {@link ensureRegisteredForSubagents}, already serialized. */
  private async ensureRegisteredNow(): Promise<McpSubagentRegistration> {
    // `stop()` nulls `this.port` in its own continuation, OUTSIDE the queue, so
    // the port can still be non-null here for a registration that queued right
    // behind the stop's unregister. Writing an entry for a server being torn
    // down is exactly the dead-port entry this task exists to remove.
    if (this.stopped || !this.port) return notRegistered('not-started');

    const target = this.getMcpJsonPath();
    if (!target) return notRegistered('no-workspace');
    if (
      this.registeredMcpJsonPath === target &&
      this.registeredPort === this.port
    ) {
      return REGISTERED;
    }

    if (this.registeredMcpJsonPath && this.registeredMcpJsonPath !== target) {
      // A failed removal must NOT be followed by a write into the new file:
      // that leaves a live entry in both, and overwrites the record of the
      // stale one so nothing can ever clean it up. Report and let the next call
      // retry the whole move.
      const removalFailure = await this.unregisterFromMcpJson();
      if (removalFailure !== null) return notRegistered(removalFailure);
    }
    return this.registerInMcpJson(target, this.port);
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
   *
   * **Call it only from inside `enqueueMcpOp`** (`queueRepoint` is the one
   * caller). It reads `registeredMcpJsonPath` and then awaits twice, so running
   * two of these concurrently is the stale-read race the queue exists to close.
   */
  private async syncMcpJsonRegistration(): Promise<void> {
    if (this.registeredMcpJsonPath === null) return;

    const target = this.getMcpJsonPath();
    if (target === this.registeredMcpJsonPath) return;

    // Same rule as `ensureRegisteredNow`: if the old entry could not be
    // removed, do not write a second one somewhere else. Both helpers log their
    // own failure, and the next re-point or `ensureRegisteredForSubagents`
    // retries the move.
    if ((await this.unregisterFromMcpJson()) !== null) return;
    if (target && this.port) {
      await this.registerInMcpJson(target, this.port);
    }
  }

  /**
   * Stop MCP server and clean up resources.
   *
   * The two statements before the unregister are the cancellation half of
   * TASK_2026_332 and are not bookkeeping: without them a re-point that was
   * queued a moment earlier still runs, and writes a `ptah` entry into the new
   * workspace pointing at the port this call is about to close.
   */
  async stop(): Promise<void> {
    // Drop re-points queued after this point...
    this.stopped = true;
    // ...and supersede the ones already queued before it.
    this.repointGeneration++;

    // Joins the queue rather than jumping it: a re-point that already STARTED
    // has to finish, or this would remove the entry from the file it recorded
    // and the re-point would then write a fresh one into another.
    await this.enqueueMcpOp(() => this.unregisterFromMcpJson());

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
  ): Promise<McpSubagentRegistration> {
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
      return REGISTERED;
    } catch (error: unknown) {
      // A lock timeout is NOT an ordinary I/O failure and must not be folded
      // into the same branch. `harness-sync` refuses the write when another
      // process holds the config file past the deadline (TASK_2026_332), which
      // means the entry is definitely absent and definitely retryable — as
      // opposed to an EACCES, which is likely to fail the same way next time.
      if (isFileLockTimeoutError(error)) {
        this.logger.warn(
          `[CodeExecutionMCP] Did not register in .mcp.json — another process ` +
            `held the config lock: ${error.message}`,
          'CodeExecutionMCP',
        );
        return notRegistered('lock-timeout');
      }
      this.logger.warn(
        `[CodeExecutionMCP] Failed to register in .mcp.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'CodeExecutionMCP',
      );
      return notRegistered('write-failed');
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
   *
   * Returns `null` on success — including the "we owned nothing" case — and the
   * failure reason otherwise, so a caller that was about to write somewhere ELSE
   * can decline rather than leave a live entry in two files.
   */
  private async unregisterFromMcpJson(): Promise<McpRegistrationFailure | null> {
    const mcpJsonPath = this.registeredMcpJsonPath;
    if (!mcpJsonPath) return null;

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
      return null;
    } catch (error: unknown) {
      // Distinguished for the same reason registration distinguishes it, and
      // with a sharper consequence: a lock timeout means the entry is STILL ON
      // DISK, pointing at a port that may be about to die. `clearRegistration`
      // is deliberately skipped on every failure path, so the record survives
      // and a later `stop()` or re-point retries the removal.
      if (isFileLockTimeoutError(error)) {
        this.logger.warn(
          `[CodeExecutionMCP] Did not unregister from ${mcpJsonPath} — another ` +
            `process held the config lock; the ptah entry is still on disk: ${error.message}`,
          'CodeExecutionMCP',
        );
        return 'lock-timeout';
      }
      this.logger.warn(
        `[CodeExecutionMCP] Failed to unregister from .mcp.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'CodeExecutionMCP',
      );
      return 'write-failed';
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
