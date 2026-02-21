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

/** Maximum output buffer size per agent (1MB) */
const MAX_BUFFER_SIZE = 1024 * 1024;

/** Default timeout: 10 minutes */
const DEFAULT_TIMEOUT = 10 * 60 * 1000;

/** Maximum timeout: 30 minutes */
const MAX_TIMEOUT = 30 * 60 * 1000;

/** Grace period for SIGTERM before SIGKILL: 5 seconds */
const KILL_GRACE_PERIOD = 5000;

interface TrackedAgent {
  info: AgentProcessInfo;
  process: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  timeoutHandle: NodeJS.Timeout;
  stdoutLineCount: number;
  stderrLineCount: number;
  truncated: boolean;
}

@injectable()
export class AgentProcessManager {
  private readonly agents = new Map<string, TrackedAgent>();

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
    // Check concurrent limit
    const maxConcurrent = this.getMaxConcurrentAgents();
    const runningCount = this.getRunningCount();
    if (runningCount >= maxConcurrent) {
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

    // Sanitize task to prevent shell injection
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

    // Spawn the process
    this.logger.info('[AgentProcessManager] Spawning agent', {
      agentId,
      cli,
      binary: command.binary,
      args: command.args.length,
      workingDirectory,
    });

    const childProcess = spawn(command.binary, command.args, {
      cwd: workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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

  private handleTimeout(agentId: string): void {
    const tracked = this.agents.get(agentId);
    if (!tracked || tracked.info.status !== 'running') return;

    this.logger.warn('[AgentProcessManager] Agent timed out', { agentId });
    tracked.info = { ...tracked.info, status: 'timeout' };
    this.killProcess(tracked);
  }

  private handleExit(
    agentId: string,
    code: number | null,
    signal: string | null
  ): void {
    const tracked = this.agents.get(agentId);
    if (!tracked) return;

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

    this.logger.info('[AgentProcessManager] Agent exited', {
      agentId,
      status: tracked.info.status,
      exitCode: code,
      signal,
    });
  }

  private async killProcess(tracked: TrackedAgent): Promise<void> {
    const child = tracked.process;
    if (!child.pid) return;

    if (process.platform === 'win32') {
      // Windows: use taskkill to kill process tree
      try {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch {
        child.kill();
      }
    } else {
      // Unix: SIGTERM then SIGKILL after grace period
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const killTimeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already dead */
          }
          resolve();
        }, KILL_GRACE_PERIOD);

        child.on('exit', () => {
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
    if (preferred && (preferred === 'gemini' || preferred === 'codex')) {
      const detection = await this.cliDetection.getDetection(
        preferred as CliType
      );
      if (detection?.installed) {
        return preferred as CliType;
      }
    }

    // Auto-detect: prefer gemini, then codex
    const installed = await this.cliDetection.getInstalledClis();
    if (installed.length === 0) return null;

    // Prefer gemini over codex
    const gemini = installed.find((c) => c.cli === 'gemini');
    if (gemini) return 'gemini';
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

  private sanitizeTask(task: string): string {
    // Remove shell injection patterns
    return task.replace(/`/g, "'").replace(/\$\(/g, '(').replace(/\$\{/g, '{');
  }

  private tailLines(str: string, n: number): string {
    const lines = str.split('\n');
    return lines.slice(-n).join('\n');
  }
}
