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
import type { McpServerConfig } from '@ptah-extension/shared';
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
  HARNESS_SYNC_TOKENS,
  PTAH_SPAWN_MCP_KEY,
  type IHarnessCliDetector,
} from '@ptah-extension/harness-sync';
import {
  startHttpServer,
  stopHttpServer,
  getConfiguredPort,
} from './http-server.handler';
import {
  planPtahMcpSlots,
  ptahMcpEntry,
  CLAUDE_TARGET,
  type PtahMcpSlot,
} from './ptah-mcp-slots';

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

/** The shape of the `ptah` key this service owns inside `.mcp.json`. */
interface McpHttpServerEntry {
  type: 'http';
  url: string;
}

/**
 * True when the `ptah` key already on disk is exactly the entry we would write.
 *
 * Structural rather than `JSON.stringify` equality: a hand-edited file may
 * carry the same two fields in the other order, and rewriting it for that would
 * be the same spurious diff this check exists to avoid. An entry carrying EXTRA
 * keys is deliberately treated as different — we own this key, and leaving
 * someone else's additions in place would mean advertising a server config we
 * did not author.
 */
function isSameMcpHttpEntry(
  existing: unknown,
  desired: McpHttpServerEntry,
): boolean {
  if (typeof existing !== 'object' || existing === null) return false;
  const entry = existing as Record<string, unknown>;
  const keys = Object.keys(entry);
  return (
    keys.length === 2 &&
    entry['type'] === desired.type &&
    entry['url'] === desired.url
  );
}

/**
 * True when the `ptah` entry a FACET-written config file already declares is
 * exactly the one we would write.
 *
 * Compared through the facet's PARSED form rather than raw bytes, so one
 * predicate serves dialects that spell the same entry differently — `url`
 * versus `serverUrl`, a fenced TOML table in Codex. The read-compare exists to
 * keep an idempotent restart from rewriting a config file it does not need to
 * touch.
 *
 * A stdio entry can never be ours — Ptah's server is always an HTTP endpoint —
 * so it compares unequal and is overwritten.
 */
function isSameFacetEntry(
  existing: McpServerConfig | undefined,
  desired: McpServerConfig,
): boolean {
  if (existing === undefined) return false;
  if (existing.type === 'stdio' || desired.type === 'stdio') return false;
  return existing.type === desired.type && existing.url === desired.url;
}

/** A `ptah` entry we wrote, and everything needed to take it back. */
interface OwnedRegistration {
  readonly port: number;
  readonly slot: PtahMcpSlot;
}

@injectable()
export class CodeExecutionMCP implements IDisposable, IMcpServerStatus {
  private server: http.Server | null = null;
  private port: number | null = null;
  private ptahAPI: PtahAPI;
  private toolResultCallback: ToolResultCallback | undefined;

  /**
   * Every MCP config file we currently own a `ptah` entry in, keyed by absolute
   * path. Empty when we own no entry anywhere.
   *
   * **One entry per OPEN workspace folder, not one for the active root**
   * (TASK_2026_354). This used to be a single `registeredMcpJsonPath` slot, so
   * the set of files we owned was always "the active workspace" — and on
   * Electron `setActiveFolder()` fires `onDidChangeWorkspaceFolders`, which
   * `workspace:switch` calls on every tab switch. The result was a
   * unregister-from-A + register-into-B pair on every switch between two
   * ALREADY-OPEN folders, i.e. a write into a file inside the user's
   * version-controlled repository for a change that altered nothing they could
   * observe (six such moves in `tmp/logs/log.log`).
   *
   * **And one entry per rival CLI, not just `.mcp.json`.** Ptah's own server
   * used to be persisted for Claude alone; every other CLI received it
   * in-process at spawn time, so a `codex` the USER launched saw none of it.
   * See `ptah-mcp-slots.ts` for which files that is and why the scope differs
   * per target.
   *
   * Keyed by path, and per-path, for two more reasons:
   *  - A folder that is open needs the entry, whether or not it is the one on
   *    screen: a subagent spawned for that folder reads ITS `.mcp.json`.
   *  - A failed removal keeps its own record, so a write into a different
   *    folder can no longer destroy the evidence of a stale entry. That was the
   *    single-slot hazard TASK_2026_332 had to work around by coupling the two
   *    mutations together; with per-path records the coupling is unnecessary
   *    and would only produce false negatives.
   *
   * The slot is stored beside the port because removal must go through the same
   * facet the write used. Re-deriving it at removal time would ask the CURRENT
   * workspace which files we own, which is the second half of the A3 defect
   * `unregisterFromSlot` documents.
   */
  private readonly registrations = new Map<string, OwnedRegistration>();

