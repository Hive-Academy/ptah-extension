/**
 * SessionRegistry — Per-tab store for deep-agent graph instances.
 *
 * Phase 1 scope: tracks session metadata and AbortControllers so
 * interrupt/end operations can abort in-flight graph invocations.
 * Graph instance storage is opaque (`unknown`) at this layer so the
 * registry doesn't leak LangChain types across module boundaries.
 */

import { injectable } from 'tsyringe';
import type { SessionId } from '@ptah-extension/shared';

/**
 * Per-session state. `graph` is intentionally typed as `unknown` — this
 * registry only stores and retrieves it; the adapter casts on reference.
 */
export interface DeepAgentSession {
  readonly tabId: string;
  readonly sessionId: SessionId;
  readonly threadId: string;
  readonly graph: unknown;
  readonly abortController: AbortController;
  readonly startedAt: number;
  readonly providerId: string;
  readonly model: string;
}

@injectable()
export class SessionRegistry {
  private readonly sessions = new Map<string, DeepAgentSession>();

  register(session: DeepAgentSession): void {
    this.sessions.set(String(session.sessionId), session);
  }

  get(sessionId: SessionId): DeepAgentSession | undefined {
    return this.sessions.get(String(sessionId));
  }

  getByTabId(tabId: string): DeepAgentSession | undefined {
    for (const s of this.sessions.values()) {
      if (s.tabId === tabId) return s;
    }
    return undefined;
  }

  remove(sessionId: SessionId): boolean {
    return this.sessions.delete(String(sessionId));
  }

  has(sessionId: SessionId): boolean {
    return this.sessions.has(String(sessionId));
  }

  size(): number {
    return this.sessions.size;
  }

  forEach(cb: (session: DeepAgentSession) => void): void {
    this.sessions.forEach(cb);
  }

  clear(): void {
    for (const s of this.sessions.values()) {
      try {
        s.abortController.abort();
      } catch {
        // best-effort
      }
    }
    this.sessions.clear();
  }
}
