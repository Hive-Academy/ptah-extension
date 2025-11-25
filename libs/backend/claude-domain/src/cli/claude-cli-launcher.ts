/**
 * Claude CLI Launcher - TEMPORARY during TASK_2025_023 purge
 *
 * This file will be DELETED and replaced by ClaudeProcess in Batch 4.
 * For now, keeping minimal functionality with inline JSONL parsing.
 */

import {
  ClaudeCliLaunchOptions,
  ClaudePermissionRequest,
  SessionId,
} from '@ptah-extension/shared';
import { ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import { Readable } from 'stream';
import type * as vscode from 'vscode';
import { ClaudeInstallation } from '../detector/claude-cli-detector';
import { PermissionService } from '../permissions/permission-service';
import { ProcessManager } from './process-manager';

/**
 * Dependencies required by ClaudeCliLauncher
 */
export interface LauncherDependencies {
  readonly webview: vscode.Webview;
  readonly permissionService: PermissionService;
  readonly processManager: ProcessManager;
  readonly context: vscode.ExtensionContext;
}

/**
 * TEMPORARY: Inline JSONL parser callbacks
 * Will be replaced by ClaudeProcess in Batch 4
 */
interface JSONLParserCallbacks {
  onMessage: (message: unknown) => void;
  onPermission: (request: ClaudePermissionRequest) => Promise<void>;
  onError: (error: Error, rawLine?: string) => void;
}

/**
 * TEMPORARY: Inline JSONL parser
 * Will be replaced by ClaudeProcess in Batch 4
 */
class InlineJSONLParser {
  private buffer = '';

  constructor(private readonly callbacks: JSONLParserCallbacks) {}

  processChunk(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);

        // Check for permission request
        if (parsed.type === 'permission' && parsed.subtype === 'request') {
          void this.callbacks.onPermission(parsed as ClaudePermissionRequest);
        } else {
          this.callbacks.onMessage(parsed);
        }
      } catch (error) {
        this.callbacks.onError(
          error instanceof Error ? error : new Error(String(error)),
          line
        );
      }
    }
  }

  processEnd(): void {
    if (this.buffer.trim()) {
      try {
        const parsed = JSON.parse(this.buffer);
        this.callbacks.onMessage(parsed);
      } catch (error) {
        this.callbacks.onError(
          error instanceof Error ? error : new Error(String(error)),
          this.buffer
        );
      }
    }
    this.buffer = '';
  }
}

/**
 * TEMPORARY: ClaudeCliLauncher during purge
 * Will be replaced by ClaudeProcess in Batch 4
 */
export class ClaudeCliLauncher {
  constructor(
    private readonly installation: ClaudeInstallation,
    private readonly deps: LauncherDependencies
  ) {}

