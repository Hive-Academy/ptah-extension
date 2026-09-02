/**
 * Agent Process Manager
 *
 * Responsibilities:
 * - Spawn CLI agent processes (codex, copilot)
 * - Track process state, output buffers, timeouts
 * - Enforce concurrent agent limits
 * - Graceful shutdown on extension deactivation
 * - Cross-platform process termination (SIGTERM/taskkill)
 */
import { injectable, inject } from 'tsyringe';
import {
  HARNESS_PREFLIGHT_TOKEN,
  type IHarnessPreflight,
} from '@ptah-extension/agent-sdk';
import { ChildProcess } from 'child_process';
import { promises as fsPromises } from 'fs';
import { EventEmitter } from 'eventemitter3';
import {
  TOKENS,
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ICallerWorkspaceResolver,
  IMcpServerStatus,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ReasoningSettings } from '@ptah-extension/settings-core';
import {
  AgentId,
  AgentStatus,
  AgentProcessInfo,
  AgentOutputDelta,
  SpawnAgentRequest,
  SpawnAgentResult,
  AgentOutput,
  CliType,
  SYSTEM_CLI_TYPES,
  normalizeWorkspaceRoot,
} from '@ptah-extension/shared';
import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { CliDetectionService } from './cli-detection.service';
import type {
  CliCommandOptions,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';
import { killProcessTree } from './cli-adapters/cli-adapter.utils';
import {
  MAX_BUFFER_SIZE,
  DEFAULT_TIMEOUT,
  MAX_TIMEOUT,
  COMPLETED_AGENT_TTL,
  SDK_IDLE_RELEASE_MS,
  MIN_SDK_IDLE_RELEASE_MS,
  SDK_ABORT_SETTLE_MS,
  DISPOSE_RELEASE_TIMEOUT_MS,
  OUTPUT_FLUSH_INTERVAL,
  GRACEFUL_EXIT_DELAY_MS,
  MAX_ACCUMULATED_SEGMENTS,
  MAX_ACCUMULATED_STREAM_EVENTS,
  STREAM_EVENTS_CAP_SLACK,
  MAX_STDOUT_PERSISTENCE_SIZE,
  type PendingDelta,
  createEmptyPendingDelta,
  countNewlines,
  trimBufferToLowWater,
  tailLines,
  capStreamEvents,
  mergeConsecutiveTextSegments,
} from './agent-process-manager-helpers';

export const MIN_CONCURRENT_AGENTS = 1;
export const MAX_CONCURRENT_AGENTS = 20;
export const DEFAULT_CONCURRENT_AGENTS = 5;

/**
 * Shell metacharacters — kept for reference only.
 * spawn() is called WITHOUT shell:true, so args are passed directly
 * to the binary as a positional argument array. Shell injection is not
 * possible. Stripping these chars corrupts legitimate prompts containing
 * code characters ($, (), {}, backticks, etc.).
 */

export type AgentContinueErrorCode =
  | 'not_found'
  | 'unsupported'
  | 'busy'
  /**
   * The record is still here and still readable, but its SDK subprocess was
   * released after {@link SDK_IDLE_RELEASE_MS} of idling. In-process
   * continuation is gone; the CONVERSATION is not. Callers fall back to the
   * session-resume path using the agent's `cliSessionId` — the same recovery
   * `not_found` already takes.
   */
  | 'released'
  | 'unknown';

/** Why a subprocess was released — carried on the `agent:released` event. */
export type AgentReleaseReason = 'idle' | 'expired' | 'stopped' | 'disposed';

export class AgentContinueError extends Error {
  constructor(
    readonly code: AgentContinueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentContinueError';
  }
}

interface TrackedAgent {
  info: AgentProcessInfo;
  /** Child process for CLI-based agents, null for SDK-based agents */
  process: ChildProcess | null;
  sdkHandle?: SdkHandle;
  /** Abort controller for SDK-based agents (null/undefined for CLI agents) */
  sdkAbortController?: AbortController;
  stdoutBuffer: string;
  stderrBuffer: string;
  timeoutHandle: NodeJS.Timeout;
  stdoutLineCount: number;
  stderrLineCount: number;
  truncated: boolean;
  /** Guard against double handleExit (error + exit events firing) */
  hasExited: boolean;
  /** Cleanup timer handle for TTL-based removal from map */
  cleanupHandle?: NodeJS.Timeout;
  /** Deferred `agent:exited` emit timer (GRACEFUL_EXIT_DELAY); cleared if the
   * agent is re-opened via continueConversation so a stale exit from the prior
   * turn can't clobber the running continuation. */
  exitEmitHandle?: NodeJS.Timeout;
  /** Idle-release timer armed at exit for continuation-capable handles; cleared
   * when a continuation re-opens the agent. */
  idleReleaseHandle?: NodeJS.Timeout;
  /** Wall-clock ms at which the current idle window started, for the release log. */
  idleSince?: number;
  /** True once the SDK subprocess has been aborted and reaped. The record and
   * its buffers stay readable; only in-process continuation is gone. */
  subprocessReleased: boolean;
  /** Accumulated structured segments for persistence (capped at MAX_ACCUMULATED_SEGMENTS) */
  accumulatedSegments: CliOutputSegment[];
  /** Accumulated rich stream events for persistence (Ptah CLI only, capped at MAX_ACCUMULATED_STREAM_EVENTS) */
  accumulatedStreamEvents: FlatStreamEventUnion[];
  /** True once the stream-events cap has been logged — suppresses per-event log spam for long-running agents. */
  streamCapLogged: boolean;
}

@injectable()
export class AgentProcessManager {
  private readonly agents = new Map<string, TrackedAgent>();
  /** Counter for in-flight spawn operations (not yet in agents map) */
  private spawning = 0;
  /** Promise-based mutex to serialize spawn operations and prevent TOCTOU race in concurrent limit check */
  private spawnMutex: Promise<void> = Promise.resolve();

  /** EventEmitter for agent lifecycle events (spawned, output, exited) */
  readonly events = new EventEmitter();

  /** Pending output deltas per agent (throttled to OUTPUT_FLUSH_INTERVAL) */
  private readonly pendingDeltas = new Map<string, PendingDelta>();
  /** Flush timers per agent */
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();

  /** Allowlist an effort value to what Codex/Copilot accept (`max` → `xhigh`). */
  private mapEffortToCli(effort: string): string | undefined {
    switch (effort) {
      case 'low':
      case 'medium':
      case 'high':
      case 'xhigh':
      case 'minimal':
        return effort;
      case 'max':
        return 'xhigh';
      default:
        return undefined;
    }
  }

  /** Clamp a UI effort value onto the `low|medium|high` scale `agy` accepts. */
  private static mapEffortToAgy(effort: string): string | undefined {
    switch (effort) {
      case 'minimal':
      case 'low':
        return 'low';
      case 'medium':
        return 'medium';
      case 'high':
      case 'xhigh':
      case 'max':
        return 'high';
      default:
        return undefined;
    }
  }

  /** UI reasoning-effort selection drives Codex/Copilot; per-CLI config is the fallback. */
  private resolveReasoningEffort(cli: CliType): string | undefined {
    // Pi maps reasoning effort to `--thinking` and supports the full scale
    // (off|minimal|low|medium|high|xhigh|max), so the configured value flows
    // through raw — no in-chat driver and no `max`→`xhigh` coercion.
    if (cli === 'pi') {
      const piEffort =
        this.workspace.getConfiguration<string>(
          'ptah.agentOrchestration',
          'piReasoningEffort',
          '',
        ) ?? '';
      return piEffort || undefined;
    }
    // `agy --effort` takes low|medium|high only, and has no per-CLI config key
    // (the Antigravity settings pane is model-only), so the in-chat selection
    // is the sole driver and is clamped onto that three-value scale.
    if (cli === 'antigravity') {
      return AgentProcessManager.mapEffortToAgy(
        this.reasoningSettings.effort.get(),
      );
    }
    if (cli !== 'codex' && cli !== 'copilot') return undefined;
    const uiEffort = this.mapEffortToCli(this.reasoningSettings.effort.get());
    if (uiEffort) return uiEffort;
    const effortKey =
      cli === 'codex' ? 'codexReasoningEffort' : 'copilotReasoningEffort';
    const effort =
      this.workspace.getConfiguration<string>(
        'ptah.agentOrchestration',
        effortKey,
        '',
      ) ?? '';
    return this.mapEffortToCli(effort);
  }

  private resolveAutoApprove(cli: CliType): boolean | undefined {
    if (cli === 'codex') return undefined;
    if (cli !== 'copilot') return undefined;
    return this.workspace.getConfiguration<boolean>(
      'ptah.agentOrchestration',
      'copilotAutoApprove',
      true,
    );
  }

  private static readonly MODEL_CONFIG_KEYS: Partial<Record<CliType, string>> =
    {
      codex: 'codexModel',
      copilot: 'copilotModel',
      cursor: 'cursorModel',
      antigravity: 'antigravityModel',
      opencode: 'opencodeModel',
      pi: 'piModel',
    };

  private resolveConfiguredModel(
    cli: CliType,
    requestModel: string | undefined,
  ): string | undefined {
    if (requestModel) return requestModel;
    const configKey = AgentProcessManager.MODEL_CONFIG_KEYS[cli];
    if (!configKey) return requestModel;
    const configuredModel =
      this.workspace.getConfiguration<string>(
        'ptah.agentOrchestration',
        configKey,
        '',
      ) ?? '';
    return configuredModel || requestModel;
  }

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SETTINGS_TOKENS.REASONING_SETTINGS)
    private readonly reasoningSettings: ReasoningSettings,
    /**
     * A rival CLI reads the harness off DISK and has no other channel — no
     * system-prompt injection, no MCP fallback. If `{ws}/.agents/skills` is not
     * there when the process starts, the skills do not exist for that run.
     * Optional so a host without `harness-sync` spawns exactly as before.
     */
    @inject(HARNESS_PREFLIGHT_TOKEN, { isOptional: true })
    private readonly harnessPreflight: IHarnessPreflight | null = null,
    /**
     * Optional because CLI-only hosts do not start Ptah's in-process MCP server.
     * The port is the source of truth after deterministic fallback selection.
     */
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpServerStatus: IMcpServerStatus | null = null,
    /**
     * The calling MCP request's workspace root (TASK_2026_364). Optional:
     * only hosts that run the in-process HTTP MCP server (VS Code, Electron)
     * register an implementation. Unregistered — the CLI host and unit
     * tests — every resolution falls to the platform provider exactly as
     * before the port existed. Never import `vscode-lm-tools` here instead:
     * the dependency runs `vscode-lm-tools` → this lib, and inverting it is a
     * module-boundary error.
     */
    @inject(PLATFORM_TOKENS.CALLER_WORKSPACE_RESOLVER, { isOptional: true })
    private readonly callerWorkspaceResolver: ICallerWorkspaceResolver | null = null,
  ) {
    this.logger.info('[AgentProcessManager] Initialized');
  }

  /**
   * Spawn a new CLI agent process.
   *
   * Only the cap check and the slot reservation are serialized
   * ({@link reserveSpawnSlot}). CLI detection, working-directory validation,
   * the harness preflight and the SDK launch all run OUTSIDE the mutex, so a
   * slow spawn in one session cannot stall a spawn in another (TASK_2026_323
   * B10).
   */
  async spawn(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    await this.reserveSpawnSlot();
    try {
      return await this.doSpawn(request);
    } finally {
      this.spawning--;
    }
  }

  /**
   * Internal spawn implementation, wrapped by spawn() for concurrency tracking.
   *
   * Runs UNLOCKED and does NOT re-check the concurrent limit — the caller
   * already holds a reservation taken atomically in {@link reserveSpawnSlot}.
   * Re-checking here would double-count that reservation.
   */
  private async doSpawn(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    this.logger.info('[AgentProcessManager] Spawn request received', {
      requestedCli: request.cli ?? 'auto-detect',
      task:
        request.task.substring(0, 120) +
        (request.task.length > 120 ? '...' : ''),
      model: request.model,
      timeout: request.timeout,
      files: request.files?.length ?? 0,
      taskFolder: request.taskFolder,
    });
    const cli = request.cli ?? (await this.getPreferredCli());
    if (!cli) {
      throw new Error(
        'No CLI agent available. Install Codex CLI, Copilot, or Ptah CLI ' +
          'and authenticate before using agent orchestration.',
      );
    }

    this.logger.info('[AgentProcessManager] CLI resolved', {
      resolvedCli: cli,
      source: request.cli ? 'user-specified' : 'auto-detected',
    });
    const detection = await this.cliDetection.getDetection(cli);
    if (!detection || !detection.installed) {
      this.logger.error('[AgentProcessManager] CLI not installed', {
        cli,
        detection: detection
          ? {
              installed: detection.installed,
              path: detection.path,
              version: detection.version,
            }
          : 'no detection result',
      });
      throw new Error(
        `${cli} CLI is not installed. Install it and run authentication before using.`,
      );
    }
    const adapter = this.cliDetection.getAdapter(cli);
    if (!adapter) {
      throw new Error(`No adapter registered for CLI: ${cli}`);
    }

    this.logger.info('[AgentProcessManager] Adapter resolved', {
      cli,
      detectedVersion: detection.version,
      detectedPath: detection.path,
    });
    const workingDirectory =
      request.workingDirectory ?? this.getWorkspaceRoot();
    await this.validateWorkingDirectory(workingDirectory);
    // AFTER validation, BEFORE the process exists. `workingDirectory` may be a
    // sub-package of a monorepo (E14) — the preflight resolves it to the
    // workspace root, which is where every CLI-discoverable directory lives.
    await this.runHarnessPreflight(workingDirectory);
    const mcpPort =
      adapter.supportsMcp !== false ? await this.resolveMcpPort() : undefined;
    return this.doSpawnSdk(
      adapter.runSdk.bind(adapter),
      request,
      request.task,
      workingDirectory,
      cli,
      adapter.displayName,
      detection.path,
      mcpPort,
    );
  }

  /**
   * Spawn an SDK-based agent using adapter.runSdk() instead of child_process.spawn().
   * SDK agents have process: null and use AbortController for cancellation.
   */
  private async doSpawnSdk(
    runSdk: (options: CliCommandOptions) => Promise<SdkHandle>,
    request: SpawnAgentRequest,
    task: string,
    workingDirectory: string,
    cli: CliType,
    displayName: string,
    binaryPath?: string,
    mcpPort?: number,
  ): Promise<SpawnAgentResult> {
    const agentId = AgentId.create();
    const startedAt = new Date().toISOString();
    const resolvedModel = this.resolveConfiguredModel(cli, request.model);

    const info: AgentProcessInfo = {
      agentId,
      cli,
      task: request.task,
      workingDirectory,
      taskFolder: request.taskFolder,
      status: 'running',
      startedAt,
      parentSessionId: request.parentSessionId,
      displayName,
      model: resolvedModel,
      ...(request.resumeSessionId
        ? { cliSessionId: request.resumeSessionId }
        : {}),
    };

    this.logger.info('[AgentProcessManager] Spawning SDK agent', {
      agentId,
      cli,
      workingDirectory,
      model: resolvedModel,
    });

    if (request.resumeSessionId && request.cli !== 'copilot') {
      this.logger.warn(
        `[AgentProcessManager] resume_session_id provided for ${request.cli} which does not support session resume`,
      );
    }

    const sdkHandle = await runSdk({
      task,
      workingDirectory,
      files: request.files,
      taskFolder: request.taskFolder,
      model: resolvedModel,
      binaryPath,
      mcpPort,
      resumeSessionId: request.resumeSessionId,
      projectGuidance: request.projectGuidance,
      systemPrompt: request.systemPrompt,
      reasoningEffort: this.resolveReasoningEffort(cli),
      autoApprove: this.resolveAutoApprove(cli),
    });
    const initialCliSessionId = sdkHandle.getSessionId?.();
    const infoWithSession = initialCliSessionId
      ? { ...info, cliSessionId: initialCliSessionId }
      : info;

    const timeout = Math.min(request.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

    return this.trackSdkHandle(sdkHandle, infoWithSession, timeout, () =>
      sdkHandle.getSessionId?.(),
    );
  }

  /**
   * Spawn an agent from a pre-built SdkHandle (e.g., custom agent).
   * Same lifecycle management as doSpawnSdk() but skips CLI detection.
   *
   * Like {@link spawn}, only the cap check and the slot reservation are
   * serialized; the working-directory validation and the tracking wire-up run
   * outside the mutex (TASK_2026_323 B10).
   */
  async spawnFromSdkHandle(
    sdkHandle: SdkHandle,
    meta: {
      task: string;
      cli: CliType;
      workingDirectory: string;
      taskFolder?: string;
      parentSessionId?: string;
      ptahCliName?: string;
      ptahCliId?: string;
      timeout?: number;
      resumedFromAgentId?: string;
      /** Resume session ID. Pre-sets cliSessionId on the agent:spawned event
       *  so the frontend can deduplicate agent cards by CLI session. */
      resumeSessionId?: string;
    },
  ): Promise<SpawnAgentResult> {
    await this.reserveSpawnSlot();
    try {
      await this.validateWorkingDirectory(meta.workingDirectory);

      const agentId = AgentId.create();
      const startedAt = new Date().toISOString();

      const info: AgentProcessInfo = {
        agentId,
        cli: meta.cli,
        task: meta.task,
        workingDirectory: meta.workingDirectory,
        taskFolder: meta.taskFolder,
        status: 'running',
        startedAt,
        parentSessionId: meta.parentSessionId,
        displayName: meta.ptahCliName,
        ptahCliName: meta.ptahCliName,
        ptahCliId: meta.ptahCliId,
        resumedFromAgentId: meta.resumedFromAgentId,
        ...(meta.resumeSessionId ? { cliSessionId: meta.resumeSessionId } : {}),
      };
      const initialCliSessionId = sdkHandle.getSessionId?.();
      const infoWithSession = initialCliSessionId
        ? { ...info, cliSessionId: initialCliSessionId }
        : info;

      const timeout = Math.min(meta.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

      this.logger.info('[AgentProcessManager] Spawned agent from SdkHandle', {
        agentId,
        cli: meta.cli,
        ptahCliName: meta.ptahCliName,
        ptahCliId: meta.ptahCliId,
      });

      return this.trackSdkHandle(sdkHandle, infoWithSession, timeout, () =>
        sdkHandle.getSessionId?.(),
      );
    } finally {
      this.spawning--;
    }
  }

  /**
   * Wire an SdkHandle for lifecycle tracking: timeout, output capture, exit handling.
   *
   * Shared by doSpawnSdk() and spawnFromSdkHandle() to eliminate duplicated
   * tracking logic (~80% of each method was identical).
   *
   * @param sdkHandle   - SDK handle to track
   * @param info        - Agent process info (agentId, cli, task, etc.)
   * @param timeout     - Timeout in milliseconds
   * @param captureSessionId - Optional callback to capture CLI session ID
   *   from async init events (e.g., the init JSONL segment). Called on
   *   each structured segment until a session ID is captured.
   */
  private trackSdkHandle(
    sdkHandle: SdkHandle,
    info: AgentProcessInfo,
    timeout: number,
    captureSessionId?: () => string | undefined,
  ): SpawnAgentResult {
    const agentId = info.agentId;
    const timeoutHandle = this.unrefTimer(
      setTimeout(() => {
        this.handleTimeout(agentId);
      }, timeout),
    );
    const supportsContinuation = sdkHandle.supportsContinuation?.() === true;
    const trackedInfo: AgentProcessInfo = supportsContinuation
      ? { ...info, supportsContinuation: true }
      : info;
    const tracked: TrackedAgent = {
      info: trackedInfo,
      process: null,
      sdkHandle,
      sdkAbortController: sdkHandle.abort,
      stdoutBuffer: '',
      stderrBuffer: '',
      timeoutHandle,
      stdoutLineCount: 0,
      stderrLineCount: 0,
      truncated: false,
      hasExited: false,
      subprocessReleased: false,
      accumulatedSegments: [],
      accumulatedStreamEvents: [],
      streamCapLogged: false,
    };

    this.agents.set(agentId, tracked);
    sdkHandle.setAgentId?.(agentId);
    sdkHandle.onOutput((data: string) => {
      this.appendBuffer(agentId, 'stdout', data);
    });
    if (sdkHandle.onSegment) {
      sdkHandle.onSegment((segment: CliOutputSegment) => {
        this.accumulateSegment(agentId, segment);
        if (captureSessionId) {
          const sessionId = captureSessionId();
          if (sessionId && sessionId !== tracked.info.cliSessionId) {
            tracked.info = { ...tracked.info, cliSessionId: sessionId };
          }
        }
      });
    }
    if (sdkHandle.onStreamEvent) {
      sdkHandle.onStreamEvent((event: FlatStreamEventUnion) => {
        this.accumulateStreamEvent(agentId, event);
      });
    }
    if (sdkHandle.onSessionResolved) {
      sdkHandle.onSessionResolved((sessionId: string) => {
        if (sessionId && sessionId !== tracked.info.cliSessionId) {
          tracked.info = { ...tracked.info, cliSessionId: sessionId };
        }
      });
    }
    sdkHandle.done.then(
      (exitCode) => {
        this.handleExit(agentId, exitCode, null);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('[AgentProcessManager] SDK agent error', {
          agentId,
          error: message,
        });
        this.handleExit(agentId, 1, null);
      },
    );

    const spawnResult: SpawnAgentResult = {
      agentId,
      cli: info.cli,
      status: 'running',
      startedAt: info.startedAt,
      cliSessionId: info.cliSessionId,
      ptahCliName: info.ptahCliName,
      ptahCliId: info.ptahCliId,
    };

    this.events.emit('agent:spawned', tracked.info);
    this.markParentSubagentsAsCliAgent(info.parentSessionId);

    return spawnResult;
  }

  /**
   * Get the status of a specific agent, or of every agent in the caller's
   * workspace.
   *
   * The list is scoped (TASK_2026_364): agents whose `workingDirectory` lies
   * outside the caller's resolved workspace root are omitted, so a status
   * call from workspace A never mixes in workspace B's agents. Hosts with no
   * scope (no caller context AND no open folder) return everything, as
   * before.
   *
   * The single-id path must never conflate "yours is gone" with "exists
   * elsewhere": on 2026-08-31 two sessions read a bare `Agent not found` /
   * empty registry as "the agent died" and both began overwriting files a
   * live agent was still writing. An agent that EXISTS but belongs to another
   * workspace therefore gets an error saying exactly that.
   */
  getStatus(agentId?: string): AgentProcessInfo | AgentProcessInfo[] {
    const scopeRoot = this.resolveScopedWorkspaceRoot();
    const scopeKey =
      scopeRoot === undefined ? undefined : normalizeWorkspaceRoot(scopeRoot);
    if (agentId) {
      const tracked = this.agents.get(agentId);
      if (!tracked) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      if (
        !this.isWithinWorkspaceScope(tracked.info.workingDirectory, scopeKey)
      ) {
        throw new Error(
          `Agent ${agentId} exists but belongs to another workspace: its working directory is ` +
            `${tracked.info.workingDirectory}, and this call is scoped to ${scopeRoot}. ` +
            `The agent is still tracked (status: ${tracked.info.status}) — it did not disappear. ` +
            `Ask again from its own workspace to read or manage it.`,
        );
      }
      return {
        ...tracked.info,
        status: tracked.info.status,
      };
    }

    return Array.from(this.agents.values())
      .filter((t) =>
        this.isWithinWorkspaceScope(t.info.workingDirectory, scopeKey),
      )
      .map((t) => ({
        ...t.info,
      }));
  }

  /**
   * Read agent output (stdout + stderr).
   *
   * `lineCount` describes the STRINGS THIS CALL RETURNS, not the buffers behind
   * them. `tracked.stdoutLineCount` counts what is in the raw buffer, which is
   * the same number only when no adapter rewrote the text and no `tail` was
   * asked for. `readOutput(id, 20)` used to answer with the buffer's several
   * thousand lines next to twenty lines of output, and the two callers that
   * surface the number — `agent-tool.dispatcher` and the MCP response
   * formatter's `**Lines:**` row — both present it as a description of the
   * text on screen. There is no consumer of the buffered count, so none is
   * returned.
   */
  readOutput(agentId: string, tail?: number): AgentOutput {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const adapter = this.cliDetection.getAdapter(tracked.info.cli);

    let stdout = tracked.stdoutBuffer;
    let stderr = tracked.stderrBuffer;
    if (adapter) {
      stdout = adapter.parseOutput(stdout);
      stderr = adapter.parseOutput(stderr);
    }
    if (tail && tail > 0) {
      stdout = tailLines(stdout, tail);
      stderr = tailLines(stderr, tail);
    }

    return {
      agentId: AgentId.from(agentId),
      stdout,
      stderr,
      lineCount: countNewlines(stdout) + countNewlines(stderr),
      truncated: tracked.truncated,
    };
  }

  /**
   * Update parentSessionId for all tracked agents that match the given tab ID.
   * Called when the real session UUID is resolved from the SDK, replacing the
   * temporary tab ID so that CLI session persistence uses the correct parent.
   *
   * A blank id is not an id. Without this guard, one call with `tabId === ''`
   * matched every agent whose parent was also `''` — agents belonging to
   * different sessions, or to none — and re-parented all of them onto whichever
   * session happened to resolve first. `SubagentRegistryService.pruneSession`
   * guards the same way.
   */
  resolveParentSessionId(tabId: string, realSessionId: string): void {
    if (!tabId || !realSessionId) {
      this.logger.warn(
        '[AgentProcessManager] resolveParentSessionId ignored — blank id',
        {
          hasTabId: Boolean(tabId),
          hasRealSessionId: Boolean(realSessionId),
        },
      );
      return;
    }
    for (const tracked of this.agents.values()) {
      if (tracked.info.parentSessionId === tabId) {
        tracked.info.parentSessionId = realSessionId;
      }
    }
  }

  /**
   * Stream events copied out for persistence.
   *
   * The LIVE cap is `MAX_ACCUMULATED_STREAM_EVENTS` (50 000) — the right size
   * for an agent card watching a run in progress, and far too large to copy
   * into storage on every lifecycle event. `capStreamEvents` keeps the tail
   * plus the landmark events before it, so the restored execution tree still
   * has its structure (TASK_2026_323 blocker B5).
   */
  private static readonly MAX_PERSISTED_STREAM_EVENTS = 2000;

  /**
   * Read accumulated output for session persistence.
   * Returns stdout (capped at 100KB), structured segments, and a bounded tail
   * of rich stream events. Every returned array is a bounded copy — this runs
   * on the main thread on each agent exit. Returns undefined if the agent is
   * not found (e.g., already cleaned up after TTL).
   */
  readOutputForPersistence(agentId: string):
    | {
        stdout: string;
        segments: CliOutputSegment[];
        streamEvents: FlatStreamEventUnion[];
      }
    | undefined {
    const tracked = this.agents.get(agentId);
    if (!tracked) return undefined;

    let stdout = tracked.stdoutBuffer;
    if (stdout.length > MAX_STDOUT_PERSISTENCE_SIZE) {
      stdout = stdout.slice(-MAX_STDOUT_PERSISTENCE_SIZE);
    }

    return {
      stdout,
      segments: [...tracked.accumulatedSegments],
      streamEvents: [
        ...capStreamEvents(
          tracked.accumulatedStreamEvents,
          AgentProcessManager.MAX_PERSISTED_STREAM_EVENTS,
        ),
      ],
    };
  }

  /**
   * Write instruction to agent's stdin (steering)
   */
  steer(agentId: string, instruction: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (tracked.info.status !== 'running') {
      throw new Error(
        `Agent ${agentId} is not running (status: ${tracked.info.status})`,
      );
    }

    const adapter = this.cliDetection.getAdapter(tracked.info.cli);
    if (!adapter?.supportsSteer()) {
      throw new Error(
        `Steering is not supported for ${tracked.info.cli} CLI. ` +
          `The agent will complete its task based on the original prompt.`,
      );
    }
    // SDK-based agents that own a live input channel (e.g. Pi RPC mode) route
    // steering through the handle, which writes to the current child's stdin.
    // This is preferred over the legacy `tracked.process.stdin` path below.
    const sdkSteer = tracked.sdkHandle?.steer;
    if (sdkSteer) {
      sdkSteer(instruction);
      return;
    }

    if (!tracked.process) {
      throw new Error(
        `Agent ${agentId} is an SDK-based agent and does not support stdin steering.`,
      );
    }

    if (!tracked.process.stdin?.writable) {
      throw new Error(`Agent ${agentId} stdin is not writable`);
    }

    tracked.process.stdin.write(instruction + '\n');
  }

  async continueConversation(agentId: string, message: string): Promise<void> {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new AgentContinueError('not_found', `Agent not found: ${agentId}`);
    }

    const sdkHandle = tracked.sdkHandle;
    if (sdkHandle?.supportsContinuation?.() !== true || !sdkHandle.continue) {
      throw new AgentContinueError(
        'unsupported',
        `Agent ${agentId} does not support continuation`,
      );
    }

    if (tracked.subprocessReleased) {
      // The record is intact and still readable — only the OS process is gone.
      // Name the recovery in the message: `persistSession: true` is set on every
      // ptah-cli spawn, so `tracked.info.cliSessionId` is a real, resumable
      // conversation and the caller should hand it back as `resume_session_id`.
      throw new AgentContinueError(
        'released',
        `Agent ${agentId} released its process after idling. ` +
          `Resume the conversation instead: spawn with ` +
          `resume_session_id: ${tracked.info.cliSessionId ?? '<unknown>'}.`,
      );
    }

    if (tracked.info.status === 'running') {
      throw new AgentContinueError(
        'busy',
        `Agent ${agentId} is busy (status: ${tracked.info.status})`,
      );
    }

    // The continuation is the reason the subprocess was kept alive — stand the
    // idle countdown down before doing anything that can await.
    this.clearIdleRelease(tracked);

    tracked.hasExited = false;
    if (tracked.cleanupHandle) {
      clearTimeout(tracked.cleanupHandle);
      tracked.cleanupHandle = undefined;
    }
    if (tracked.exitEmitHandle) {
      clearTimeout(tracked.exitEmitHandle);
      tracked.exitEmitHandle = undefined;
    }
    clearTimeout(tracked.timeoutHandle);
    tracked.info = {
      ...tracked.info,
      status: 'running',
      completedAt: undefined,
      exitCode: undefined,
    };
    tracked.timeoutHandle = this.unrefTimer(
      setTimeout(() => {
        this.handleTimeout(agentId);
      }, DEFAULT_TIMEOUT),
    );

    this.events.emit('agent:spawned', tracked.info);

    let outcome: { done: Promise<number> };
    try {
      outcome = await sdkHandle.continue(message);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('[AgentProcessManager] continue() failed to start', {
        agentId,
        error: errorMessage,
      });
      this.handleExit(agentId, 1, null);
      throw new AgentContinueError('unknown', errorMessage);
    }

    outcome.done.then(
      (exitCode) => {
        this.handleExit(agentId, exitCode, null);
      },
      (error: unknown) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error('[AgentProcessManager] continued turn error', {
          agentId,
          error: errorMessage,
        });
        this.handleExit(agentId, 1, null);
      },
    );
  }

  /**
   * Stop an agent process gracefully.
   *
   * A non-running agent is NOT a no-op. A continuation-capable agent that has
   * finished its turn still owns a live subprocess (that is the whole point of
   * the prompt mailbox), so returning early here left `ptah_agent_stop` unable
   * to reclaim the one thing the user asked it to reclaim — memory. The status
   * is deliberately left alone: the run really did complete, and rewriting it to
   * `stopped` would relabel a successful task as a cancelled one. Only the
   * process goes (TASK_2026_323 B11).
   */
  async stop(agentId: string): Promise<AgentProcessInfo> {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    if (tracked.info.status !== 'running') {
      await this.releaseSubprocess(agentId, tracked, 'stopped');
      return tracked.info;
    }

    await this.killProcess(tracked);
    tracked.subprocessReleased = true;
    this.clearIdleRelease(tracked);
    tracked.info = {
      ...tracked.info,
      status: 'stopped',
      completedAt: new Date().toISOString(),
    };
    clearTimeout(tracked.timeoutHandle);
    this.flushDelta(agentId);
    this.cleanupFlushTimer(agentId);

    this.scheduleCleanup(agentId);

    this.events.emit('agent:exited', tracked.info);

    this.logger.info('[AgentProcessManager] Agent stopped', { agentId });
    return tracked.info;
  }

  /**
   * Tear down every tracked agent. The one teardown entry point, called from
   * each host's shutdown path.
   *
   * It releases the subprocess of EVERY tracked agent, not just the running
   * ones. That distinction is the whole fix: the agents that orphan a
   * `claude.exe` are precisely the ones that have already COMPLETED and whose
   * continuation-capable handle is still holding the process open. The previous
   * `shutdownAll()` filtered to `status === 'running'`, so on quit it walked
   * past every orphan it was written to collect — and nothing called it anyway
   * (TASK_2026_323 B11).
   *
   * The wait is bounded by {@link DISPOSE_RELEASE_TIMEOUT_MS}: Electron's
   * `will-quit` is synchronous and VS Code's `deactivate()` has a finite budget,
   * so a release that has not settled by then keeps its already-issued abort and
   * tree-kill and the host stops waiting on it.
   */
  async disposeAll(): Promise<void> {
    const entries = Array.from(this.agents.entries());
    this.logger.info('[AgentProcessManager] Disposing all agents...', {
      agents: entries.length,
      running: entries.filter(([, t]) => t.info.status === 'running').length,
    });

    const releases = entries.map(([id, tracked]) =>
      this.releaseSubprocess(id, tracked, 'disposed'),
    );
    await Promise.race([
      Promise.allSettled(releases),
      new Promise<void>((resolve) =>
        this.unrefTimer(setTimeout(resolve, DISPOSE_RELEASE_TIMEOUT_MS)),
      ),
    ]);

    for (const [agentId, tracked] of this.agents) {
      if (tracked.cleanupHandle) {
        clearTimeout(tracked.cleanupHandle);
      }
      if (tracked.exitEmitHandle) {
        clearTimeout(tracked.exitEmitHandle);
      }
      clearTimeout(tracked.timeoutHandle);
      this.clearIdleRelease(tracked);
      this.cleanupFlushTimer(agentId);
    }
    try {
      const copilotAdapter = this.cliDetection.getAdapter('copilot');
      if (
        copilotAdapter &&
        'dispose' in copilotAdapter &&
        typeof (copilotAdapter as { dispose: () => Promise<void> }).dispose ===
          'function'
      ) {
        await (copilotAdapter as { dispose: () => Promise<void> }).dispose();
        this.logger.info('[AgentProcessManager] Copilot SDK adapter disposed');
      }
    } catch (error) {
      this.logger.warn(
        '[AgentProcessManager] Failed to dispose Copilot SDK adapter',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    this.agents.clear();
    this.logger.info(`[AgentProcessManager] ${entries.length} agents disposed`);
  }

  /**
   * Reserve one slot against the concurrent-agent cap.
   *
   * The check and the reservation must be atomic with respect to each other,
   * and nothing else may sit between them: read the cap, count the agents that
   * are running plus the ones already reserved, throw if the next one would not
   * fit, otherwise take the slot by incrementing `spawning`.
   *
   * Because the increment happens INSIDE the mutex it is visible to the next
   * caller before that caller runs its own check, so a burst of N simultaneous
   * spawns admits exactly `max` of them — no TOCTOU window, no over-admission.
   * Do not move the increment out of the lock to "simplify" this.
   *
   * EVERY caller must release the slot with `this.spawning--` in a `finally`,
   * on success and on throw alike. A missed release leaks a slot permanently
   * and the cap drifts down to zero.
   *
   * The error text is user-facing and asserted in specs — keep it verbatim.
   */
  private async reserveSpawnSlot(): Promise<void> {
    return this.acquireSpawnLock(async () => {
      const maxConcurrent = this.getMaxConcurrentAgents();
      const runningCount = this.getRunningCount();
      if (runningCount + this.spawning >= maxConcurrent) {
        throw new Error(
          `Maximum concurrent agent limit reached (${maxConcurrent}). ` +
            `Stop a running agent before spawning a new one. ` +
            `Running agents: ${this.getRunningAgentIds().join(', ')}`,
        );
      }
      this.spawning++;
    });
  }

  /**
   * The spawn mutex primitive: a promise chain that runs `fn` after every
   * previously-queued `fn` has settled.
   *
   * **It protects the check-and-reserve in {@link reserveSpawnSlot} and nothing
   * else. Never await I/O inside it.** This lock is global to the host, so
   * anything awaited within it serializes EVERY session on the machine: until
   * TASK_2026_323 B10 the whole spawn ran in here, which meant one session's
   * CLI detection, working-directory `realpath`, 1500 ms harness preflight and
   * SDK process launch blocked every other session's spawn from even starting.
   * The critical section is now a few synchronous reads and one increment.
   *
   * Uses a Promise-chain pattern: each call chains onto the previous, ensuring
   * sequential execution while remaining non-blocking. try/finally guarantees
   * the lock is released even on exceptions.
   */
  private acquireSpawnLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = this.spawnMutex;
    let resolve: () => void = () => {};
    this.spawnMutex = new Promise<void>((r) => {
      resolve = r;
    });
    return release.then(async () => {
      try {
        return await fn();
      } finally {
        resolve();
      }
    });
  }

  /**
   * Detach a timer from the event loop's ref count.
   *
   * Every timer this manager arms is a per-agent watchdog or a deferred
   * housekeeping tick — a thing that must fire IF the process is still alive,
   * never a reason for it to stay alive. Left ref'd, one spawned agent pins the
   * loop for up to an hour (`DEFAULT_TIMEOUT`) and a completed one for another
   * thirty minutes (`COMPLETED_AGENT_TTL`); with several agents per session that
   * is the same open-handle defect commit 5dc525f02 fixed in
   * `wizard-generation-rpc.handlers.ts`, and it is what makes Jest report
   * "worker process has failed to exit gracefully".
   *
   * Guarded shape because `unref` exists on Node's `Timeout` but not on the
   * DOM's numeric handle, and not on every fake-timer implementation.
   *
   * Unref'ing the OUTPUT FLUSH timer is safe for the same reason: while an agent
   * is producing output, the SDK subprocess's own stdio handles hold the loop
   * open, so the 200 ms flush always gets its tick. When nothing is producing
   * output there is nothing pending to flush, and `handleExit` flushes
   * synchronously before teardown regardless.
   */
  private unrefTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    return timer;
  }

  /**
   * Arm the shared per-agent output flush timer if it is not already armed.
   * Text deltas, structured segments and stream events all coalesce onto it.
   */
  private scheduleFlush(agentId: string): void {
    if (this.flushTimers.has(agentId)) return;
    const timer = this.unrefTimer(
      setTimeout(() => {
        this.flushDelta(agentId);
      }, OUTPUT_FLUSH_INTERVAL),
    );
    this.flushTimers.set(agentId, timer);
  }

  /**
   * Append a chunk to an agent's output buffer, trimming with hysteresis.
   *
   * This is the hottest per-chunk path in the manager: on the ptah-cli path
   * `SdkHandle.onOutput` fires once per `text_delta`, i.e. once per token. Two
   * rules keep it O(chunk) instead of O(buffer):
   *
   * - **Trim to a LOW-WATER mark, not to the cap.** The previous version cut
   *   only the overflow, which left the buffer sitting on `MAX_BUFFER_SIZE` so
   *   the next token trimmed again and copied the whole megabyte. Cutting back
   *   to `BUFFER_LOW_WATER_SIZE` amortizes the copy over the 256 KB of headroom
   *   it buys (TASK_2026_323 B1).
   * - **No regex for the newline count.** `data.match(/\n/g)` allocated a match
   *   array per chunk; `countNewlines` walks the same bytes and allocates none.
   *
   * The line counter tracks lines CURRENTLY in the buffer, so a trim subtracts
   * the newlines it dropped — counted once, at trim time, over the dropped
   * prefix only.
   */
  private appendBuffer(
    agentId: string,
    stream: 'stdout' | 'stderr',
    data: string,
  ): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;

    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    const lineCountKey =
      stream === 'stdout' ? 'stdoutLineCount' : 'stderrLineCount';

    tracked[key] += data;
    tracked[lineCountKey] += countNewlines(data);

    if (tracked[key].length > MAX_BUFFER_SIZE) {
      const trim = trimBufferToLowWater(tracked[key]);
      tracked[key] = trim.buffer;
      tracked[lineCountKey] = Math.max(
        0,
        tracked[lineCountKey] - trim.linesDropped,
      );
      tracked.truncated = true;
    }

    this.accumulateDelta(agentId, stream, data);
  }

  /**
   * Accumulate output delta for throttled emission to webview.
   * Flushes every OUTPUT_FLUSH_INTERVAL ms per agent.
   */
  private accumulateDelta(
    agentId: string,
    stream: 'stdout' | 'stderr',
    data: string,
  ): void {
    let pending = this.pendingDeltas.get(agentId);
    if (!pending) {
      pending = createEmptyPendingDelta();
      this.pendingDeltas.set(agentId, pending);
    }
    pending[stream] += data;
    this.scheduleFlush(agentId);
  }

  /**
   * Accumulate a structured segment for throttled emission.
   * Shares the same flush timer as text deltas.
   */
  private accumulateSegment(agentId: string, segment: CliOutputSegment): void {
    let pending = this.pendingDeltas.get(agentId);
    if (!pending) {
      pending = createEmptyPendingDelta();
      this.pendingDeltas.set(agentId, pending);
    }
    pending.segments.push(segment);
    const tracked = this.agents.get(agentId);
    if (
      tracked &&
      tracked.accumulatedSegments.length < MAX_ACCUMULATED_SEGMENTS
    ) {
      tracked.accumulatedSegments.push(segment);
    }
    this.scheduleFlush(agentId);
  }

  /**
   * Accumulate a FlatStreamEventUnion event for throttled emission.
   * Shares the same flush timer as text deltas and segments.
   * Only Ptah CLI adapter produces these events.
   */
  private accumulateStreamEvent(
    agentId: string,
    event: FlatStreamEventUnion,
  ): void {
    let pending = this.pendingDeltas.get(agentId);
    if (!pending) {
      pending = createEmptyPendingDelta();
      this.pendingDeltas.set(agentId, pending);
    }
    pending.streamEvents.push(event);
    const tracked = this.agents.get(agentId);
    if (tracked) {
      tracked.accumulatedStreamEvents.push(event);

      // Re-cap only once the array has run STREAM_EVENTS_CAP_SLACK entries past
      // the cap, not the moment it exceeds it. `capStreamEvents` rebuilds all
      // 50 000 entries; firing it on every event past the cap is the same
      // per-chunk full-buffer rescan as the stdout trim above, just in array
      // form. The slack amortizes each rebuild over 5 000 events.
      if (
        tracked.accumulatedStreamEvents.length >
        MAX_ACCUMULATED_STREAM_EVENTS + STREAM_EVENTS_CAP_SLACK
      ) {
        tracked.accumulatedStreamEvents = capStreamEvents(
          tracked.accumulatedStreamEvents,
          MAX_ACCUMULATED_STREAM_EVENTS,
        );
        // Log only the FIRST time the cap is hit for this agent. A long-running
        // agent crosses the cap on every subsequent event, so logging here
        // unconditionally floods the console and adds synchronous logging load
        // to the event loop per stream event.
        if (!tracked.streamCapLogged) {
          tracked.streamCapLogged = true;
          this.logger.debug(
            '[AgentProcessManager] Stream events cap reached, dropping oldest deltas (further drops for this agent are silent)',
            {
              agentId,
              cap: MAX_ACCUMULATED_STREAM_EVENTS,
            },
          );
        }
      }
    }
    this.scheduleFlush(agentId);
  }

  /**
   * Flush accumulated deltas for an agent and emit 'agent:output' event.
   * Merges consecutive text segments before emitting to reduce webview overhead.
   */
  private flushDelta(agentId: string): void {
    this.flushTimers.delete(agentId);
    const pending = this.pendingDeltas.get(agentId);
    if (
      !pending ||
      (!pending.stdout &&
        !pending.stderr &&
        pending.segments.length === 0 &&
        pending.streamEvents.length === 0)
    )
      return;

    const tracked = this.agents.get(agentId);
    if (!tracked) return;

    const mergedSegments = mergeConsecutiveTextSegments(pending.segments);

    const delta: AgentOutputDelta = {
      agentId: AgentId.from(agentId),
      stdoutDelta: pending.stdout,
      stderrDelta: pending.stderr,
      timestamp: Date.now(),
      ...(mergedSegments.length > 0 ? { segments: mergedSegments } : {}),
      ...(pending.streamEvents.length > 0
        ? { streamEvents: pending.streamEvents }
        : {}),
    };
    pending.stdout = '';
    pending.stderr = '';
    pending.segments = [];
    pending.streamEvents = [];

    this.events.emit('agent:output', delta);
  }

  private async handleTimeout(agentId: string): Promise<void> {
    const tracked = this.agents.get(agentId);
    if (!tracked || tracked.info.status !== 'running') return;

    this.logger.warn('[AgentProcessManager] Agent timed out', { agentId });
    tracked.info = {
      ...tracked.info,
      status: 'timeout',
      completedAt: new Date().toISOString(),
    };
    await this.killProcess(tracked);
    tracked.subprocessReleased = true;
    this.clearIdleRelease(tracked);
    this.scheduleCleanup(agentId);
  }

  /**
   * The idle window before a completed agent's subprocess is released.
   *
   * Read through the same settings surface as `maxConcurrentAgents`, so a user
   * who lives on long follow-up threads can widen it (or set it very large to
   * get the old hold-forever behaviour back) without a rebuild.
   *
   * Two guards, and they answer different questions. A value that is not a
   * usable number at all — a string from a hand-edited settings file, `NaN`,
   * zero or negative — is not a preference, so the DEFAULT is used. A value
   * that is a real preference but below {@link MIN_SDK_IDLE_RELEASE_MS} is
   * raised to the floor rather than discarded: the user asked for "as short as
   * possible" and gets the shortest window the setting is declared to allow,
   * not five minutes.
   */
  private getSdkIdleReleaseMs(): number {
    const configured = this.workspace.getConfiguration<number>(
      'ptah',
      'agentOrchestration.sdkIdleReleaseMs',
      SDK_IDLE_RELEASE_MS,
    );
    if (
      typeof configured !== 'number' ||
      !Number.isFinite(configured) ||
      configured <= 0
    ) {
      return SDK_IDLE_RELEASE_MS;
    }
    return Math.max(configured, MIN_SDK_IDLE_RELEASE_MS);
  }

  /**
   * Arm the idle countdown for an agent whose turn just ended.
   *
   * Only continuation-capable handles get one, because they are the only ones
   * that deliberately outlive their turn: on the ptah-cli path `query()` is fed
   * a prompt mailbox whose generator does not return until `close()`, and
   * `close()` runs only on abort. A handle without continuation support has
   * already finished with its process, and the `scheduleCleanup` backstop
   * catches it at TTL either way.
   */
  private scheduleIdleRelease(agentId: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked || tracked.subprocessReleased) return;
    if (!tracked.sdkHandle || !tracked.sdkAbortController) return;
    if (tracked.sdkHandle.supportsContinuation?.() !== true) return;

    this.clearIdleRelease(tracked);
    const idleMs = this.getSdkIdleReleaseMs();
    tracked.idleSince = Date.now();
    tracked.idleReleaseHandle = this.unrefTimer(
      setTimeout(() => {
        void this.releaseTracked(agentId, 'idle');
      }, idleMs),
    );
  }

  private clearIdleRelease(tracked: TrackedAgent): void {
    if (tracked.idleReleaseHandle) {
      clearTimeout(tracked.idleReleaseHandle);
      tracked.idleReleaseHandle = undefined;
    }
    tracked.idleSince = undefined;
  }

  /** Look up an agent and release it. No-op for an id that is already gone. */
  private async releaseTracked(
    agentId: string,
    reason: AgentReleaseReason,
  ): Promise<void> {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;
    await this.releaseSubprocess(agentId, tracked, reason);
  }

  /**
   * End an agent's operating-system process while KEEPING its record.
   *
   * This is the memory reclamation that `handleExit` never did. It aborts the
   * SDK handle — on the ptah-cli path that closes the prompt mailbox, which
   * lets the prompt generator return, which lets the stream loop resolve and
   * stop the translation proxy — and tree-kills the child pid for handles that
   * expose one, via the same `killProcess` path `stop()` uses.
   *
   * What deliberately SURVIVES: `tracked.info`, the stdout/stderr buffers, the
   * accumulated segments and stream events. `ptah_agent_read` and the agent card
   * keep working until {@link COMPLETED_AGENT_TTL} removes the record. The only
   * capability lost is in-process continuation, and `agent:released` exists so
   * the UI can stop offering it and reach for a session resume instead.
   *
   * Takes the record rather than looking it up so the TTL backstop can release
   * an agent it is about to delete from the map.
   */
  private async releaseSubprocess(
    agentId: string,
    tracked: TrackedAgent,
    reason: AgentReleaseReason,
  ): Promise<void> {
    if (tracked.subprocessReleased) return;
    // Set BEFORE the await: killProcess yields, and a second caller arriving in
    // that window would issue a duplicate abort and a duplicate tree-kill.
    tracked.subprocessReleased = true;

    const idleMs = tracked.idleSince ? Date.now() - tracked.idleSince : 0;
    this.clearIdleRelease(tracked);

    try {
      await this.killProcess(tracked);
    } catch (error: unknown) {
      this.logger.warn(
        `[AgentProcessManager] Subprocess release failed for ${agentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.logger.info('[AgentProcessManager] Released agent subprocess', {
      agentId,
      reason,
      idleMs,
      cli: tracked.info.cli,
      status: tracked.info.status,
      cliSessionId: tracked.info.cliSessionId,
    });

    this.events.emit('agent:released', {
      agentId,
      reason,
      cliSessionId: tracked.info.cliSessionId,
    });
  }

  private handleExit(
    agentId: string,
    code: number | null,
    signal: string | null,
  ): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;
    if (tracked.hasExited) return;
    tracked.hasExited = true;

    clearTimeout(tracked.timeoutHandle);
    if (tracked.info.status === 'running') {
      const status: AgentStatus = code === 0 ? 'completed' : 'failed';
      tracked.info = {
        ...tracked.info,
        status,
        exitCode: code ?? undefined,
        completedAt: new Date().toISOString(),
      };
    } else if (!tracked.info.completedAt) {
      tracked.info = {
        ...tracked.info,
        completedAt: new Date().toISOString(),
      };
    }
    this.flushDelta(agentId);
    this.cleanupFlushTimer(agentId);

    this.scheduleCleanup(agentId);
    // The turn is over but a continuation-capable handle still owns its
    // subprocess, by design — start the clock on how long that stays true.
    this.scheduleIdleRelease(agentId);
    const exitInfo = tracked.info;
    tracked.exitEmitHandle = this.unrefTimer(
      setTimeout(() => {
        const current = this.agents.get(agentId);
        if (current && !current.hasExited) {
          return;
        }
        this.events.emit('agent:exited', exitInfo);

        this.logger.info('[AgentProcessManager] Agent exited', {
          agentId,
          status: exitInfo.status,
          exitCode: code,
          signal,
        });
      }, GRACEFUL_EXIT_DELAY_MS),
    );
  }

  /**
   * Schedule removal of a completed agent from the map after TTL.
   * Prevents memory leaks from agents that are never read after completion.
   */
  private scheduleCleanup(agentId: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;
    if (tracked.cleanupHandle) {
      clearTimeout(tracked.cleanupHandle);
    }

    tracked.cleanupHandle = this.unrefTimer(
      setTimeout(() => {
        // Backstop for the idle release. Dropping the record without ending its
        // process is how an orphan becomes permanent: nothing holds a reference
        // to abort afterwards, so it lives until the host quits. Fire-and-forget
        // BEFORE the delete, holding its own record reference, so the delete
        // below stays synchronous for callers reading the map right after.
        const record = this.agents.get(agentId);
        if (record) {
          void this.releaseSubprocess(agentId, record, 'expired');
        }
        this.agents.delete(agentId);
        this.logger.info('[AgentProcessManager] Cleaned up completed agent', {
          agentId,
        });
        // The UI's agent card outlives this record. Announce the drop so a
        // follow-up box can stop offering `continueConversation` on an id that
        // can now only answer `not_found`, and reach for the session-resume path
        // instead. Emitted AFTER the delete so a listener that immediately calls
        // back in observes the same map this method just left behind.
        this.events.emit('agent:expired', { agentId });
      }, COMPLETED_AGENT_TTL),
    );
  }

  /**
   * Clean up flush timer for a specific agent.
   */
  private cleanupFlushTimer(agentId: string): void {
    const timer = this.flushTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(agentId);
    }
    this.pendingDeltas.delete(agentId);
  }

  private async killProcess(tracked: TrackedAgent): Promise<void> {
    const captureTreeKillError = (err: unknown): void => {
      this.sentryService.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { errorSource: 'AgentProcessManager.killProcess.treeKill' },
      );
    };

    const child = tracked.process;
    if (!child) {
      // SDK-handle branch (every current adapter). Abort fires the adapter's own
      // best-effort graceful stop + tree-kill; we ALSO tree-kill the live child's
      // process group here (defense in depth for handles whose abort path doesn't
      // reap descendants), then wait for the run to actually settle.
      if (tracked.sdkAbortController) {
        tracked.sdkAbortController.abort();

        const sdkPid = tracked.sdkHandle?.getPid?.();
        if (sdkPid) {
          // killProcessTree polls for real exit, so it already blocks until the
          // process (and group) is gone — no separate settle wait needed.
          await killProcessTree(sdkPid, 'SIGTERM', captureTreeKillError);
        } else {
          // No live child PID to kill, and none is missing. A handle without
          // `getPid` never spawned a child of its own: it handed that job to an
          // SDK that owns the process and reaps it from the same abort signal we
          // just fired (see the `SdkHandle` comment in `ptah-cli-registry.ts`).
          // So the abort IS the kill here, and all that is left is waiting for
          // the run to unwind — bounded, because a host on its way out cannot
          // wait forever for a run that already lost its prompt source.
          await this.waitForSdkSettle(tracked);
        }
      }
      return;
    }

    if (!child.pid) return;

    // Legacy tracked-ChildProcess branch: single shared tree-kill implementation
    // (Windows taskkill /T /F; POSIX process-group kill escalating to SIGKILL).
    await killProcessTree(child.pid, 'SIGTERM', captureTreeKillError);
  }

  /**
   * Wait for an aborted PID-less SDK run to unwind, for at most
   * {@link SDK_ABORT_SETTLE_MS}.
   *
   * The handle's `done` is what actually says "the run has ended", so it wins
   * the race whenever it can; the timer is only the ceiling. Both halves matter
   * for shutdown: the timer is unref'd so it can never be the reason a host
   * stays alive, and it is cleared the moment `done` wins so a settled kill
   * leaves nothing pending behind it.
   *
   * A rejected `done` counts as settled — a run that failed is a run that is
   * over, and killProcess has no error to report to.
   */
  private async waitForSdkSettle(tracked: TrackedAgent): Promise<void> {
    let settleTimer: NodeJS.Timeout | undefined;
    const bounded = new Promise<void>((resolve) => {
      settleTimer = this.unrefTimer(setTimeout(resolve, SDK_ABORT_SETTLE_MS));
    });
    try {
      const done = tracked.sdkHandle?.done;
      await (done
        ? Promise.race([
            done.then(
              () => undefined,
              () => undefined,
            ),
            bounded,
          ])
        : bounded);
    } finally {
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
    }
  }

  private getRunningCount(): number {
    return Array.from(this.agents.values()).filter(
      (t) => t.info.status === 'running',
    ).length;
  }

  private getRunningAgentIds(): string[] {
    return Array.from(this.agents.entries())
      .filter(([, t]) => t.info.status === 'running')
      .map(([id]) => id);
  }

  /**
   * The concurrent-agent cap.
   *
   * The extension manifest schema protects only the VS Code settings UI.
   * Electron, CLI, and hand-edited settings reach this runtime unchecked, so
   * the 1..20 bounds are enforced here and non-finite values fall back to 5.
   *
   * `ptah.agentOrchestration.maxConcurrentAgents` — DEFAULT 5, MAXIMUM 20, both
   * declared in the extension's `package.json`. Prompt text and docs that say
   * "max 3 concurrent" are stale and describe a limit that has not existed for
   * some time; the number here is the one the runtime enforces.
   */
  private getMaxConcurrentAgents(): number {
    const configured =
      this.workspace.getConfiguration<number>(
        'ptah',
        'agentOrchestration.maxConcurrentAgents',
        DEFAULT_CONCURRENT_AGENTS,
      ) ?? DEFAULT_CONCURRENT_AGENTS;

    if (!Number.isFinite(configured)) {
      return DEFAULT_CONCURRENT_AGENTS;
    }

    return Math.max(
      MIN_CONCURRENT_AGENTS,
      Math.min(MAX_CONCURRENT_AGENTS, configured),
    );
  }

  private async getPreferredCli(): Promise<CliType | null> {
    const systemCliTypes = new Set<string>(SYSTEM_CLI_TYPES);
    const disabledClis = new Set(
      this.workspace.getConfiguration<string[]>(
        'ptah',
        'agentOrchestration.disabledClis',
        [],
      ) ?? [],
    );
    const preferredOrder =
      this.workspace.getConfiguration<string[]>(
        'ptah',
        'agentOrchestration.preferredAgentOrder',
        [],
      ) ?? [];
    this.logger.debug(
      '[AgentProcessManager] getPreferredCli: preferred order',
      {
        order:
          preferredOrder.length > 0
            ? preferredOrder.join(', ')
            : 'none (auto-detect)',
        disabled: disabledClis.size > 0 ? [...disabledClis].join(', ') : 'none',
      },
    );
    for (const entry of preferredOrder) {
      if (!systemCliTypes.has(entry)) {
        continue;
      }
      if (disabledClis.has(entry)) {
        continue;
      }

      const adapter = this.cliDetection.getAdapter(entry as CliType);
      if (adapter) {
        const detection = await this.cliDetection.getDetection(
          entry as CliType,
        );
        if (detection?.installed) {
          this.logger.info(
            '[AgentProcessManager] getPreferredCli: using preferred CLI',
            { cli: entry },
          );
          return entry as CliType;
        }
        this.logger.warn(
          '[AgentProcessManager] getPreferredCli: preferred CLI not installed, trying next',
          { preferred: entry, installed: detection?.installed },
        );
      }
    }
    const installed = await this.cliDetection.getInstalledClis();
    const enabled = installed.filter((c) => !disabledClis.has(c.cli));
    this.logger.debug(
      '[AgentProcessManager] getPreferredCli: auto-detect installed CLIs',
      {
        count: enabled.length,
        clis: enabled.map((c) => `${c.cli}${c.installed ? ' ✓' : ' ✗'}`),
      },
    );

    if (enabled.length === 0) return null;

    return enabled[0].cli;
  }

  /**
   * The workspace root this call is scoped to: the calling MCP request's
   * workspace (declared in its URL, or inferred from its session) first, then
   * the platform provider's active folder. `undefined` when neither resolves.
   *
   * A throw from the resolver — a caller that declared a workspace this host
   * does not have open — propagates deliberately. Refusing by name is the
   * point; degrading to the provider root would answer for an unrelated
   * workspace, the exact defect TASK_2026_364 exists to close.
   */
  private resolveScopedWorkspaceRoot(): string | undefined {
    return (
      this.callerWorkspaceResolver?.resolveCallerWorkspaceRoot() ??
      this.workspace.getWorkspaceRoot() ??
      undefined
    );
  }

  private getWorkspaceRoot(): string {
    return this.resolveScopedWorkspaceRoot() ?? require('os').homedir();
  }

  /**
   * Whether an agent's working directory falls under the caller's workspace
   * scope, compared with the shared normalized key (`normalizeWorkspaceRoot`),
   * so separator and case spellings of one directory land on one answer.
   *
   * An `undefined` scope (no caller context and no open folder) keeps the
   * pre-scoping behaviour: everything is visible. A record with no working
   * directory is also visible — it cannot be attributed to any workspace, and
   * hiding it recreates the invisible-live-agent hazard this scoping fixes.
   */
  private isWithinWorkspaceScope(
    workingDirectory: string | undefined,
    scopeKey: string | undefined,
  ): boolean {
    if (scopeKey === undefined) return true;
    if (!workingDirectory) return true;
    const dirKey = normalizeWorkspaceRoot(workingDirectory);
    return dirKey === scopeKey || dirKey.startsWith(`${scopeKey}/`);
  }

  /**
   * This prevents markAllInterrupted() from killing them when the parent session ends.
   * CLI agents run independently and should only stop on their own completion, timeout,
   * or explicit user action.
   */
  private markParentSubagentsAsCliAgent(
    parentSessionId: string | undefined,
  ): void {
    if (!parentSessionId) return;

    const running = this.subagentRegistry.getRunningBySession(parentSessionId);

    if (running.length === 0) {
      this.logger.debug(
        '[AgentProcessManager] No running subagents found to mark as CLI-orchestrating',
        { parentSessionId },
      );
      return;
    }

    for (const record of running) {
      this.subagentRegistry.update(record.toolCallId, { isCliAgent: true });
      this.logger.debug(
        '[AgentProcessManager] Marked subagent as CLI-orchestrating',
        {
          toolCallId: record.toolCallId,
          agentType: record.agentType,
          parentSessionId,
        },
      );
    }
  }

  private async validateWorkingDirectory(dir: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot || workspaceRoot.trim() === '') {
      throw new Error('Cannot spawn agent process: no workspace root is open.');
    }
    if (!dir || dir.trim() === '') {
      throw new Error('Working directory is required but was empty.');
    }
    let normalizedDir: string;
    let normalizedRoot: string;
    if (process.platform === 'win32') {
      const asciiLower = (s: string): string =>
        s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
      normalizedDir = asciiLower(dir.replace(/\\/g, '/'));
      normalizedRoot = asciiLower(workspaceRoot.replace(/\\/g, '/'));
    } else {
      let realDir = dir;
      let realRoot = workspaceRoot;

      realDir = await fsPromises.realpath(dir);

      realRoot = await fsPromises.realpath(workspaceRoot);
      normalizedDir = realDir;
      normalizedRoot = realRoot;
    }

    if (!normalizedDir.startsWith(normalizedRoot)) {
      throw new Error(
        `Working directory must be within workspace root. ` +
          `Got: ${dir}, Expected prefix: ${workspaceRoot}`,
      );
    }
  }

  /**
   * Resolve the actual MCP listener port.
   *
   * The status port is updated only after the server binds, so it reflects a
   * deterministic fallback port rather than the configured port that collided.
   */
  private resolveMcpPort(): number | undefined {
    try {
      const port = this.mcpServerStatus?.getPort() ?? null;
      if (port === null) {
        this.logger.info(
          '[AgentProcessManager] MCP server is not running, disabling for CLI agent',
        );
        return undefined;
      }

      this.logger.info('[AgentProcessManager] MCP enabled for CLI agent', {
        port,
      });
      return port;
    } catch (error: unknown) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'AgentProcessManager.resolveMcpPort' },
      );
      this.logger.info('[AgentProcessManager] MCP port resolution failed');
      return undefined;
    }
  }
  /**
   * Bounded harness check for a rival CLI spawn.
   *
   * Swallows everything. `spawn` is wrapped in a lock and its caller surfaces
   * failures to the user as "the agent could not start"; a harness directory
   * that could not be written is not that, and must not be reported as that.
   */
  private async runHarnessPreflight(cwd: string): Promise<void> {
    if (this.harnessPreflight === null) return;
    try {
      await this.harnessPreflight.ensure(cwd);
    } catch (error: unknown) {
      this.logger.warn(
        `[AgentProcessManager] Harness preflight failed (ignored): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
