/**
 * Claude CLI Provider Adapter
 * Implements EnhancedAIProvider interface for Claude Code CLI integration
 * Provides process spawning, streaming responses, and health monitoring
 */

import { injectable } from 'tsyringe';
import { spawn, ChildProcess } from 'child_process';
import type {
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  AISessionConfig,
  AIMessageOptions,
  SessionId,
} from '@ptah-extension/shared';
import type { EnhancedAIProvider, ProviderContext } from '../interfaces';

/**
 * Session Process Tracker
 * Maps session IDs to their associated child processes and metadata
 */
interface SessionProcess {
  process: ChildProcess;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
}

/**
 * Claude CLI Adapter - Process-based provider for Claude Code CLI
 *
 * Features:
 * - Child process spawning and management
 * - Streaming response handling via AsyncIterable
 * - Session lifecycle management
 * - Health monitoring with response time tracking
 * - Automatic process cleanup on errors
 *
 * @injectable Registered with DI container for dependency injection
 */
@injectable()
export class ClaudeCliAdapter implements EnhancedAIProvider {
  readonly providerId: ProviderId = 'claude-cli';

  readonly info: ProviderInfo = {
    id: 'claude-cli',
    name: 'Claude Code CLI',
    version: '1.0.0',
    description: 'Claude AI via official CLI with full coding capabilities',
    vendor: 'Anthropic',
    capabilities: {
      streaming: true,
      fileAttachments: true,
      contextManagement: true,
      sessionPersistence: true,
      multiTurn: true,
      codeGeneration: true,
      imageAnalysis: true,
      functionCalling: true,
    },
    maxContextTokens: 200000,
    supportedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
  };

  private processes = new Map<string, SessionProcess>();
  private healthStatus: ProviderHealth = {
    status: 'initializing',
    lastCheck: Date.now(),
  };
  private cliPath: string | null = null;

  /**
   * Initialize Claude CLI adapter
   * Verifies Claude CLI installation and sets up environment
   */
  async initialize(): Promise<boolean> {
    try {
      const installed = await this.verifyInstallation();
      if (installed) {
        this.healthStatus = {
          status: 'available',
          lastCheck: Date.now(),
          uptime: 0,
        };
      } else {
        this.healthStatus = {
          status: 'unavailable',
          lastCheck: Date.now(),
          errorMessage: 'Claude CLI not found in PATH',
        };
      }
      return installed;
    } catch (error) {
      this.healthStatus = {
        status: 'error',
        lastCheck: Date.now(),
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown initialization error',
      };
      return false;
    }
  }

