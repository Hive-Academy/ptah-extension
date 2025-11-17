/**
 * Claude CLI Launcher - Orchestrates CLI process spawning with permissions and session management
 * SOLID: Dependency Inversion - Depends on abstractions (SessionManager, PermissionService)
 */

import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';
import * as os from 'os';
import {
  SessionId,
  ClaudeCliLaunchOptions,
  ClaudePermissionRequest,
} from '@ptah-extension/shared';
import { ClaudeInstallation } from '../detector/claude-cli-detector';
import { SessionManager } from '../session/session-manager';
import { PermissionService } from '../permissions/permission-service';
import { ProcessManager } from './process-manager';
import { JSONLStreamParser, JSONLParserCallbacks } from './jsonl-stream-parser';
import { ClaudeDomainEventPublisher } from '../events/claude-domain.events';

export interface LauncherDependencies {
  readonly sessionManager: SessionManager;
  readonly permissionService: PermissionService;
  readonly processManager: ProcessManager;
  readonly eventPublisher: ClaudeDomainEventPublisher;
}

/**
 * Launches Claude CLI processes with integrated session/permission/event handling
 */
export class ClaudeCliLauncher {
  constructor(
    private readonly installation: ClaudeInstallation,
    private readonly deps: LauncherDependencies
  ) {}

