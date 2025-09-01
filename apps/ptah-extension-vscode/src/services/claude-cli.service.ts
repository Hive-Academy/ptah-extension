import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';
import { Logger } from '../core/logger';
import { CommandResult } from '@ptah-extension/shared';
import {
  ClaudeCliDetector,
  ClaudeInstallation,
} from './claude-cli-detector.service';
import {
  SessionId,
  MessageId,
  CorrelationId,
  BrandedTypeValidator,
} from '@ptah-extension/shared';
import { StrictChatMessage, MessageResponse } from '@ptah-extension/shared';

export class ClaudeCliService implements vscode.Disposable {
  private activeProcesses = new Map<SessionId | string, ChildProcess>();
  private claudeInstallation: ClaudeInstallation | null = null;
  private detector: ClaudeCliDetector;
  private lastSessionId?: string;
  private pendingPermissionRequests = new Map<
    string,
    {
      toolCallId: string;
      requestMessage: string;
      timestamp: number;
    }
  >();

  constructor() {
    this.detector = new ClaudeCliDetector();
  }

  async verifyInstallation(): Promise<boolean> {
    try {
      Logger.info('🔍 Verifying Claude Code CLI installation...');

      if (this.claudeInstallation) {
        const isValid = await this.detector.validateInstallation(
          this.claudeInstallation
        );
        if (isValid) {
          Logger.info(
            `✅ Existing Claude CLI installation verified: ${this.claudeInstallation.path}`
          );
          return true;
        }
      }

      // Detect Claude CLI installation using dedicated detector service
      this.claudeInstallation = await this.detector.detectClaudeInstallation();

      if (this.claudeInstallation) {
        Logger.info(
          `✅ Claude CLI detected: ${this.claudeInstallation.path} (${this.claudeInstallation.source})`
        );
        return true;
      }

      Logger.error(
        '❌ Claude Code CLI not found. Please install it with: npm install -g @anthropic-ai/claude-code'
      );
      return false;
    } catch (error) {
      Logger.error('Error verifying Claude CLI installation', error);
      return false;
    }
  }

  /**
   * Send a message to Claude and get streaming response
   * Each call spawns a new process (one process per turn pattern)
   */
  async sendMessage(
    message: string,
    sessionId?: SessionId | string,
    resumeSessionId?: string,
    sessionManager?: {
      setClaudeSessionId: (sessionId: string, claudeSessionId: string) => void;
    }
  ): Promise<Readable> {
    if (!this.claudeInstallation) {
      throw new Error('Claude CLI not found. Please install Claude Code.');
    }

    // Validate and convert sessionId to branded type
    const validatedSessionId = sessionId
      ? typeof sessionId === 'string'
        ? BrandedTypeValidator.validateSessionId(sessionId)
        : sessionId
      : SessionId.create();

    // Build args following working example pattern
    const args: string[] = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
    ];

    // Add resume flag if we have a session to continue
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd = workspaceRoot || process.cwd();

    Logger.info(
      `Sending message to Claude CLI${
        resumeSessionId ? ` (resuming session: ${resumeSessionId})` : ''
      }`
    );
    Logger.info(`Command: ${this.claudeInstallation.path} ${args.join(' ')}`);

    // Determine if we need shell on Windows for PATH resolution
    const needsShell =
      process.platform === 'win32' &&
      !this.claudeInstallation.path.includes('\\') &&
      !this.claudeInstallation.path.includes('/');

    const childProcess = spawn(this.claudeInstallation.path, args, {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      shell: needsShell,
    });

