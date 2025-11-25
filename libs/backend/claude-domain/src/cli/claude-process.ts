/**
 * ClaudeProcess - Simple spawn-based Claude CLI process manager
 *
 * Philosophy: Direct spawn pattern - no complex state machines.
 * 1. Spawn claude CLI process with --output-format stream-json
 * 2. Write prompt to stdin, close stdin
 * 3. Parse stdout JSONL line-by-line
 * 4. Emit events for each message
 *
 * Batch 4 - TASK_2025_023
 */

import { JSONLMessage } from '@ptah-extension/shared';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';

/**
 * Options for spawning Claude CLI process
 */
export interface ClaudeProcessOptions {
  /** Model to use (opus, sonnet, haiku) */
  model?: 'opus' | 'sonnet' | 'haiku';
  /** Session ID to resume */
  resumeSessionId?: string;
  /** Enable verbose output */
  verbose?: boolean;
}

/**
 * ClaudeProcess - Event-driven Claude CLI process wrapper
 *
 * Events:
 * - 'message': (msg: JSONLMessage) => void - JSONL message received
 * - 'error': (error: Error) => void - Process or parse error
 * - 'close': (code: number | null) => void - Process closed
 */
export class ClaudeProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';

  constructor(
    private readonly cliPath: string,
    private readonly workspacePath: string
  ) {
    super();
  }

  /**
   * Start new conversation with initial prompt
   */
  async start(prompt: string, options?: ClaudeProcessOptions): Promise<void> {
    if (this.process) {
      throw new Error('ClaudeProcess already running. Call kill() first.');
    }

    const args = this.buildArgs(options);
    this.spawnProcess(args, prompt);
  }

  /**
   * Resume existing session with new prompt
   */
  async resume(sessionId: string, prompt: string): Promise<void> {
    if (this.process) {
      throw new Error('ClaudeProcess already running. Call kill() first.');
    }

    const args = this.buildArgs({ resumeSessionId: sessionId, verbose: true });
    this.spawnProcess(args, prompt);
  }

  /**
   * Kill the active process
   */
  kill(): void {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Check if process is currently running
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Build CLI arguments array
   */
  private buildArgs(options?: ClaudeProcessOptions): string[] {
    const args = [
      '-p', // Print mode (don't enter interactive)
      '--output-format',
      'stream-json',
      '--verbose',
    ];

    if (options?.model && options.model !== 'sonnet') {
      args.push('--model', options.model);
    }

    if (options?.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    return args;
  }

  /**
   * Spawn Claude CLI process
   */
  private spawnProcess(args: string[], prompt: string): void {
    const { command, commandArgs, needsShell } = this.buildSpawnCommand(args);

    this.process = spawn(command, commandArgs, {
      cwd: this.workspacePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1',
        NODE_NO_READLINE: '1',
      },
      shell: needsShell,
      windowsVerbatimArguments: false,
    });

    // Set encoding for stdout/stderr
    if (this.process.stdout) {
      this.process.stdout.setEncoding('utf8');
    }
    if (this.process.stderr) {
      this.process.stderr.setEncoding('utf8');
    }

    // Write prompt to stdin and close
    if (this.process.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(prompt + '\n');
      this.process.stdin.end();
    }

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Build spawn command (handles direct execution vs shell)
   */
  private buildSpawnCommand(cliArgs: string[]): {
    command: string;
    commandArgs: string[];
    needsShell: boolean;
  } {
    // For now, use cliPath directly
    // Future: Could check for direct execution (.js file)
    return {
      command: this.cliPath,
      commandArgs: cliArgs,
      needsShell: this.needsShellExecution(),
    };
  }

  /**
   * Determine if shell execution is needed
   *
   * CRITICAL: On Windows, npm-installed global commands (like `claude`) are
   * .cmd wrapper scripts. Node.js spawn() with shell:false CANNOT execute
   * .cmd files - it only works for native .exe executables.
   *
   * Infrastructure tests confirmed:
   * - shell: false + "claude" → ENOENT (fails)
   * - shell: true + "claude" → Works (uses cmd.exe to run claude.cmd)
   *
   * Therefore: ALWAYS use shell:true on Windows unless it's an .exe with full path.
   */
  private needsShellExecution(): boolean {
    // On non-Windows, never need shell
    if (os.platform() !== 'win32') {
      return false;
    }

    const pathLower = this.cliPath.toLowerCase();

    // If it's an explicit .exe with full path, we can spawn directly
    if (pathLower.endsWith('.exe') && pathLower.includes('\\')) {
      return false;
    }

    // Everything else on Windows needs shell:
    // - PATH commands like "claude" resolve to .cmd wrappers
    // - .cmd and .bat files require shell execution
    // - Relative paths may resolve to .cmd files
    return true;
  }

  /**
   * Setup stdout/stderr/close event handlers
   */
  private setupEventHandlers(): void {
    if (!this.process) return;

    // Parse stdout as JSONL
    this.process.stdout?.on('data', (chunk: Buffer | string) => {
      this.processChunk(chunk);
    });

    // Log stderr
    this.process.stderr?.on('data', (data: Buffer | string) => {
      console.error('[ClaudeProcess] STDERR:', data.toString());
    });

    // Handle process close
    this.process.on('close', (code) => {
      // Process any remaining buffer
      if (this.buffer.trim()) {
        this.parseLine(this.buffer);
        this.buffer = '';
      }
      this.emit('close', code);
      this.process = null;
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.emit('error', error);
      this.process = null;
    });
  }

  /**
   * Process incoming stdout chunk
   */
  private processChunk(chunk: Buffer | string): void {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split('\n');

    // Keep last incomplete line in buffer
    this.buffer = lines.pop() || '';

    // Parse complete lines
    for (const line of lines) {
      if (line.trim()) {
        this.parseLine(line);
      }
    }
  }

  /**
   * Parse single JSONL line and emit message event
   */
  private parseLine(line: string): void {
    try {
      const parsed = JSON.parse(line) as JSONLMessage;
      this.emit('message', parsed);
    } catch (error) {
      this.emit(
        'error',
        new Error(
          `Failed to parse JSONL: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    }
  }
}
