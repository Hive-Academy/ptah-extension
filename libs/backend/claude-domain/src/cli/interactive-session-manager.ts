/**
 * Interactive Session Manager - Manages interactive Claude CLI processes
 *
 * Responsibilities:
 * - One CLI process per session (no process killing)
 * - Message queueing when session is busy
 * - Pause/resume/stop support
 * - Session lifecycle management
 * - Idle session cleanup
 */

import { ChildProcess } from 'child_process';
import type * as vscode from 'vscode';
import { SessionId } from '@ptah-extension/shared';
import { SessionProcess, SessionProcessMetadata } from './session-process';
import { ClaudeCliLauncher } from './claude-cli-launcher';

export interface InteractiveSessionManagerOptions {
  readonly maxQueueSize?: number;
  readonly maxIdleMs?: number;
  readonly cleanupIntervalMs?: number;
}

/**
 * Manages interactive CLI sessions with message queueing and pause/resume support
 */
export class InteractiveSessionManager {
  private readonly sessions = new Map<SessionId, SessionProcess>();
  private readonly maxIdleMs: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly cliLauncher: ClaudeCliLauncher,
    private readonly webview: vscode.Webview,
    private readonly options: InteractiveSessionManagerOptions = {}
  ) {
    this.maxIdleMs = options.maxIdleMs ?? 5 * 60 * 1000; // 5 minutes default

    // Start cleanup interval
    if (options.cleanupIntervalMs) {
      this.startCleanupInterval(options.cleanupIntervalMs);
    }
  }

  /**
   * Send message to session
   * Creates session if it doesn't exist, queues if busy
   */
  async sendMessage(
    sessionId: SessionId,
    content: string,
    files?: readonly string[]
  ): Promise<void> {
    let sessionProcess = this.sessions.get(sessionId);

    // Create session if it doesn't exist
    if (!sessionProcess || !sessionProcess.isAlive()) {
      console.log(
        '[InteractiveSessionManager] Creating new session:',
        sessionId
      );
      sessionProcess = await this.createSession(sessionId);
    }

    // Send message (queues if busy)
    await sessionProcess.sendMessage(content, files);
  }

  /**
   * Pause current turn (SIGTSTP)
   */
  pauseSession(sessionId: SessionId): void {
    const sessionProcess = this.sessions.get(sessionId);
    if (!sessionProcess) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    sessionProcess.pause();
  }

  /**
   * Resume paused turn (SIGCONT)
   */
  resumeSession(sessionId: SessionId): void {
    const sessionProcess = this.sessions.get(sessionId);
    if (!sessionProcess) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    sessionProcess.resume();
  }

  /**
   * Stop current turn and clear queue (SIGTERM)
   */
  stopSession(sessionId: SessionId): void {
    const sessionProcess = this.sessions.get(sessionId);
    if (!sessionProcess) {
      console.warn(
        '[InteractiveSessionManager] Session not found for stop:',
        sessionId
      );
      return;
    }

    sessionProcess.stop();
  }

  /**
   * Get session state metadata
   */
  getSessionMetadata(sessionId: SessionId): SessionProcessMetadata | undefined {
    const sessionProcess = this.sessions.get(sessionId);
    return sessionProcess?.getMetadata();
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): Map<SessionId, SessionProcessMetadata> {
    const metadata = new Map<SessionId, SessionProcessMetadata>();
    for (const [sessionId, sessionProcess] of this.sessions) {
      metadata.set(sessionId, sessionProcess.getMetadata());
    }
    return metadata;
  }

  /**
   * Check if session exists and is alive
   */
  hasActiveSession(sessionId: SessionId): boolean {
    const sessionProcess = this.sessions.get(sessionId);
    return !!sessionProcess && sessionProcess.isAlive();
  }

  /**
   * Clean up idle sessions
   * Removes sessions that have been idle for longer than maxIdleMs
   */
  cleanupIdleSessions(): number {
    let cleanedCount = 0;

    for (const [sessionId, sessionProcess] of this.sessions) {
      if (!sessionProcess.isAlive()) {
        console.log(
          '[InteractiveSessionManager] Removing dead session:',
          sessionId
        );
        this.sessions.delete(sessionId);
        cleanedCount++;
        continue;
      }

      const idleDuration = sessionProcess.getIdleDuration();
      if (idleDuration > this.maxIdleMs) {
        console.log('[InteractiveSessionManager] Cleaning up idle session:', {
          sessionId,
          idleDuration,
          maxIdleMs: this.maxIdleMs,
        });

        sessionProcess.stop();
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(
        '[InteractiveSessionManager] Cleaned up sessions:',
        cleanedCount
      );
    }

    return cleanedCount;
  }

  /**
   * Dispose all sessions and stop cleanup
   */
  dispose(): void {
    console.log(
      '[InteractiveSessionManager] Disposing all sessions:',
      this.sessions.size
    );

    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Stop all sessions
    for (const [sessionId, sessionProcess] of this.sessions) {
      try {
        sessionProcess.stop();
      } catch (error) {
        console.error('[InteractiveSessionManager] Error stopping session:', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.sessions.clear();
  }

  /**
   * Create new interactive session process
   */
  private async createSession(sessionId: SessionId): Promise<SessionProcess> {
    // Spawn interactive CLI process (no -p flag)
    const process = await this.spawnInteractiveProcess(sessionId);

    // Create SessionProcess wrapper
    const sessionProcess = new SessionProcess(
      sessionId,
      process,
      this.webview,
      this.options.maxQueueSize
    );

    // Store in map
    this.sessions.set(sessionId, sessionProcess);

    console.log('[InteractiveSessionManager] Session created:', {
      sessionId,
      processId: process.pid,
    });

    return sessionProcess;
  }

  /**
   * Spawn interactive CLI process
   * Uses ClaudeCliLauncher but without -p flag
   */
  private async spawnInteractiveProcess(
    sessionId: SessionId
  ): Promise<ChildProcess> {
    // TODO: Update ClaudeCliLauncher to support interactive mode
    // For now, this is a placeholder that will be implemented in Phase 2
    return this.cliLauncher.spawnInteractiveSession(sessionId);
  }

  /**
   * Start periodic cleanup of idle sessions
   */
  private startCleanupInterval(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      try {
        this.cleanupIdleSessions();
      } catch (error) {
        console.error('[InteractiveSessionManager] Cleanup error:', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);

    // Prevent interval from keeping process alive
    this.cleanupInterval.unref?.();
  }
}