  /**
   * Spawn a new Claude CLI turn
   */
  async spawnTurn(
    message: string,
    options: ClaudeCliLaunchOptions
  ): Promise<Readable> {
    const { sessionId, model, resumeSessionId, workspaceRoot } = options;

    // Build CLI arguments WITHOUT message (message goes to stdin, not args!)
    const args = this.buildArgs(model, resumeSessionId);

    // Determine execution context
    const cwd = workspaceRoot || process.cwd();

    // CRITICAL FIX: Use direct Node.js execution if available (bypasses Windows cmd.exe buffering)
    const { command, commandArgs, needsShell } = this.buildSpawnCommand(args);

    console.log('[ClaudeCliLauncher] ===== SPAWNING CLI PROCESS =====');
    console.log('[ClaudeCliLauncher] Original path:', this.installation.path);
    console.log(
      '[ClaudeCliLauncher] Using direct execution:',
      this.installation.useDirectExecution
    );
    console.log(
      '[ClaudeCliLauncher] Resolved cli.js:',
      this.installation.cliJsPath
    );
    console.log('[ClaudeCliLauncher] Command:', command);
    console.log(
      '[ClaudeCliLauncher] Args:',
      JSON.stringify(commandArgs, null, 2)
    );
    console.log('[ClaudeCliLauncher] CWD:', cwd);
    console.log('[ClaudeCliLauncher] Shell:', needsShell);
    console.log('[ClaudeCliLauncher] Session:', sessionId);
    console.log('[ClaudeCliLauncher] Message length:', message.length, 'chars');
    console.log(
      '[ClaudeCliLauncher] Message preview:',
      message.substring(0, 100)
    );

    // Spawn child process
    const childProcess = spawn(command, commandArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'], // Explicit stdio: stdin, stdout, stderr
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        // CRITICAL: Disable output buffering on Windows
        PYTHONUNBUFFERED: '1',
        NODE_NO_READLINE: '1',
      },
      shell: needsShell,
      // CRITICAL: Set windowsVerbatimArguments to prevent command-line escaping issues
      windowsVerbatimArguments: false,
    });

    console.log('[ClaudeCliLauncher] Process spawned, PID:', childProcess.pid);

    // CRITICAL: Set encoding on stdout to force line-buffered mode
    if (childProcess.stdout) {
      childProcess.stdout.setEncoding('utf8');
    }
    if (childProcess.stderr) {
      childProcess.stderr.setEncoding('utf8');
    }

    // Log stdio setup
    console.log(
      '[ClaudeCliLauncher] stdin writable:',
      childProcess.stdin?.writable
    );
    console.log(
      '[ClaudeCliLauncher] stdout readable:',
      childProcess.stdout?.readable
    );
    console.log(
      '[ClaudeCliLauncher] stderr readable:',
      childProcess.stderr?.readable
    );

    // CRITICAL: Write message to stdin (but DON'T close it for permissions!)
    if (childProcess.stdin) {
      console.log('[ClaudeCliLauncher] Writing message to stdin...');
      childProcess.stdin.write(message + '\n');
      // NOTE: We do NOT call stdin.end() here because permissions require
      // writing responses to stdin later. stdin will be closed when the
      // process exits or we explicitly kill it.
      console.log(
        '[ClaudeCliLauncher] Message written, stdin kept open for permissions'
      );
    } else {
      console.error('[ClaudeCliLauncher] ERROR: stdin is null!');
    }

    // Register process
    this.deps.processManager.registerProcess(
      sessionId,
      childProcess,
      this.installation.path,
      args
    );

    // Create streaming output with event handling
    return this.createStreamingPipeline(childProcess, sessionId);
  }

  /**
   * Build CLI arguments array
   * Message is written to stdin, NOT passed as argument (per working-example.md)
   */
  private buildArgs(model?: string, resumeSessionId?: string): string[] {
    // CRITICAL: --verbose is REQUIRED when using --output-format=stream-json
    // CRITICAL: --include-partial-messages enables token-by-token streaming
    // Message goes to STDIN, not as an argument!
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (model && model !== 'default') {
      args.push('--model', model);
    }

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    return args;
  }

  /**
   * Build spawn command with direct Node.js execution support
   * Returns: { command, commandArgs, needsShell }
   *
   * If useDirectExecution is true (Windows with resolved cli.js):
   *   command: "node" or process.execPath
   *   commandArgs: ["C:\...\cli.js", ...cliArgs]
   *   needsShell: false
   *
   * Otherwise (fallback to wrapper):
   *   command: "claude.cmd" or "/usr/local/bin/claude"
   *   commandArgs: [...cliArgs]
   *   needsShell: true on Windows for .cmd/.bat
   */
  private buildSpawnCommand(cliArgs: string[]): {
    command: string;
    commandArgs: string[];
    needsShell: boolean;
  } {
    // Strategy 1: Direct Node.js execution (bypasses Windows cmd.exe buffering)
    if (this.installation.useDirectExecution && this.installation.cliJsPath) {
      return {
        command: process.execPath, // Path to node.exe/node
        commandArgs: [this.installation.cliJsPath, ...cliArgs],
        needsShell: false, // No shell needed for direct node execution!
      };
    }

    // Strategy 2: Fallback to wrapper (shell spawning, potential buffering on Windows)
    const needsShell = this.needsShellExecution();
    return {
      command: this.installation.path,
      commandArgs: cliArgs,
      needsShell,
    };
  }

  /**
   * Determine if shell execution is needed for wrapper (Windows CMD/BAT files)
   */
  private needsShellExecution(): boolean {
    if (os.platform() !== 'win32') {
      return false;
    }

    const path = this.installation.path.toLowerCase();
    return (
      path.endsWith('.cmd') ||
      path.endsWith('.bat') ||
      (!path.includes('\\') && !path.includes('/'))
    );
  }

  /**
   * Create streaming pipeline with JSONL parsing and event emission
   */
  private createStreamingPipeline(
    childProcess: ChildProcess,
    sessionId: SessionId
  ): Readable {
    if (!childProcess.stdout) {
      throw new Error('Child process stdout is null');
    }

    const outputStream = new Readable({
      objectMode: true,
      read() {
        // Resume child process stdout when consumer is ready for more data
        if (childProcess.stdout?.isPaused()) {
          childProcess.stdout.resume();
        }
      },
    });

    /**
     * Helper to push data with backpressure handling
     * Pauses child process stdout if internal buffer is full
     */
    const pushWithBackpressure = (data: unknown): void => {
      const canContinue = outputStream.push(data);
      if (
        !canContinue &&
        childProcess.stdout &&
        !childProcess.stdout.isPaused()
      ) {
        // Buffer is full - pause source stream to prevent memory issues
        childProcess.stdout.pause();
      }
    };

    // Create parser with event callbacks
    const callbacks: JSONLParserCallbacks = {
      onSessionInit: (claudeSessionId, model) => {
        console.log(
          '[ClaudeCliLauncher] Session initialized:',
          claudeSessionId,
          'Model:',
          model
        );
        this.deps.sessionManager.setClaudeSessionId(sessionId, claudeSessionId);
        this.deps.eventPublisher.emitSessionInit(
          sessionId,
          claudeSessionId,
          model
        );
      },

      onContent: (chunk) => {
        console.log(
          '[ClaudeCliLauncher] Content chunk:',
          chunk.delta?.substring(0, 50)
        );
        this.deps.sessionManager.touchSession(sessionId);
        this.deps.eventPublisher.emitContentChunk(sessionId, chunk);
        pushWithBackpressure({ type: 'content', data: chunk });
      },

      onThinking: (thinking) => {
        console.log('[ClaudeCliLauncher] Thinking event');
        this.deps.eventPublisher.emitThinking(sessionId, thinking);
        pushWithBackpressure({ type: 'thinking', data: thinking });
      },

      onTool: (toolEvent) => {
        console.log('[ClaudeCliLauncher] Tool event:', toolEvent.type);
        this.deps.eventPublisher.emitToolEvent(sessionId, toolEvent);
        pushWithBackpressure({ type: 'tool', data: toolEvent });
      },

      onPermission: async (request) => {
        console.log(
          '[ClaudeCliLauncher] Permission request:',
          request.toolCallId
        );
        await this.handlePermissionRequest(sessionId, request, childProcess);
      },

      onError: (error, rawLine) => {
        console.error('[ClaudeCliLauncher] Parser error:', error.message);
        console.error('[ClaudeCliLauncher] Raw line:', rawLine);
        this.deps.eventPublisher.emitError(error.message, sessionId, {
          rawLine,
        });
      },
    };

    const parser = new JSONLStreamParser(callbacks);

    // Pipe stdout through parser
    childProcess.stdout.on('data', (chunk: Buffer) => {
      console.log(
        '[ClaudeCliLauncher] Received stdout chunk:',
        chunk.length,
        'bytes'
      );
      console.log(
        '[ClaudeCliLauncher] Chunk preview:',
        chunk.toString().substring(0, 200)
      );
      parser.processChunk(chunk);
    });

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        const stderr = data.toString();
        console.error('[ClaudeCliLauncher] STDERR:', stderr);
        if (stderr.trim()) {
          this.deps.eventPublisher.emitError(stderr, sessionId);
        }
      });
    }

    // Handle process close
    childProcess.on('close', (code) => {
      console.log('[ClaudeCliLauncher] Process closed with code:', code);
      parser.processEnd();
      outputStream.push(null); // End stream

      const reason = code === 0 ? 'completed' : `exit code ${code}`;
      this.deps.eventPublisher.emitSessionEnd(sessionId, reason);
    });

    // Handle process error
    childProcess.on('error', (error) => {
      console.error('[ClaudeCliLauncher] Process error:', error.message);
      this.deps.eventPublisher.emitError(error.message, sessionId);
      outputStream.destroy(error);
    });

    return outputStream;
  }

  /**
   * Handle permission request from CLI
   */
  private async handlePermissionRequest(
    sessionId: SessionId,
    request: ClaudePermissionRequest,
    childProcess: ChildProcess
  ): Promise<void> {
    console.log('[ClaudeCliLauncher] ===== PERMISSION REQUEST =====');
    console.log('[ClaudeCliLauncher] Tool:', request.tool);
    console.log('[ClaudeCliLauncher] Tool Call ID:', request.toolCallId);
    console.log(
      '[ClaudeCliLauncher] Args:',
      JSON.stringify(request.args, null, 2)
    );

    // Get permission decision
    const response = await this.deps.permissionService.requestDecision(request);
    console.log('[ClaudeCliLauncher] Decision:', response.decision);
    console.log('[ClaudeCliLauncher] Provenance:', response.provenance);

    // Emit permission request event (for UI to potentially override)
    this.deps.eventPublisher.emitPermissionRequested(sessionId, request);

    // Emit permission response
    this.deps.eventPublisher.emitPermissionResponded(sessionId, response);

    // Send response to CLI stdin if still writable
    if (childProcess.stdin && !childProcess.stdin.destroyed) {
      const permissionResponse = {
        type: 'permission',
        subtype: 'response',
        tool_call_id: request.toolCallId,
        decision: response.decision,
      };

      console.log(
        '[ClaudeCliLauncher] Writing permission response to stdin:',
        JSON.stringify(permissionResponse)
      );
      childProcess.stdin.write(JSON.stringify(permissionResponse) + '\n');
      console.log('[ClaudeCliLauncher] Permission response sent');
    } else {
      console.error(
        '[ClaudeCliLauncher] ERROR: Cannot send permission response - stdin is not writable!'
      );
      console.error('[ClaudeCliLauncher] stdin exists:', !!childProcess.stdin);
      console.error(
        '[ClaudeCliLauncher] stdin destroyed:',
        childProcess.stdin?.destroyed
      );
    }
  }

  /**
   * Kill active process for a session
   */
  killSession(sessionId: SessionId): boolean {
    return this.deps.processManager.killProcess(sessionId);
  }
}
