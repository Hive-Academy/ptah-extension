/**
 * Session Process - Wraps a single interactive Claude CLI process
 *
 * Responsibilities:
 * - Manage one CLI process per session
 * - Queue messages when process is busy
 * - Detect turn boundaries (message_stop)
 * - Support pause/resume/stop
 * - Handle stdin backpressure
 */

import { ChildProcess } from 'child_process';
import type * as vscode from 'vscode';
import { SessionId } from '@ptah-extension/shared';
import { MessageQueue, QueuedMessage } from './message-queue';
import { JSONLStreamParser, JSONLParserCallbacks } from './jsonl-stream-parser';

export type SessionProcessState = 'idle' | 'processing' | 'paused' | 'stopped';

export interface SessionProcessMetadata {
  readonly sessionId: SessionId;
  readonly state: SessionProcessState;
  readonly queuedMessages: number;
  readonly processId?: number;
  readonly startedAt: number;
  readonly lastActivityAt: number;
}

/**
 * Wraps a single interactive Claude CLI process for a session
 */
export class SessionProcess {
  private state: SessionProcessState = 'idle';
  private messageQueue: MessageQueue;
  private currentTurnResolver?: () => void;
  private readonly startedAt: number;
  private lastActivityAt: number;
  private isProcessingQueue = false;

  constructor(
    private readonly sessionId: SessionId,
    private readonly process: ChildProcess,
    private readonly webview: vscode.Webview,
    maxQueueSize = 100
  ) {
    this.messageQueue = new MessageQueue(maxQueueSize);
    this.startedAt = Date.now();
    this.lastActivityAt = Date.now();
    this.setupStreamHandlers();
    this.setupProcessHandlers();
  }

  /**
   * Send message to this session
   * Queues if currently processing another message
   */
  async sendMessage(content: string, files?: readonly string[]): Promise<void> {
    if (this.state === 'stopped') {
      throw new Error('Session process is stopped');
    }

    // Queue message
    const message: QueuedMessage = {
      content,
      timestamp: Date.now(),
      files,
    };

    try {
      this.messageQueue.enqueue(message);
      this.lastActivityAt = Date.now();

      console.log('[SessionProcess] Message queued:', {
        sessionId: this.sessionId,
        queueSize: this.messageQueue.size(),
        state: this.state,
      });
    } catch (error) {
      // Queue full
      throw new Error(
        `Cannot send message: ${
          error instanceof Error ? error.message : 'Queue full'
        }`
      );
    }

    // Start processing queue if idle
    if (this.state === 'idle' && !this.isProcessingQueue) {
      await this.processQueue();
    }
  }

  /**
   * Pause current turn (SIGTSTP)
   */
  pause(): void {
    if (this.state !== 'processing') {
      console.warn('[SessionProcess] Cannot pause - not processing', {
        sessionId: this.sessionId,
        state: this.state,
      });
      return;
    }

    console.log('[SessionProcess] Pausing session:', this.sessionId);
    this.process.kill('SIGTSTP');
    this.state = 'paused';
    this.lastActivityAt = Date.now();

    // Notify frontend
    this.webview.postMessage({
      type: 'session-paused',
      data: { sessionId: this.sessionId },
    });
  }

  /**
   * Resume paused turn (SIGCONT)
   */
  resume(): void {
    if (this.state !== 'paused') {
      console.warn('[SessionProcess] Cannot resume - not paused', {
        sessionId: this.sessionId,
        state: this.state,
      });
      return;
    }

    console.log('[SessionProcess] Resuming session:', this.sessionId);
    this.process.kill('SIGCONT');
    this.state = 'processing';
    this.lastActivityAt = Date.now();

    // Notify frontend
    this.webview.postMessage({
      type: 'session-resumed',
      data: { sessionId: this.sessionId },
    });
  }

  /**
   * Stop current turn and clear queue (SIGTERM)
   */
  stop(): void {
    console.log('[SessionProcess] Stopping session:', {
      sessionId: this.sessionId,
      queueSize: this.messageQueue.size(),
    });

    this.process.kill('SIGTERM');
    this.messageQueue.clear();
    this.state = 'stopped';
    this.lastActivityAt = Date.now();

    // Resolve any pending turn
    if (this.currentTurnResolver) {
      this.currentTurnResolver();
      this.currentTurnResolver = undefined;
    }

    // Notify frontend
    this.webview.postMessage({
      type: 'session-stopped',
      data: { sessionId: this.sessionId },
    });
  }

  /**
   * Get session metadata
   */
  getMetadata(): SessionProcessMetadata {
    return {
      sessionId: this.sessionId,
      state: this.state,
      queuedMessages: this.messageQueue.size(),
      processId: this.process.pid,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
    };
  }

  /**
   * Check if process is alive
   */
  isAlive(): boolean {
    return !this.process.killed && this.state !== 'stopped';
  }

  /**
   * Get idle duration in milliseconds
   */
  getIdleDuration(): number {
    return Date.now() - this.lastActivityAt;
  }