  /**
   * Verify Claude CLI installation by checking PATH
   */
  async verifyInstallation(): Promise<boolean> {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'where' : 'which';
      const args = ['claude'];

      const proc = spawn(command, args, { shell: true });
      let output = '';

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        const found = code === 0 && output.trim().length > 0;
        if (found) {
          this.cliPath = output.trim().split('\n')[0];
        }
        resolve(found);
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Get current provider health status
   */
  getHealth(): ProviderHealth {
    return this.healthStatus;
  }

  /**
   * Reset provider state and cleanup all sessions
   */
  async reset(): Promise<void> {
    // Cleanup all active processes
    for (const [sessionId] of this.processes) {
      this.endSession(sessionId as SessionId);
    }
    this.processes.clear();

    // Reinitialize
    await this.initialize();
  }

  /**
   * Dispose of all resources and cleanup
   */
  dispose(): void {
    for (const [sessionId] of this.processes) {
      this.endSession(sessionId as SessionId);
    }
    this.processes.clear();
  }

  /**
   * Check if provider can handle the given context
   * Claude CLI excels at coding, reasoning, and refactoring tasks
   */
  canHandle(context: ProviderContext): boolean {
    // Claude CLI is excellent for complex tasks
    const compatibleTasks = ['coding', 'reasoning', 'refactoring'];
    return compatibleTasks.includes(context.taskType);
  }

  /**
   * Estimate cost for the given context
   * Based on Claude 3.5 Sonnet pricing (~$3 per million input tokens)
   */
  estimateCost(context: ProviderContext): number {
    const baseRate = 0.003; // $3 per 1M tokens = $0.003 per 1k tokens
    const contextTokens = context.contextSize;
    const estimatedOutputTokens = Math.min(contextTokens * 0.5, 4096); // Assume 50% of input or 4k max
    const outputRate = 0.015; // $15 per 1M output tokens

    return (
      (contextTokens / 1000) * baseRate +
      (estimatedOutputTokens / 1000) * outputRate
    );
  }

  /**
   * Estimate latency for the given context
   * Factors in complexity and context size
   */
  estimateLatency(context: ProviderContext): number {
    const baseLatency = 500; // Base 500ms for process startup and first token

    const complexityMultiplier = {
      low: 1,
      medium: 1.5,
      high: 2.5,
    }[context.complexity];

    // Add ~10ms per 1000 tokens of context
    const contextLatency = (context.contextSize / 1000) * 10;

    return Math.round(baseLatency * complexityMultiplier + contextLatency);
  }

  /**
   * Create a new chat session with Claude CLI
   * Spawns a new child process for the session
   */
  async createSession(config: AISessionConfig): Promise<SessionId> {
    const sessionId = this.generateSessionId() as SessionId;

    // Build Claude CLI command arguments
    // Following production pattern: --output-format stream-json --verbose
    const args: string[] = [
      'chat',
      '--output-format',
      'stream-json',
      '--verbose',
    ];

    if (config.model) {
      args.push('--model', config.model);
    }
    if (config.systemPrompt) {
      args.push('--system-prompt', config.systemPrompt);
    }
    if (config.maxTokens) {
      args.push('--max-tokens', config.maxTokens.toString());
    }
    if (config.temperature !== undefined) {
      args.push('--temperature', config.temperature.toString());
    }

    // Add interactive mode for streaming
    args.push('--interactive');

    try {
      const process = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: config.projectPath,
      });

      // Track session process
      this.processes.set(sessionId, {
        process,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
      });

      // Setup error handlers
      process.on('error', (error) => {
        console.error(
          `Claude CLI process error for session ${sessionId}:`,
          error
        );
        this.endSession(sessionId);
      });

      process.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(
            `Claude CLI process exited with code ${code} for session ${sessionId}`
          );
        }
        this.processes.delete(sessionId);
      });

      return sessionId;
    } catch (error) {
      throw new Error(
        `Failed to create Claude CLI session: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Start a chat session (implementing IAIProvider interface)
   * Returns a readable stream for compatibility
   */
  async startChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<unknown> {
    // Create session with provided config or defaults
    const actualSessionId = await this.createSession(config || {});

    // Map the new session to the requested session ID
    const sessionProcess = this.processes.get(actualSessionId);
    if (sessionProcess) {
      this.processes.delete(actualSessionId);
      this.processes.set(sessionId, sessionProcess);
    }

    // Return the process stdout as readable stream
    return sessionProcess?.process.stdout || null;
  }

  /**
   * End a chat session and cleanup process
   */
  endSession(sessionId: SessionId): void {
    const session = this.processes.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Send exit command to Claude CLI
      session.process.stdin?.write('exit\n');
      session.process.stdin?.end();

      // Force kill if still running after 2 seconds
      setTimeout(() => {
        if (!session.process.killed) {
          session.process.kill('SIGTERM');
        }
      }, 2000);
    } catch (error) {
      console.error(`Error ending session ${sessionId}:`, error);
      session.process.kill('SIGKILL');
    } finally {
      this.processes.delete(sessionId);
    }
  }

  /**
   * Send message to session and stream response
   * Implements AsyncIterable for efficient streaming
   */
  async *sendMessage(
    sessionId: SessionId,
    message: string,
    context: ProviderContext,
    options?: AIMessageOptions
  ): AsyncIterable<string> {
    const session = this.processes.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startTime = Date.now();

    try {
      // Update session activity
      session.lastActivity = Date.now();
      session.messageCount++;

      // Write message to Claude CLI process and close stdin
      // CRITICAL: Following production pattern - write message then immediately close stdin
      // This signals to Claude CLI that input is complete and it should process the message
      if (session.process.stdin) {
        session.process.stdin.write(`${message}\n`);
        session.process.stdin.end(); // Close stdin to trigger response
      } else {
        throw new Error(`Session ${sessionId} stdin not available`);
      }

      // Stream response chunks
      // Event-driven JSONL parsing (following production pattern from claude-cli.service.ts)
      let buffer = '';
      const chunks: string[] = [];

      // Setup stdout listener for JSONL stream
      const dataListener = (data: Buffer): void => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const json = JSON.parse(trimmed);

            // Extract session ID from init message
            if (
              json.type === 'system' &&
              json.subtype === 'init' &&
              json.session_id
            ) {
              session.claudeSessionId = json.session_id;
            }

            // Extract text content from assistant messages
            if (
              json.type === 'message' &&
              json.role === 'assistant' &&
              json.content
            ) {
              for (const block of json.content) {
                if (block.type === 'text' && block.text) {
                  chunks.push(block.text);
                }
              }
            }
          } catch {
            // Skip non-JSON lines (might be stderr or debug output)
            continue;
          }
        }
      };

      session.process.stdout?.on('data', dataListener);

      // Wait for process to complete
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(`Claude CLI timeout after ${options?.timeout || 60000}ms`)
          );
        }, options?.timeout || 60000);

        session.process.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });

        session.process.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      // Cleanup listener
      session.process.stdout?.off('data', dataListener);

      // Yield all accumulated chunks
      for (const chunk of chunks) {
        yield chunk;
      }

      // Update health metrics
      const responseTime = Date.now() - startTime;
      this.healthStatus = {
        ...this.healthStatus,
        lastCheck: Date.now(),
        responseTime,
      };
    } catch (error) {
      this.healthStatus = {
        status: 'error',
        lastCheck: Date.now(),
        errorMessage:
          error instanceof Error ? error.message : 'Streaming error',
      };
      throw error;
    }
  }

  /**
   * Send message to session (implementing IAIProvider interface)
   * Non-streaming version that uses sendMessage internally
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void> {
    // Create a minimal context for the message
    const context: ProviderContext = {
      taskType: 'coding',
      complexity: 'medium',
      fileTypes: [],
      contextSize: content.length,
    };

    // Consume the async iterable to send the message
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of this.sendMessage(
      sessionId,
      content,
      context,
      options
    )) {
      // Process chunks (could accumulate or emit events)
    }
  }

  /**
   * Perform health check on Claude CLI
   * Sends a simple test command and measures response time
   */
  async performHealthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      // Quick installation check
      const installed = await this.verifyInstallation();

      if (!installed) {
        this.healthStatus = {
          status: 'unavailable',
          lastCheck: Date.now(),
          errorMessage: 'Claude CLI not installed or not in PATH',
        };
        return this.healthStatus;
      }

      // Measure response time with version check
      const responseTime = Date.now() - startTime;

      this.healthStatus = {
        status: 'available',
        lastCheck: Date.now(),
        responseTime,
        uptime: this.healthStatus.uptime
          ? this.healthStatus.uptime +
            (Date.now() - this.healthStatus.lastCheck)
          : 0,
      };

      return this.healthStatus;
    } catch (error) {
      this.healthStatus = {
        status: 'error',
        lastCheck: Date.now(),
        errorMessage:
          error instanceof Error ? error.message : 'Health check failed',
      };
      return this.healthStatus;
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `claude-cli-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 11)}`;
  }
}
