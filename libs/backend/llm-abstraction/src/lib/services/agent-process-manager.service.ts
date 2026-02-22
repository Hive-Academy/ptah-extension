/**
 * Agent Process Manager
 * TASK_2025_157: Manages headless CLI agent child processes
 *
 * Responsibilities:
 * - Spawn CLI agent processes (gemini, codex)
 * - Track process state, output buffers, timeouts
 * - Enforce concurrent agent limits
 * - Graceful shutdown on extension deactivation
 * - Cross-platform process termination (SIGTERM/taskkill)
 */
import { injectable, inject } from 'tsyringe';
import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import {
  AgentId,
  AgentStatus,
  AgentProcessInfo,
  SpawnAgentRequest,
  SpawnAgentResult,
  AgentOutput,
  CliType,
} from '@ptah-extension/shared';
import { CliDetectionService } from './cli-detection.service';
import type {
  CliCommandOptions,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';

const execFileAsync = promisify(execFile);

/** Maximum output buffer size per agent (1MB) */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** Default timeout: 10 minutes */
const DEFAULT_TIMEOUT = 10 * 60 * 1000;

/** Maximum timeout: 30 minutes */
const MAX_TIMEOUT = 30 * 60 * 1000;

/** Grace period for SIGTERM before SIGKILL: 5 seconds */
const KILL_GRACE_PERIOD = 5000;

/** TTL for completed agents before cleanup from map: 30 minutes */
const COMPLETED_AGENT_TTL = 30 * 60 * 1000;

/**
 * Shell metacharacters that must be stripped from task input
 * to prevent injection on both bash and CMD.exe
 */
const SHELL_METACHAR_PATTERN = /[`$(){}|&<>^;%!]/g;

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
}

@injectable()
export class AgentProcessManager {
  private readonly agents = new Map<string, TrackedAgent>();
  /** Counter for in-flight spawn operations (not yet in agents map) */
  private spawning = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService
  ) {
    this.logger.info('[AgentProcessManager] Initialized');
  }

  /**
   * Spawn a new CLI agent process
   */
  async spawn(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    // Increment spawning counter synchronously before any async work
    this.spawning++;

    try {
      return await this.doSpawn(request);
    } finally {
      this.spawning--;
    }
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

    // Determine which CLI to use
    const cli = request.cli ?? (await this.getDefaultCli());
    if (!cli) {
      throw new Error(
        'No CLI agent available. Install Gemini CLI (`npm install -g @google/gemini-cli`) ' +
          'or Codex CLI and authenticate before using agent orchestration.'
      );
    }

    // Verify CLI is installed
    const detection = await this.cliDetection.getDetection(cli);
    if (!detection || !detection.installed) {
      throw new Error(
        `${cli} CLI is not installed. Install it and run authentication before using.`
      );
    }

    // Get adapter and build command
    const adapter = this.cliDetection.getAdapter(cli);
    if (!adapter) {
      throw new Error(`No adapter registered for CLI: ${cli}`);
    }

    // Validate working directory
    const workingDirectory =
      request.workingDirectory ?? this.getWorkspaceRoot();
    this.validateWorkingDirectory(workingDirectory);

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
        cli
      );
    }

    // Sanitize task to prevent shell injection (CLI spawn path only)
    const sanitizedTask = this.sanitizeTask(request.task);

    const command = adapter.buildCommand({
      task: sanitizedTask,
      workingDirectory,
      files: request.files,
      taskFolder: request.taskFolder,
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
    };

    // Use resolved binary path from detection to avoid shell: true
    const binaryPath = detection.path ?? command.binary;

    // Spawn the process
    this.logger.info('[AgentProcessManager] Spawning agent', {
      agentId,
      cli,
      binary: binaryPath,
      args: command.args.length,
      workingDirectory,
    });

    const childProcess = spawn(binaryPath, command.args, {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...command.env },
    });

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

    return {
      agentId,
      cli,
      status: 'running',
      startedAt,
    };
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
    cli: CliType
  ): Promise<SpawnAgentResult> {
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
    };

    this.logger.info('[AgentProcessManager] Spawning SDK agent', {
      agentId,
      cli,
      workingDirectory,
    });

    const sdkHandle = await runSdk({
      task,
      workingDirectory,
      files: request.files,
      taskFolder: request.taskFolder,
    });

    // Set up timeout (same as CLI path)
    const timeout = Math.min(request.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
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
    };

    this.agents.set(agentId, tracked);

    // Wire SDK output to the agent's stdout buffer
    sdkHandle.onOutput((data: string) => {
      this.appendBuffer(agentId, 'stdout', data);
    });

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

    return {
      agentId,
      cli,
      status: 'running',
      startedAt,
    };
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
    tracked.info = { ...tracked.info, status: 'stopped' };
    clearTimeout(tracked.timeoutHandle);
    this.scheduleCleanup(agentId);

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

    // Clear all cleanup timers on shutdown
    for (const [, tracked] of this.agents) {
      if (tracked.cleanupHandle) {
        clearTimeout(tracked.cleanupHandle);
      }
    }

    this.logger.info(
      `[AgentProcessManager] ${running.length} agents shut down`
    );
  }

  // ========================================
  // Private Methods
  // ========================================

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
  }

  private async handleTimeout(agentId: string): Promise<void> {
    const tracked = this.agents.get(agentId);
    if (!tracked || tracked.info.status !== 'running') return;

    this.logger.warn('[AgentProcessManager] Agent timed out', { agentId });
    tracked.info = { ...tracked.info, status: 'timeout' };
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
      };
    }

    this.scheduleCleanup(agentId);

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

  private async killProcess(tracked: TrackedAgent): Promise<void> {
    const child = tracked.process;

    // SDK-based agent: abort via AbortController instead of process signals
    if (!child) {
      if (tracked.sdkAbortController) {
        tracked.sdkAbortController.abort();
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
    return config.get<number>('maxConcurrentAgents', 3);
  }

  private async getDefaultCli(): Promise<CliType | null> {
    // Check user preference first
    const config = vscode.workspace.getConfiguration('ptah.agentOrchestration');
    const preferred = config.get<string>('defaultCli');
    if (preferred) {
      // Validate preferred CLI is a known adapter (supports future additions like 'vscode-lm')
      const adapter = this.cliDetection.getAdapter(preferred as CliType);
      if (adapter) {
        const detection = await this.cliDetection.getDetection(
          preferred as CliType
        );
        if (detection?.installed) {
          return preferred as CliType;
        }
      }
    }

    // Auto-detect: prefer gemini > codex, then any other installed CLI
    const installed = await this.cliDetection.getInstalledClis();
    if (installed.length === 0) return null;

    // Prefer gemini, then codex, then fall back to first available
    const gemini = installed.find((c) => c.cli === 'gemini');
    if (gemini) return 'gemini';

    const codex = installed.find((c) => c.cli === 'codex');
    if (codex) return 'codex';

    return installed[0].cli;
  }

  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return process.cwd();
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
   * Sanitize task input to prevent shell injection.
   * Strips all shell metacharacters for both bash and CMD.exe.
   */
  private sanitizeTask(task: string): string {
    return task.replace(SHELL_METACHAR_PATTERN, '');
  }

  private tailLines(str: string, n: number): string {
    const lines = str.split('\n');
    return lines.slice(-n).join('\n');
  }
}
