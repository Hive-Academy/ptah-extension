/**
 * PTY Manager Service
 *
 * Manages pseudo-terminal sessions in the Electron main process.
 * Spawns node-pty instances, tracks them by session ID, and forwards
 * data/exit events via registered callbacks.
 *
 * TASK_2025_227 Batch 4: Terminal integration backend
 *
 * Design:
 * - Plain class (NOT @injectable) -- instantiated in DI container setup
 * - Session ID: crypto.randomUUID()
 * - Limits: max 20 total sessions, max 5 per workspace
 * - Shell detection: COMSPEC on Windows, SHELL on Unix
 * - Data/exit forwarding via registered callbacks (set by IpcBridge)
 */

import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import type { Logger } from '@ptah-extension/vscode-core';

const MAX_TOTAL_SESSIONS = 20;
const MAX_SESSIONS_PER_WORKSPACE = 5;

interface PtySession {
  id: string;
  pty: pty.IPty;
  workspacePath: string;
}

type DataCallback = (id: string, data: string) => void;
type ExitCallback = (id: string, exitCode: number) => void;

export class PtyManagerService {
  private readonly sessions = new Map<string, PtySession>();
  private dataCallback: DataCallback | null = null;
  private exitCallback: ExitCallback | null = null;

  constructor(private readonly logger: Logger) {}

  /**
   * Register callback for terminal data output.
   * Called by IpcBridge to forward PTY output to the renderer process.
   */
  onData(callback: DataCallback): void {
    this.dataCallback = callback;
  }

  /**
   * Register callback for terminal exit events.
   * Called by IpcBridge to notify the renderer when a PTY session ends.
   */
  onExit(callback: ExitCallback): void {
    this.exitCallback = callback;
  }

  /**
   * Create a new PTY session.
   *
   * @param params.cwd - Working directory for the shell
   * @param params.shell - Optional shell executable override
   * @param params.name - Optional display name (unused by PTY, stored for reference)
   * @returns Session ID and PID of the spawned process
   * @throws Error if session limits are exceeded
   */
  create(params: { cwd: string; shell?: string; name?: string }): {
    id: string;
    pid: number;
  } {
    // Enforce total session limit
    if (this.sessions.size >= MAX_TOTAL_SESSIONS) {
      throw new Error(
        `Maximum total terminal sessions reached (${MAX_TOTAL_SESSIONS})`,
      );
    }

    // Enforce per-workspace session limit
    const workspaceSessions = this.getSessionsForWorkspace(params.cwd);
    if (workspaceSessions.length >= MAX_SESSIONS_PER_WORKSPACE) {
      throw new Error(
        `Maximum terminal sessions per workspace reached (${MAX_SESSIONS_PER_WORKSPACE})`,
      );
    }

    const id = randomUUID();
    const shell = params.shell || this.getDefaultShell();

    this.logger.info('[PtyManager] Creating PTY session', {
      id,
      shell,
      cwd: params.cwd,
    } as unknown as Error);

    const ptyInstance = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd: params.cwd,
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>,
    });

    const session: PtySession = {
      id,
      pty: ptyInstance,
      workspacePath: params.cwd,
    };

    this.sessions.set(id, session);

    // Forward PTY output data to the registered callback
    ptyInstance.onData((data: string) => {
      if (this.dataCallback) {
        this.dataCallback(id, data);
      }
    });

    // Handle PTY exit
    ptyInstance.onExit(({ exitCode }) => {
      this.logger.info('[PtyManager] PTY session exited', {
        id,
        exitCode,
      } as unknown as Error);

      // Notify via callback before cleanup
      if (this.exitCallback) {
        this.exitCallback(id, exitCode);
      }

      // Remove from session map
      this.sessions.delete(id);
    });

    this.logger.info('[PtyManager] PTY session created', {
      id,
      pid: ptyInstance.pid,
      totalSessions: this.sessions.size,
    } as unknown as Error);

    return { id, pid: ptyInstance.pid };
  }

  /**
   * Write data to a PTY session (keyboard input from renderer).
   */
  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      this.logger.warn('[PtyManager] Write to unknown session', {
        id,
      } as unknown as Error);
      return;
    }
    session.pty.write(data);
  }

  /**
   * Resize a PTY session to new dimensions.
   */
  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) {
      this.logger.warn('[PtyManager] Resize unknown session', {
        id,
      } as unknown as Error);
      return;
    }

    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
    }
  }

  /**
   * Kill a PTY session by ID.
   */
  kill(id: string): { success: boolean; error?: string } {
    const session = this.sessions.get(id);
    if (!session) {
      return { success: false, error: `Session ${id} not found` };
    }

    try {
      session.pty.kill();
      // Note: The onExit handler will remove the session from the map
      this.logger.info('[PtyManager] PTY session killed', {
        id,
      } as unknown as Error);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[PtyManager] Failed to kill PTY session', {
        id,
        error: message,
      } as unknown as Error);
      return { success: false, error: message };
    }
  }

  /**
   * Kill all PTY sessions associated with a workspace path.
   * Called during workspace removal cleanup.
   */
  killAllForWorkspace(workspacePath: string): void {
    const sessionIds = this.getSessionsForWorkspace(workspacePath);
    this.logger.info('[PtyManager] Killing all sessions for workspace', {
      workspacePath,
      count: sessionIds.length,
    } as unknown as Error);

    for (const id of sessionIds) {
      this.kill(id);
    }
  }

  /**
   * Get all active session IDs for a given workspace path.
   */
  getSessionsForWorkspace(workspacePath: string): string[] {
    const ids: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.workspacePath === workspacePath) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Dispose all PTY sessions. Called on application shutdown.
   */
  disposeAll(): void {
    this.logger.info('[PtyManager] Disposing all PTY sessions', {
      count: this.sessions.size,
    } as unknown as Error);

    for (const [id, session] of this.sessions) {
      try {
        session.pty.kill();
      } catch (error) {
        this.logger.warn('[PtyManager] Error killing session during dispose', {
          id,
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error);
      }
    }

    this.sessions.clear();
    this.dataCallback = null;
    this.exitCallback = null;
  }

  /**
   * Detect the default shell for the current platform.
   * Windows: COMSPEC env var or cmd.exe fallback
   * Unix: SHELL env var or /bin/bash fallback
   */
  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env['COMSPEC'] || 'cmd.exe';
    }
    return process.env['SHELL'] || '/bin/bash';
  }
}
