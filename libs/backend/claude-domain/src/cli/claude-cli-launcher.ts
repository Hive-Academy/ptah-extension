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
    const {
      sessionId,
      model,
      resumeSessionId,
      workspaceRoot,
      verbose = false,
    } = options;

    // Build CLI arguments
    const args = this.buildArgs(model, resumeSessionId, verbose);

    // Determine execution context
    const cwd = workspaceRoot || process.cwd();
    const needsShell = this.needsShellExecution();

    // Spawn child process
    const childProcess = spawn(this.installation.path, args, {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      shell: needsShell,
    });

    // Register process
    this.deps.processManager.registerProcess(
      sessionId,
      childProcess,
      this.installation.path,
      args
    );

    // Write message and close stdin (one-process-per-turn pattern)
    if (childProcess.stdin) {
      childProcess.stdin.write(message + '\n');
      childProcess.stdin.end();
    }

    // Create streaming output with event handling
    return this.createStreamingPipeline(childProcess, sessionId);
  }

  /**
   * Build CLI arguments array
   */
  private buildArgs(
    model?: string,
    resumeSessionId?: string,
    verbose = false
  ): string[] {
    const args = ['-p', '--output-format', 'stream-json'];

    if (verbose) {
      args.push('--verbose');
    }

    if (model && model !== 'default') {
      args.push('--model', model);
    }

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    return args;
  }

  /**
   * Determine if shell execution is needed (Windows CMD/BAT files)
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
        // No-op - push-based
      },
    });

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
        this.deps.eventPublisher.emitContentChunk(sessionId, chunk);
        outputStream.push({ type: 'content', data: chunk });
      },

      onThinking: (thinking) => {
        this.deps.eventPublisher.emitThinking(sessionId, thinking);
        outputStream.push({ type: 'thinking', data: thinking });
      },

      onTool: (toolEvent) => {
        this.deps.eventPublisher.emitToolEvent(sessionId, toolEvent);
        outputStream.push({ type: 'tool', data: toolEvent });
      },

      onPermission: async (request) => {
        await this.handlePermissionRequest(sessionId, request, childProcess);
      },

      onError: (error, rawLine) => {
        this.deps.eventPublisher.emitError(error.message, sessionId, {
          rawLine,
        });
      },
    };

    const parser = new JSONLStreamParser(callbacks);

    // Pipe stdout through parser
    childProcess.stdout.on('data', (chunk: Buffer) => {
      parser.processChunk(chunk);
    });

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        const stderr = data.toString();
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

    // Handle process error
    childProcess.on('error', (error) => {
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
    }
  }

  /**
   * Kill active process for a session
   */
  killSession(sessionId: SessionId): boolean {
    return this.deps.processManager.killProcess(sessionId);
  }
}
