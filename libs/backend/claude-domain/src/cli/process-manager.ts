/**
 * Process Manager - Manages child processes per session turn
 * SOLID: Single Responsibility - Only manages process lifecycle
 */

import { ChildProcess } from 'child_process';
import { SessionId } from '@ptah-extension/shared';

export interface ProcessMetadata {
  readonly sessionId: SessionId;
  readonly process: ChildProcess;
  readonly startedAt: number;
  readonly command: string;
  readonly args: string[];
}

/**
 * Manages active Claude CLI child processes
 */
export class ProcessManager {
  private processes = new Map<SessionId, ProcessMetadata>();

  /**
   * Register a new process for a session
   */
  registerProcess(
    sessionId: SessionId,
    process: ChildProcess,
    command: string,
    args: string[]
  ): void {
    // Kill existing process for this session if any
    this.killProcess(sessionId);

    const metadata: ProcessMetadata = {
      sessionId,
      process,
      startedAt: Date.now(),
      command,
      args,
    };

    this.processes.set(sessionId, metadata);

    // Auto-cleanup on process exit
    process.on('close', () => {
      this.processes.delete(sessionId);
    });
  }

  /**
   * Get process for a session
   */
  getProcess(sessionId: SessionId): ChildProcess | undefined {
    return this.processes.get(sessionId)?.process;
  }

  /**
   * Get process metadata
   */
  getProcessMetadata(sessionId: SessionId): ProcessMetadata | undefined {
    return this.processes.get(sessionId);
  }

  /**
   * Kill process for a session
   */
  killProcess(sessionId: SessionId): boolean {
    const metadata = this.processes.get(sessionId);
    if (!metadata) {
      return false;
    }

    try {
      metadata.process.kill('SIGTERM');
      this.processes.delete(sessionId);
      return true;
    } catch {
      // Process may have already exited
      this.processes.delete(sessionId);
      return false;
    }
  }

  /**
   * Kill all active processes
   */
  killAll(): void {
    for (const sessionId of this.processes.keys()) {
      this.killProcess(sessionId);
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): SessionId[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Check if session has active process
   */
  hasActiveProcess(sessionId: SessionId): boolean {
    return this.processes.has(sessionId);
  }

  /**
   * Get process count
   */
  getProcessCount(): number {
    return this.processes.size;
  }
}
