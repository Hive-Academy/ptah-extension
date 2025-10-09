/**
 * Session Manager - Tracks Claude CLI session state and resume tokens
 * SOLID: Single Responsibility - Only manages session lifecycle
 */

import { SessionId, ClaudeSessionResume } from '@ptah-extension/shared';

export interface SessionMetadata {
  readonly sessionId: SessionId;
  readonly claudeSessionId?: string; // From Claude CLI init message
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly model?: string;
  readonly workspaceRoot?: string;
}

/**
 * Manages Claude CLI session state for resumption
 */
export class SessionManager {
  private sessions = new Map<SessionId, SessionMetadata>();

  /**
   * Create new session
   */
  createSession(
    sessionId: SessionId,
    options?: { model?: string; workspaceRoot?: string }
  ): SessionMetadata {
    const metadata: SessionMetadata = {
      sessionId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      model: options?.model,
      workspaceRoot: options?.workspaceRoot,
    };

    this.sessions.set(sessionId, metadata);
    return metadata;
  }

  /**
   * Update session with Claude CLI's internal session ID (from init message)
   */
  setClaudeSessionId(sessionId: SessionId, claudeSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.sessions.set(sessionId, {
      ...session,
      claudeSessionId,
      lastActivityAt: Date.now(),
    });
  }

  /**
   * Get session metadata
   */
  getSession(sessionId: SessionId): SessionMetadata | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get resume info for continuation
   */
  getResumeInfo(sessionId: SessionId): ClaudeSessionResume | null {
    const session = this.sessions.get(sessionId);

    if (!session?.claudeSessionId) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      claudeSessionId: session.claudeSessionId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    };
  }

  /**
   * Update last activity timestamp
   */
  touchSession(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, {
        ...session,
        lastActivityAt: Date.now(),
      });
    }
  }

  /**
   * End session and clear from memory
   */
  endSession(sessionId: SessionId): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear all sessions (for testing/cleanup)
   */
  clearAll(): void {
    this.sessions.clear();
  }
}
