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
import { EventEmitter } from 'eventemitter3';
import {
  TOKENS,
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  AgentId,
  AgentStatus,
  AgentProcessInfo,
  SpawnAgentRequest,
  SpawnAgentResult,
  AgentOutput,
  CliType,
  normalizeWorkspaceRoot,
} from '@ptah-extension/shared';
import type {
  AgentMessageOutcome,
  AgentRoleChannel,
  AgentRoleDelivery,
  CliOutputSegment,
  CliSessionReference,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { CliDetectionService } from './cli-detection.service';
import {
  AgentMessageError,
  AgentMessageRouter,
} from './agent-message-router.service';
import type {
  CliCommandOptions,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';
import { killProcessTree } from './cli-adapters/cli-adapter.utils';
import {
  DEFAULT_INACTIVITY_TIMEOUT,
  COMPLETED_AGENT_TTL,
  SDK_ABORT_SETTLE_MS,
  DISPOSE_RELEASE_TIMEOUT_MS,
  GRACEFUL_EXIT_DELAY_MS,
  MAX_STDOUT_PERSISTENCE_SIZE,
  countNewlines,
  tailLines,
  capStreamEvents,
} from './agent-process-manager-helpers';
import { AgentSpawnEnvironment } from './agent-spawn-environment.service';
import { AgentOutputBuffer } from './agent-output-buffer.service';
import type { TrackedAgent } from './tracked-agent';

export {
  MIN_CONCURRENT_AGENTS,
  MAX_CONCURRENT_AGENTS,
  DEFAULT_CONCURRENT_AGENTS,
} from './agent-spawn-environment.service';

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

export interface AgentRoleStamp {
  readonly role: string;
  readonly roleDelivery: AgentRoleDelivery;
  readonly roleChannel: AgentRoleChannel;
}

interface SdkSpawnOptions {
  readonly runSdk: (options: CliCommandOptions) => Promise<SdkHandle>;
  readonly request: SpawnAgentRequest;
  readonly task: string;
  readonly workingDirectory: string;
  readonly cli: CliType;
  readonly displayName: string;
  readonly roleChannel: AgentRoleChannel;
  readonly binaryPath?: string;
  readonly mcpPort?: number;
}

function roleStampOf(
  record: Partial<AgentRoleStamp>,
): AgentRoleStamp | undefined {
  const { role, roleDelivery, roleChannel } = record;
  return role !== undefined &&
    roleDelivery !== undefined &&
    roleChannel !== undefined
    ? { role, roleDelivery, roleChannel }
    : undefined;
}

export class AgentContinueError extends Error {
  constructor(
    readonly code: AgentContinueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentContinueError';
  }
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

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    /**
     * Owns mode selection and the pending queue for {@link sendToAgent}
     * (TASK_2026_402 R-8). Stateless — every per-agent field it touches lives
     * on the tracked record.
     */
    @inject(AgentMessageRouter)
    private readonly messageRouter: AgentMessageRouter,
    @inject(AgentSpawnEnvironment)
    private readonly spawnEnvironment: AgentSpawnEnvironment,
    @inject(AgentOutputBuffer)
    private readonly outputBuffer: AgentOutputBuffer,
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
    const cli = request.cli ?? (await this.spawnEnvironment.preferredCli());
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
      request.workingDirectory ?? this.spawnEnvironment.workspaceRoot();
    await this.spawnEnvironment.validateWorkingDirectory(workingDirectory);
    // AFTER validation, BEFORE the process exists. `workingDirectory` may be a
    // sub-package of a monorepo (E14) — the preflight resolves it to the
    // workspace root, which is where every CLI-discoverable directory lives.
    await this.spawnEnvironment.runHarnessPreflight(workingDirectory);
    const mcpPort =
      adapter.supportsMcp !== false
        ? await this.spawnEnvironment.mcpPort()
        : undefined;
    return this.doSpawnSdk({
      runSdk: adapter.runSdk.bind(adapter),
      request,
      task: request.task,
      workingDirectory,
      cli,
      displayName: adapter.displayName,
      roleChannel: adapter.roleChannel,
      binaryPath: detection.path,
      mcpPort,
    });
  }

  /**
   * Spawn an SDK-based agent using adapter.runSdk() instead of child_process.spawn().
   * SDK agents have process: null and use AbortController for cancellation.
   */
  private async doSpawnSdk(
    options: SdkSpawnOptions,
  ): Promise<SpawnAgentResult> {
    const {
      runSdk,
      request,
      task,
      workingDirectory,
      cli,
      displayName,
      roleChannel,
      binaryPath,
      mcpPort,
    } = options;
    const agentId = AgentId.create();
    const startedAt = new Date().toISOString();
    const resolvedModel = this.spawnEnvironment.resolveModel(
      cli,
      request.model,
    );
    const roleDefinition = request.roleDefinition;
    const roleStamp: AgentRoleStamp | undefined = roleDefinition
      ? { role: roleDefinition.name, roleDelivery: 'preamble', roleChannel }
      : undefined;

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
      ...roleStamp,
    };

    this.logger.info('[AgentProcessManager] Spawning SDK agent', {
      agentId,
      cli,
      workingDirectory,
      model: resolvedModel,
      role: roleStamp?.role,
      roleChannel: roleStamp?.roleChannel,
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
      reasoningEffort: this.spawnEnvironment.resolveReasoningEffort(cli),
      autoApprove: this.spawnEnvironment.resolveAutoApprove(cli),
      // Minted above, BEFORE the CLI is asked to build its MCP config, so the
      // `/agent/{id}` segment of the URL names this exact record
      // (TASK_2026_402). The rival-CLI path needs no extra plumbing for this —
      // the id already exists by the time `runSdk` is called.
      agentId,
      role: roleDefinition,
    });
    const initialCliSessionId = sdkHandle.getSessionId?.();
    const infoWithSession = initialCliSessionId
      ? { ...info, cliSessionId: initialCliSessionId }
      : info;

    return this.trackSdkHandle(
      sdkHandle,
      infoWithSession,
      request.timeout,
      () => sdkHandle.getSessionId?.(),
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
      /**
       * The id this record must take, reserved by the caller with
       * {@link reserveAgentId} (TASK_2026_402).
       *
       * Unlike `doSpawnSdk`, this method receives a handle that has ALREADY
       * been built — and with it the MCP URL the child will call back on. If
       * the id were minted here it would be minted after the URL, so the URL
       * could never carry it. The caller therefore reserves one id and hands
       * it to both the handle builder and this method, so the record and the
       * URL agree.
       */
      agentId?: AgentId;
      roleStamp?: AgentRoleStamp;
    },
  ): Promise<SpawnAgentResult> {
    await this.reserveSpawnSlot();
    try {
      await this.spawnEnvironment.validateWorkingDirectory(
        meta.workingDirectory,
      );

      const agentId = meta.agentId ?? AgentId.create();
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
        ...meta.roleStamp,
      };
      const initialCliSessionId = sdkHandle.getSessionId?.();
      const infoWithSession = initialCliSessionId
        ? { ...info, cliSessionId: initialCliSessionId }
        : info;

      this.logger.info('[AgentProcessManager] Spawned agent from SdkHandle', {
        agentId,
        cli: meta.cli,
        ptahCliName: meta.ptahCliName,
        ptahCliId: meta.ptahCliId,
      });

      return this.trackSdkHandle(sdkHandle, infoWithSession, meta.timeout, () =>
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
   * @param requestedTimeout - Inactivity window in milliseconds, `0` to disable
   *   the watchdog, or undefined for {@link DEFAULT_INACTIVITY_TIMEOUT}
   * @param captureSessionId - Optional callback to capture CLI session ID
   *   from async init events (e.g., the init JSONL segment). Called on
   *   each structured segment until a session ID is captured.
   */
  private trackSdkHandle(
    sdkHandle: SdkHandle,
    info: AgentProcessInfo,
    requestedTimeout: number | undefined,
    captureSessionId?: () => string | undefined,
  ): SpawnAgentResult {
    const agentId = info.agentId;
    const inactivityTimeoutMs =
      AgentProcessManager.resolveInactivityTimeout(requestedTimeout);
    const timeoutHandle =
      inactivityTimeoutMs === undefined
        ? undefined
        : this.unrefTimer(
            setTimeout(() => {
              this.handleTimeout(agentId);
            }, inactivityTimeoutMs),
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
      inactivityTimeoutMs,
      stdoutLineCount: 0,
      stderrLineCount: 0,
      truncated: false,
      hasExited: false,
      subprocessReleased: false,
      accumulatedSegments: [],
      accumulatedStreamEvents: [],
      streamCapLogged: false,
      pendingMessages: [],
    };

    this.agents.set(agentId, tracked);
    sdkHandle.setAgentId?.(agentId);
    const onFlushDue = (): void => {
      this.flushDelta(agentId);
    };
    sdkHandle.onOutput((data: string) => {
      const current = this.agents.get(agentId);
      if (!current) return;
      this.outputBuffer.appendOutput(
        agentId,
        current,
        'stdout',
        data,
        onFlushDue,
      );
    });
    if (sdkHandle.onSegment) {
      sdkHandle.onSegment((segment: CliOutputSegment) => {
        this.outputBuffer.appendSegment(
          agentId,
          this.agents.get(agentId),
          segment,
          onFlushDue,
        );
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
        this.outputBuffer.appendStreamEvent(
          agentId,
          this.agents.get(agentId),
          event,
          onFlushDue,
        );
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

    // Registered AFTER the exit handler above, deliberately: both are
    // continuations of the same `done` promise and they run in registration
    // order, so anything awaiting `currentTurnDone` observes a record
    // handleExit has already moved out of `running`. Its rejection is folded
    // into a non-zero code here — the exit handler above owns the reporting,
    // and an unhandled rejection on a promise nobody may await is not a
    // failure mode worth having.
    tracked.currentTurnDone = sdkHandle.done.then(
      (exitCode) => exitCode,
      () => 1,
    );

    const spawnResult: SpawnAgentResult = {
      agentId,
      cli: info.cli,
      status: 'running',
      startedAt: info.startedAt,
      cliSessionId: info.cliSessionId,
      ptahCliName: info.ptahCliName,
      ptahCliId: info.ptahCliId,
      ...roleStampOf(info),
    };

    this.events.emit('agent:spawned', tracked.info);
    this.markParentSubagentsAsCliAgent(info.parentSessionId);

    return spawnResult;
  }

  /**
   * The message for an id this host holds no record of, live or restored.
   *
   * A bare `Agent not found: <id>` is read by a model as "the agent died", and
   * the recovery it invites is to retry — which can never succeed, because the
   * map is the only registry and nothing will put the id back into it. Say
   * that the record is absent rather than the agent, and name the one recovery
   * that works.
   *
   * The `Agent not found: <id>` PREFIX is load-bearing: callers and specs match
   * on it. Extend this message, never re-word its opening.
   */
  private static noSuchAgentMessage(agentId: string): string {
    return (
      `Agent not found: ${agentId}. This host holds no record under that id — ` +
      `neither a live agent nor one restored from persisted session state. ` +
      `The id is from a run that was never persisted, or from one older than ` +
      `the retention window. Retrying cannot recover it: spawn a new agent if ` +
      `the work still needs doing.`
    );
  }

  /**
   * The message for an operation a restored record cannot serve.
   *
   * Restored records are readable and nothing else. The old wording for each
   * refusal described a live agent in the wrong state ("is not running"), which
   * says neither why nor what to do next.
   */
  private static restoredRecordMessage(
    agentId: string,
    cliSessionId: string | undefined,
  ): string {
    return (
      `Agent ${agentId} was restored from a previous run of this host. Its ` +
      `output is readable, but nothing about it is live — the process ended ` +
      `when that run did. Resume the conversation instead: spawn with ` +
      `resume_session_id: ${cliSessionId ?? '<unknown>'}.`
    );
  }

  /**
   * Rebuild read-only records from persisted CLI session references.
   *
   * The agent map is in-memory, so it is empty after a host restart and
   * {@link COMPLETED_AGENT_TTL} empties it again thirty minutes after an agent
   * finishes. The OUTPUT survives both: `persistCliSessionReference` writes it
   * to the session metadata store on exit, and the restore paths
   * (`chat:resume`, `session:cli-sessions`) already read it back for the UI.
   * Nothing put it back HERE, so a resumed session replayed agent cards whose
   * ids `ptah_agent_read` answered `Agent not found` for — and the model read
   * that as "the agent died" rather than "ask the store".
   *
   * **A live agent is never clobbered by a stale persisted snapshot.** The
   * reference is a point-in-time copy taken at exit; an id already in the map
   * has a record that is at least as current, and may be a run in flight.
   *
   * `workingDirectory` comes from the caller because a `CliSessionReference`
   * carries none, and {@link getStatus} scopes on it — a restored agent filed
   * under the wrong root is either invisible or another workspace's.
   *
   * @returns how many records were added (ids already present are skipped).
   */
  restoreAgents(
    refs: readonly CliSessionReference[],
    workingDirectory: string,
  ): number {
    let restored = 0;

    for (const ref of refs) {
      const agentId = String(ref.agentId);
      if (!agentId || this.agents.has(agentId)) continue;

      const stdout = ref.stdout ?? '';
      const info: AgentProcessInfo = {
        agentId: ref.agentId,
        cli: ref.cli,
        task: ref.task,
        workingDirectory,
        // A reference persisted as `running` describes a process that died with
        // the run that wrote it. Carrying it through would show a spinner that
        // never resolves and would count against the concurrency cap.
        status: ref.status === 'running' ? 'stopped' : ref.status,
        startedAt: ref.startedAt,
        ...(ref.cliSessionId ? { cliSessionId: ref.cliSessionId } : {}),
        ...(ref.ptahCliId ? { ptahCliId: ref.ptahCliId } : {}),
      };

      this.agents.set(agentId, {
        info,
        process: null,
        stdoutBuffer: stdout,
        stderrBuffer: '',
        stdoutLineCount: countNewlines(stdout),
        stderrLineCount: 0,
        truncated: false,
        hasExited: true,
        // There is no subprocess to reclaim, which is what makes `disposeAll`
        // and the TTL backstop no-ops for these records rather than errors.
        subprocessReleased: true,
        // Restore refs are lean, so both are normally empty. That cannot
        // overwrite the stored output: `readOutputForPersistence` is read only
        // on `agent:spawned` / `agent:exited`, which a restored record never
        // emits (no process, and steer/stop/continue throw first); its info has
        // no `parentSessionId`, so the session-id remap never re-persists it;
        // and `saveAgentOutput` skips a write when both arrays are empty.
        accumulatedSegments: ref.segments ? [...ref.segments] : [],
        accumulatedStreamEvents: ref.streamEvents ? [...ref.streamEvents] : [],
        streamCapLogged: false,
        pendingMessages: [],
        restored: true,
      });

      // Same TTL as a completed agent. Without it, a long-lived Electron
      // process accumulates one record per restored agent per session switch.
      this.scheduleCleanup(agentId);
      restored++;
    }

    if (restored > 0) {
      this.logger.info(
        '[AgentProcessManager] Restored agents from persisted session state',
        { restored, offered: refs.length, workingDirectory },
      );
    }

    return restored;
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
    const scopeRoot = this.spawnEnvironment.scopedWorkspaceRoot();
    const scopeKey =
      scopeRoot === undefined ? undefined : normalizeWorkspaceRoot(scopeRoot);
    if (agentId) {
      const tracked = this.agents.get(agentId);
      if (!tracked) {
        throw new Error(AgentProcessManager.noSuchAgentMessage(agentId));
      }
      if (
        !this.spawnEnvironment.isWithinScope(
          tracked.info.workingDirectory,
          scopeKey,
        )
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
        this.spawnEnvironment.isWithinScope(t.info.workingDirectory, scopeKey),
      )
      .map((t) => ({
        ...t.info,
      }));
  }

  /**
   * Every tracked agent, in EVERY workspace — the unscoped bookkeeping view.
   *
   * `getStatus()` is the caller-facing list and is scoped to the calling MCP
   * request's workspace (TASK_2026_364). Internal bookkeeping must not use it.
   * `sdk-callbacks.ts` did, and it runs on the chat SDK stream — outside
   * `runWithMcpRequestContext` — so the resolver answered `undefined`, the scope
   * fell back to the process-global active folder, and every agent belonging to
   * the non-focused window was filtered out. Its parent-session remap then
   * re-persisted nothing, leaving those references keyed to the pre-resolution
   * tab id and unfindable by `chat:resume` (the TASK_2026_323 "agent went dark
   * on resume" failure). This accessor exists so a bookkeeping consumer states
   * "unscoped" explicitly instead of inheriting a caller scope it has no caller
   * for. It must never be reachable from the MCP tool surface.
   */
  listTrackedAgents(): AgentProcessInfo[] {
    return Array.from(this.agents.values()).map((t) => ({ ...t.info }));
  }

  /**
   * Reserve an agent id BEFORE anything that needs to embed it exists.
   *
   * `doSpawnSdk` mints its id before it calls `runSdk`, so the adapter can put
   * it in the MCP URL. `spawnFromSdkHandle` cannot: it is handed a finished
   * handle whose MCP URL was decided when the handle was built. Its caller
   * therefore reserves the id here and passes the SAME value to the handle
   * builder and to `spawnFromSdkHandle`'s `meta.agentId`, so exactly one id is
   * minted per spawn and the URL names the record that will exist
   * (TASK_2026_402).
   *
   * Reserving does not register anything: an id that is never spawned simply
   * goes unused.
   */
  reserveAgentId(): AgentId {
    return AgentId.create();
  }

  /**
   * Unscoped, non-throwing lookup of one tracked record.
   *
   * Used by {@link AgentReportRouter} to resolve the parent of the agent the
   * MCP URL named. It is deliberately NOT `getStatus`: that method is the
   * caller-facing view and is scoped to the calling MCP request's workspace,
   * and it throws. Here the "caller" IS the agent being looked up — it is
   * reporting about itself, from its own working directory — so a workspace
   * scope would only ever reject the agent's own record, and a throw would
   * turn a refusal that must carry a reason into an exception.
   */
  findAgentInfo(agentId: string): AgentProcessInfo | undefined {
    const tracked = this.agents.get(agentId);
    return tracked ? { ...tracked.info } : undefined;
  }

  /**
   * Write one synthetic segment onto this agent's own output stream, so a user
   * watching the tile rather than the chat sees what the agent did
   * (TASK_2026_402, Req 6.4).
   *
   * It rides the EXISTING `AgentOutputDelta` path — the same accumulate /
   * throttled-flush funnel every adapter segment takes, broadcast to the tile
   * at `wiring/agent-events.ts`. There is no new event, no new frontend
   * plumbing, and no second broadcast channel to keep in step.
   *
   * Unknown agent is a silent no-op ON PURPOSE: the only caller already
   * resolved the record and only writes the note after a delivery it made, so
   * the record disappearing in between is a lifecycle race, not a failure to
   * report.
   */
  recordAgentNote(agentId: string, segment: CliOutputSegment): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;
    this.outputBuffer.appendSegment(agentId, tracked, segment, () => {
      this.flushDelta(agentId);
    });
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
      throw new Error(AgentProcessManager.noSuchAgentMessage(agentId));
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
   * Deliver one message to a spawned agent by the best mechanism it supports,
   * and report which mechanism actually fired.
   *
   * This replaces the old `steer()`, which could only ever answer "steering is
   * not supported" for five of the six CLIs. Mode selection and the pending
   * queue live in {@link AgentMessageRouter}; this method owns the three record
   * states no mechanism can serve, because they are states of the MAP, not of
   * the agent's messaging surface.
   *
   * A completed-but-alive continuation-capable agent is deliberately NOT one of
   * them: the honest answer there is "this message starts a new turn", which is
   * what the router returns.
   *
   * @throws {AgentMessageError} `not_found`, `restored` or `not_running`.
   */
  async sendToAgent(
    agentId: string,
    message: string,
  ): Promise<AgentMessageOutcome> {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new AgentMessageError(
        'not_found',
        AgentProcessManager.noSuchAgentMessage(agentId),
      );
    }

    if (tracked.restored) {
      throw new AgentMessageError(
        'restored',
        AgentProcessManager.restoredRecordMessage(
          agentId,
          tracked.info.cliSessionId,
        ),
      );
    }

    if (
      tracked.info.status !== 'running' &&
      !AgentProcessManager.canStartNewTurn(tracked)
    ) {
      throw new AgentMessageError(
        'not_running',
        `Agent ${agentId} is not running (status: ${tracked.info.status}) and ` +
          `its handle cannot start a new turn — the run is over and its ` +
          `process is gone. Resume the conversation instead: spawn with ` +
          `resume_session_id: ${tracked.info.cliSessionId ?? '<unknown>'}.`,
      );
    }

    return this.messageRouter.route(agentId, tracked, message, this);
  }

  /**
   * Whether a record that is no longer running can still be handed a new turn.
   *
   * Read from the handle's own declarations, never from the CLI name: a handle
   * that kept its subprocess alive after finishing is exactly the case the
   * prompt mailbox exists for.
   */
  private static canStartNewTurn(tracked: TrackedAgent): boolean {
    const handle = tracked.sdkHandle;
    return (
      !tracked.subprocessReleased &&
      handle?.supportsContinuation?.() === true &&
      typeof handle.continue === 'function'
    );
  }

  async continueConversation(agentId: string, message: string): Promise<void> {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new AgentContinueError('not_found', `Agent not found: ${agentId}`);
    }

    // Before the `unsupported` check below: a restored record has no handle at
    // all, so it would answer "does not support continuation" — true of the
    // record, and wrong about the conversation, which IS resumable. `released`
    // already means "record readable, process gone, use session resume", which
    // is exactly this state, and the callers that recover from it are written
    // against that code.
    if (tracked.restored) {
      throw new AgentContinueError(
        'released',
        AgentProcessManager.restoredRecordMessage(
          agentId,
          tracked.info.cliSessionId,
        ),
      );
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
    tracked.info = {
      ...tracked.info,
      status: 'running',
      completedAt: undefined,
      exitCode: undefined,
    };
    this.armInactivityWatchdog(agentId, tracked);

    this.events.emit('agent:spawned', tracked.info);

    let outcome: { done: Promise<number> };
    try {
      // The previous turn's tail segments can still be pending in the 200 ms
      // flush window. Stamp the edge BEFORE the continuation can emit, so the
      // flush-time merge never fuses the two turns (TASK_2026_466 defect 5).
      this.outputBuffer.markTurnBoundary(agentId);
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

    // Same ordering rule as the first turn in trackSdkHandle: registered after
    // the exit handler, so an `interrupt-resume` awaiting this observes a
    // settled record rather than racing the `busy` check.
    tracked.currentTurnDone = outcome.done.then(
      (exitCode) => exitCode,
      () => 1,
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
    // A restored record owns no process, so the release below would return
    // early and report a successful stop for work this host never held.
    if (tracked.restored) {
      throw new Error(
        AgentProcessManager.restoredRecordMessage(
          agentId,
          tracked.info.cliSessionId,
        ),
      );
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
    this.outputBuffer.discard(agentId);

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
      this.outputBuffer.discard(agentId);
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
      const maxConcurrent = this.spawnEnvironment.maxConcurrentAgents();
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
   * loop for a whole inactivity window (`DEFAULT_INACTIVITY_TIMEOUT`, and an
   * agent that keeps working re-arms it) and a completed one for another
   * thirty minutes (`COMPLETED_AGENT_TTL`); with several agents per session that
   * is the same open-handle defect commit 5dc525f02 fixed in
   * `wizard-generation-rpc.handlers.ts`, and it is what makes Jest report
   * "worker process has failed to exit gracefully".
   *
   * Guarded shape because `unref` exists on Node's `Timeout` but not on the
   * DOM's numeric handle, and not on every fake-timer implementation.
   */
  private unrefTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    return timer;
  }

  /**
   * Flush accumulated deltas for an agent and emit 'agent:output' event.
   */
  private flushDelta(agentId: string): void {
    const tracked = this.agents.get(agentId);
    const delta = this.outputBuffer.takeDelta(agentId, tracked);
    if (!tracked || !delta) return;

    // Output IS the liveness signal, and this is the one funnel every kind of
    // it passes through — stdout, stderr, segments and stream events alike.
    // Throttled to OUTPUT_FLUSH_INTERVAL, so re-arming here costs one timer per
    // 200 ms rather than one per token.
    if (tracked.info.status === 'running') {
      this.armInactivityWatchdog(agentId, tracked);
    }

    this.events.emit('agent:output', delta);
  }

  /**
   * Resolve the inactivity window a spawn asked for.
   *
   * `0` is the caller saying "no watchdog" and is honoured — a job that is
   * expected to sit silent for a day has no window that is both safe and
   * useful. There is no upper bound: the clamp that used to be here discarded
   * the caller's own number without telling it. A value that is not a usable
   * number at all is not a preference, so the default is used.
   */
  private static resolveInactivityTimeout(
    requested: number | undefined,
  ): number | undefined {
    if (requested === undefined) return DEFAULT_INACTIVITY_TIMEOUT;
    if (!Number.isFinite(requested) || requested < 0) {
      return DEFAULT_INACTIVITY_TIMEOUT;
    }
    return requested === 0 ? undefined : requested;
  }

  /**
   * Re-arm the inactivity watchdog. Called on every output flush, so the window
   * measures SILENCE rather than the run's total duration.
   */
  private armInactivityWatchdog(agentId: string, tracked: TrackedAgent): void {
    clearTimeout(tracked.timeoutHandle);
    tracked.timeoutHandle = undefined;
    const window = tracked.inactivityTimeoutMs;
    if (window === undefined) return;
    tracked.timeoutHandle = this.unrefTimer(
      setTimeout(() => {
        this.handleTimeout(agentId);
      }, window),
    );
  }

  private async handleTimeout(agentId: string): Promise<void> {
    const tracked = this.agents.get(agentId);
    if (!tracked || tracked.info.status !== 'running') return;

    this.logger.warn(
      '[AgentProcessManager] Agent produced no output for the whole inactivity window — treating it as hung',
      { agentId, inactivityTimeoutMs: tracked.inactivityTimeoutMs },
    );
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
    const idleMs = this.spawnEnvironment.sdkIdleReleaseMs();
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
    // Nothing can deliver a queued message once the process is gone. Say so in
    // the log rather than leaving entries that look pending forever.
    this.messageRouter.discardPending(agentId, tracked);

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
    this.outputBuffer.discard(agentId);

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

    // The single settle point, and therefore the only place a queued message
    // can be delivered: the status is now terminal, so `continueConversation`
    // will not refuse it as `busy`. One entry per settle — the turn this
    // starts settles again and drains the next.
    void this.messageRouter.flushPending(agentId, tracked, this);
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
}