  /**
   * Process message queue
   * Continues until queue is empty or state changes
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return; // Already processing
    }

    this.isProcessingQueue = true;

    try {
      while (!this.messageQueue.isEmpty() && this.state === 'idle') {
        const message = this.messageQueue.dequeue();
        if (!message) break;

        console.log('[SessionProcess] Processing message:', {
          sessionId: this.sessionId,
          contentLength: message.content.length,
          remainingQueue: this.messageQueue.size(),
        });

        this.state = 'processing';
        this.lastActivityAt = Date.now();

        // Write to stdin
        await this.writeToStdin(message.content);

        // Wait for turn to complete (message_stop event)
        await this.waitForTurnComplete();

        this.state = 'idle';
        this.lastActivityAt = Date.now();
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Write message to stdin with backpressure handling
   */
  private async writeToStdin(content: string): Promise<void> {
    if (!this.process.stdin || this.process.stdin.destroyed) {
      throw new Error('stdin is not writable');
    }

    return new Promise<void>((resolve, reject) => {
      const canWrite = this.process.stdin!.write(content + '\n');

      if (canWrite) {
        resolve();
      } else {
        // Wait for drain event (backpressure)
        this.process.stdin!.once('drain', () => resolve());
        this.process.stdin!.once('error', (err) =>
          reject(new Error(`stdin write error: ${err.message}`))
        );
      }
    });
  }

  /**
   * Wait for current turn to complete
   * Resolves when message_stop or result received
   */
  private async waitForTurnComplete(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.currentTurnResolver = resolve;
      // Resolver will be called by onTurnComplete()
    });
  }

  /**
   * Called when turn boundary detected (message_stop or result)
   */
  private onTurnComplete(): void {
    console.log('[SessionProcess] Turn completed:', {
      sessionId: this.sessionId,
      remainingQueue: this.messageQueue.size(),
    });

    if (this.currentTurnResolver) {
      this.currentTurnResolver();
      this.currentTurnResolver = undefined;
    }
  }

  /**
   * Setup JSONL stream parser and handlers
   */
  private setupStreamHandlers(): void {
    const callbacks: JSONLParserCallbacks = {
      onMessage: (message) => {
        // Forward all JSONL messages to webview (existing behavior)
        this.webview.postMessage({
          type: 'jsonl-message',
          data: {
            sessionId: this.sessionId,
            message,
          },
        });

        // Detect turn completion
        if (this.isMessageStop(message)) {
          this.onTurnComplete();
        }
      },

      onPermission: async (request) => {
        // Forward permission requests to webview
        this.webview.postMessage({
          type: 'permission-request',
          data: {
            sessionId: this.sessionId,
            request,
          },
        });
      },

      onError: (error, rawLine) => {
        console.error('[SessionProcess] Parser error:', {
          sessionId: this.sessionId,
          error: error.message,
          rawLine,
        });

        // Forward error to webview
        this.webview.postMessage({
          type: 'jsonl-error',
          data: {
            sessionId: this.sessionId,
            error: error.message,
            rawLine,
          },
        });
      },
    };

    const parser = new JSONLStreamParser(callbacks);

    // Pipe stdout through parser
    this.process.stdout?.on('data', (chunk: Buffer) => {
      try {
        parser.processChunk(chunk);
      } catch (error) {
        console.error('[SessionProcess] Failed to process chunk:', {
          sessionId: this.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const stderr = data.toString('utf8');
      console.error('[SessionProcess] STDERR:', {
        sessionId: this.sessionId,
        stderr,
      });
    });
  }

  /**
   * Setup process event handlers (close, error, etc.)
   */
  private setupProcessHandlers(): void {
    this.process.on('close', (code, signal) => {
      console.log('[SessionProcess] Process closed:', {
        sessionId: this.sessionId,
        code,
        signal,
        state: this.state,
      });

      this.state = 'stopped';

      // Notify frontend
      this.webview.postMessage({
        type: 'session-closed',
        data: {
          sessionId: this.sessionId,
          code,
          signal,
        },
      });

      // Resolve any pending turn
      if (this.currentTurnResolver) {
        this.currentTurnResolver();
        this.currentTurnResolver = undefined;
      }
    });

    this.process.on('error', (error) => {
      console.error('[SessionProcess] Process error:', {
        sessionId: this.sessionId,
        error: error.message,
      });

      this.state = 'stopped';

      // Notify frontend
      this.webview.postMessage({
        type: 'session-error',
        data: {
          sessionId: this.sessionId,
          error: error.message,
        },
      });
    });
  }

  /**
   * Detect if JSONL message signals turn completion
   */
  private isMessageStop(message: any): boolean {
    // Check for stream_event with message_stop
    if (
      message.type === 'stream_event' &&
      message.event?.type === 'message_stop'
    ) {
      return true;
    }

    // Check for result message (final message)
    if (message.type === 'result') {
      return true;
    }

    return false;
  }
}