  /**
   * The tail of the re-pointing queue. Every `.mcp.json` OWNERSHIP mutation
   * this service performs joins it, so no two of them can interleave.
   *
   * `withMcpConfigLock` cannot do this job and adding a second lock would not
   * either: it is keyed per FILE, and the racing mutations here target
   * DIFFERENT files. Two concrete failures it cannot see (TASK_2026_332):
   *
   *  a. The user switches workspace A -> B -> C quickly. Both reconciles read
   *     the registration record as {A} — the first has not finished updating it
   *     when the second starts — and then write B and C independently. B is
   *     left with a live `ptah` entry for a folder that is no longer open, and
   *     nothing ever removes it.
   *  b. `stop()` arrives right after a switch. The stop unregisters A while the
   *     outstanding event writes B, so B ends up advertising a dead port.
   *
   * So the queue is over the OPERATION, not the file, and it has two rules:
   *
   *  - **Serialized.** A job reads {@link registrations} only after every
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

    /**
     * Which rival CLIs are installed, used to gate the two HOME-scoped slots.
     *
     * Optional so a bare container still starts a server; absent means no
     * home-global file is written, which is the conservative answer. All three
     * hosts register `HARNESS_SYNC_TOKENS.CLI_DETECTOR` during DI setup, and
     * this class is a lazily-constructed singleton resolved when the server
     * starts, so the token exists by then even where `registerHarnessSyncServices`
     * runs AFTER `registerVsCodeLmToolsServices` (the VS Code host does).
     */
    @inject(HARNESS_SYNC_TOKENS.CLI_DETECTOR, { isOptional: true })
    private readonly cliDetector: IHarnessCliDetector | undefined,
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
   * Register the Ptah MCP server in the `.mcp.json` of every OPEN workspace
   * folder, for subagent discovery. Callers gate this on the MCP server
   * actually being up (`mcpServerRunning`) — Ptah's local features, including
   * MCP tool access, are available to everyone.
   *
   * Idempotent per (path, port), twice over: a folder already recorded at this
   * port is skipped without taking the lock, and a folder whose file already
   * holds the exact desired entry is left byte-for-byte alone. A folder that
   * has LEFT the workspace has its entry removed in the same pass; a switch
   * between two open folders changes the folder set not at all and therefore
   * writes nothing (TASK_2026_354).
   *
   * The outcome describes the ACTIVE workspace root, because that is the root
   * the caller is about to start a session in. The other open folders are
   * reconciled in the same pass and report through the log.
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

    const activeTarget = this.getMcpJsonPath();
    if (!activeTarget) {
      // No folder open: nothing to register in, and anything we still own
      // belongs to a folder that has gone away.
      await this.reconcileRegistrations(this.port);
      return notRegistered('no-workspace');
    }

