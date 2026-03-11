/**
 * Agent Process Manager
 * TASK_2025_157: Manages headless CLI agent child processes
 *
 * Responsibilities:
 * - Spawn CLI agent processes (gemini, codex, copilot)
 * - Track process state, output buffers, timeouts
 * - Enforce concurrent agent limits
 * - Graceful shutdown on extension deactivation
 * - Cross-platform process termination (SIGTERM/taskkill)
 */
import { injectable, inject } from 'tsyringe';
import { execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { EventEmitter } from 'eventemitter3';
import {
  TOKENS,
  Logger,
  LicenseService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import {
  AgentId,
  AgentStatus,
  AgentProcessInfo,
  AgentOutputDelta,
  SpawnAgentRequest,
  SpawnAgentResult,
  AgentOutput,
  CliType,
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
import { spawnCli } from './cli-adapters/cli-adapter.utils';

const execFileAsync = promisify(execFile);

/** Maximum output buffer size per agent (1MB) */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** Default timeout: 1 hour */
const DEFAULT_TIMEOUT = 60 * 60 * 1000;

/** Maximum timeout: 1 hour */
const MAX_TIMEOUT = 60 * 60 * 1000;

/** Grace period for SIGTERM before SIGKILL: 5 seconds */
const KILL_GRACE_PERIOD = 5000;

/** TTL for completed agents before cleanup from map: 30 minutes */
const COMPLETED_AGENT_TTL = 30 * 60 * 1000;

/** Throttle interval for output delta events: 200ms */
const OUTPUT_FLUSH_INTERVAL = 200;

/**
 * Shell metacharacters — kept for reference only.
 * spawn() is called WITHOUT shell:true, so args are passed directly
 * to the binary as a positional argument array. Shell injection is not
 * possible. Stripping these chars corrupts legitimate prompts containing
 * code characters ($, (), {}, backticks, etc.).
 */
// const SHELL_METACHAR_PATTERN = /[`$(){}|&<>^;%!]/g; // REMOVED — see comment above

/** Maximum number of accumulated segments kept per agent for persistence */
const MAX_ACCUMULATED_SEGMENTS = 500;

/**
 * Maximum number of stream events kept per agent for persistence.
 * Higher than segments because stream events are finer-grained —
 * a single tool call may produce dozens of delta events.
 * Matches the frontend MAX_STREAM_EVENTS cap in agent-monitor.store.ts.
 */
const MAX_ACCUMULATED_STREAM_EVENTS = 2000;

/** Maximum stdout size (bytes) returned for persistence */
const MAX_STDOUT_PERSISTENCE_SIZE = 100 * 1024; // 100 KB

/** Landmark event types that establish tree structure and must be preserved during capping */
const LANDMARK_EVENT_TYPES = new Set([
  'message_start',
  'tool_start',
  'agent_start',
  'thinking_start',
  'message_complete',
]);

/** Buffered output deltas per agent, flushed every OUTPUT_FLUSH_INTERVAL */
interface PendingDelta {
  stdout: string;
  stderr: string;
  segments: CliOutputSegment[];
  streamEvents: FlatStreamEventUnion[];
}

function createEmptyPendingDelta(): PendingDelta {
  return { stdout: '', stderr: '', segments: [], streamEvents: [] };
}

interface TrackedAgent {
  info: AgentProcessInfo;
  /** Child process for CLI-based agents, null for SDK-based agents */
  process: ChildProcess | null;
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
  /** Accumulated structured segments for persistence (capped at MAX_ACCUMULATED_SEGMENTS) */
  accumulatedSegments: CliOutputSegment[];
  /** Accumulated rich stream events for persistence (Ptah CLI only, capped at MAX_ACCUMULATED_STREAM_EVENTS) */
  accumulatedStreamEvents: FlatStreamEventUnion[];
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

  /**
   * Resolve per-CLI reasoning effort from VS Code config.
   * Returns undefined if the CLI doesn't support it or no effort is configured.
   */
  private resolveReasoningEffort(cli: CliType): string | undefined {
    if (cli !== 'codex' && cli !== 'copilot') return undefined;
    const effortKey =
      cli === 'codex' ? 'codexReasoningEffort' : 'copilotReasoningEffort';
    const effort = vscode.workspace
      .getConfiguration('ptah.agentOrchestration')
      .get<string>(effortKey, '');
    return effort || undefined;
  }

  private resolveAutoApprove(cli: CliType): boolean | undefined {
    if (cli !== 'codex' && cli !== 'copilot') return undefined;
    const key = cli === 'codex' ? 'codexAutoApprove' : 'copilotAutoApprove';
    return vscode.workspace
      .getConfiguration('ptah.agentOrchestration')
      .get<boolean>(key, true);
  }

  /** Cached MCP health check result (30s TTL) to avoid repeated HTTP calls on rapid spawns */
  private mcpHealthCache: {
    port: number | undefined;
    timestamp: number;
  } | null = null;
  private static readonly MCP_HEALTH_CACHE_TTL = 30_000;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService
  ) {
    this.logger.info('[AgentProcessManager] Initialized');
  }

  /**
   * Spawn a new CLI agent process
   */
  async spawn(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    return this.acquireSpawnLock(async () => {
      // Increment spawning counter synchronously before any async work
      this.spawning++;

      try {
        return await this.doSpawn(request);
      } finally {
        this.spawning--;
      }
    });
  }

  /**
   * Internal spawn implementation, wrapped by spawn() for concurrency tracking
   */
  private async doSpawn(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    // Check concurrent limit (include in-flight spawns)
    const maxConcurrent = this.getMaxConcurrentAgents();
    const runningCount = this.getRunningCount();
    if (runningCount + this.spawning > maxConcurrent) {
      throw new Error(
        `Maximum concurrent agent limit reached (${maxConcurrent}). ` +
          `Stop a running agent before spawning a new one. ` +
          `Running agents: ${this.getRunningAgentIds().join(', ')}`
      );
    }

    // Log the incoming spawn request
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

    // Determine which CLI to use
    const cli = request.cli ?? (await this.getDefaultCli());
    if (!cli) {
      throw new Error(
        'No CLI agent available. Install Gemini CLI (`npm install -g @google/gemini-cli`) ' +
          'or Codex CLI and authenticate before using agent orchestration.'
      );
    }

    this.logger.info('[AgentProcessManager] CLI resolved', {
      resolvedCli: cli,
      source: request.cli ? 'user-specified' : 'auto-detected',
    });

    // Verify CLI is installed
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
        `${cli} CLI is not installed. Install it and run authentication before using.`
      );
    }

    // Get adapter and build command
    const adapter = this.cliDetection.getAdapter(cli);
    if (!adapter) {
      throw new Error(`No adapter registered for CLI: ${cli}`);
    }

    const isSdk = typeof adapter.runSdk === 'function';
    this.logger.info('[AgentProcessManager] Adapter resolved', {
      cli,
      adapterType: isSdk ? 'sdk' : 'cli-process',
      detectedVersion: detection.version,
      detectedPath: detection.path,
    });

    // Validate working directory
    const workingDirectory =
      request.workingDirectory ?? this.getWorkspaceRoot();
    this.validateWorkingDirectory(workingDirectory);

    // Resolve MCP port before SDK/CLI branch — only for adapters that support it.
    // Premium-gated: only provided when user is premium AND MCP server is running.
    // Adapters that declare supportsMcp=false (e.g., Gemini) skip the health check.
    const mcpPort =
      adapter.supportsMcp !== false ? await this.resolveMcpPort() : undefined;

    // Branch: SDK-based adapters use runSdk() instead of spawn()
    // SDK adapters run in-process, so shell injection sanitization is not needed
    // and would corrupt legitimate code content (e.g., $, (), {}, backticks).
    const runSdk = adapter.runSdk?.bind(adapter);
    if (runSdk) {
      return this.doSpawnSdk(
        runSdk,
        request,
        request.task,
        workingDirectory,
        cli,
        adapter.displayName,
        detection.path,
        mcpPort
      );
    }

    // Resolve model for CLI subprocess path (same logic as SDK path)
    let cliModel = request.model;
    if (
      !cliModel &&
      (cli === 'gemini' || cli === 'codex' || cli === 'copilot')
    ) {
      const agentConfig = vscode.workspace.getConfiguration(
        'ptah.agentOrchestration'
      );
      const configKey =
        cli === 'gemini'
          ? 'geminiModel'
          : cli === 'codex'
          ? 'codexModel'
          : 'copilotModel';
      const configuredModel = agentConfig.get<string>(configKey, '');
      if (configuredModel) {
        cliModel = configuredModel;
      }
    }

    // No sanitization needed: spawn() is called without shell:true,
    // so args are passed directly to the binary (no shell interpretation).
    const command = adapter.buildCommand({
      task: request.task,
      workingDirectory,
      files: request.files,
      taskFolder: request.taskFolder,
      model: cliModel,
      mcpPort,
      resumeSessionId: request.resumeSessionId,
      projectGuidance: request.projectGuidance,
      systemPrompt: request.systemPrompt,
      reasoningEffort: this.resolveReasoningEffort(cli),
      autoApprove: this.resolveAutoApprove(cli),
    });

    // Create agent ID and info
    const agentId = AgentId.create();
    const startedAt = new Date().toISOString();

    const info: AgentProcessInfo = {
      agentId,
      cli,
      task: request.task,
      workingDirectory,
      taskFolder: request.taskFolder,
      status: 'running',
      startedAt,
      parentSessionId: request.parentSessionId,
      displayName: adapter.displayName,
      model: cliModel,
    };

    // Use resolved binary path from detection.
    const binaryPath = detection.path ?? command.binary;

    // Spawn the process using cross-spawn (transparent .cmd handling on Windows)
    this.logger.info('[AgentProcessManager] Spawning agent', {
      agentId,
      cli,
      binary: binaryPath,
      args: command.args.length,
      workingDirectory,
    });

    const childProcess = spawnCli(binaryPath, command.args, {
      cwd: workingDirectory,
      env: command.env,
    });

    // Explicit UTF-8 encoding prevents Buffer concatenation issues
    childProcess.stdout?.setEncoding('utf8');
    childProcess.stderr?.setEncoding('utf8');

    // Set up timeout
    const timeout = Math.min(request.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(agentId);
    }, timeout);

    // Track the agent
    const tracked: TrackedAgent = {
      info: { ...info, pid: childProcess.pid },
      process: childProcess,
      stdoutBuffer: '',
      stderrBuffer: '',
      timeoutHandle,
      stdoutLineCount: 0,
      stderrLineCount: 0,
      truncated: false,
      hasExited: false,
      accumulatedSegments: [],
      accumulatedStreamEvents: [],
    };

    this.agents.set(agentId, tracked);

    // Set up output capture
    childProcess.stdout?.on('data', (data: Buffer) => {
      this.appendBuffer(agentId, 'stdout', data.toString());
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      this.appendBuffer(agentId, 'stderr', data.toString());
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      this.handleExit(agentId, code, signal);
    });

    childProcess.on('error', (error) => {
      this.logger.error('[AgentProcessManager] Process error', error);
      this.handleExit(agentId, 1, null);
    });

    const spawnResult: SpawnAgentResult = {
      agentId,
      cli,
      status: 'running',
      startedAt,
    };

    this.events.emit('agent:spawned', tracked.info);

    // TASK_2025_186: Mark parent session's running subagents as CLI-orchestrating
    // so they are not interrupted when the parent SDK session ends.
    this.markParentSubagentsAsCliAgent(request.parentSessionId);

    return spawnResult;
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
    mcpPort?: number
  ): Promise<SpawnAgentResult> {
    const agentId = AgentId.create();
    const startedAt = new Date().toISOString();

    // Resolve model: use explicit request.model, else per-CLI config, else CLI default
    let resolvedModel = request.model;
    if (
      !resolvedModel &&
      (cli === 'gemini' || cli === 'codex' || cli === 'copilot')
    ) {
      const agentConfig = vscode.workspace.getConfiguration(
        'ptah.agentOrchestration'
      );
      const configKey =
        cli === 'gemini'
          ? 'geminiModel'
          : cli === 'codex'
          ? 'codexModel'
          : 'copilotModel';
      const configuredModel = agentConfig.get<string>(configKey, '');
      if (configuredModel) {
        resolvedModel = configuredModel;
      }
    }

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
      // Pre-set cliSessionId for resume: we already know the CLI session being
      // resumed, so make it available on the agent:spawned event immediately.
      // This enables spawn-time persistence (linking to parent session before
      // the agent exits). The late-capture callback will update it if the init
      // event returns a different session ID.
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

    if (
      request.resumeSessionId &&
      request.cli !== 'gemini' &&
      request.cli !== 'copilot'
    ) {
      this.logger.warn(
        `[AgentProcessManager] resume_session_id provided for ${request.cli} which does not support session resume`
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

    // Capture CLI session ID immediately if available (e.g., from sync init)
    const initialCliSessionId = sdkHandle.getSessionId?.();
    const infoWithSession = initialCliSessionId
      ? { ...info, cliSessionId: initialCliSessionId }
      : info;

    const timeout = Math.min(request.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

    return this.trackSdkHandle(
      sdkHandle,
      infoWithSession,
      timeout,
      // Late capture: session_id arrives in init event (first JSONL line).
      // Passed as callback so trackSdkHandle can invoke it on each segment.
      () => sdkHandle.getSessionId?.()
    );
  }

  /**
   * Spawn an agent from a pre-built SdkHandle (e.g., custom agent).
   * Same lifecycle management as doSpawnSdk() but skips CLI detection.
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
    }
  ): Promise<SpawnAgentResult> {
    return this.acquireSpawnLock(async () => {
      // Increment spawning counter synchronously before any async work
      this.spawning++;

      try {
        // Check concurrent limit (include in-flight spawns)
        const maxConcurrent = this.getMaxConcurrentAgents();
        const runningCount = this.getRunningCount();
        if (runningCount + this.spawning > maxConcurrent) {
          throw new Error(
            `Maximum concurrent agent limit reached (${maxConcurrent}). ` +
              `Stop a running agent before spawning a new one. ` +
              `Running agents: ${this.getRunningAgentIds().join(', ')}`
          );
        }

        // Validate working directory is within workspace root (same as doSpawn path)
        this.validateWorkingDirectory(meta.workingDirectory);

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
        };

        const timeout = Math.min(meta.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

        this.logger.info('[AgentProcessManager] Spawned agent from SdkHandle', {
          agentId,
          cli: meta.cli,
          ptahCliName: meta.ptahCliName,
          ptahCliId: meta.ptahCliId,
        });

        return this.trackSdkHandle(sdkHandle, info, timeout);
      } finally {
        this.spawning--;
      }
    });
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
   *   from async init events (e.g., Gemini's init JSONL segment). Called on
   *   each structured segment until a session ID is captured.
   */
  private trackSdkHandle(
    sdkHandle: SdkHandle,
    info: AgentProcessInfo,
    timeout: number,
    captureSessionId?: () => string | undefined
  ): SpawnAgentResult {
    const agentId = info.agentId;

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(agentId);
    }, timeout);

    // Track the SDK agent (process is null, abort via sdkAbortController)
    const tracked: TrackedAgent = {
      info,
      process: null,
      sdkAbortController: sdkHandle.abort,
      stdoutBuffer: '',
      stderrBuffer: '',
      timeoutHandle,
      stdoutLineCount: 0,
      stderrLineCount: 0,
      truncated: false,
      hasExited: false,
      accumulatedSegments: [],
      accumulatedStreamEvents: [],
    };

    this.agents.set(agentId, tracked);

    // Update permission routing to use the real agentId (Copilot SDK)
    sdkHandle.setAgentId?.(agentId);

    // Wire SDK output to the agent's stdout buffer
    sdkHandle.onOutput((data: string) => {
      this.appendBuffer(agentId, 'stdout', data);
    });

    // Wire structured segments (if the adapter provides them)
    if (sdkHandle.onSegment) {
      sdkHandle.onSegment((segment: CliOutputSegment) => {
        this.accumulateSegment(agentId, segment);

        // Late capture: session_id arrives in init event (first JSONL line).
        // For fresh agents, cliSessionId starts undefined and is captured here.
        // For resumed agents, cliSessionId is pre-set to resumeSessionId; we
        // still check the init event in case the CLI returns a different ID
        // (e.g., new session instead of true resume).
        if (captureSessionId) {
          const sessionId = captureSessionId();
          if (sessionId && sessionId !== tracked.info.cliSessionId) {
            tracked.info = { ...tracked.info, cliSessionId: sessionId };
          }
        }
      });
    }

    // Wire FlatStreamEventUnion events (Ptah CLI only -- enables rich ExecutionNode rendering)
    if (sdkHandle.onStreamEvent) {
      sdkHandle.onStreamEvent((event: FlatStreamEventUnion) => {
        this.accumulateStreamEvent(agentId, event);
      });
    }

    // Wire session ID resolution (Ptah CLI only — session ID arrives via system init)
    if (sdkHandle.onSessionResolved) {
      sdkHandle.onSessionResolved((sessionId: string) => {
        if (sessionId && sessionId !== tracked.info.cliSessionId) {
          tracked.info = { ...tracked.info, cliSessionId: sessionId };
        }
      });
    }

    // Wire SDK completion to handleExit (uses hasExited guard to prevent double-exit)
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
      }
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

    // TASK_2025_186: Mark parent session's running subagents as CLI-orchestrating
    // so they are not interrupted when the parent SDK session ends.
    this.markParentSubagentsAsCliAgent(info.parentSessionId);

    return spawnResult;
  }

  /**
   * Get status of a specific agent or all agents
   */
  getStatus(agentId?: string): AgentProcessInfo | AgentProcessInfo[] {
    if (agentId) {
      const tracked = this.agents.get(agentId);
      if (!tracked) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      return {
        ...tracked.info,
        status: tracked.info.status,
      };
    }

    return Array.from(this.agents.values()).map((t) => ({
      ...t.info,
    }));
  }

  /**
   * Read agent output (stdout + stderr)
   */
  readOutput(agentId: string, tail?: number): AgentOutput {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const adapter = this.cliDetection.getAdapter(tracked.info.cli);

    let stdout = tracked.stdoutBuffer;
    let stderr = tracked.stderrBuffer;

    // Parse output through adapter to strip ANSI codes
    if (adapter) {
      stdout = adapter.parseOutput(stdout);
      stderr = adapter.parseOutput(stderr);
    }

    // Apply tail limit
    if (tail && tail > 0) {
      stdout = this.tailLines(stdout, tail);
      stderr = this.tailLines(stderr, tail);
    }

    return {
      agentId: AgentId.from(agentId),
      stdout,
      stderr,
      lineCount: tracked.stdoutLineCount + tracked.stderrLineCount,
      truncated: tracked.truncated,
    };
  }

  /**
   * Update parentSessionId for all tracked agents that match the given tab ID.
   * Called when the real session UUID is resolved from the SDK, replacing the
   * temporary tab ID so that CLI session persistence uses the correct parent.
   */
  resolveParentSessionId(tabId: string, realSessionId: string): void {
    for (const tracked of this.agents.values()) {
      if (tracked.info.parentSessionId === tabId) {
        tracked.info.parentSessionId = realSessionId;
      }
    }
  }

  /**
   * Read accumulated output for session persistence.
   * Returns stdout (capped at 100KB), structured segments, and rich stream
   * events for storage in CliSessionReference. Returns undefined if the
   * agent is not found (e.g., already cleaned up after TTL).
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
      streamEvents: [...tracked.accumulatedStreamEvents],
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
        `Agent ${agentId} is not running (status: ${tracked.info.status})`
      );
    }

    const adapter = this.cliDetection.getAdapter(tracked.info.cli);
    if (!adapter?.supportsSteer()) {
      throw new Error(
        `Steering is not supported for ${tracked.info.cli} CLI. ` +
          `The agent will complete its task based on the original prompt.`
      );
    }

    // SDK agents have no child process - steering requires stdin pipe
    if (!tracked.process) {
      throw new Error(
        `Agent ${agentId} is an SDK-based agent and does not support stdin steering.`
      );
    }

    if (!tracked.process.stdin?.writable) {
      throw new Error(`Agent ${agentId} stdin is not writable`);
    }

    tracked.process.stdin.write(instruction + '\n');
  }

  /**
   * Stop an agent process gracefully
   */
  async stop(agentId: string): Promise<AgentProcessInfo> {
    const tracked = this.agents.get(agentId);
    if (!tracked) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Already finished
    if (tracked.info.status !== 'running') {
      return tracked.info;
    }

    await this.killProcess(tracked);
    tracked.info = {
      ...tracked.info,
      status: 'stopped',
      completedAt: new Date().toISOString(),
    };
    clearTimeout(tracked.timeoutHandle);

    // Flush any pending output deltas before emitting exit
    this.flushDelta(agentId);
    this.cleanupFlushTimer(agentId);

    this.scheduleCleanup(agentId);

    this.events.emit('agent:exited', tracked.info);

    this.logger.info('[AgentProcessManager] Agent stopped', { agentId });
    return tracked.info;
  }

  /**
   * Gracefully shut down all running agents (called on extension deactivation)
   */
  async shutdownAll(): Promise<void> {
    this.logger.info('[AgentProcessManager] Shutting down all agents...');
    const running = Array.from(this.agents.entries()).filter(
      ([, t]) => t.info.status === 'running'
    );

    await Promise.all(running.map(([id]) => this.stop(id)));

    // Clear all cleanup timers and flush timers on shutdown
    for (const [agentId, tracked] of this.agents) {
      if (tracked.cleanupHandle) {
        clearTimeout(tracked.cleanupHandle);
      }
      this.cleanupFlushTimer(agentId);
    }

    // Dispose SDK adapters that hold long-lived client processes (TASK_2025_162).
    // Fire-and-forget: errors are logged but do not block shutdown.
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
        error instanceof Error ? error : new Error(String(error))
      );
    }

    this.logger.info(
      `[AgentProcessManager] ${running.length} agents shut down`
    );
  }

  // ========================================
  // Private Methods
  // ========================================

  /**
   * Serialize spawn operations to prevent TOCTOU race conditions in
   * the concurrent limit check. Without this mutex, two spawn() calls
   * arriving simultaneously could both pass the limit check before
   * either registers in the agents map.
   *
   * Uses a Promise-chain pattern: each call chains onto the previous,
   * ensuring sequential execution while remaining non-blocking.
   * try/finally guarantees the lock is released even on exceptions.
   */
  private acquireSpawnLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = this.spawnMutex;
    // eslint-disable-next-line @typescript-eslint/no-empty-function
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

  private appendBuffer(
    agentId: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;

    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    const lineCountKey =
      stream === 'stdout' ? 'stdoutLineCount' : 'stderrLineCount';

    tracked[key] += data;
    tracked[lineCountKey] += (data.match(/\n/g) || []).length;

    // Rolling buffer: trim from beginning if over limit
    if (tracked[key].length > MAX_BUFFER_SIZE) {
      const excess = tracked[key].length - MAX_BUFFER_SIZE;
      const newlineIndex = tracked[key].indexOf('\n', excess);
      tracked[key] =
        newlineIndex > -1
          ? tracked[key].substring(newlineIndex + 1)
          : tracked[key].substring(excess);
      tracked.truncated = true;
    }

    // Accumulate output delta for throttled emission
    this.accumulateDelta(agentId, stream, data);
  }

  /**
   * Accumulate output delta for throttled emission to webview.
   * Flushes every OUTPUT_FLUSH_INTERVAL ms per agent.
   */
  private accumulateDelta(
    agentId: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): void {
    let pending = this.pendingDeltas.get(agentId);
    if (!pending) {
      pending = createEmptyPendingDelta();
      this.pendingDeltas.set(agentId, pending);
    }
    pending[stream] += data;

    // Start flush timer if not already running
    if (!this.flushTimers.has(agentId)) {
      const timer = setTimeout(() => {
        this.flushDelta(agentId);
      }, OUTPUT_FLUSH_INTERVAL);
      this.flushTimers.set(agentId, timer);
    }
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

    // Also accumulate for persistence (capped)
    const tracked = this.agents.get(agentId);
    if (
      tracked &&
      tracked.accumulatedSegments.length < MAX_ACCUMULATED_SEGMENTS
    ) {
      tracked.accumulatedSegments.push(segment);
    }

    // Start flush timer if not already running
    if (!this.flushTimers.has(agentId)) {
      const timer = setTimeout(() => {
        this.flushDelta(agentId);
      }, OUTPUT_FLUSH_INTERVAL);
      this.flushTimers.set(agentId, timer);
    }
  }

  /**
   * Accumulate a FlatStreamEventUnion event for throttled emission.
   * Shares the same flush timer as text deltas and segments.
   * Only Ptah CLI adapter produces these events.
   */
  private accumulateStreamEvent(
    agentId: string,
    event: FlatStreamEventUnion
  ): void {
    let pending = this.pendingDeltas.get(agentId);
    if (!pending) {
      pending = createEmptyPendingDelta();
      this.pendingDeltas.set(agentId, pending);
    }
    pending.streamEvents.push(event);

    // Also accumulate for persistence with smart capping that preserves tree-structural landmarks
    const tracked = this.agents.get(agentId);
    if (tracked) {
      tracked.accumulatedStreamEvents.push(event);

      if (
        tracked.accumulatedStreamEvents.length > MAX_ACCUMULATED_STREAM_EVENTS
      ) {
        tracked.accumulatedStreamEvents = capStreamEvents(
          tracked.accumulatedStreamEvents,
          MAX_ACCUMULATED_STREAM_EVENTS
        );
        this.logger.debug(
          '[AgentProcessManager] Stream events cap reached, dropped oldest deltas',
          {
            agentId,
            cap: MAX_ACCUMULATED_STREAM_EVENTS,
          }
        );
      }
    }

    // Start flush timer if not already running
    if (!this.flushTimers.has(agentId)) {
      const timer = setTimeout(() => {
        this.flushDelta(agentId);
      }, OUTPUT_FLUSH_INTERVAL);
      this.flushTimers.set(agentId, timer);
    }
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

    // Reset pending
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
    this.scheduleCleanup(agentId);
  }

  private handleExit(
    agentId: string,
    code: number | null,
    signal: string | null
  ): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;

    // Guard against double handleExit (error + exit events both firing)
    if (tracked.hasExited) return;
    tracked.hasExited = true;

    clearTimeout(tracked.timeoutHandle);

    // Don't override timeout/stopped status
    if (tracked.info.status === 'running') {
      const status: AgentStatus = code === 0 ? 'completed' : 'failed';
      tracked.info = {
        ...tracked.info,
        status,
        exitCode: code ?? undefined,
        completedAt: new Date().toISOString(),
      };
    } else if (!tracked.info.completedAt) {
      // Ensure completedAt is set even for timeout/stopped agents
      tracked.info = {
        ...tracked.info,
        completedAt: new Date().toISOString(),
      };
    }

    // Flush remaining output deltas before emitting exit
    this.flushDelta(agentId);
    this.cleanupFlushTimer(agentId);

    this.scheduleCleanup(agentId);

    this.events.emit('agent:exited', tracked.info);

    this.logger.info('[AgentProcessManager] Agent exited', {
      agentId,
      status: tracked.info.status,
      exitCode: code,
      signal,
    });
  }

  /**
   * Schedule removal of a completed agent from the map after TTL.
   * Prevents memory leaks from agents that are never read after completion.
   */
  private scheduleCleanup(agentId: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;

    // Clear any existing cleanup timer
    if (tracked.cleanupHandle) {
      clearTimeout(tracked.cleanupHandle);
    }

    tracked.cleanupHandle = setTimeout(() => {
      this.agents.delete(agentId);
      this.logger.info('[AgentProcessManager] Cleaned up completed agent', {
        agentId,
      });
    }, COMPLETED_AGENT_TTL);
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
    const child = tracked.process;

    // SDK-based agent: abort via AbortController instead of process signals
    if (!child) {
      if (tracked.sdkAbortController) {
        tracked.sdkAbortController.abort();
        // TASK_2025_175: Wait briefly for SDK process to respond to abort.
        // AbortController.abort() is synchronous but the SDK needs a tick
        // to process the signal and tear down resources.
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      return;
    }

    if (!child.pid) return;

    if (process.platform === 'win32') {
      // Windows: use taskkill to kill process tree
      try {
        await execFileAsync('taskkill', [
          '/pid',
          String(child.pid),
          '/T',
          '/F',
        ]);
      } catch {
        // taskkill failed (process already dead or access denied), fallback
        try {
          child.kill();
        } catch {
          /* already dead */
        }
      }
    } else {
      // Unix: SIGTERM then SIGKILL after grace period
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        let resolved = false;

        const killTimeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          try {
            child.kill('SIGKILL');
          } catch {
            /* already dead */
          }
          resolve();
        }, KILL_GRACE_PERIOD);

        child.on('exit', () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(killTimeout);
          resolve();
        });
      });
    }
  }

  private getRunningCount(): number {
    return Array.from(this.agents.values()).filter(
      (t) => t.info.status === 'running'
    ).length;
  }

  private getRunningAgentIds(): string[] {
    return Array.from(this.agents.entries())
      .filter(([, t]) => t.info.status === 'running')
      .map(([id]) => id);
  }

  private getMaxConcurrentAgents(): number {
    const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');
    return config.get<number>('maxConcurrentAgents', 5);
  }

  private async getDefaultCli(): Promise<CliType | null> {
    // Check user preference first
    const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');
    const preferred = config.get<string>('defaultCli');
    this.logger.debug('[AgentProcessManager] getDefaultCli: user preference', {
      preferred: preferred ?? 'none (auto-detect)',
    });

    if (preferred) {
      // Validate preferred CLI is a known adapter
      const adapter = this.cliDetection.getAdapter(preferred as CliType);
      if (adapter) {
        const detection = await this.cliDetection.getDetection(
          preferred as CliType
        );
        if (detection?.installed) {
          this.logger.info(
            '[AgentProcessManager] getDefaultCli: using user-preferred CLI',
            { cli: preferred }
          );
          return preferred as CliType;
        }
        this.logger.warn(
          '[AgentProcessManager] getDefaultCli: preferred CLI not installed, falling back',
          { preferred, installed: detection?.installed }
        );
      }
    }

    // Auto-detect: prefer gemini > codex > copilot among headless CLI agents
    const installed = await this.cliDetection.getInstalledClis();
    this.logger.debug('[AgentProcessManager] getDefaultCli: installed CLIs', {
      count: installed.length,
      clis: installed.map((c) => `${c.cli}${c.installed ? ' ✓' : ' ✗'}`),
    });

    if (installed.length === 0) return null;

    // Prefer gemini, then codex, then copilot, then fall back to first available
    const gemini = installed.find((c) => c.cli === 'gemini');
    if (gemini) return 'gemini';

    const codex = installed.find((c) => c.cli === 'codex');
    if (codex) return 'codex';

    const copilot = installed.find((c) => c.cli === 'copilot');
    if (copilot) return 'copilot';

    return installed[0].cli;
  }

  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return process.cwd();
  }

  /**
   * TASK_2025_186: Mark all running subagents for a parent session as CLI-orchestrating.
   * This prevents markAllInterrupted() from killing them when the parent session ends.
   * CLI agents run independently and should only stop on their own completion, timeout,
   * or explicit user action.
   */
  private markParentSubagentsAsCliAgent(
    parentSessionId: string | undefined
  ): void {
    if (!parentSessionId) return;

    const running = this.subagentRegistry.getRunningBySession(parentSessionId);

    if (running.length === 0) {
      this.logger.debug(
        '[AgentProcessManager] No running subagents found to mark as CLI-orchestrating',
        { parentSessionId }
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
        }
      );
    }
  }

  private validateWorkingDirectory(dir: string): void {
    const workspaceRoot = this.getWorkspaceRoot();
    // Normalize paths for cross-platform comparison
    const normalizedDir = dir.replace(/\\/g, '/').toLowerCase();
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/').toLowerCase();
    if (!normalizedDir.startsWith(normalizedRoot)) {
      throw new Error(
        `Working directory must be within workspace root. ` +
          `Got: ${dir}, Expected prefix: ${workspaceRoot}`
      );
    }
  }

  /**
   * Resolve MCP server port for CLI agents, gated on premium status + server health.
   * Returns the port number if both conditions are met, undefined otherwise.
   * Mirrors the premium gating pattern from SdkQueryOptionsBuilder.buildMcpServers().
   *
   * Health check results are cached for 30 seconds to avoid repeated HTTP calls
   * when spawning multiple agents in rapid succession.
   */
  private async resolveMcpPort(): Promise<number | undefined> {
    try {
      // Check 1: Is user premium? Use cached status first (no network call),
      // fall back to verifyLicense() if cache is empty.
      const cached = this.licenseService.getCachedStatus();
      const status = cached ?? (await this.licenseService.verifyLicense());
      const isPremium =
        status.tier === 'pro' ||
        status.tier === 'trial_pro' ||
        status.plan?.isPremium === true;

      if (!isPremium) {
        this.logger.info(
          '[AgentProcessManager] MCP disabled for CLI agent (not premium)',
          {
            tier: status.tier,
          }
        );
        return undefined;
      }

      // Check 2: Is MCP server running? Use cached health check result if fresh.
      const configuredPort = vscode.workspace
        .getConfiguration('ptah')
        .get<number>('mcpPort', 51820);

      if (
        this.mcpHealthCache &&
        Date.now() - this.mcpHealthCache.timestamp <
          AgentProcessManager.MCP_HEALTH_CACHE_TTL
      ) {
        return this.mcpHealthCache.port;
      }

      // Health check: verify server is actually running
      try {
        const response = await fetch(
          `http://localhost:${configuredPort}/health`,
          {
            signal: AbortSignal.timeout(2000),
          }
        );

        if (response.ok) {
          this.mcpHealthCache = { port: configuredPort, timestamp: Date.now() };
          this.logger.info('[AgentProcessManager] MCP enabled for CLI agent', {
            port: configuredPort,
          });
          return configuredPort;
        }

        this.mcpHealthCache = { port: undefined, timestamp: Date.now() };
        this.logger.info(
          '[AgentProcessManager] MCP server health check failed',
          {
            port: configuredPort,
            status: response.status,
          }
        );
        return undefined;
      } catch {
        this.mcpHealthCache = { port: undefined, timestamp: Date.now() };
        this.logger.info(
          '[AgentProcessManager] MCP server not reachable, disabling for CLI agent'
        );
        return undefined;
      }
    } catch {
      this.logger.info(
        '[AgentProcessManager] MCP port resolution failed (license check error)'
      );
      return undefined;
    }
  }

  // sanitizeTask removed: spawn() without shell:true doesn't need it,
  // and stripping metachar chars corrupts legitimate prompts.

  private tailLines(str: string, n: number): string {
    const lines = str.split('\n');
    return lines.slice(-n).join('\n');
  }
}

