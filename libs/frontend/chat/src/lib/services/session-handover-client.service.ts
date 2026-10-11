import { Injectable, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  SessionId,
  type SessionHandoverState,
  type SessionSuccessorReplacementPayload,
} from '@ptah-extension/shared';

function isHandoverState(value: unknown): value is SessionHandoverState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state['operationId'] === 'string' &&
    typeof state['sourceSessionId'] === 'string' &&
    typeof state['phase'] === 'string' &&
    typeof state['revision'] === 'number' &&
    Number.isSafeInteger(state['revision'])
  );
}

/**
 * Session-handover state at the webview boundary.  Stats can arrive before a
 * terminal turn_state, so this service deliberately stores state only; views
 * decide when their tab is idle enough to display it.
 */
@Injectable({ providedIn: 'root' })
export class SessionHandoverClientService {
  private readonly tabManager = inject(TabManagerService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly states = signal<Record<string, SessionHandoverState>>({});

  stateFor(sessionId: string | null): SessionHandoverState | null {
    return sessionId ? (this.states()[sessionId] ?? null) : null;
  }

  /** Installs only a newer coordinator publication for its source session. */
  record(sessionId: string, candidate: unknown): boolean {
    if (!isHandoverState(candidate) || candidate.sourceSessionId !== sessionId) {
      return false;
    }
    const previous = this.states()[sessionId];
    if (previous && candidate.revision <= previous.revision) return false;
    this.states.update((states) => ({ ...states, [sessionId]: candidate }));
    return true;
  }

  /**
   * Binds the replacement into the original tab slot before acknowledging it.
   * An old operation can never replace a newer session because its operation id
   * must still match the latest revisioned state for the source.
   */
  async bindSuccessor(payload: SessionSuccessorReplacementPayload): Promise<void> {
    const handover = this.stateFor(payload.sourceSessionId);
    if (!handover || handover.operationId !== payload.operationId) return;
    const source = this.tabManager.findTabByIdAcrossWorkspaces(payload.sourceTabId);
    if (!source || source.tab.claudeSessionId !== payload.sourceSessionId) return;
    const successor = SessionId.safeParse(payload.successorSessionId);
    if (!successor) return;

    this.tabManager.rebindTabSession(
      payload.sourceTabId,
      successor,
      source.tab.title,
    );
    if (payload.config.model !== undefined) {
      this.tabManager.setOverrideModel(payload.sourceTabId, payload.config.model);
    }
    if (payload.config.effort !== undefined) {
      this.tabManager.setOverrideEffort(payload.sourceTabId, payload.config.effort);
    }
    this.tabManager.switchTab(payload.sourceTabId);

    try {
      await this.rpc.call('session:successorBound', {
        operationId: payload.operationId,
        sourceTabId: payload.sourceTabId,
        successorTabId: payload.successorTabId,
      });
    } catch (error) {
      // The host timeout restores the source/FIFO if this acknowledgement does
      // not arrive. The tab remains focused so the user never loses the draft.
      console.warn('[SessionHandover] successor acknowledgement failed', error);
    }
  }
}