    const outcomes = await this.reconcileRegistrations(this.port);
    // The reported outcome is the ACTIVE root's `.mcp.json` and nothing else,
    // because that is what the callers do with it: they AND it into the
    // `mcpServerRunning` they pass to a Claude session, whose subagents read
    // exactly that file. A contended `~/.codex/config.toml` must not make a
    // Claude session report itself tool-less; those slots report through the
    // log instead.
    const active = outcomes.get(activeTarget);
    if (active !== undefined) return active;
    // `planPtahMcpSlots` always yields a claude slot for the active root, so
    // the lookup hits. Reaching here means it did not, and returning REGISTERED
    // on that would be the false assurance TASK_2026_332 removed.
    return notRegistered('no-workspace');
  }

  /**
   * Bring the set of MCP config files we own into line with the set of slots
   * that should currently exist, at `port`.
   *
   * Removals first, then registrations — not for correctness (the paths are
   * disjoint by construction, since a path is only removed when it is NOT in
   * the desired set) but so a shrinking workspace gives its entries back before
   * anything else touches disk.
   *
   * Unlike the single-slot version this replaces, a failed removal does NOT
   * block the registrations. Each path carries its own record, so the stale
   * entry stays known and is retried by the next reconcile or by `stop()`;
   * refusing to register the folder the user is actually working in, because an
   * unrelated closed folder's file was contended, would report
   * `mcpServerRunning: false` for a session that has a perfectly good entry.
   * The same independence now covers a whole TARGET: a contended
   * `~/.codex/config.toml` costs Codex its entry and costs Claude nothing.
   *
   * **Call it only from inside `enqueueMcpOp`.** It reads {@link registrations}
   * and then awaits, so two concurrent runs are the stale-read race the queue
   * exists to close.
   */
  private async reconcileRegistrations(
    port: number,
  ): Promise<Map<string, McpSubagentRegistration>> {
    const desired = await this.desiredSlots();
    const outcomes = new Map<string, McpSubagentRegistration>();

    for (const owned of [...this.registrations.keys()]) {
      if (desired.has(owned)) continue;
      await this.unregisterFromSlot(owned);
    }

    for (const [configPath, slot] of desired) {
      if (this.registrations.get(configPath)?.port === port) {
        outcomes.set(configPath, REGISTERED);
        continue;
      }
      outcomes.set(configPath, await this.registerInSlot(slot, port));
    }

    return outcomes;
  }

  /**
   * Every slot Ptah should own right now, keyed by config path.
   *
   * A detector failure is not fatal here: `planPtahMcpSlots` gates only the
   * home-scoped targets on it, so the workspace files are planned either way.
   */
  private async desiredSlots(): Promise<Map<string, PtahMcpSlot>> {
    const slots = await planPtahMcpSlots({
      workspaceRoots: [
        ...this.workspaceProvider.getWorkspaceFolders(),
        this.workspaceProvider.getWorkspaceRoot() ?? '',
      ],
      isInstalled: (target) =>
        this.cliDetector?.isInstalled(target) ?? Promise.resolve(false),
    });
    return new Map(slots.map((slot) => [slot.configPath, slot]));
  }

  /**
   * Reconcile after the workspace folders changed.
   *
   * Only runs when we already own an entry: a host that never called
   * `ensureRegisteredForSubagents` must not start touching the user's disk just
   * because they opened a folder (the Bug #9 rule that
   * `unregisterFromMcpJson` also enforces).
   *
   * Going to ZERO folders is a real case — the desired set is empty, every
   * owned entry is removed and none is written back, which is what stops a
   * dead-port entry outliving the workspace it was written into.
   *
   * A switch between folders that are BOTH open reaches here (the Electron
   * provider fires the folder event from `setActiveFolder`) and finds the
   * desired set unchanged, so it writes nothing.
   *
   * **Call it only from inside `enqueueMcpOp`** (`queueRepoint` is the one
   * caller).
   */
  private async syncMcpJsonRegistration(): Promise<void> {
    if (this.registrations.size === 0) return;
    if (this.port === null) return;

    await this.reconcileRegistrations(this.port);
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
    await this.enqueueMcpOp(() => this.unregisterFromAllSlots());

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
   * Declare the Ptah MCP server in one target's config file.
   *
   * For Claude this is what lets SUBAGENTS reach Ptah at all: only the parent
   * SDK session gets the server through the programmatic `Options.mcpServers`,
   * and a spawned subagent reads `.mcp.json`. For every other target it is what
   * lets a CLI the USER launched reach Ptah, which nothing did before — the
   * spawn adapters hand the server over in-process, so it existed only inside
   * threads Ptah itself started.
   *
   * **The write goes through `harness-sync`'s facet, never a hand-rolled
   * read-modify-write.** The facet owns the path, the dialect (`url` versus
   * `serverUrl`, a `type` discriminant for VS Code only, a fenced TOML table
   * for Codex), the atomic write and — critically — the per-config-file lock.
   * That lock is what makes this safe beside the reconciler, which writes the
   * same files for the user's OWN installed servers: two unserialized
   * read-modify-writes lose an entry silently, with no torn file to notice.
   *
   * Ownership is unchanged by the widening. `ptah` (`PTAH_SPAWN_MCP_KEY`) is
   * this service's key for as long as the HTTP server is up; the reconciler
   * never writes or reaps it, because its desired state is the user's durable
   * `~/.ptah/mcp-installed.json` and this key is in neither that nor any
   * manifest.
   */
  private async registerInSlot(
    slot: PtahMcpSlot,
    port: number,
  ): Promise<McpSubagentRegistration> {
    try {
      const wrote =
        slot.target === CLAUDE_TARGET
          ? await this.writeMcpJsonEntry(slot.configPath, port)
          : await this.writeFacetEntry(slot, port);

      this.registrations.set(slot.configPath, { port, slot });
      if (wrote) {
        this.logger.info(
          `[CodeExecutionMCP] Registered ptah for ${slot.target} in ${slot.configPath} (port ${port})`,
          'CodeExecutionMCP',
        );
      }
      return REGISTERED;
    } catch (error: unknown) {
      // A lock timeout is NOT an ordinary I/O failure and must not be folded
      // into the same branch. `harness-sync` refuses the write when another
      // process holds the config file past the deadline (TASK_2026_332), which
      // means the entry is definitely absent and definitely retryable — as
      // opposed to an EACCES, which is likely to fail the same way next time.
      if (isFileLockTimeoutError(error)) {
        this.logger.warn(
          `[CodeExecutionMCP] Did not register for ${slot.target} — another process ` +
            `held the config lock: ${error.message}`,
          'CodeExecutionMCP',
        );
        return notRegistered('lock-timeout');
      }
      this.logger.warn(
        `[CodeExecutionMCP] Failed to register for ${slot.target} in ${slot.configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'CodeExecutionMCP',
      );
      return notRegistered('write-failed');
    }
  }

  /**
   * Write the `ptah` key into `{ws}/.mcp.json`.
   *
   * **Deliberately NOT routed through `createMcpFacet('claude')`, unlike every
   * other target.** The facet is the right writer for a server the RECONCILER
   * installs, and it is a different writer from this one in a way that shows on
   * disk: `includeType: false` means it emits `{ url }`, while this key has been
   * `{ type, url }` in every `.mcp.json` Ptah has ever written. Switching would
   * rewrite that entry in every existing user's repository to say the same
   * thing differently, for no capability — Ptah's own server reached Claude
   * perfectly well before this task. The gap being closed is the CLIs that had
   * NO persistent registration at all, and none of them is this file.
   *
   * It is still one writer per file: `.mcp.json` is written here and by the
   * reconciler, both under `withMcpConfigLock`, and they own disjoint keys.
   *
   * Returns whether anything was written.
   */
  private async writeMcpJsonEntry(
    mcpJsonPath: string,
    port: number,
  ): Promise<boolean> {
    const desiredEntry: McpHttpServerEntry = {
      type: 'http',
      url: `http://localhost:${port}`,
    };
    let wrote = false;

    // `harness-sync` also writes this file (it is the `claude` target's MCP
    // facet), so the read-modify-write below runs inside that lib's
    // config-file lock (TASK_2026_318). Atomicity is NOT the same problem:
    // a temp+rename guarantees no reader sees half a file and guarantees
    // nothing about two writers that each READ, each edit their own key and
    // each write their own copy back — the second write wins whole and the
    // first key is gone, silently.
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

      // Read-COMPARE-write. The entry on disk is frequently already the one
      // we want — a restart that reused the port, a second host, a reconcile
      // that changed nothing — and rewriting a file inside the user's
      // repository to the bytes it already holds is a spurious VCS diff and a
      // spurious log line (TASK_2026_354).
      if (isSameMcpHttpEntry(servers['ptah'], desiredEntry)) return;

      servers['ptah'] = desiredEntry;
      config['mcpServers'] = servers;

      fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
      wrote = true;
    });

    return wrote;
  }

  /**
   * Write the `ptah` key into a rival CLI's config file, through its facet.
   *
   * The facet owns the path, the dialect (`url` versus `serverUrl`, a fenced
   * TOML table for Codex), the atomic write and — critically — the
   * per-config-file lock. Hand-rolling any of that here would make this a
   * second writer with a second idea of the format, which is the failure
   * `AntigravityCliAdapter` already documents.
   *
   * The read-compare is OUTSIDE the facet's lock. That is sound for THIS key
   * and would not be for a user's server: a stale read can only cost one
   * redundant write, never a lost update, because the write itself is the
   * facet's own read-modify-write under the lock and it touches one key.
   *
   * Returns whether anything was written.
   */
  private async writeFacetEntry(
    slot: PtahMcpSlot,
    port: number,
  ): Promise<boolean> {
    const desired = ptahMcpEntry(port);
    const existing = slot.facet
      .readAll(slot.workspaceRoot)
      .get(PTAH_SPAWN_MCP_KEY);
    if (isSameFacetEntry(existing, desired)) return false;

    await slot.facet.write(slot.workspaceRoot, PTAH_SPAWN_MCP_KEY, desired);
    return true;
  }

  /**
   * Give back every entry we still own. Used by `stop()`, where the server is
   * about to close and no config file should keep advertising its port.
   *
   * Failures are already logged per path and deliberately do not abort the
   * loop: one contended file must not strand the entries in the others.
   */
  private async unregisterFromAllSlots(): Promise<void> {
    for (const owned of [...this.registrations.keys()]) {
      await this.unregisterFromSlot(owned);
    }
  }

  /**
   * Remove the Ptah MCP server entry from one config file we actually wrote.
   * Prevents stale entries pointing to a dead server.
   *
   * Takes the slot from {@link registrations}, NOT by re-deriving it. Resolving
   * the current workspace root here was the second half of the A3 defect: after
   * a workspace switch (or after the last folder was removed) it either edited
   * the wrong repository or gave up entirely, leaving the written entry behind.
   *
   * Returns `null` on success — including the "we did not own this path" case —
   * and the failure reason otherwise. On failure the record is deliberately
   * KEPT, so `stop()` or the next reconcile retries the removal.
   */
  private async unregisterFromSlot(
    configPath: string,
  ): Promise<McpRegistrationFailure | null> {
    const owned = this.registrations.get(configPath);
    if (owned === undefined) return null;

    try {
      const removed =
        owned.slot.target === CLAUDE_TARGET
          ? await this.removeMcpJsonEntry(configPath)
          : await this.removeFacetEntry(owned.slot);

      this.registrations.delete(configPath);
      if (removed) {
        this.logger.info(
          `[CodeExecutionMCP] Unregistered ptah for ${owned.slot.target} from ${configPath}`,
          'CodeExecutionMCP',
        );
      }
      return null;
    } catch (error: unknown) {
      // Distinguished for the same reason registration distinguishes it, and
      // with a sharper consequence: a lock timeout means the entry is STILL ON
      // DISK, pointing at a port that may be about to die. The record is
      // deliberately left in `registrations` on every failure path, so it
      // survives and a later `stop()` or reconcile retries the removal.
      if (isFileLockTimeoutError(error)) {
        this.logger.warn(
          `[CodeExecutionMCP] Did not unregister from ${configPath} — another ` +
            `process held the config lock; the ptah entry is still on disk: ${error.message}`,
          'CodeExecutionMCP',
        );
        return 'lock-timeout';
      }
      this.logger.warn(
        `[CodeExecutionMCP] Failed to unregister from ${configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'CodeExecutionMCP',
      );
      return 'write-failed';
    }
  }

  /**
   * Take the `ptah` key back out of `{ws}/.mcp.json`.
   *
   * Under the same lock as the write, and for the same reason — see
   * {@link writeMcpJsonEntry}. The whole read/check/delete/write is one
   * critical section: deciding `ptah` is present and then removing it are two
   * halves of one decision, and a reconcile landing between them would be
   * written over by the copy read before it.
   */
  private removeMcpJsonEntry(mcpJsonPath: string): Promise<boolean> {
    return withMcpConfigLock(mcpJsonPath, async () => {
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
  }

  /** Take the `ptah` key back out of a rival CLI's config, through its facet. */
  private async removeFacetEntry(slot: PtahMcpSlot): Promise<boolean> {
    const present = slot.facet
      .readAll(slot.workspaceRoot)
      .has(PTAH_SPAWN_MCP_KEY);
    if (!present) return false;
    await slot.facet.remove(slot.workspaceRoot, PTAH_SPAWN_MCP_KEY);
    return true;
  }

  /**
   * Get the path to .mcp.json in the ACTIVE workspace folder.
   *
   * Used only to decide which slot {@link ensureRegisteredForSubagents} reports
   * on. The full set actually written is {@link desiredSlots}.
   */
  private getMcpJsonPath(): string | null {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) return null;
    return path.join(workspaceRoot, '.mcp.json');
  }
}