/**
 * Merge consecutive segments of the same streamable type into a single segment.
 * SDK adapters (e.g. Copilot) emit per-token text/thinking segments which causes
 * one-word-per-line rendering in the agent card. This collapses adjacent
 * segments of the same type while preserving segment-type boundaries.
 *
 * Mergeable types: 'text', 'thinking' (both are content-only streaming types).
 */
/**
 * Cap stream events buffer by dropping oldest delta events while preserving
 * landmark events that establish the execution tree structure.
 * Landmarks (message_start, tool_start, etc.) are always kept.
 * The remaining budget is filled with the most recent non-landmark (delta) events.
 * Events are returned in their original order.
 *
 * Mirrors the frontend capStreamEvents() in agent-monitor.store.ts.
 */
function capStreamEvents(
  events: FlatStreamEventUnion[],
  max: number
): FlatStreamEventUnion[] {
  if (events.length <= max) return events;

  const landmarks: Array<{ event: FlatStreamEventUnion; index: number }> = [];
  const deltas: Array<{ event: FlatStreamEventUnion; index: number }> = [];
  for (let i = 0; i < events.length; i++) {
    if (LANDMARK_EVENT_TYPES.has(events[i].eventType)) {
      landmarks.push({ event: events[i], index: i });
    } else {
      deltas.push({ event: events[i], index: i });
    }
  }

  const deltasBudget = max - landmarks.length;
  if (deltasBudget <= 0) {
    return landmarks.slice(-max).map((l) => l.event);
  }

  const keptDeltas = deltas.slice(-deltasBudget);
  const merged = [...landmarks, ...keptDeltas].sort(
    (a, b) => a.index - b.index
  );
  return merged.map((m) => m.event);
}

function mergeConsecutiveTextSegments(
  segments: CliOutputSegment[]
): CliOutputSegment[] {
  if (segments.length <= 1) return segments;

  const result: CliOutputSegment[] = [];
  let buffer = '';
  let bufferType: 'text' | 'thinking' | null = null;

  for (const seg of segments) {
    if (seg.type === 'text' || seg.type === 'thinking') {
      if (bufferType === seg.type) {
        // Same type — accumulate
        buffer += seg.content;
      } else {
        // Different type — flush previous buffer
        if (buffer && bufferType) {
          result.push({ type: bufferType, content: buffer });
        }
        buffer = seg.content;
        bufferType = seg.type;
      }
    } else {
      // Non-mergeable segment — flush buffer and push
      if (buffer && bufferType) {
        result.push({ type: bufferType, content: buffer });
        buffer = '';
        bufferType = null;
      }
      result.push(seg);
    }
  }

  if (buffer && bufferType) {
    result.push({ type: bufferType, content: buffer });
  }

  return result;
}
