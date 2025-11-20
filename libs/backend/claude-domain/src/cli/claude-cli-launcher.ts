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

    // Build CLI arguments (message will be sent via stdin)
    const args = this.buildArgs(model, resumeSessionId);

    // Determine execution context
    const cwd = workspaceRoot || process.cwd();

    // CRITICAL FIX: Use direct Node.js execution if available (bypasses Windows cmd.exe buffering)
    const { command, commandArgs, needsShell } = this.buildSpawnCommand(args);

    // PHASE 3: Debug logging for spawn diagnostics
    console.log(
      '[ClaudeCliLauncher] =========================================='
    );
    console.log('[ClaudeCliLauncher] SPAWN CONFIGURATION:');
    console.log('[ClaudeCliLauncher] SessionID:', sessionId);
    console.log('[ClaudeCliLauncher] Platform:', os.platform());
    console.log(
      '[ClaudeCliLauncher] Installation Path:',
      this.installation.path
    );
    console.log(
      '[ClaudeCliLauncher] Installation Source:',
      this.installation.source
    );
    console.log(
      '[ClaudeCliLauncher] Use Direct Execution:',
      this.installation.useDirectExecution || false
    );
    console.log(
      '[ClaudeCliLauncher] CLI.js Path:',
      this.installation.cliJsPath || 'NONE'
    );
    console.log('[ClaudeCliLauncher] Spawn Command:', command);
    console.log('[ClaudeCliLauncher] Command Arguments:', commandArgs);
    console.log(
      '[ClaudeCliLauncher] Full Command:',
      `${command} ${commandArgs.join(' ')}`
    );
    console.log('[ClaudeCliLauncher] Needs Shell:', needsShell);
    console.log('[ClaudeCliLauncher] Working Directory:', cwd);
    console.log(
      '[ClaudeCliLauncher] Resume Session ID:',
      resumeSessionId || 'none'
    );
    console.log('[ClaudeCliLauncher] Model:', model || 'default');
    console.log(
      '[ClaudeCliLauncher] =========================================='
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

    // PHASE 3: Log successful spawn
    console.log(
      '[ClaudeCliLauncher] Process spawned successfully, PID:',
      childProcess.pid
    );

    // CRITICAL: Set encoding on stdout to force line-buffered mode
    if (childProcess.stdout) {
      childProcess.stdout.setEncoding('utf8');
    }
    if (childProcess.stderr) {
      childProcess.stderr.setEncoding('utf8');
    }

    // CRITICAL: Write message to stdin (required for -p flag)
    // The -p flag tells Claude CLI to read the message from stdin
    // CRITICAL: Must call stdin.end() to signal EOF, otherwise CLI hangs forever!
    if (childProcess.stdin && !childProcess.stdin.destroyed) {
      console.log('[ClaudeCliLauncher] Writing message to stdin:', {
        messageLength: message.length,
        messagePreview: message.substring(0, 50),
      });
      childProcess.stdin.write(message + '\n');
      console.log('[ClaudeCliLauncher] Message written to stdin');

      // CRITICAL FIX: End stdin to signal EOF (like echo pipe does)
      // Without this, Claude CLI waits forever for more stdin input!
      childProcess.stdin.end();
      console.log('[ClaudeCliLauncher] stdin ended (EOF signaled)');
    } else {
      console.error('[ClaudeCliLauncher] ERROR: stdin is not writable!');
    }

    // Register process
    this.deps.processManager.registerProcess(
      sessionId,
      childProcess,
      this.installation.path,
      args
    );

    // Create streaming output with event handling
    return this.createStreamingPipeline(
      childProcess,
      sessionId,
      command,
      needsShell
    );
  }

  /**
   * Build CLI arguments array
   * NOTE: Message is NOT passed as argument - it's written to stdin after spawn
   */
  private buildArgs(model?: string, resumeSessionId?: string): string[] {
    // CRITICAL: -p flag tells CLI to read message from stdin (NOT argument)
    // CRITICAL: --verbose is REQUIRED when using --output-format=stream-json
    // CRITICAL: --include-partial-messages enables token-by-token streaming
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
   *   command: "node" (resolved from PATH, NOT process.execPath which is Code.exe)
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
      // CRITICAL FIX: In VS Code extensions, process.execPath = Code.exe (Electron)
      // We need the actual node.exe path. Use 'node' and let system PATH resolve it.
      // This works because node.exe is in PATH when npm install works.
      return {
        command: 'node', // System will resolve to node.exe via PATH
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
   *
   * FIX: Always use shell on Windows for .cmd/.bat files OR bare commands OR non-.exe files
   * This fixes ENOENT errors when spawning NPM global installs (claude.cmd wrapper)
   *
   * Cross-platform behavior:
   * - Windows: shell=true for .cmd/.bat/bare commands/non-.exe (fixes NPM installs)
   * - Windows: shell=false for .exe files (direct execution, better performance)
   * - macOS/Linux: shell=false (symlinks work directly)
   */
  private needsShellExecution(): boolean {
    if (os.platform() !== 'win32') {
      return false;
    }

    const path = this.installation.path.toLowerCase();

    // Case 1: Explicit wrapper extensions MUST use shell
    if (path.endsWith('.cmd') || path.endsWith('.bat')) {
      return true;
    }

    // Case 2: Bare command without path (e.g., 'claude') needs shell to resolve from PATH
    if (!path.includes('\\') && !path.includes('/')) {
      return true;
    }

    // Case 3: Native .exe doesn't need shell (direct execution, better performance)
    if (path.endsWith('.exe')) {
      return false;
    }

    // Case 4: Default to shell for unknown extensions on Windows (safe fallback)
    // This handles edge cases like custom wrappers or unusual installation methods
    return true;
  }

  /**
   * Create streaming pipeline with JSONL parsing and event emission
   */
  private createStreamingPipeline(
    childProcess: ChildProcess,
    sessionId: SessionId,
    spawnCommand: string,
    spawnShell: boolean
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
        this.deps.sessionManager.setClaudeSessionId(sessionId, claudeSessionId);
        this.deps.eventPublisher.emitSessionInit(
          sessionId,
          claudeSessionId,
          model
        );
      },

      onContent: (chunk) => {
        this.deps.sessionManager.touchSession(sessionId);
        this.deps.eventPublisher.emitContentChunk(sessionId, chunk.blocks);
        pushWithBackpressure({ type: 'content', data: chunk });
      },

      onThinking: (thinking) => {
        this.deps.eventPublisher.emitThinking(sessionId, thinking);
        pushWithBackpressure({ type: 'thinking', data: thinking });
      },

      onTool: (toolEvent) => {
        this.deps.eventPublisher.emitToolEvent(sessionId, toolEvent);
        pushWithBackpressure({ type: 'tool', data: toolEvent });
      },

      onPermission: async (request) => {
        await this.handlePermissionRequest(sessionId, request, childProcess);
      },

      onError: (error, rawLine) => {
        console.error('[ClaudeCliLauncher] Parser error:', error.message);
        this.deps.eventPublisher.emitError(error.message, sessionId, {
          rawLine,
        });
      },

      onAgentStart: (event) => {
        this.deps.eventPublisher.emitAgentStarted(sessionId, event);
      },

      onAgentActivity: (event) => {
        this.deps.eventPublisher.emitAgentActivity(sessionId, event);
      },

      onAgentComplete: (event) => {
        this.deps.eventPublisher.emitAgentCompleted(sessionId, event);
      },

      onMessageStop: () => {
        console.log(
          '[ClaudeCliLauncher] Streaming complete (message_stop received)'
        );
        this.deps.eventPublisher.emitMessageComplete(sessionId);
      },

      onResult: (result) => {
        console.log('[ClaudeCliLauncher] Final result received:', {
          cost: result.total_cost_usd,
          duration: result.duration_ms,
          tokens: result.usage,
        });

        // Emit token usage if available
        if (result.usage) {
          this.deps.eventPublisher.emitTokenUsage(sessionId, {
            inputTokens: result.usage.input_tokens || 0,
            outputTokens: result.usage.output_tokens || 0,
            cacheReadTokens: result.usage.cache_read_input_tokens || 0,
            cacheCreationTokens: result.usage.cache_creation_input_tokens || 0,
            totalCost: result.total_cost_usd || 0,
          });
        }

        // Emit session end
        const reason = result.subtype === 'success' ? 'completed' : 'error';
        this.deps.eventPublisher.emitSessionEnd(sessionId, reason);
      },
    };

    const parser = new JSONLStreamParser(callbacks);

    // Pipe stdout through parser
    childProcess.stdout.on('data', (chunk: Buffer) => {
      console.log('[ClaudeCliLauncher] Received stdout data:', {
        chunkLength: chunk.length,
        chunkPreview: chunk.toString('utf8').substring(0, 200),
      });
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
      parser.processEnd();
      outputStream.push(null); // End stream

      const reason = code === 0 ? 'completed' : `exit code ${code}`;
      this.deps.eventPublisher.emitSessionEnd(sessionId, reason);
    });

    // Handle process error (ENOENT, EACCES, etc.)
    childProcess.on('error', (error) => {
      // PHASE 3: Enhanced error logging with diagnostic details
      console.error('[ClaudeCliLauncher] Process spawn/execution error:', {
        errorMessage: error.message,
        errorCode: (error as NodeJS.ErrnoException).code,
        sessionId,
        command: spawnCommand,
        needsShell: spawnShell,
        installationPath: this.installation.path,
        platform: os.platform(),
      });
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
    // Get permission decision
    const response = await this.deps.permissionService.requestDecision(request);

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

      childProcess.stdin.write(JSON.stringify(permissionResponse) + '\n');
    } else {
      console.error(
        '[ClaudeCliLauncher] ERROR: Cannot send permission response - stdin is not writable!'
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