  /**
   * @deprecated Will be replaced by ClaudeProcess in Batch 4
   */
  async spawnTurn(
    message: string,
    options: ClaudeCliLaunchOptions
  ): Promise<Readable> {
    const { sessionId, model, resumeSessionId, workspaceRoot } = options;
    const args = this.buildArgs(model, resumeSessionId);
    const cwd = workspaceRoot || process.cwd();
    const { command, commandArgs, needsShell } = this.buildSpawnCommand(args);

    console.log('[ClaudeCliLauncher] SPAWN (TEMP):', {
      sessionId,
      command,
      commandArgs,
    });

    const mcpPort =
      this.deps.context?.workspaceState.get<number>('ptah.mcp.port');

    const childProcess = spawn(command, commandArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        PYTHONUNBUFFERED: '1',
        NODE_NO_READLINE: '1',
        ...(mcpPort && { PTAH_MCP_PORT: mcpPort.toString() }),
      },
      shell: needsShell,
      windowsVerbatimArguments: false,
    });

    if (childProcess.stdout) childProcess.stdout.setEncoding('utf8');
    if (childProcess.stderr) childProcess.stderr.setEncoding('utf8');

    if (childProcess.stdin && !childProcess.stdin.destroyed) {
      childProcess.stdin.write(message + '\n');
      childProcess.stdin.end();
    }

    this.deps.processManager.registerProcess(
      sessionId,
      childProcess,
      this.installation.path,
      args
    );

    return this.createStreamingPipeline(
      childProcess,
      sessionId,
      command,
      needsShell
    );
  }

  private buildArgs(model?: string, resumeSessionId?: string): string[] {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
    if (model && model !== 'default') args.push('--model', model);
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    return args;
  }

  private buildSpawnCommand(cliArgs: string[]): {
    command: string;
    commandArgs: string[];
    needsShell: boolean;
  } {
    if (this.installation.useDirectExecution && this.installation.cliJsPath) {
      return {
        command: 'node',
        commandArgs: [this.installation.cliJsPath, ...cliArgs],
        needsShell: false,
      };
    }
    return {
      command: this.installation.path,
      commandArgs: cliArgs,
      needsShell: this.needsShellExecution(),
    };
  }

  private needsShellExecution(): boolean {
    if (os.platform() !== 'win32') return false;
    const path = this.installation.path.toLowerCase();
    if (path.endsWith('.cmd') || path.endsWith('.bat')) return true;
    if (!path.includes('\\') && !path.includes('/')) return true;
    if (path.endsWith('.exe')) return false;
    return true;
  }

  private createStreamingPipeline(
    childProcess: ChildProcess,
    sessionId: SessionId,
    spawnCommand: string,
    spawnShell: boolean
  ): Readable {
    if (!childProcess.stdout) throw new Error('Child process stdout is null');

    const outputStream = new Readable({
      objectMode: true,
      read() {
        if (childProcess.stdout?.isPaused()) childProcess.stdout.resume();
      },
    });

    const callbacks: JSONLParserCallbacks = {
      onMessage: (message) => {
        this.deps.webview.postMessage({
          type: 'jsonl-message',
          data: { sessionId, message },
        });
      },
      onPermission: async (request) => {
        await this.handlePermissionRequest(sessionId, request, childProcess);
      },
      onError: (error, rawLine) => {
        console.error(
          '[ClaudeCliLauncher] Parser error:',
          error.message,
          rawLine
        );
      },
    };

    const parser = new InlineJSONLParser(callbacks);

    childProcess.stdout.on('data', (chunk: Buffer) =>
      parser.processChunk(chunk)
    );
    childProcess.stderr?.on('data', (data) =>
      console.error('[ClaudeCliLauncher] STDERR:', data.toString())
    );
    childProcess.on('close', (code) => {
      parser.processEnd();
      outputStream.push(null);
      console.log(`[ClaudeCliLauncher] Process closed: ${code}`);
    });
    childProcess.on('error', (error) => {
      console.error('[ClaudeCliLauncher] Process error:', error);
      outputStream.destroy(error);
    });

    return outputStream;
  }

  private async handlePermissionRequest(
    sessionId: SessionId,
    request: ClaudePermissionRequest,
    childProcess: ChildProcess
  ): Promise<void> {
    const response = await this.deps.permissionService.requestDecision(request);
    if (childProcess.stdin && !childProcess.stdin.destroyed) {
      childProcess.stdin.write(
        JSON.stringify({
          type: 'permission',
          subtype: 'response',
          tool_call_id: request.toolCallId,
          decision: response.decision,
        }) + '\n'
      );
    }
  }

  killSession(sessionId: SessionId): boolean {
    return this.deps.processManager.killProcess(sessionId);
  }

  /**
   * @deprecated Will be replaced by ClaudeProcess in Batch 4
   */
  spawnInteractiveSession(
    sessionId: SessionId,
    workspaceRoot?: string
  ): ChildProcess {
    const args = [
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--resume',
      sessionId,
    ];
    const cwd = workspaceRoot || process.cwd();
    const { command, commandArgs, needsShell } = this.buildSpawnCommand(args);

    const childProcess = spawn(command, commandArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: needsShell,
    });

    this.deps.processManager.registerProcess(
      sessionId,
      childProcess,
      command,
      commandArgs
    );
    return childProcess;
  }
}