    // Capture stderr for error diagnostics
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        const stderr = data.toString();
        if (stderr.trim()) {
          Logger.error(`Claude CLI stderr: ${stderr}`);
        }
      });
    }

    // CRITICAL: Write message and immediately close stdin (following working example)
    if (childProcess.stdin) {
      childProcess.stdin.write(message + '\n');
      childProcess.stdin.end();
    }

    this.activeProcesses.set(validatedSessionId, childProcess);

    // Create simplified streaming pipeline
    return this.createSimplifiedStreamPipeline(
      childProcess,
      validatedSessionId,
      sessionManager
    );
  }

  /**
   * Create simplified stream pipeline for JSONL parsing
   * Following the working example pattern - direct line-by-line JSON parsing
   */
  private createSimplifiedStreamPipeline(
    childProcess: ChildProcess,
    sessionId: SessionId,
    sessionManager?: {
      setClaudeSessionId: (sessionId: string, claudeSessionId: string) => void;
    }
  ): Readable {
    if (!childProcess.stdout) {
      throw new Error('Child process stdout is null');
    }

    const outputStream = new Readable({
      objectMode: true,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      read() {},
    });

    let buffer = '';
    let currentSessionId: string | undefined;

    // Process stdout line by line (JSONL format)
    childProcess.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed);

          // Track session ID from init message
          if (
            json.type === 'system' &&
            json.subtype === 'init' &&
            json.session_id
          ) {
            currentSessionId = json.session_id;
            Logger.info(
              `Received session ID from Claude CLI: ${currentSessionId}`
            );

            // Notify session manager if available
            if (
              sessionManager &&
              sessionManager.setClaudeSessionId &&
              currentSessionId
            ) {
              sessionManager.setClaudeSessionId(
                sessionId.toString(),
                currentSessionId
              );
            }
          }

          // Convert to your message format and push to stream
          const messageResponse = this.convertClaudeJsonToMessageResponse(
            json,
            sessionId
          );
          if (messageResponse) {
            outputStream.push(messageResponse);
          }
        } catch (error) {
          Logger.warn(`Failed to parse JSON line: ${trimmed}`, error);
        }
      }
    });

    childProcess.on('close', (code) => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer.trim());
          const messageResponse = this.convertClaudeJsonToMessageResponse(
            json,
            sessionId
          );
          if (messageResponse) {
            outputStream.push(messageResponse);
          }
        } catch (error) {
          Logger.warn(`Failed to parse final buffer: ${buffer}`, error);
        }
      }

      // Store the session ID for future use
      if (currentSessionId) {
        this.lastSessionId = currentSessionId;
      }

      outputStream.push(null); // Signal end of stream
      this.activeProcesses.delete(sessionId);
    });

    childProcess.on('error', (error) => {
      Logger.error('Claude CLI process error', { error, sessionId });
      outputStream.destroy(error);
    });

    return outputStream;
  }

  getLastSessionId(): string | undefined {
    return this.lastSessionId;
  }

  /**
   * Check if message is a system initialization message
   */
  private isSystemInit(message: any): boolean {
    // System init messages have these characteristics from the logs
    return (
      message &&
      ((message.session_id && message.model && message.tools && message.cwd) ||
        (message.type === 'system' && message.role === 'system') ||
        (message.data && message.data.type === 'system'))
    );
  }

  /**
   * Convert actual Claude CLI JSON to our message response format
   * SURGICAL FIX: Handle direct Claude CLI JSON format correctly
   */
  private convertClaudeJsonToMessageResponse(
    json: any,
    sessionId: SessionId
  ): MessageResponse<StrictChatMessage> | null {
    try {
      // Handle system messages (session initialization)
      if (json.type === 'system' && json.subtype === 'init') {
        Logger.info(`Claude CLI Session Initialized: ${json.session_id}`);
        // Don't send system messages to UI
        return null;
      }

      // Handle assistant messages (Claude's responses)
      if (json.type === 'assistant') {
        for (const content of json.message.content) {
          // Handle text content
          if (content.type === 'text' && content.text.trim()) {
            const chatMessage: StrictChatMessage = {
              type: 'assistant',
              id: MessageId.create(),
              sessionId,
              content: content.text.trim(),
              timestamp: Date.now(),
              streaming: json.message.stop_reason === null,
              isComplete: json.message.stop_reason !== null,
            };

            return {
              requestId: CorrelationId.create(),
              success: true,
              data: chatMessage,
              metadata: {
                sessionId,
                timestamp: Date.now(),
                source: 'extension' as const,
                version: '1.0',
              },
            };
          }

          // Handle thinking content (Claude's reasoning)
          if (content.type === 'thinking' && content.thinking.trim()) {
            const chatMessage: StrictChatMessage = {
              type: 'assistant',
              id: MessageId.create(),
              sessionId,
              content: `💭 ${content.thinking.trim()}`,
              timestamp: Date.now(),
              streaming: json.message.stop_reason === null,
              isComplete: json.message.stop_reason !== null,
            };

            return {
              requestId: CorrelationId.create(),
              success: true,
              data: chatMessage,
              metadata: {
                sessionId,
                timestamp: Date.now(),
                source: 'extension' as const,
                version: '1.0',
              },
            };
          }

          // Handle tool usage
          if (content.type === 'tool_use') {
            let toolDisplay = `🔧 Executing: ${content.name}`;

            // Special formatting for TodoWrite
            if (content.name === 'TodoWrite' && content.input.todos) {
              toolDisplay += '\nTodo List Update:';
              for (const todo of content.input.todos) {
                const status =
                  todo.status === 'completed'
                    ? '✅'
                    : todo.status === 'in_progress'
                    ? '🔄'
                    : '⏳';
                toolDisplay += `\n${status} ${todo.content}`;
              }
            }

            const chatMessage: StrictChatMessage = {
              type: 'assistant',
              id: MessageId.create(),
              sessionId,
              content: toolDisplay,
              timestamp: Date.now(),
              streaming: json.message.stop_reason === null,
              isComplete: json.message.stop_reason !== null,
            };

            return {
              requestId: CorrelationId.create(),
              success: true,
              data: chatMessage,
              metadata: {
                sessionId,
                timestamp: Date.now(),
                source: 'extension' as const,
                version: '1.0',
              },
            };
          }
        }
      }

      // Handle user messages (tool results)
      if (json.type === 'user') {
        for (const content of json.message.content) {
          if (content.type === 'tool_result') {
            // Handle permission requests (is_error: true)
            if (content.is_error) {
              if (content.content.includes('Claude requested permissions')) {
                const permissionResult = this.handlePermissionRequest(
                  content,
                  sessionId
                );
                if (permissionResult) {
                  return permissionResult;
                }
                // Return null if permission was sent to popup (no chat message needed)
                return null;
              } else {
                // Show other errors
                const chatMessage: StrictChatMessage = {
                  type: 'system',
                  id: MessageId.create(),
                  sessionId,
                  content: `❌ Error: ${content.content}`,
                  timestamp: Date.now(),
                  streaming: false,
                  isComplete: true,
                };

                return {
                  requestId: CorrelationId.create(),
                  success: true,
                  data: chatMessage,
                  metadata: {
                    sessionId,
                    timestamp: Date.now(),
                    source: 'extension' as const,
                    version: '1.0',
                  },
                };
              }
            } else {
              // Filter tool results (hide verbose ones unless error)
              const hiddenTools = ['Read', 'Edit', 'TodoWrite', 'MultiEdit'];
              const toolName = content.tool_name || 'Unknown';

              if (!hiddenTools.includes(toolName)) {
                const chatMessage: StrictChatMessage = {
                  type: 'assistant',
                  id: MessageId.create(),
                  sessionId,
                  content: `📋 Tool Result (${toolName}):\n${content.content}`,
                  timestamp: Date.now(),
                  streaming: false,
                  isComplete: true,
                };

                return {
                  requestId: CorrelationId.create(),
                  success: true,
                  data: chatMessage,
                  metadata: {
                    sessionId,
                    timestamp: Date.now(),
                    source: 'extension' as const,
                    version: '1.0',
                  },
                };
              }
            }
          }
        }
      }

      // Handle result messages (session completion)
      if (json.type === 'result') {
        const chatMessage: StrictChatMessage = {
          type: 'system',
          id: MessageId.create(),
          sessionId,
          content: `✅ Session completed. Tokens: ${
            json.usage?.input_tokens || 0
          }/${json.usage?.output_tokens || 0}`,
          timestamp: Date.now(),
          streaming: false,
          isComplete: true,
        };

        return {
          requestId: CorrelationId.create(),
          success: true,
          data: chatMessage,
          metadata: {
            sessionId,
            timestamp: Date.now(),
            source: 'extension' as const,
            version: '1.0',
          },
        };
      }

      return null;
    } catch (error) {
      Logger.error('Error converting Claude CLI message:', error);
      return null;
    }
  }

  /**
   * Handle permission requests from Claude CLI
   * SURGICAL FIX: Send permission request to popup instead of chat messages
   */
  private handlePermissionRequest(
    content: any,
    sessionId: SessionId
  ): MessageResponse<StrictChatMessage> | null {
    const permissionMessage = content.content;

    // Store pending permission request for this session
    this.pendingPermissionRequests.set(sessionId.toString(), {
      toolCallId: content.tool_call_id,
      requestMessage: permissionMessage,
      timestamp: Date.now(),
    });

    // Extract tool information from permission message
    const toolMatch = permissionMessage.match(
      /Claude requested permissions for: (.+?)$/m
    );
    const actionMatch =
      permissionMessage.match(/Action: (.+?)$/m) ||
      permissionMessage.match(/to (.+?)$/m);

    const permissionData = {
      id: `perm_${sessionId}_${Date.now()}`,
      tool: toolMatch?.[1] || 'Claude Tool',
      action: actionMatch?.[1] || 'execute command',
      description: permissionMessage,
      timestamp: Date.now(),
      sessionId: sessionId.toString(),
    };

    // Send permission request to webview popup instead of chat
    this.sendPermissionRequestToWebview(permissionData);

    Logger.info('Permission request sent to popup UI');

    // Return null to prevent chat message creation
    return null;
  }

  /**
   * Send permission request to webview for popup display
   */
  private sendPermissionRequestToWebview(permissionData: any): void {
    try {
      // Access the extension instance and its services through the registry architecture
      const { PtahExtension } = require('../core/ptah-extension');
      const extension = PtahExtension.instance;

      if (!extension) {
        Logger.warn(
          'PtahExtension instance not available for permission request'
        );
        return;
      }

      const services = extension.getServices();

      if (!services?.angularWebviewProvider) {
        Logger.warn(
          'AngularWebviewProvider not available for permission request'
        );
        return;
      }

      // Send permission request message to the webview using existing provider
      services.angularWebviewProvider.sendMessage({
        type: 'chat:permissionRequest',
        payload: permissionData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0',
        },
      });

      Logger.info('Permission request sent to webview popup successfully', {
        requestId: permissionData.id,
        tool: permissionData.tool,
        sessionId: permissionData.sessionId,
      });
    } catch (error) {
      Logger.error('Failed to send permission request to webview:', error);

      // Fallback: Log detailed permission info for debugging
      Logger.info(
        'Permission request details (fallback logging):',
        permissionData
      );
    }
  }

  /**
   * Handle permission response from user and send to Claude CLI
   */
  async respondToPermission(
    sessionId: SessionId,
    response: 'allow' | 'always_allow' | 'deny'
  ): Promise<void> {
    const pendingRequest = this.pendingPermissionRequests.get(
      sessionId.toString()
    );
    if (!pendingRequest) {
      Logger.warn(
        `No pending permission request found for session: ${sessionId}`
      );
      return;
    }

    try {
      Logger.info(
        `Responding to permission request for session ${sessionId} with: ${response}`
      );

      // Get the active process for this session
      const activeProcess = this.activeProcesses.get(sessionId);
      if (!activeProcess || !activeProcess.stdin) {
        Logger.error(
          `No active Claude CLI process found for session: ${sessionId}`
        );
        return;
      }

      // Send permission response to Claude CLI via stdin
      // Claude CLI expects permission responses in this format: response_type\n
      let responseCommand: string;
      switch (response) {
        case 'allow':
          responseCommand = 'allow\n';
          break;
        case 'always_allow':
          responseCommand = 'always\n';
          break;
        case 'deny':
          responseCommand = 'deny\n';
          break;
        default:
          responseCommand = 'deny\n';
      }

      // Send the response to Claude CLI
      if (activeProcess.stdin.writable) {
        activeProcess.stdin.write(responseCommand);
        Logger.info(
          `Permission response '${response}' sent to Claude CLI for session: ${sessionId}`
        );
      } else {
        Logger.error(`Claude CLI stdin not writable for session: ${sessionId}`);
      }

      // Clear the pending request
      this.pendingPermissionRequests.delete(sessionId.toString());
    } catch (error) {
      Logger.error(
        `Error responding to permission request for session ${sessionId}:`,
        error
      );
    }
  }

  /**
   * Extract text content from Claude message content array
   */
  private extractTextContent(content: any[]): string {
    if (!Array.isArray(content)) return '';

    let text = '';
    for (const item of content) {
      if (item.type === 'text' && item.text) {
        text += item.text;
      }
    }
    return text;
  }

  async executeCommand(
    command: string,
    args: string[],
    options: { timeout?: number } = {}
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { stdio: 'pipe' });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => (stdout += data));
      process.stderr?.on('data', (data) => (stderr += data));

      const timeoutId = options.timeout
        ? setTimeout(() => {
            process.kill();
            reject(new Error(`Command timeout after ${options.timeout}ms`));
          }, options.timeout)
        : null;

      process.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          success: code === 0,
          stdout,
          stderr,
          code: code || 0,
        });
      });

      process.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  endSession(sessionId: SessionId | string): void {
    const validatedSessionId =
      typeof sessionId === 'string'
        ? BrandedTypeValidator.validateSessionId(sessionId)
        : sessionId;

    const process = this.activeProcesses.get(validatedSessionId);
    if (process && !process.killed) {
      process.kill();
    }
    this.activeProcesses.delete(validatedSessionId);
  }

  dispose(): void {
    Logger.info('Disposing Claude CLI service...');

    // Clean up all active processes
    for (const [sessionId, process] of this.activeProcesses) {
      if (!process.killed) {
        process.kill();
      }
    }
    this.activeProcesses.clear();

    Logger.info('Claude CLI service disposed');
  }
}
